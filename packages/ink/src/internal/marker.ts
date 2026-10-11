import type { Point, Rect } from "@folio/rendering";
import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type {
  BrushHitSample,
  LiveBrushEvaluator,
  LiveEvaluationSnapshot,
  MarkerSwathBand,
  MarkerSwathRenderGeometry,
} from "./brush-geometry";

/**
 * `marker@1`: a solid felt nib of fixed page-space orientation, swept.
 *
 * Every other strategy in the engine makes a mark whose shape is a function of
 * a radius. A marker's is not: its nib is *oriented*, so the same brush draws
 * broad one way and narrow the other, and that single fact is where the whole
 * character comes from. Nothing here is textured, stochastic or deposited --
 * the mark is one solid region, and it reads as a marker because of the shape
 * being dragged rather than because of anything painted inside it.
 *
 * **The nib is a capsule**, a rectangle with semicircular ends: the simplest
 * convex shape that is directional enough to read as a chisel and rounded
 * enough to read as felt rather than as a blade. Its support function is
 * closed-form, which is what makes sweeping it exact rather than approximate:
 * the support point of a capsule in direction `n` is
 *
 *     centre + a * sign(u . n) * u + r * n
 *
 * for axis `u`, straight half-length `a` and corner radius `r`. The boundary of
 * the swept region is therefore a *traced curve* rather than a union of
 * stamps -- which is the reason this strategy has no stamps to batch, no brick
 * pattern to hide, and one contour per fill instead of thousands.
 *
 * **Orientation is fixed in page space** and is a strategy constant. Letting it
 * follow the path tangent is what turns a marker into a calligraphy brush, and
 * it makes corners unstable: the nib would rotate through a turn and the swept
 * boundary would fold. Fixed, a corner is just two slabs meeting, and the
 * thick-to-thin character becomes a property of *which way you drew* rather
 * than of how fast the tangent happened to turn.
 *
 * **Placement is by distance, not by sample.** The centreline is decimated to a
 * spacing derived from the brush's own width, so an input device reporting 240
 * events a second produces the same mark as one reporting 60. Density is not
 * ink: because the swath is one closed region filled once, passing the nib over
 * the same page twice inside one stroke cannot darken it, whatever the event
 * rate did.
 *
 * Arranged, like the two pens, so that **the same prefix evaluates to the same
 * geometry whether the stroke ends now or continues later**: smoothing reads a
 * fixed window, decimation is causal, and a boundary point depends on at most
 * two later kept points. That is what makes committing a stroke a no-op.
 */

const EPSILON = 0.000_001;

/**
 * The nib's broad axis, in page space, in degrees.
 *
 * Forty-five is the angle a broad-edge nib is conventionally held at, and it is
 * the one that makes the strategy's character legible: horizontal and vertical
 * strokes come out identical and mid-width, while the two diagonals are the
 * widest and the narrowest the brush can draw. Any other angle makes one of the
 * two axis-aligned directions privileged for no reason a person could predict.
 *
 * Not durable. It is a constant of this strategy version, so a Marker drawn at
 * a different angle is `marker@2`, not a field in a file.
 */
export const MARKER_NIB_ANGLE_DEGREES = 45;

/**
 * Nib thickness as a fraction of its broad width.
 *
 * The ratio of the widest mark to the narrowest. At 0.42 that is about 2.4 to
 * one: unmistakably a chisel, and well short of the eight-to-one a calligraphy
 * nib gives, which reads as a pen being flourished rather than a marker being
 * used.
 */
export const MARKER_NIB_THICKNESS_RATIO = 0.42;

const NIB_ANGLE_RADIANS = (MARKER_NIB_ANGLE_DEGREES * Math.PI) / 180;
const AXIS_X = Math.cos(NIB_ANGLE_RADIANS);
const AXIS_Y = Math.sin(NIB_ANGLE_RADIANS);

/** Angular resolution of a traced corner or cap. Matches the engine's other strategies. */
const ARC_STEP = Math.PI / 16;

/** Decimation distance as a fraction of nominal width, with page-space guard rails. */
const SPACING_WIDTH_FACTOR = 0.25;
const MINIMUM_SPACING_FLOOR = 0.35;
const MINIMUM_SPACING_CEILING = 2;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/**
 * How far two alphas may drift before the swath is cut into a new band, and the
 * shortest run of spans a band may cover. Both are the engine's existing
 * values, for the same reasons Pressure Pen has them.
 */
const ALPHA_BAND_TOLERANCE = 1 / 64;
const MINIMUM_BAND_SPANS = 16;

/** A boundary point depends on at most this many later kept points. */
const BOUNDARY_LOOKAHEAD = 2;

interface CenterSample {
  readonly x: number;
  readonly y: number;
  /** Straight half-length of the nib at this sample. */
  readonly nibHalf: number;
  /** Corner radius of the nib at this sample. */
  readonly nibRadius: number;
  /** Resolved page alpha, base opacity already included. */
  readonly alpha: number;
}

interface MutableBand {
  alpha: number;
  /** The span this band opened on, so its length is known without counting. */
  readonly startSpan: number;
  readonly left: Point[];
  readonly right: Point[];
  /** The nib outline closing this end, or empty for a straight cut. */
  startCap: readonly Point[];
  endCap: readonly Point[];
  /** How many boundary points are settled and will never be rebuilt. */
  settledLeft: number;
  settledRight: number;
}

interface Extent {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

export class MarkerEvaluator implements LiveBrushEvaluator {
  readonly #brush: ResolvedBrushSnapshot;
  readonly #renderedScale: number;
  readonly #smoothingRadius: number;
  readonly #smoothingAmount: number;
  readonly #lookaheadSamples: number;
  readonly #minimumSpacing: number;
  readonly #kept: CenterSample[] = [];
  readonly #bands: MutableBand[] = [];
  /** Kept as its own array so a live frame can alias it instead of rebuilding it. */
  readonly #hit: BrushHitSample[] = [];
  readonly #settledExtent: Extent = emptyExtent();
  #settledKeptCount = 0;
  #settledRawCount = 0;
  #settledSpanCount = 0;
  #foldedKeptCount = 0;
  #lastNormalAngle: number | null = null;
  #sourcePointCount = 0;
  #finalized = false;
  #settledPointEvaluations = 0;
  #tailPointEvaluations = 0;
  #maximumTailPointEvaluations = 0;

  constructor(brush: ResolvedBrushSnapshot, renderedScale: number) {
    if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
      throw new RangeError("Marker render scale must be positive and finite.");
    }
    this.#brush = brush;
    this.#renderedScale = renderedScale;
    const smoothing = brush.smoothing;
    const active = smoothing.mode !== "none" && smoothing.amount > 0;
    this.#smoothingAmount = active ? Math.min(1, Math.max(0, smoothing.amount)) : 0;
    this.#smoothingRadius = active
      ? Math.min(MAXIMUM_SMOOTHING_RADIUS, 1 + Math.floor(this.#smoothingAmount * 3))
      : 0;
    this.#lookaheadSamples = Math.max(this.#smoothingRadius, 1);
    this.#minimumSpacing = clamp(
      brush.size * SPACING_WIDTH_FACTOR,
      MINIMUM_SPACING_FLOOR,
      MINIMUM_SPACING_CEILING,
    );
  }

  /**
   * Consumes every sample not yet consumed, then rebuilds only the open tail.
   *
   * Two settlement horizons, because two different things stop moving at
   * different times. A *sample* settles once smoothing can no longer reach it.
   * A *boundary point* settles two kept points later than that, because the
   * curve traced at a vertex reads the direction on both sides of it.
   */
  append(points: readonly StrokePoint[], final: boolean): void {
    if (this.#finalized) return;
    this.#sourcePointCount = points.length;
    this.#kept.length = this.#settledKeptCount;

    const settleLimit = final ? points.length : Math.max(0, points.length - this.#lookaheadSamples);
    while (this.#settledRawCount < settleLimit) {
      const index = this.#settledRawCount;
      this.#settledPointEvaluations += 1;
      this.#consume(points, index, final && index === points.length - 1);
      this.#settledKeptCount = this.#kept.length;
      this.#settledRawCount = index + 1;
    }

    this.#tailPointEvaluations = 0;
    for (let index = this.#settledRawCount; index < points.length; index += 1) {
      this.#tailPointEvaluations += 1;
      // The newest sample is treated as terminal whether or not the stroke has
      // ended, so the drawn nib sits exactly under the pen rather than lagging
      // it -- and so lifting the pen moves nothing.
      this.#consume(points, index, index === points.length - 1);
    }
    this.#maximumTailPointEvaluations = Math.max(
      this.#maximumTailPointEvaluations,
      this.#tailPointEvaluations,
    );

    this.#hit.length = Math.min(this.#hit.length, this.#settledKeptCount);
    for (let index = this.#hit.length; index < this.#kept.length; index += 1) {
      const sample = requireSample(this.#kept, index);
      this.#hit.push(
        Object.freeze({ x: sample.x, y: sample.y, radius: sample.nibHalf + sample.nibRadius }),
      );
    }
    for (let index = this.#foldedKeptCount; index < this.#settledKeptCount; index += 1) {
      foldSample(this.#settledExtent, requireSample(this.#kept, index));
    }
    this.#foldedKeptCount = this.#settledKeptCount;

    this.#rebuildBoundary(final);
    if (final) this.#finalized = true;
  }

  /**
   * The current swath.
   *
   * Band boundaries alias evaluator state, so a live frame allocates nothing
   * proportional to the stroke; they are valid until the next `append`. Use
   * {@link frozenGeometry} for anything retained.
   */
  geometry(): MarkerSwathRenderGeometry {
    return this.#geometry(false);
  }

  /** An immutable copy, for geometry that outlives the evaluator. */
  frozenGeometry(): MarkerSwathRenderGeometry {
    return this.#geometry(true);
  }

  evaluationSnapshot(): LiveEvaluationSnapshot {
    return Object.freeze({
      settledPointEvaluations: this.#settledPointEvaluations,
      tailPointEvaluations: this.#tailPointEvaluations,
      maximumTailPointEvaluations: this.#maximumTailPointEvaluations,
      settledSegmentCount: this.#settledSpanCount,
      segmentCount: Math.max(0, this.#kept.length - 1),
      keptPointCount: this.#kept.length,
      lookaheadSamples: this.#lookaheadSamples,
    });
  }

  /**
   * Bands and hit samples alias evaluator state unless a frozen copy is asked
   * for, so a live frame allocates a handful of objects rather than one per
   * sample. Bounds come from the kept centres inflated by the nib's reach: the
   * settled part is folded once as it settles, and only the tail is folded
   * again, which is the same arrangement the two pens use.
   */
  #geometry(frozen: boolean): MarkerSwathRenderGeometry {
    const extent = copyExtent(this.#settledExtent);
    for (let index = this.#foldedKeptCount; index < this.#kept.length; index += 1) {
      foldSample(extent, requireSample(this.#kept, index));
    }
    const bands: MarkerSwathBand[] = [];
    for (const band of this.#bands) {
      if (band.left.length === 0 && band.startCap.length === 0) continue;
      bands.push(
        Object.freeze({
          alpha: band.alpha,
          left: frozen ? Object.freeze([...band.left]) : band.left,
          right: frozen ? Object.freeze([...band.right]) : band.right,
          startCap: band.startCap,
          endCap: band.endCap,
        }),
      );
    }
    return Object.freeze({
      kind: "marker-swath",
      bands: Object.freeze(bands),
      hitGeometry: frozen ? Object.freeze([...this.#hit]) : this.#hit,
      nibAngle: NIB_ANGLE_RADIANS,
      renderedScale: this.#renderedScale,
      bounds: boundsOf(extent),
      sourcePointCount: this.#sourcePointCount,
      keptPointCount: this.#kept.length,
    });
  }

  #consume(points: readonly StrokePoint[], index: number, terminal: boolean): void {
    const current = requirePoint(points, index);
    const evaluated = this.#smoothed(points, index, terminal);
    const sample = this.#sample(evaluated.x, evaluated.y, current.pressure);
    const last = this.#kept.at(-1);
    if (last === undefined) {
      this.#kept.push(sample);
      return;
    }
    const separation = Math.hypot(sample.x - last.x, sample.y - last.y);
    if (separation >= this.#minimumSpacing) {
      this.#kept.push(sample);
      return;
    }
    // Where the nib stopped is information no later sample can supply, so the
    // terminal sample is admitted even when it falls short of the spacing rule.
    if (terminal && separation > EPSILON) this.#kept.push(sample);
  }

  #sample(x: number, y: number, pressure: number): CenterSample {
    // The same generic reading of the snapshot every modern strategy does: the
    // size response decides the contact footprint, the opacity response decides
    // how much ink it lays down, and a preset that enables neither gets a
    // constant nib -- which is what both shipped Marker presets ask for.
    const width = brushSizeAtPressure(this.#brush, pressure) / this.#renderedScale;
    const nibRadius = Math.max((width * MARKER_NIB_THICKNESS_RATIO) / 2, EPSILON);
    const nibHalf = Math.max(width / 2 - nibRadius, 0);
    const alpha = clamp(
      this.#brush.opacity *
        evaluatePressureResponse(this.#brush.dynamics.pressureOpacity, pressure),
      0,
      1,
    );
    return Object.freeze({ x, y, nibHalf, nibRadius, alpha });
  }

  #smoothed(points: readonly StrokePoint[], index: number, terminal: boolean): Point {
    const current = requirePoint(points, index);
    const radius = this.#smoothingRadius;
    // Both ends stay exactly where the nib was.
    if (radius === 0 || index === 0 || terminal) {
      return Object.freeze({ x: current.x, y: current.y });
    }
    const first = Math.max(0, index - radius);
    const last = Math.min(points.length - 1, index + radius);
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    for (let sampleIndex = first; sampleIndex <= last; sampleIndex += 1) {
      const sample = requirePoint(points, sampleIndex);
      const weight = radius + 1 - Math.abs(sampleIndex - index);
      totalWeight += weight;
      weightedX += sample.x * weight;
      weightedY += sample.y * weight;
    }
    const amount = this.#smoothingAmount;
    return Object.freeze({
      x: current.x + (weightedX / totalWeight - current.x) * amount,
      y: current.y + (weightedY / totalWeight - current.y) * amount,
    });
  }

  /**
   * Traces the swath boundary for every span not yet settled.
   *
   * Earlier bands are immutable: a cut happens at a settled sample, so only the
   * open band is ever truncated and re-emitted. The work per frame is therefore
   * bounded by the tail, not by the stroke.
   */
  #rebuildBoundary(final: boolean): void {
    const kept = this.#kept;
    if (kept.length === 0) {
      this.#bands.length = 0;
      return;
    }
    if (kept.length === 1) {
      this.#bands.length = 0;
      this.#bands.push(this.#impressionBand(requireSample(kept, 0)));
      this.#settledSpanCount = final ? 1 : 0;
      return;
    }

    const spanCount = kept.length - 1;
    const settledSpans = final
      ? spanCount
      : Math.max(0, Math.min(spanCount, this.#settledKeptCount - 1 - BOUNDARY_LOOKAHEAD));
    // Drop whole bands that began inside the range being rebuilt, then rewind
    // the one that survives to its settled length.
    while (this.#bands.length > 1) {
      const last = this.#bands[this.#bands.length - 1];
      if (last === undefined || last.startSpan < this.#settledSpanCount) break;
      this.#bands.pop();
    }
    const open = this.#bands.at(-1);
    if (open === undefined) {
      this.#bands.push(this.#openBand(0, requireSample(kept, 0)));
    } else {
      open.left.length = open.settledLeft;
      open.right.length = open.settledRight;
    }

    let from = this.#bands.at(-1)?.startSpan ?? 0;
    from = Math.max(from, Math.min(this.#settledSpanCount, spanCount));
    // The vertex arc reads the previous span's normal, and the rewind above
    // just discarded it. Recover it from the span before the one being
    // re-emitted rather than trusting what the last frame happened to leave.
    this.#lastNormalAngle = from === 0 ? null : spanNormalAngle(kept, from - 1);
    for (let span = from; span < spanCount; span += 1) {
      this.#emitSpan(span, span < settledSpans);
    }
    this.#settledSpanCount = settledSpans;
    this.#closeOpenBand();
  }

  #emitSpan(span: number, settled: boolean): void {
    const kept = this.#kept;
    const start = requireSample(kept, span);
    const finish = requireSample(kept, span + 1);
    const normalAngle = spanNormalAngle(kept, span);
    if (normalAngle === null) return;

    let band = this.#bands.at(-1);
    if (band === undefined) {
      band = this.#openBand(span, start);
      this.#bands.push(band);
    } else if (this.#shouldCut(band, span, finish.alpha)) {
      // Cut on the cross-section at `start`: both bands are closed by the same
      // straight edge, so they tile along the stroke instead of overlapping and
      // a seam between two alphas is a seam rather than a dark rung.
      band.endCap = EMPTY_OUTLINE;
      band.settledLeft = band.left.length;
      band.settledRight = band.right.length;
      band = this.#openBand(span, start);
      this.#bands.push(band);
    }

    // The slab this span sweeps: both edges are tangent lines in the span's own
    // normal direction, which is exact for a nib of fixed orientation.
    if (band.left.length === 0) {
      band.left.push(supportPoint(start, normalAngle));
      band.right.push(supportPoint(start, normalAngle + Math.PI));
    } else {
      // Trace the nib around the vertex this span leaves, so an outer corner is
      // the curve the nib actually sweeps rather than a chord across it. On the
      // inner side the same points fall inside the region and fill harmlessly.
      const previous = this.#lastNormalAngle;
      if (previous !== null) {
        appendSupportArc(band.left, start, previous, normalAngle);
        appendSupportArc(band.right, start, previous + Math.PI, normalAngle + Math.PI);
      }
      band.left.push(supportPoint(start, normalAngle));
      band.right.push(supportPoint(start, normalAngle + Math.PI));
    }
    band.left.push(supportPoint(finish, normalAngle));
    band.right.push(supportPoint(finish, normalAngle + Math.PI));
    this.#lastNormalAngle = normalAngle;
    if (settled) {
      band.settledLeft = band.left.length;
      band.settledRight = band.right.length;
    }
  }

  #shouldCut(band: MutableBand, span: number, alpha: number): boolean {
    if (!this.#brush.dynamics.pressureOpacity.enabled) return false;
    if (Math.abs(alpha - band.alpha) <= ALPHA_BAND_TOLERANCE) return false;
    return span - band.startSpan >= MINIMUM_BAND_SPANS;
  }

  #openBand(span: number, at: CenterSample): MutableBand {
    return {
      alpha: at.alpha,
      startSpan: span,
      left: [],
      right: [],
      startCap: EMPTY_OUTLINE,
      endCap: EMPTY_OUTLINE,
      settledLeft: 0,
      settledRight: 0,
    };
  }

  /** Gives the first and last bands the complete nib impression at their ends. */
  #closeOpenBand(): void {
    const kept = this.#kept;
    const first = this.#bands[0];
    const last = this.#bands.at(-1);
    if (first === undefined || last === undefined) return;
    const firstNormal = spanNormalAngle(kept, 0);
    if (firstNormal !== null && first.left.length > 0) {
      // From the right edge round to the left edge the *short* way, which is
      // the half of the nib lying behind where the stroke began. Sweeping the
      // other way traces the half in front of it, which folds the outline back
      // over itself and leaves the start of the stroke outside its own mark.
      first.startCap = traceSupportArc(requireSample(kept, 0), firstNormal + Math.PI, firstNormal);
    }
    const lastNormal = this.#lastNormalAngle;
    if (lastNormal !== null && last.left.length > 0) {
      // And from the left edge round to the right edge through the direction
      // the stroke was travelling, which is the half in front of where it
      // stopped.
      last.endCap = traceSupportArc(
        requireSample(kept, kept.length - 1),
        lastNormal,
        lastNormal - Math.PI,
      );
    }
  }

  /** A press that never moved: the mark is the nib itself, in full. */
  #impressionBand(at: CenterSample): MutableBand {
    // Sweeping the support direction right round traces the capsule exactly, so
    // a tap is the nib's own outline and not a round dot standing in for it.
    const outline = traceSupportArc(at, 0, Math.PI * 2);
    return {
      alpha: at.alpha,
      startSpan: 0,
      left: [],
      right: [],
      startCap: outline,
      endCap: EMPTY_OUTLINE,
      settledLeft: 0,
      settledRight: 0,
    };
  }
}

const EMPTY_OUTLINE: readonly Point[] = Object.freeze([]);

/**
 * Where the nib's boundary touches a tangent line of the given normal.
 *
 * The capsule's support point, in closed form. `sign(u . n)` is which of the
 * two rounded ends the tangent meets; when the normal is perpendicular to the
 * axis the two ends tie, and the straight side between them is what the
 * boundary follows -- which the tracing below reproduces as one straight edge
 * rather than needing a case of its own.
 */
function supportPoint(sample: CenterSample, normalAngle: number): Point {
  const nx = Math.cos(normalAngle);
  const ny = Math.sin(normalAngle);
  const along = AXIS_X * nx + AXIS_Y * ny;
  const reach = along >= 0 ? sample.nibHalf : -sample.nibHalf;
  return Object.freeze({
    x: sample.x + reach * AXIS_X + sample.nibRadius * nx,
    y: sample.y + reach * AXIS_Y + sample.nibRadius * ny,
  });
}

/** Support points from one normal to another, the short way round, exclusive of both ends. */
function appendSupportArc(out: Point[], sample: CenterSample, from: number, to: number): void {
  const delta = normalizeAngle(to - from);
  const steps = Math.floor(Math.abs(delta) / ARC_STEP);
  if (steps === 0) return;
  const step = delta / (steps + 1);
  for (let index = 1; index <= steps; index += 1) {
    out.push(supportPoint(sample, from + step * index));
  }
}

/** Support points sweeping from one normal to another, inclusive of both ends. */
function traceSupportArc(sample: CenterSample, from: number, to: number): readonly Point[] {
  const span = to - from;
  const steps = Math.max(1, Math.ceil(Math.abs(span) / ARC_STEP));
  const outline: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    outline.push(supportPoint(sample, from + (span * index) / steps));
  }
  return Object.freeze(outline);
}

/** The outward normal of one span, as an angle, or null for a zero-length span. */
function spanNormalAngle(samples: readonly CenterSample[], span: number): number | null {
  const direction = unitBetween(requireSample(samples, span), requireSample(samples, span + 1));
  return direction === null ? null : Math.atan2(direction.x, -direction.y);
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function unitBetween(from: CenterSample, to: CenterSample): Point | null {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length <= EPSILON) return null;
  return Object.freeze({ x: deltaX / length, y: deltaY / length });
}

/** Builds the whole swath for one finished set of samples. */
export function createMarkerGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): MarkerSwathRenderGeometry {
  const evaluator = new MarkerEvaluator(brush, renderedScale);
  evaluator.append(points, true);
  return evaluator.frozenGeometry();
}

function requirePoint(points: readonly StrokePoint[], index: number): StrokePoint {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Marker sample ${String(index)} is missing.`);
  return point;
}

function requireSample(samples: readonly CenterSample[], index: number): CenterSample {
  const sample = samples[index];
  if (sample === undefined) throw new RangeError(`Marker centre ${String(index)} is missing.`);
  return sample;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
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
  return {
    minimumX: extent.minimumX,
    minimumY: extent.minimumY,
    maximumX: extent.maximumX,
    maximumY: extent.maximumY,
  };
}

/** Folds one nib impression, which reaches its circumradius in every direction. */
function foldSample(extent: Extent, sample: CenterSample): void {
  const reach = sample.nibHalf + sample.nibRadius;
  extent.minimumX = Math.min(extent.minimumX, sample.x - reach);
  extent.minimumY = Math.min(extent.minimumY, sample.y - reach);
  extent.maximumX = Math.max(extent.maximumX, sample.x + reach);
  extent.maximumY = Math.max(extent.maximumY, sample.y + reach);
}

function boundsOf(extent: Extent): Rect {
  if (!Number.isFinite(extent.minimumX)) {
    return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  }
  return Object.freeze({
    x: extent.minimumX,
    y: extent.minimumY,
    width: extent.maximumX - extent.minimumX,
    height: extent.maximumY - extent.minimumY,
  });
}
