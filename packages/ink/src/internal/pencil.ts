import type { Rect } from "@folio/rendering";
import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import {
  STAMP_MARK_STRIDE,
  type BrushStamp,
  type LiveBrushEvaluator,
  type LiveEvaluationSnapshot,
  type StampsRenderGeometry,
} from "./brush-geometry";
import { brushHash, unitFromHash } from "./brush-random";

/**
 * `pencil@1`: a deterministic graphite pencil built from distance-placed stamps.
 *
 * The first dry-media strategy, and the first to use the `stamps` primitive.
 * Where the two pens describe a continuous shape, a pencil describes *where the
 * medium landed*: graphite is spatially discontinuous, and the gaps are most of
 * the character of the mark. So the stroke is a stream of tip placements, and
 * each placement lays down a few short streaks of graphite -- some of them, not
 * all of them -- according to a grain field fixed in the stroke's own space.
 *
 * Four decisions carry the design.
 *
 * - **Placement is by distance, not by sample.** An arc-length cursor walks the
 *   smoothed centerline and drops a stamp every fixed advance, so the mark is
 *   the same whether the device reported 60 or 240 samples per second, and a
 *   fast flick cannot leave a gap: stamps follow the path, not the events.
 * - **Pressure moves coverage, not alpha.** Every mark in a stroke is painted at
 *   one alpha in one `fill()`, so overlapping marks composite exactly once and a
 *   stroke cannot darken at its own overlaps. What pressure changes is how many
 *   of the tip's grain lanes receive graphite -- which is what darkness on paper
 *   physically is, and the only way to vary tone within a stroke that Canvas 2D
 *   can paint in a single pass. Pressure also widens the tip, through the same
 *   durable response every other strategy reads.
 * - **Grain is a field in the stroke's own space, not a sequence.** A mark's
 *   threshold and jitter are hashed from the grain cell it falls in, so
 *   neighbouring stamps agree about where the paper's tooth is and the texture
 *   survives being overdrawn by the stroke's own overlap. A value drawn from a
 *   sequence would be reshuffled by anything that changed the stamp count, and
 *   the tooth would fill in solid wherever stamps overlapped.
 * - **Nothing generated is durable.** Stamps, marks and grain are a pure
 *   function of the source samples, the resolved snapshot, the rendered scale
 *   and a seed derived from `Stroke.id`. The document stores none of it.
 *
 * Deliberately absent: tilt, azimuth, side-of-pencil shading, per-hardness
 * physics, wet media, and any external texture asset. Tilt in particular is
 * ignored on purpose rather than by omission -- a pencil that reads tilt is
 * `pencil@2`, not a later edit to this one.
 */

const EPSILON = 0.000_001;

/** Stamp advance as a fraction of nominal diameter, with page-space guard rails. */
const SPACING_WIDTH_FACTOR = 0.55;
const MINIMUM_SPACING_FLOOR = 0.4;
const MINIMUM_SPACING_CEILING = 4;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/**
 * Paper tooth, measured in painted page units.
 *
 * The grain field is one two-dimensional lattice of this size in painted page
 * space, so the tooth stays one physical size whatever the object's scale,
 * exactly as the painted width does. Coarse enough to read as texture rather
 * than as noise, fine enough that even a two-unit pencil crosses several cells.
 *
 * It is capped against the lane pitch below, because a cell wider than the
 * distance between two lanes would hand both lanes the same answer and the
 * tooth would come out as stripes along the stroke rather than as grain.
 */
const GRAIN_CELL = 0.9;
const GRAIN_CELL_LANE_FRACTION = 0.85;

/**
 * How much tip one grain lane wants before the tip is split again.
 *
 * Lane count comes from the brush's *nominal* radius and never from the
 * pressure-varied one: a tip that gained and lost lanes as the hand pressed
 * would reshuffle its own grain mid-stroke. Two lanes minimum, so a light touch
 * thins the mark instead of only breaking it.
 */
const GRAIN_LANE_SPAN = 1.1;
const MINIMUM_LANES = 2;
const MAXIMUM_LANES = 6;

/** A lane's mark slightly overruns its share of the tip, so full coverage closes up. */
const LANE_FILL = 1.15;

/** A streak spans rather more than an advance, so consecutive stamps join into a trail. */
const STREAK_LENGTH_FACTOR = 1.35;

/**
 * Deterministic excursions, as fractions of the tip radius and of the nominal
 * streak.
 *
 * Kept small and bounded on purpose. Edge irregularity is what separates
 * graphite from ink, but scatter that grows with the brush stops reading as a
 * rough edge and starts reading as a broken stroke.
 */
const LATERAL_JITTER = 0.22;
const WIDTH_JITTER = 0.3;
const LENGTH_JITTER = 0.35;

/**
 * The most of a tip that graphite ever covers.
 *
 * Below one so even a hard press leaves tooth showing, which is what stops a
 * pressed pencil from resolving into the same solid line a pen draws.
 */
const FULL_COVERAGE = 0.92;

/** Independent hash channels. Adding one must not perturb the others. */
const CHANNEL_INK = 0;
const CHANNEL_LATERAL = 1;
const CHANNEL_WIDTH = 2;
const CHANNEL_LENGTH = 3;

const EMPTY_MARKS: readonly number[] = Object.freeze([]);

interface EvaluatedSample {
  readonly x: number;
  readonly y: number;
  /** Page-space radius, already divided by the rendered scale. */
  readonly radius: number;
  /** Fraction of the tip that inks at this sample, 0..1. */
  readonly coverage: number;
}

/**
 * Where stamp emission may resume without recomputing anything settled.
 *
 * Restoring it is four assignments, which is what keeps a frame's cost
 * independent of how long the stroke already is.
 */
interface EmissionCheckpoint {
  readonly previous: EvaluatedSample | null;
  /** Distance still to travel before the next stamp lands. */
  readonly residual: number;
  readonly stampCount: number;
  readonly markLength: number;
}

interface Extent {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

export class PencilEvaluator implements LiveBrushEvaluator {
  readonly #brush: ResolvedBrushSnapshot;
  readonly #renderedScale: number;
  readonly #seed: number;
  readonly #smoothingRadius: number;
  readonly #smoothingAmount: number;
  readonly #lookaheadSamples: number;
  readonly #spacing: number;
  readonly #grainCell: number;
  readonly #lanes: number;
  readonly #laneOffsets: readonly number[];
  readonly #laneHalfWidth: number;
  readonly #halfLength: number;
  readonly #alpha: number;
  readonly #stamps: BrushStamp[] = [];
  readonly #marks: number[] = [];
  readonly #settledExtent: Extent = emptyExtent();
  #provisionalExtent: Extent = emptyExtent();
  #checkpoint: EmissionCheckpoint = Object.freeze({
    previous: null,
    residual: 0,
    stampCount: 0,
    markLength: 0,
  });
  #previous: EvaluatedSample | null = null;
  #residual = 0;
  #settledRawCount = 0;
  #sourcePointCount = 0;
  #finalized = false;
  #settledPointEvaluations = 0;
  #tailPointEvaluations = 0;
  #maximumTailPointEvaluations = 0;

  constructor(brush: ResolvedBrushSnapshot, renderedScale: number, seed: number) {
    if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
      throw new RangeError("Pencil render scale must be positive and finite.");
    }
    this.#brush = brush;
    this.#renderedScale = renderedScale;
    this.#seed = seed >>> 0;
    const smoothing = brush.smoothing;
    const active = smoothing.mode !== "none" && smoothing.amount > 0;
    this.#smoothingAmount = active ? clamp(smoothing.amount, 0, 1) : 0;
    this.#smoothingRadius = active
      ? Math.min(MAXIMUM_SMOOTHING_RADIUS, 1 + Math.floor(this.#smoothingAmount * 3))
      : 0;
    // At least one sample is always held back, so the terminal sample reaches
    // the rule that keeps it regardless of where the cursor happens to stand.
    this.#lookaheadSamples = Math.max(this.#smoothingRadius, 1);
    // Divided by the rendered scale, like every other page-space length here: a
    // scaled object keeps its painted width and gains length, so it needs
    // proportionally more stamps rather than the same ones spread further apart.
    this.#spacing =
      clamp(brush.size * SPACING_WIDTH_FACTOR, MINIMUM_SPACING_FLOOR, MINIMUM_SPACING_CEILING) /
      renderedScale;
    const nominalRadius = brush.size / 2;
    this.#lanes = Math.min(
      MAXIMUM_LANES,
      Math.max(MINIMUM_LANES, 1 + Math.round(nominalRadius / GRAIN_LANE_SPAN)),
    );
    this.#grainCell =
      Math.min(GRAIN_CELL, ((2 * nominalRadius) / this.#lanes) * GRAIN_CELL_LANE_FRACTION) /
      renderedScale;
    this.#laneOffsets = Object.freeze(
      Array.from({ length: this.#lanes }, (_, lane) => (2 * (lane + 0.5)) / this.#lanes - 1),
    );
    this.#laneHalfWidth = LANE_FILL / this.#lanes;
    this.#halfLength = (this.#spacing * STREAK_LENGTH_FACTOR) / 2;
    this.#alpha = clamp(brush.opacity, 0, 1);
  }

  /**
   * Consumes every sample not yet consumed, then re-walks only the open tail.
   *
   * `final` promotes the whole stroke: the terminal sample is where the pencil
   * actually stopped, so it is admitted under a rule of its own and everything
   * becomes settled at once.
   */
  append(points: readonly StrokePoint[], final: boolean): void {
    if (this.#finalized) return;
    this.#sourcePointCount = points.length;
    // The previous frame's provisional work is thrown away; settled stamps are
    // not in this range and are therefore never regenerated.
    this.#restoreCheckpoint();
    this.#provisionalExtent = emptyExtent();

    const settleLimit = final ? points.length : Math.max(0, points.length - this.#lookaheadSamples);
    while (this.#settledRawCount < settleLimit) {
      const index = this.#settledRawCount;
      this.#settledPointEvaluations += 1;
      this.#consume(points, index, final && index === points.length - 1, true);
      this.#settledRawCount = index + 1;
      this.#saveCheckpoint();
    }

    this.#tailPointEvaluations = 0;
    for (let index = this.#settledRawCount; index < points.length; index += 1) {
      this.#tailPointEvaluations += 1;
      // The newest sample is treated as terminal whether or not the stroke has
      // ended. It keeps the last graphite exactly under the tip instead of
      // lagging a stamp behind it, and it is why lifting the pencil moves
      // nothing: the end was already being placed by the committed rule.
      this.#consume(points, index, index === points.length - 1, false);
    }
    this.#maximumTailPointEvaluations = Math.max(
      this.#maximumTailPointEvaluations,
      this.#tailPointEvaluations,
    );
    if (final) this.#finalized = true;
  }

  /**
   * The current stamp stream.
   *
   * `stamps` and `marks` alias evaluator state so a live frame allocates nothing
   * proportional to the stroke; they are valid until the next `append`. Use
   * {@link frozenGeometry} for anything retained.
   */
  geometry(): StampsRenderGeometry {
    return this.#geometry(false);
  }

  /** An immutable copy, for geometry that outlives the evaluator. */
  frozenGeometry(): StampsRenderGeometry {
    return this.#geometry(true);
  }

  evaluationSnapshot(): LiveEvaluationSnapshot {
    return Object.freeze({
      settledPointEvaluations: this.#settledPointEvaluations,
      tailPointEvaluations: this.#tailPointEvaluations,
      maximumTailPointEvaluations: this.#maximumTailPointEvaluations,
      settledSegmentCount: this.#checkpoint.stampCount,
      segmentCount: this.#stamps.length,
      keptPointCount: this.#stamps.length,
      lookaheadSamples: this.#lookaheadSamples,
    });
  }

  #geometry(frozen: boolean): StampsRenderGeometry {
    const stamps = this.#stamps;
    const marks = this.#marks;
    const extent = copyExtent(this.#settledExtent);
    unionExtent(extent, this.#provisionalExtent);
    const previous = this.#previous;
    // A press that never travelled far enough to place a stamp is still a mark:
    // the tip touched the paper, so it leaves the tip.
    const resting = stamps.length === 0 ? previous : null;
    if (resting !== null) foldDisc(extent, resting);
    // One array, read as both the stamp stream and the hit geometry. Copying it
    // twice would be two things that can disagree as well as twice the memory.
    const stream = frozen ? Object.freeze([...stamps]) : stamps;
    return Object.freeze({
      kind: "stamps",
      stamps: stream,
      marks: marks.length === 0 ? EMPTY_MARKS : frozen ? Object.freeze([...marks]) : marks,
      markCount: marks.length / STAMP_MARK_STRIDE,
      alpha: this.#alpha,
      dot:
        resting === null
          ? null
          : Object.freeze({
              center: Object.freeze({ x: resting.x, y: resting.y }),
              radius: resting.radius,
            }),
      hitGeometry: stream,
      renderedScale: this.#renderedScale,
      bounds: extentRect(extent),
      sourcePointCount: this.#sourcePointCount,
      keptPointCount: stamps.length,
    });
  }

  #restoreCheckpoint(): void {
    const checkpoint = this.#checkpoint;
    this.#stamps.length = checkpoint.stampCount;
    this.#marks.length = checkpoint.markLength;
    this.#previous = checkpoint.previous;
    this.#residual = checkpoint.residual;
  }

  #saveCheckpoint(): void {
    this.#checkpoint = Object.freeze({
      previous: this.#previous,
      residual: this.#residual,
      stampCount: this.#stamps.length,
      markLength: this.#marks.length,
    });
  }

  /** Walks one span of the centerline, dropping a stamp every fixed advance. */
  #consume(
    points: readonly StrokePoint[],
    index: number,
    terminal: boolean,
    settled: boolean,
  ): void {
    const sample = this.#evaluate(points, index, terminal);
    const previous = this.#previous;
    this.#previous = sample;
    if (previous === null) return;
    const spanX = sample.x - previous.x;
    const spanY = sample.y - previous.y;
    const length = Math.hypot(spanX, spanY);
    if (length <= EPSILON) return;
    const tangentX = spanX / length;
    const tangentY = spanY / length;
    let residual = this.#residual;
    while (residual <= length) {
      const progress = residual / length;
      this.#emitStamp(
        previous.x + spanX * progress,
        previous.y + spanY * progress,
        tangentX,
        tangentY,
        previous.radius + (sample.radius - previous.radius) * progress,
        previous.coverage + (sample.coverage - previous.coverage) * progress,
        settled,
      );
      residual += this.#spacing;
    }
    this.#residual = residual - length;
    // Where the pencil stopped is information no later sample can supply, so
    // the last position always receives graphite even when the cursor has not
    // come round again. A stamp already standing there is not repeated.
    if (terminal && this.#spacing - this.#residual > EPSILON) {
      this.#emitStamp(
        sample.x,
        sample.y,
        tangentX,
        tangentY,
        sample.radius,
        sample.coverage,
        settled,
      );
    }
  }

  /**
   * Lays one tip's worth of graphite.
   *
   * Each lane asks the grain field whether this patch of paper takes ink at this
   * coverage. Because the answer is hashed from the cell rather than from the
   * stamp's position in the stream, two stamps overlapping the same tooth agree
   * about it -- so the gaps survive the stroke's own overlap instead of filling
   * in, and raising coverage only ever *adds* marks rather than moving them.
   */
  #emitStamp(
    x: number,
    y: number,
    tangentX: number,
    tangentY: number,
    radius: number,
    coverage: number,
    settled: boolean,
  ): void {
    const seed = this.#seed;
    const cell = this.#grainCell;
    const normalX = -tangentY;
    const normalY = tangentX;
    const extent = settled ? this.#settledExtent : this.#provisionalExtent;
    const marks = this.#marks;
    let markCount = 0;
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      // The field is asked about where this lane's graphite would actually
      // land, not about where the tip's centre is. Hashing the mark's own patch
      // of paper is what makes the tooth two-dimensional: a lane channel keyed
      // to the stamp would give one lane the same answer stamp after stamp, and
      // the grain would come out as stripes running along the stroke.
      const laneOffset = requireOffset(this.#laneOffsets, lane) * radius;
      const cellX = Math.floor((x + normalX * laneOffset) / cell);
      const cellY = Math.floor((y + normalY * laneOffset) / cell);
      const threshold = unitFromHash(brushHash(seed, cellX, cellY, CHANNEL_INK));
      if (threshold >= coverage) continue;
      const lateral = unitFromHash(brushHash(seed, cellX, cellY, CHANNEL_LATERAL)) - 0.5;
      const widthNoise = unitFromHash(brushHash(seed, cellX, cellY, CHANNEL_WIDTH));
      const lengthNoise = unitFromHash(brushHash(seed, cellX, cellY, CHANNEL_LENGTH));
      const offset = laneOffset + lateral * LATERAL_JITTER * 2 * radius;
      const halfWidth =
        this.#laneHalfWidth * radius * (1 - WIDTH_JITTER + widthNoise * WIDTH_JITTER * 2);
      const halfLength = this.#halfLength * (1 - LENGTH_JITTER + lengthNoise * LENGTH_JITTER * 2);
      const centerX = x + normalX * offset;
      const centerY = y + normalY * offset;
      const alongX = tangentX * halfLength;
      const alongY = tangentY * halfLength;
      const acrossX = normalX * halfWidth;
      const acrossY = normalY * halfWidth;
      // One winding for every mark, whichever way the stroke is travelling:
      // `(tangent, normal)` is always the same handed pair, so a non-zero fill
      // unions overlapping marks instead of cancelling them into holes.
      marks.push(
        centerX - alongX - acrossX,
        centerY - alongY - acrossY,
        centerX + alongX - acrossX,
        centerY + alongY - acrossY,
        centerX + alongX + acrossX,
        centerY + alongY + acrossY,
        centerX - alongX + acrossX,
        centerY - alongY + acrossY,
      );
      foldQuad(extent, marks, marks.length - STAMP_MARK_STRIDE);
      markCount += 1;
    }
    this.#stamps.push(
      Object.freeze({ index: this.#stamps.length, x, y, radius, coverage, markCount }),
    );
    // The nominal tip is folded whether or not the grain inked it, so the bound
    // always contains the hit geometry a selection frame and the eraser read.
    foldDisc(extent, { x, y, radius, coverage });
  }

  /**
   * Position, radius and coverage under one fixed window.
   *
   * All three are smoothed by the same weights for the same reason: a quantity
   * that stops changing once it has a fixed number of successors is a quantity
   * that can settle, and one that does not would keep moving the stamps behind
   * it.
   */
  #evaluate(points: readonly StrokePoint[], index: number, terminal: boolean): EvaluatedSample {
    const current = requirePoint(points, index);
    const radius = this.#smoothingRadius;
    // Both ends stay exactly where the pencil was, at exactly the pressure it
    // reported. Smoothing an endpoint would pull the mark away from where the
    // artist started or stopped it.
    if (radius === 0 || index === 0 || terminal) {
      return this.#resolve(current.x, current.y, normalizePressure(current.pressure));
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
    return this.#resolve(
      current.x + (weightedX / totalWeight - current.x) * amount,
      current.y + (weightedY / totalWeight - current.y) * amount,
      clamp(pressure + (weightedPressure / totalWeight - pressure) * amount, 0, 1),
    );
  }

  /**
   * What one pressure means for this brush.
   *
   * Width reads `pressureSize` exactly as every other strategy does. Coverage
   * reads `pressureOpacity`, which for a dry medium is the honest reading of
   * that response: a lighter touch deposits less graphite across the tip rather
   * than depositing translucent graphite. With the response disabled -- which is
   * how a mouse resolves -- the factor is one and the pencil draws at its full
   * configured coverage, so an unexpressive device gets the brush as configured
   * rather than the middle of somebody's curve.
   */
  #resolve(x: number, y: number, pressure: number): EvaluatedSample {
    return {
      x,
      y,
      radius: Math.max(
        brushSizeAtPressure(this.#brush, pressure) / (this.#renderedScale * 2),
        EPSILON,
      ),
      coverage: clamp(
        FULL_COVERAGE * evaluatePressureResponse(this.#brush.dynamics.pressureOpacity, pressure),
        0,
        1,
      ),
    };
  }
}

/** Evaluates one complete Pencil stamp stream in a single pass. */
export function createPencilGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
  seed: number,
): StampsRenderGeometry {
  const evaluator = new PencilEvaluator(brush, renderedScale, seed);
  evaluator.append(points, true);
  return evaluator.frozenGeometry();
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

function foldQuad(extent: Extent, marks: readonly number[], offset: number): void {
  for (let corner = 0; corner < STAMP_MARK_STRIDE; corner += 2) {
    const x = marks[offset + corner];
    const y = marks[offset + corner + 1];
    if (x === undefined || y === undefined) continue;
    extent.minimumX = Math.min(extent.minimumX, x);
    extent.minimumY = Math.min(extent.minimumY, y);
    extent.maximumX = Math.max(extent.maximumX, x);
    extent.maximumY = Math.max(extent.maximumY, y);
  }
}

function foldDisc(extent: Extent, sample: EvaluatedSample): void {
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
  if (point === undefined) throw new RangeError(`Missing Pencil point at index ${index}.`);
  return point;
}

function requireOffset(offsets: readonly number[], lane: number): number {
  const offset = offsets[lane];
  if (offset === undefined) throw new RangeError(`Missing Pencil lane offset at index ${lane}.`);
  return offset;
}

function normalizePressure(pressure: number): number {
  return Number.isFinite(pressure) ? clamp(pressure, 0, 1) : 0.5;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
