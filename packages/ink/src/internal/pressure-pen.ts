import type { Point, Rect } from "@folio/rendering";
import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type {
  BrushHitSample,
  FilledPathBand,
  FilledPathRenderGeometry,
  LiveBrushEvaluator,
  LiveEvaluationSnapshot,
} from "./brush-geometry";

/**
 * `pressure-pen@1`: a solid stroke whose width and opacity follow pressure.
 *
 * The first genuinely dynamic strategy, and deliberately built on Technical
 * Pen's structure rather than beside it. Everything that made a constant-width
 * prefix stable still applies -- a fixed smoothing window, causal decimation,
 * and constants taken from the brush's own size rather than from the stroke's
 * extent -- and pressure is simply one more quantity evaluated per sample under
 * exactly those rules.
 *
 * Two things are specific to a varying width:
 *
 * - **The silhouette is filled, not stroked.** A Canvas line has one width, so
 *   a variable-width mark has to be a closed boundary. Each kept sample
 *   contributes one point per side, with a tessellated arc on the outside of a
 *   real corner, and the ends take round caps.
 * - **Opacity is painted in bands.** Canvas has no alpha that varies along a
 *   path, so a run of samples at a similar alpha becomes one closed shape
 *   filled once. Consecutive bands are cut at the midpoint of the span between
 *   two samples and share that cut cross-section exactly, so they tile instead
 *   of overlapping: a seam between two alphas is a seam, not a dark rung.
 *
 * What is deliberately absent: velocity response, taper, texture, scatter and
 * tilt. Pressure is the whole dynamic.
 */

const EPSILON = 0.000_001;

/** Decimation distance as a fraction of nominal width, with page-space guard rails. */
const SPACING_WIDTH_FACTOR = 0.25;
const MINIMUM_SPACING_FLOOR = 0.35;
const MINIMUM_SPACING_CEILING = 2;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/** The turn above which a corner is tessellated rather than mitred, matching `outline@1`. */
const ROUND_JOIN_MINIMUM_ANGLE = 0.35;

/** Angular resolution of a tessellated corner or cap. */
const JOIN_ARC_STEP = Math.PI / 16;

/**
 * How far two alphas may drift before the silhouette is cut into a new band.
 *
 * This is the only thing bounding how many fills a stroke costs, and one part
 * in 64 is below what a reader can see as a step while keeping a full-range
 * pressure ramp to a few dozen bands.
 */
const ALPHA_BAND_TOLERANCE = 1 / 64;

/**
 * The shortest run of spans a band may cover before it may be cut again.
 *
 * The tolerance above absorbs the pressure noise a real stylus produces; this
 * bounds the pathological case, where a signal swinging across that tolerance
 * every few samples would otherwise buy a fill per sample.
 *
 * Sixteen because the cost that matters is fills relative to boundary points,
 * not fills in absolute terms. A band covers at least sixteen spans, so it
 * amortizes at least thirty-two vertices, and the banding overhead stays a
 * bounded fraction of the drawing it rides on however long the stroke gets. At
 * the decimation spacing that is roughly four brush widths -- long enough that
 * an alpha change reads as a gradient along the stroke rather than a rung
 * across it, and far shorter than a pen takes to change pressure by anything a
 * reader could see.
 */
const MINIMUM_BAND_SPANS = 16;

const EMPTY_BANDS: readonly FilledPathBand[] = Object.freeze([]);
const ZERO_DIRECTION: Point = Object.freeze({ x: 1, y: 0 });

interface CenterSample {
  readonly x: number;
  readonly y: number;
  /** Page-space radius, already divided by the rendered scale. */
  readonly radius: number;
  /** Resolved page alpha, base opacity already included. */
  readonly alpha: number;
}

interface MutableBand {
  readonly alpha: number;
  /** The span this band opened on, so its length is known without counting. */
  readonly startSpan: number;
  readonly left: Point[];
  readonly right: Point[];
  readonly roundStart: boolean;
  roundEnd: boolean;
  readonly startCenter: Point;
  readonly startRadius: number;
  endCenter: Point;
  endRadius: number;
}

/**
 * Where emission may resume without recomputing anything settled.
 *
 * Restoring it is three assignments, which is what keeps a frame's cost
 * independent of how long the stroke already is.
 */
interface EmissionCheckpoint {
  readonly spanCount: number;
  readonly bandCount: number;
  readonly leftLength: number;
  readonly rightLength: number;
}

interface Extent {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

interface EvaluatedSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export class PressurePenEvaluator implements LiveBrushEvaluator {
  readonly #brush: ResolvedBrushSnapshot;
  readonly #renderedScale: number;
  readonly #smoothingRadius: number;
  readonly #smoothingAmount: number;
  readonly #lookaheadSamples: number;
  readonly #minimumSpacing: number;
  readonly #kept: CenterSample[] = [];
  readonly #bands: MutableBand[] = [];
  readonly #settledExtent: Extent = emptyExtent();
  #provisionalExtent: Extent = emptyExtent();
  #checkpoint: EmissionCheckpoint = Object.freeze({
    spanCount: 0,
    bandCount: 0,
    leftLength: 0,
    rightLength: 0,
  });
  #settledKeptCount = 0;
  #settledRawCount = 0;
  #sourcePointCount = 0;
  #finalized = false;
  #settledPointEvaluations = 0;
  #tailPointEvaluations = 0;
  #maximumTailPointEvaluations = 0;

  constructor(brush: ResolvedBrushSnapshot, renderedScale: number) {
    if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
      throw new RangeError("Pressure Pen render scale must be positive and finite.");
    }
    this.#brush = brush;
    this.#renderedScale = renderedScale;
    const smoothing = brush.smoothing;
    const active = smoothing.mode !== "none" && smoothing.amount > 0;
    this.#smoothingAmount = active ? clamp(smoothing.amount, 0, 1) : 0;
    this.#smoothingRadius = active
      ? Math.min(MAXIMUM_SMOOTHING_RADIUS, 1 + Math.floor(this.#smoothingAmount * 3))
      : 0;
    // At least one sample is always held back, so the terminal sample reaches
    // the rule that keeps it regardless of spacing.
    this.#lookaheadSamples = Math.max(this.#smoothingRadius, 1);
    // Divided by the rendered scale, unlike a stroked path: a filled boundary
    // is straight between samples, so a zoomed-in stroke needs its samples
    // closer together to stay smooth rather than reading as facets.
    this.#minimumSpacing =
      clamp(brush.size * SPACING_WIDTH_FACTOR, MINIMUM_SPACING_FLOOR, MINIMUM_SPACING_CEILING) /
      renderedScale;
  }

  /**
   * Consumes every sample not yet consumed, then rebuilds only the open tail.
   *
   * `final` promotes the whole stroke: the terminal sample is where the pen
   * actually stopped, so it is admitted under a rule of its own and everything
   * becomes settled at once.
   */
  append(points: readonly StrokePoint[], final: boolean): void {
    if (this.#finalized) return;
    this.#sourcePointCount = points.length;
    // The previous frame's provisional work is thrown away; settled work is not
    // in this range and is therefore never recomputed.
    this.#kept.length = this.#settledKeptCount;
    this.#provisionalExtent = emptyExtent();

    const settleLimit = final ? points.length : Math.max(0, points.length - this.#lookaheadSamples);
    while (this.#settledRawCount < settleLimit) {
      const index = this.#settledRawCount;
      this.#settledPointEvaluations += 1;
      this.#consume(points, index, final && index === points.length - 1, true);
      this.#settledKeptCount = this.#kept.length;
      this.#settledRawCount = index + 1;
    }

    this.#tailPointEvaluations = 0;
    for (let index = this.#settledRawCount; index < points.length; index += 1) {
      this.#tailPointEvaluations += 1;
      // The newest sample is treated as terminal whether or not the stroke has
      // ended. It keeps the drawn tip exactly under the pen, at exactly the
      // pressure the pen reports, instead of lagging behind both -- and it is
      // why lifting the pen moves nothing.
      this.#consume(points, index, index === points.length - 1, false);
    }
    this.#maximumTailPointEvaluations = Math.max(
      this.#maximumTailPointEvaluations,
      this.#tailPointEvaluations,
    );

    this.#emit(final);
    if (final) this.#finalized = true;
  }

  /**
   * The current silhouette.
   *
   * Band boundaries alias evaluator state so a live frame allocates nothing
   * proportional to the stroke; they are valid until the next `append`. Use
   * {@link frozenGeometry} for anything retained.
   */
  geometry(): FilledPathRenderGeometry {
    return this.#geometry(false);
  }

  /** An immutable copy, for geometry that outlives the evaluator. */
  frozenGeometry(): FilledPathRenderGeometry {
    return this.#geometry(true);
  }

  evaluationSnapshot(): LiveEvaluationSnapshot {
    return Object.freeze({
      settledPointEvaluations: this.#settledPointEvaluations,
      tailPointEvaluations: this.#tailPointEvaluations,
      maximumTailPointEvaluations: this.#maximumTailPointEvaluations,
      settledSegmentCount: this.#checkpoint.spanCount,
      segmentCount: Math.max(0, this.#kept.length - 1),
      keptPointCount: this.#kept.length,
      lookaheadSamples: this.#lookaheadSamples,
    });
  }

  #geometry(frozen: boolean): FilledPathRenderGeometry {
    const kept = this.#kept;
    const extent = copyExtent(this.#settledExtent);
    unionExtent(extent, this.#provisionalExtent);
    const first = kept[0];
    const isDot = kept.length < 2 && first !== undefined;
    return Object.freeze({
      kind: "filled-path",
      bands: isDot ? EMPTY_BANDS : bandViews(this.#bands, frozen),
      dot:
        isDot && first !== undefined
          ? Object.freeze({
              center: Object.freeze({ x: first.x, y: first.y }),
              radius: first.radius,
              alpha: first.alpha,
            })
          : null,
      hitGeometry: frozen ? Object.freeze(kept.map(freezeHitSample)) : kept,
      renderedScale: this.#renderedScale,
      bounds: extentRect(extent),
      sourcePointCount: this.#sourcePointCount,
      keptPointCount: kept.length,
    });
  }

  #consume(
    points: readonly StrokePoint[],
    index: number,
    terminal: boolean,
    settled: boolean,
  ): void {
    const evaluated = this.#evaluate(points, index, terminal);
    // Read through the shared pressure evaluator rather than reimplementing the
    // curve, so a preset's durable dynamics mean the same thing here as they do
    // in bounds, in the legacy strategies, and on disk.
    const radius = Math.max(
      brushSizeAtPressure(this.#brush, evaluated.pressure) / (this.#renderedScale * 2),
      EPSILON,
    );
    const alpha = clamp(
      this.#brush.opacity *
        evaluatePressureResponse(this.#brush.dynamics.pressureOpacity, evaluated.pressure),
      0,
      1,
    );
    const sample = Object.freeze({ x: evaluated.x, y: evaluated.y, radius, alpha });
    const last = this.#kept.at(-1);
    if (last === undefined) {
      this.#keep(sample, settled);
      return;
    }
    const separation = Math.hypot(sample.x - last.x, sample.y - last.y);
    if (separation >= this.#minimumSpacing) {
      this.#keep(sample, settled);
      return;
    }
    // Where the pen stopped, and how hard it was pressing there, is information
    // no later sample can supply. A zero-length step is still refused: it would
    // add a cap, not a stroke.
    if (terminal && separation > EPSILON) this.#keep(sample, settled);
  }

  #keep(sample: CenterSample, settled: boolean): void {
    this.#kept.push(sample);
    // Every boundary point a sample contributes -- offset, corner arc or cap --
    // lies within its own disc, so folding the disc bounds the silhouette
    // without waiting for the boundary to be built.
    foldDisc(settled ? this.#settledExtent : this.#provisionalExtent, sample);
  }

  /**
   * Position and pressure under one fixed window.
   *
   * Both are smoothed by the same weights for the same reason: a point that
   * stops moving once it has a fixed number of successors is a point that can
   * settle, and a pressure that does the same keeps width from stepping.
   */
  #evaluate(points: readonly StrokePoint[], index: number, terminal: boolean): EvaluatedSample {
    const current = requirePoint(points, index);
    const radius = this.#smoothingRadius;
    // Both ends stay exactly where the pen was, at exactly the pressure it
    // reported. Smoothing an endpoint would pull the stroke away from where the
    // artist started or stopped it, and soften the pressure they ended on.
    if (radius === 0 || index === 0 || terminal) {
      return { x: current.x, y: current.y, pressure: normalizePressure(current.pressure) };
    }
    const first = Math.max(0, index - radius);
    const last = Math.min(points.length - 1, index + radius);
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let weightedPressure = 0;
    for (let sampleIndex = first; sampleIndex <= last; sampleIndex += 1) {
      const sample = requirePoint(points, sampleIndex);
      const weight = radius + 1 - Math.abs(sampleIndex - index);
      totalWeight += weight;
      weightedX += sample.x * weight;
      weightedY += sample.y * weight;
      weightedPressure += normalizePressure(sample.pressure) * weight;
    }
    const amount = this.#smoothingAmount;
    const pressure = normalizePressure(current.pressure);
    return {
      x: current.x + (weightedX / totalWeight - current.x) * amount,
      y: current.y + (weightedY / totalWeight - current.y) * amount,
      pressure: clamp(pressure + (weightedPressure / totalWeight - pressure) * amount, 0, 1),
    };
  }

  /** Rebuilds the boundary from the last settled cut forward, and no further back. */
  #emit(final: boolean): void {
    const kept = this.#kept;
    const checkpoint = this.#checkpoint;
    this.#bands.length = checkpoint.bandCount;
    const reopened = this.#bands.at(-1);
    if (reopened !== undefined) {
      reopened.left.length = checkpoint.leftLength;
      reopened.right.length = checkpoint.rightLength;
      reopened.roundEnd = false;
    }
    // One sample is a dot, which has a mark but no silhouette.
    if (kept.length < 2) return;
    if (this.#bands.length === 0) {
      this.#bands.push(createBand(requireSample(kept, 0), 0, true));
    }
    const settledSpans = final ? kept.length - 1 : Math.max(0, this.#settledKeptCount - 1);
    for (let span = checkpoint.spanCount; span + 1 < kept.length; span += 1) {
      const settled = span < settledSpans;
      this.#emitJoin(span);
      this.#emitCut(span, settled);
      if (span + 1 === settledSpans) this.#saveCheckpoint(settledSpans);
    }
    this.#emitTerminal(kept.length - 1);
  }

  /** The two boundary points one sample contributes, or an arc where it turns. */
  #emitJoin(index: number): void {
    const kept = this.#kept;
    const current = requireSample(kept, index);
    const next = requireSample(kept, index + 1);
    const band = this.#openBand();
    const outgoing = direction(current, next);
    const previous = kept[index - 1];
    if (previous === undefined) {
      pushOffsets(band, current, leftNormal(outgoing));
      return;
    }
    const incoming = direction(previous, current);
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const turn = Math.acos(clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1));
    if (!Number.isFinite(turn) || turn < ROUND_JOIN_MINIMUM_ANGLE) {
      pushOffsets(band, current, leftNormal(bisector(incoming, outgoing)));
      return;
    }
    // The outside of a real corner is the arc the pen tip actually sweeps; the
    // inside takes the bisector, which is where the two sides of the turn meet.
    const entering = leftNormal(incoming);
    const straddling = leftNormal(bisector(incoming, outgoing));
    const sweep = turn * (cross >= 0 ? 1 : -1);
    const enteringAngle = Math.atan2(entering.y, entering.x);
    if (cross >= 0) {
      band.left.push(offsetPoint(current, straddling, 1));
      pushArc(band.right, current, enteringAngle + Math.PI, sweep);
      return;
    }
    pushArc(band.left, current, enteringAngle, sweep);
    band.right.push(offsetPoint(current, straddling, -1));
  }

  /**
   * Cuts the silhouette where alpha has drifted far enough to need its own fill.
   *
   * The cut is a cross-section at the midpoint of the span, taken from that
   * span's own direction so it is unambiguous, and **both** bands are given the
   * same two points. Sharing the edge exactly is what stops the seam between
   * two alphas from compositing twice.
   */
  #emitCut(span: number, settled: boolean): void {
    const kept = this.#kept;
    const next = requireSample(kept, span + 1);
    const band = this.#openBand();
    if (Math.abs(next.alpha - band.alpha) <= ALPHA_BAND_TOLERANCE) return;
    if (span - band.startSpan < MINIMUM_BAND_SPANS) return;
    const current = requireSample(kept, span);
    const normal = leftNormal(direction(current, next));
    const cut: CenterSample = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
      radius: (current.radius + next.radius) / 2,
      alpha: next.alpha,
    };
    const left = offsetPoint(cut, normal, 1);
    const right = offsetPoint(cut, normal, -1);
    band.left.push(left);
    band.right.push(right);
    band.endCenter = Object.freeze({ x: cut.x, y: cut.y });
    band.endRadius = cut.radius;
    foldDisc(settled ? this.#settledExtent : this.#provisionalExtent, cut);
    this.#bands.push({
      alpha: next.alpha,
      startSpan: span + 1,
      left: [left],
      right: [right],
      roundStart: false,
      roundEnd: false,
      startCenter: Object.freeze({ x: cut.x, y: cut.y }),
      startRadius: cut.radius,
      endCenter: Object.freeze({ x: cut.x, y: cut.y }),
      endRadius: cut.radius,
    });
  }

  /** The last sample: a round cap at exactly the pressure the pen lifted on. */
  #emitTerminal(index: number): void {
    const kept = this.#kept;
    const current = requireSample(kept, index);
    const previous = requireSample(kept, index - 1);
    const band = this.#openBand();
    pushOffsets(band, current, leftNormal(direction(previous, current)));
    band.roundEnd = true;
    band.endCenter = Object.freeze({ x: current.x, y: current.y });
    band.endRadius = current.radius;
  }

  #saveCheckpoint(spanCount: number): void {
    const band = this.#openBand();
    this.#checkpoint = Object.freeze({
      spanCount,
      bandCount: this.#bands.length,
      leftLength: band.left.length,
      rightLength: band.right.length,
    });
  }

  #openBand(): MutableBand {
    const band = this.#bands.at(-1);
    if (band === undefined) throw new RangeError("Pressure Pen has no open band.");
    return band;
  }
}

/** Evaluates one complete Pressure Pen silhouette in a single pass. */
export function createPressurePenGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): FilledPathRenderGeometry {
  const evaluator = new PressurePenEvaluator(brush, renderedScale);
  evaluator.append(points, true);
  return evaluator.frozenGeometry();
}

function createBand(first: CenterSample, startSpan: number, roundStart: boolean): MutableBand {
  const center = Object.freeze({ x: first.x, y: first.y });
  return {
    alpha: first.alpha,
    startSpan,
    left: [],
    right: [],
    roundStart,
    roundEnd: false,
    startCenter: center,
    startRadius: first.radius,
    endCenter: center,
    endRadius: first.radius,
  };
}

function bandViews(bands: readonly MutableBand[], frozen: boolean): readonly FilledPathBand[] {
  const views = bands.map((band) =>
    Object.freeze({
      alpha: band.alpha,
      left: frozen ? Object.freeze([...band.left]) : band.left,
      right: frozen ? Object.freeze([...band.right]) : band.right,
      roundStart: band.roundStart,
      roundEnd: band.roundEnd,
      startCenter: band.startCenter,
      startRadius: band.startRadius,
      endCenter: band.endCenter,
      endRadius: band.endRadius,
    }),
  );
  return frozen ? Object.freeze(views) : views;
}

function pushOffsets(band: MutableBand, sample: CenterSample, normal: Point): void {
  band.left.push(offsetPoint(sample, normal, 1));
  band.right.push(offsetPoint(sample, normal, -1));
}

function offsetPoint(sample: CenterSample, normal: Point, side: number): Point {
  return Object.freeze({
    x: sample.x + normal.x * sample.radius * side,
    y: sample.y + normal.y * sample.radius * side,
  });
}

function pushArc(target: Point[], center: CenterSample, startAngle: number, sweep: number): void {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / JOIN_ARC_STEP));
  for (let step = 0; step <= steps; step += 1) {
    const angle = startAngle + (sweep * step) / steps;
    target.push(
      Object.freeze({
        x: center.x + Math.cos(angle) * center.radius,
        y: center.y + Math.sin(angle) * center.radius,
      }),
    );
  }
}

function direction(from: CenterSample, to: CenterSample): Point {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  if (length <= EPSILON) return ZERO_DIRECTION;
  return { x: x / length, y: y / length };
}

function bisector(incoming: Point, outgoing: Point): Point {
  const x = incoming.x + outgoing.x;
  const y = incoming.y + outgoing.y;
  const length = Math.hypot(x, y);
  // A reversal has no averaged tangent; keeping the incoming orientation lets
  // the tessellated corner bridge the two sides instead of inverting.
  if (length <= EPSILON) return incoming;
  return { x: x / length, y: y / length };
}

function leftNormal(tangent: Point): Point {
  return { x: -tangent.y, y: tangent.x };
}

function normalizePressure(pressure: number): number {
  return Number.isFinite(pressure) ? clamp(pressure, 0, 1) : 0.5;
}

function freezeHitSample(sample: CenterSample): BrushHitSample {
  return Object.freeze({ x: sample.x, y: sample.y, radius: sample.radius });
}

function emptyExtent(): Extent {
  return {
    minimumX: Number.POSITIVE_INFINITY,
    minimumY: Number.POSITIVE_INFINITY,
    maximumX: Number.NEGATIVE_INFINITY,
    maximumY: Number.NEGATIVE_INFINITY,
  };
}

function copyExtent(extent: Extent): Extent {
  return { ...extent };
}

function unionExtent(target: Extent, other: Extent): void {
  target.minimumX = Math.min(target.minimumX, other.minimumX);
  target.minimumY = Math.min(target.minimumY, other.minimumY);
  target.maximumX = Math.max(target.maximumX, other.maximumX);
  target.maximumY = Math.max(target.maximumY, other.maximumY);
}

function foldDisc(extent: Extent, sample: CenterSample): void {
  extent.minimumX = Math.min(extent.minimumX, sample.x - sample.radius);
  extent.minimumY = Math.min(extent.minimumY, sample.y - sample.radius);
  extent.maximumX = Math.max(extent.maximumX, sample.x + sample.radius);
  extent.maximumY = Math.max(extent.maximumY, sample.y + sample.radius);
}

function extentRect(extent: Extent): Rect {
  if (!Number.isFinite(extent.minimumX) || !Number.isFinite(extent.maximumX)) {
    return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  }
  return Object.freeze({
    x: extent.minimumX,
    y: extent.minimumY,
    width: extent.maximumX - extent.minimumX,
    height: extent.maximumY - extent.minimumY,
  });
}

function requirePoint(points: readonly StrokePoint[], index: number): StrokePoint {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Missing Pressure Pen point at index ${index}.`);
  return point;
}

function requireSample(samples: readonly CenterSample[], index: number): CenterSample {
  const sample = samples[index];
  if (sample === undefined) throw new RangeError(`Missing Pressure Pen sample at index ${index}.`);
  return sample;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
