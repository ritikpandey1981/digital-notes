import type { Point, Rect } from "@folio/rendering";
import type { StrokePoint } from "../types";

/**
 * The geometry primitives a brush strategy may emit, and the painter contract
 * that consumes them.
 *
 * Strategies emit primitives; a painter paints primitives. Keeping the shapes
 * here rather than inside one strategy's module is what stops a second
 * strategy from having to import the first just to describe its own output.
 */

/** One cubic on a constant-width path, in stroke-local page coordinates. */
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

/** A fitted path plus one width: `stroke()` draws it. */
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

/**
 * One contiguous run of a variable-width silhouette painted at a single alpha.
 *
 * A band is a closed shape: `left` forward, across the far end, `right`
 * backward, across the near end. Consecutive bands are cut at the midpoint of
 * the span between two samples and **share that cut cross-section exactly**, so
 * the silhouette tiles rather than overlaps. That is the whole reason two
 * different alphas can be painted in two `fill()` calls without the seam
 * between them compositing twice and reading as a dark rung.
 */
export interface FilledPathBand {
  /** Resolved page alpha, base opacity already included. */
  readonly alpha: number;
  readonly left: readonly Point[];
  readonly right: readonly Point[];
  /** A real stroke end takes a round cap; a cut between bands is flat. */
  readonly roundStart: boolean;
  readonly roundEnd: boolean;
  readonly startCenter: Point;
  readonly startRadius: number;
  readonly endCenter: Point;
  readonly endRadius: number;
}

/** One sample of a stroke's centerline, carrying the width it was drawn at. */
export interface BrushHitSample extends Point {
  /** Page-space radius at this sample, already divided by the rendered scale. */
  readonly radius: number;
}

/** A closed variable-width boundary: `fill()` draws it. */
export interface FilledPathRenderGeometry {
  readonly kind: "filled-path";
  readonly bands: readonly FilledPathBand[];
  /** A press that never moved: the whole mark is one disc. */
  readonly dot: Readonly<{ center: Point; radius: number; alpha: number }> | null;
  /** The variable-radius centerline, for hit testing and the eraser. */
  readonly hitGeometry: readonly BrushHitSample[];
  readonly renderedScale: number;
  readonly bounds: Rect;
  readonly sourcePointCount: number;
  readonly keptPointCount: number;
}

/** Geometry an incremental evaluator can produce. */
export type LiveRenderGeometry = StrokedPathRenderGeometry | FilledPathRenderGeometry;

/**
 * Structural evidence that live evaluation reuses settled work rather than
 * redoing it.
 *
 * Deliberately counters rather than timings: a per-frame rebuild shows up as
 * settled samples being evaluated more than once, which a clock cannot
 * distinguish from a slow machine.
 */
export interface LiveEvaluationSnapshot {
  /** Samples evaluated into permanent geometry. Should equal the settled sample count. */
  readonly settledPointEvaluations: number;
  readonly tailPointEvaluations: number;
  readonly maximumTailPointEvaluations: number;
  readonly settledSegmentCount: number;
  readonly segmentCount: number;
  readonly keptPointCount: number;
  /** How many later samples a sample must wait for before it can settle. */
  readonly lookaheadSamples: number;
}

/**
 * An evaluator a live renderer can feed a growing sample array without
 * rebuilding.
 *
 * The rendered scale is fixed when the evaluator is created rather than asked
 * for per frame, because a strategy whose sampling density depends on scale
 * would otherwise have to discard everything it had settled the moment the
 * canvas zoomed.
 */
export interface LiveBrushEvaluator {
  append(points: readonly StrokePoint[], final: boolean): void;
  geometry(): LiveRenderGeometry;
  evaluationSnapshot(): LiveEvaluationSnapshot;
}
