import type { Point, Rect } from "@folio/rendering";
import type { ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";

/**
 * `technical-pen@1`: a deterministic solid stroke of constant width.
 *
 * The reference strategy the rest of the engine is measured against, and
 * deliberately the simplest thing that draws well. It ignores pressure, tilt
 * and velocity; it has no texture, no scatter and no randomness; and it is a
 * pure function of the samples it has been given plus the resolved snapshot.
 *
 * Everything here is arranged around one property: **the same prefix evaluates
 * to the same geometry whether the stroke ends now or continues later.** That
 * is what lets live drawing reuse settled work instead of rebuilding, and it is
 * what makes committing a stroke a no-op rather than a replacement. Each stage
 * earns it separately:
 *
 * - smoothing reads a fixed window, so a point stops moving once it has that
 *   many successors -- not once the stroke ends;
 * - decimation is causal, deciding a point against the last point it kept and
 *   never reconsidering;
 * - a segment is a centripetal Catmull-Rom span, which reads one point back and
 *   two forward and nothing else. No stroke-wide diagonal, no mean spacing, no
 *   error-driven resplitting.
 *
 * The spacing and tolerance constants come from the brush's own width for the
 * same reason: a value derived from the stroke's extent changes as the stroke
 * grows, which is exactly the dependency that made the older fitted path
 * unable to converge.
 */

const EPSILON = 0.000_001;

/** Centripetal parameterization. The one value of alpha with no cusps or self-intersections. */
const CENTRIPETAL_EXPONENT = 0.5;

/** Decimation distance as a fraction of nominal width, with page-space guard rails. */
const SPACING_WIDTH_FACTOR = 0.25;
const MINIMUM_SPACING_FLOOR = 0.35;
const MINIMUM_SPACING_CEILING = 2;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/** One cubic on a Technical Pen path, in stroke-local page coordinates. */
export interface StrokedPathSegment {
  readonly startX: number;
  readonly startY: number;
  readonly control1X: number;
  readonly control1Y: number;
  readonly control2X: number;
  readonly control2Y: number;
  readonly endX: number;
  readonly endY: number;
}

export interface StrokedPathRenderGeometry {
  readonly kind: "stroked-path";
  /** Where the path starts, and the whole mark when a stroke has no length. */
  readonly origin: Point | null;
  readonly segments: readonly StrokedPathSegment[];
  /** Nominal page-space diameter. Pressure never changes it. */
  readonly width: number;
  readonly renderedScale: number;
  readonly bounds: Rect;
  readonly sourcePointCount: number;
  readonly keptPointCount: number;
}

/** Structural evidence that live evaluation reuses settled work rather than redoing it. */
export interface TechnicalPenEvaluationSnapshot {
  readonly settledPointEvaluations: number;
  readonly tailPointEvaluations: number;
  readonly maximumTailPointEvaluations: number;
  readonly settledSegmentCount: number;
  readonly segmentCount: number;
  readonly keptPointCount: number;
  readonly smoothingRadius: number;
}

/** An evaluator a live renderer can feed a growing sample array without rebuilding. */
export interface LiveBrushEvaluator {
  append(points: readonly StrokePoint[], final: boolean): void;
  geometry(renderedScale: number): StrokedPathRenderGeometry;
}

interface EvaluatedPoint {
  readonly x: number;
  readonly y: number;
}

interface Extent {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

export class TechnicalPenEvaluator implements LiveBrushEvaluator {
  readonly #width: number;
  readonly #smoothingRadius: number;
  readonly #smoothingAmount: number;
  readonly #minimumSpacing: number;
  readonly #kept: EvaluatedPoint[] = [];
  readonly #segments: StrokedPathSegment[] = [];
  readonly #settledExtent: Extent = emptyExtent();
  #settledKeptCount = 0;
  #settledSegmentCount = 0;
  #settledRawCount = 0;
  #foldedSegmentCount = 0;
  #sourcePointCount = 0;
  #finalized = false;
  #settledPointEvaluations = 0;
  #tailPointEvaluations = 0;
  #maximumTailPointEvaluations = 0;

  constructor(brush: ResolvedBrushSnapshot) {
    // Read straight from the snapshot's nominal size rather than through the
    // pressure evaluator, so a constant width is a property of the strategy and
    // not merely of how its preset happens to be configured.
    this.#width = brush.size;
    const smoothing = brush.smoothing;
    const active = smoothing.mode !== "none" && smoothing.amount > 0;
    this.#smoothingAmount = active ? Math.min(1, Math.max(0, smoothing.amount)) : 0;
    this.#smoothingRadius = active
      ? Math.min(MAXIMUM_SMOOTHING_RADIUS, 1 + Math.floor(this.#smoothingAmount * 3))
      : 0;
    this.#minimumSpacing = clamp(
      brush.size * SPACING_WIDTH_FACTOR,
      MINIMUM_SPACING_FLOOR,
      MINIMUM_SPACING_CEILING,
    );
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
    this.#segments.length = this.#settledSegmentCount;

    // A point settles once smoothing can no longer move it. The terminal sample
    // is always held back until `final`, because only then does it know it is
    // terminal and qualify for the rule that keeps it regardless of spacing.
    const reserved = Math.max(this.#smoothingRadius, 1);
    const settleLimit = final ? points.length : Math.max(0, points.length - reserved);
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
      this.#consume(points, index, false);
    }
    this.#maximumTailPointEvaluations = Math.max(
      this.#maximumTailPointEvaluations,
      this.#tailPointEvaluations,
    );

    for (let index = this.#segments.length; index + 1 < this.#kept.length; index += 1) {
      this.#segments.push(this.#buildSegment(index));
    }
    // A segment reads one point back and two forward, so the two most recent
    // settled points still have segments that could change around them.
    this.#settledSegmentCount = final
      ? this.#segments.length
      : Math.min(this.#segments.length, Math.max(0, this.#settledKeptCount - 2));
    if (final) this.#finalized = true;

    for (let index = this.#foldedSegmentCount; index < this.#settledSegmentCount; index += 1) {
      foldSegment(this.#settledExtent, requireSegment(this.#segments, index));
    }
    this.#foldedSegmentCount = this.#settledSegmentCount;
  }

  /**
   * The current path.
   *
   * `segments` aliases evaluator state so a live frame allocates nothing
   * proportional to the stroke; it is valid until the next `append`. Use
   * {@link frozenGeometry} for anything retained.
   */
  geometry(renderedScale: number): StrokedPathRenderGeometry {
    return this.#geometry(renderedScale, this.#segments);
  }

  /** An immutable copy, for geometry that outlives the evaluator. */
  frozenGeometry(renderedScale: number): StrokedPathRenderGeometry {
    return this.#geometry(renderedScale, Object.freeze([...this.#segments]));
  }

  evaluationSnapshot(): TechnicalPenEvaluationSnapshot {
    return Object.freeze({
      settledPointEvaluations: this.#settledPointEvaluations,
      tailPointEvaluations: this.#tailPointEvaluations,
      maximumTailPointEvaluations: this.#maximumTailPointEvaluations,
      settledSegmentCount: this.#settledSegmentCount,
      segmentCount: this.#segments.length,
      keptPointCount: this.#kept.length,
      smoothingRadius: this.#smoothingRadius,
    });
  }

  #geometry(
    renderedScale: number,
    segments: readonly StrokedPathSegment[],
  ): StrokedPathRenderGeometry {
    if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
      throw new RangeError("Technical Pen render scale must be positive and finite.");
    }
    const origin = this.#kept[0] ?? null;
    const extent = copyExtent(this.#settledExtent);
    for (let index = this.#foldedSegmentCount; index < segments.length; index += 1) {
      foldSegment(extent, requireSegment(segments, index));
    }
    if (origin !== null && segments.length === 0) foldPoint(extent, origin.x, origin.y);
    const halfWidth = this.#width / (renderedScale * 2);
    return Object.freeze({
      kind: "stroked-path",
      origin: origin === null ? null : Object.freeze({ x: origin.x, y: origin.y }),
      segments,
      width: this.#width,
      renderedScale,
      bounds: inflatedRect(extent, halfWidth),
      sourcePointCount: this.#sourcePointCount,
      keptPointCount: this.#kept.length,
    });
  }

  #consume(points: readonly StrokePoint[], index: number, terminal: boolean): void {
    const evaluated = this.#smoothed(points, index, terminal);
    const last = this.#kept.at(-1);
    if (last === undefined) {
      this.#kept.push(evaluated);
      return;
    }
    const separation = Math.hypot(evaluated.x - last.x, evaluated.y - last.y);
    if (separation >= this.#minimumSpacing) {
      this.#kept.push(evaluated);
      return;
    }
    // Where the pen stopped is information no later sample can supply, so the
    // terminal sample is admitted even when it falls short of the spacing rule.
    // A zero-length step is still refused: it would add a cap, not a stroke.
    if (terminal && separation > EPSILON) this.#kept.push(evaluated);
  }

  #smoothed(points: readonly StrokePoint[], index: number, terminal: boolean): EvaluatedPoint {
    const current = requirePoint(points, index);
    const radius = this.#smoothingRadius;
    // Both ends stay exactly where the pen was. Smoothing an endpoint would
    // pull the stroke away from where the artist started or stopped it.
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

  #buildSegment(index: number): StrokedPathSegment {
    const start = requirePoint(this.#kept, index);
    const end = requirePoint(this.#kept, index + 1);
    // Clamped ends: a missing neighbour repeats its endpoint, which is what
    // gives the first and last spans their plain one-third chord handles.
    const before = this.#kept[index - 1] ?? start;
    const after = this.#kept[index + 2] ?? end;
    return centripetalSegment(before, start, end, after);
  }
}

/** Evaluates one complete Technical Pen path in a single pass. */
export function createTechnicalPenGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): StrokedPathRenderGeometry {
  const evaluator = new TechnicalPenEvaluator(brush);
  evaluator.append(points, true);
  return evaluator.frozenGeometry(renderedScale);
}

/**
 * One centripetal Catmull-Rom span, expressed as the cubic Canvas 2D draws.
 *
 * Local by construction: it reads four points and nothing about the stroke they
 * belong to, which is the whole reason a prefix of the path cannot change when
 * the stroke grows.
 */
function centripetalSegment(
  before: EvaluatedPoint,
  start: EvaluatedPoint,
  end: EvaluatedPoint,
  after: EvaluatedPoint,
): StrokedPathSegment {
  const chordX = end.x - start.x;
  const chordY = end.y - start.y;
  const entering = Math.pow(distance(before, start), CENTRIPETAL_EXPONENT);
  const spanning = Math.pow(distance(start, end), CENTRIPETAL_EXPONENT);
  const leaving = Math.pow(distance(end, after), CENTRIPETAL_EXPONENT);

  let startTangentX = chordX;
  let startTangentY = chordY;
  if (entering > EPSILON && spanning > EPSILON) {
    startTangentX =
      chordX +
      spanning * ((start.x - before.x) / entering - (end.x - before.x) / (entering + spanning));
    startTangentY =
      chordY +
      spanning * ((start.y - before.y) / entering - (end.y - before.y) / (entering + spanning));
  }

  let endTangentX = chordX;
  let endTangentY = chordY;
  if (leaving > EPSILON && spanning > EPSILON) {
    endTangentX =
      chordX +
      spanning * ((after.x - end.x) / leaving - (after.x - start.x) / (spanning + leaving));
    endTangentY =
      chordY +
      spanning * ((after.y - end.y) / leaving - (after.y - start.y) / (spanning + leaving));
  }

  const control1X = start.x + startTangentX / 3;
  const control1Y = start.y + startTangentY / 3;
  const control2X = end.x - endTangentX / 3;
  const control2Y = end.y - endTangentY / 3;
  if (
    !Number.isFinite(control1X) ||
    !Number.isFinite(control1Y) ||
    !Number.isFinite(control2X) ||
    !Number.isFinite(control2Y)
  ) {
    return Object.freeze({
      startX: start.x,
      startY: start.y,
      control1X: start.x + chordX / 3,
      control1Y: start.y + chordY / 3,
      control2X: end.x - chordX / 3,
      control2Y: end.y - chordY / 3,
      endX: end.x,
      endY: end.y,
    });
  }
  return Object.freeze({
    startX: start.x,
    startY: start.y,
    control1X,
    control1Y,
    control2X,
    control2Y,
    endX: end.x,
    endY: end.y,
  });
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

/**
 * Folds one cubic's control hull into an extent.
 *
 * The hull contains the curve, so this over-reports slightly rather than
 * missing ink. A repaint that covers too much is invisible; one that covers too
 * little leaves a trail on the canvas.
 */
function foldSegment(extent: Extent, segment: StrokedPathSegment): void {
  foldPoint(extent, segment.startX, segment.startY);
  foldPoint(extent, segment.control1X, segment.control1Y);
  foldPoint(extent, segment.control2X, segment.control2Y);
  foldPoint(extent, segment.endX, segment.endY);
}

function foldPoint(extent: Extent, x: number, y: number): void {
  extent.minimumX = Math.min(extent.minimumX, x);
  extent.minimumY = Math.min(extent.minimumY, y);
  extent.maximumX = Math.max(extent.maximumX, x);
  extent.maximumY = Math.max(extent.maximumY, y);
}

function inflatedRect(extent: Extent, margin: number): Rect {
  if (!Number.isFinite(extent.minimumX) || !Number.isFinite(extent.maximumX)) {
    return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  }
  return Object.freeze({
    x: extent.minimumX - margin,
    y: extent.minimumY - margin,
    width: extent.maximumX - extent.minimumX + margin * 2,
    height: extent.maximumY - extent.minimumY + margin * 2,
  });
}

function distance(first: EvaluatedPoint, second: EvaluatedPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function requirePoint<TPoint extends EvaluatedPoint>(
  points: readonly TPoint[],
  index: number,
): TPoint {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Missing Technical Pen point at index ${index}.`);
  return point;
}

function requireSegment(
  segments: readonly StrokedPathSegment[],
  index: number,
): StrokedPathSegment {
  const segment = segments[index];
  if (segment === undefined) {
    throw new RangeError(`Missing Technical Pen segment at index ${index}.`);
  }
  return segment;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
