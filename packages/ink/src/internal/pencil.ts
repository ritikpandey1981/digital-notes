import type { Rect } from "@folio/rendering";
import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type {
  BrushStamp,
  LiveBrushEvaluator,
  LiveEvaluationSnapshot,
  StampRibbon,
  StampsRenderGeometry,
} from "./brush-geometry";
import { brushHash, unitFromHash } from "./brush-random";

/**
 * `pencil@1`: a deterministic graphite pencil built from distance-placed stamps.
 *
 * The first dry-media strategy, and the first to use the `stamps` primitive.
 * Where the two pens describe a continuous shape, a pencil describes *where the
 * medium landed*: graphite is spatially discontinuous, and the gaps are most of
 * the character of the mark. So the stroke is a stream of tip placements; each
 * placement offers a few lanes across the tip, a grain field fixed in the
 * stroke's own space decides which of them take graphite, and consecutive
 * placements that agree are drawn as one run.
 *
 * Six decisions carry the design, and two of them are about the rasterizer
 * rather than about pencils.
 *
 * - **Placement is by distance, not by sample.** An arc-length cursor walks the
 *   smoothed centerline and drops a stamp every fixed advance, so the mark is
 *   the same whether the device reported 60 or 240 samples per second, and a
 *   fast flick cannot leave a gap: stamps follow the path, not the events.
 * - **Pressure moves coverage, not alpha.** Every mark in a stroke is painted at
 *   one alpha, and the runs of graphite are laid out so that no two of them
 *   overlap, so the deposited tone is the brush's own opacity wherever graphite
 *   landed and nowhere darker. What pressure changes is how many of the tip's
 *   grain lanes receive graphite -- which is what darkness on paper physically
 *   is, and the only tonal variation Canvas 2D can paint without compositing an
 *   overlap twice. Pressure also widens the tip, through the same durable
 *   response every other strategy reads.
 * - **A lane's consecutive graphite is one contour, not one per stamp.** Stamps
 *   overlap by construction, so a contour each would hand the rasterizer tens of
 *   thousands of disjoint shapes to resolve against one another for a picture
 *   their union already describes -- measured at 195 ms a frame where the merged
 *   form costs single digits. A run of inked stamps in one lane is therefore
 *   accumulated into a single ribbon, and a lane closes its ribbon the moment
 *   the grain declines. Every vertex is appended and never revised, so rewinding
 *   a run to a settled length is a truncation and cannot leave a stale value
 *   behind -- which is what makes the merged form safe to build incrementally.
 * - **Runs never overlap one another, so the painter may batch them.** A lane's
 *   mark always stays inside that lane's own share of the tip, and a run's far
 *   end always stops short of where the next run in the same lane begins. That
 *   costs a little irregularity and buys the freedom to paint runs in small
 *   groups: one `fill()` over thousands of disjoint contours is quadratic in
 *   Canvas 2D and was measured at 155 ms a frame, where the same contours in
 *   batches are linear and cost single digits.
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
const SPACING_WIDTH_FACTOR = 0.8;
const MINIMUM_SPACING_FLOOR = 0.5;
const MINIMUM_SPACING_CEILING = 1.8;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/**
 * Two lattices, both in painted page units, both anchored in the stroke's own
 * space so the texture keeps one physical size whatever the object's scale.
 *
 * They are separate because the two things they address have genuinely
 * different scales on real paper, and because conflating them is expensive.
 * `GRAIN_TOOTH` decides *whether* a patch of paper catches graphite, and it is
 * the coarser of the two: tooth is a property of the sheet, it persists over a
 * few page units, and a run of stamps that agree about it is a run the painter
 * can draw as one contour. `GRAIN_FLECK` decides how a mark wobbles once it has
 * been laid down, and it is fine, because a ragged edge is a fibre-scale thing.
 *
 * The split is what lets the mark stay finely irregular while the number of
 * contours a repaint costs stays bounded by the tooth rather than by the stamp
 * rate. Measured: collapsing them into one fine lattice costs an order of
 * magnitude more contours for a picture no reader can tell apart.
 */
const GRAIN_TOOTH = 1.3;
const GRAIN_FLECK = 0.8;

/**
 * How much tip one grain lane wants before the tip is split again.
 *
 * Lane count comes from the brush's *nominal* radius and never from the
 * pressure-varied one: a tip that gained and lost lanes as the hand pressed
 * would reshuffle its own grain mid-stroke. Two lanes at the minimum: with one,
 * a declined tooth breaks the mark across its whole width, and a pencil that
 * skips entirely reads as a dashed line rather than as graphite.
 */
const GRAIN_LANE_SPAN = 1.1;
const MINIMUM_LANES = 2;
const MAXIMUM_LANES = 6;

/**
 * How far a run reaches past the stamps at its two ends, as a fraction of the
 * advance: half of this at each end, so 0.45 of an advance.
 *
 * Under one half is the point. Two runs in one lane are separated by at least
 * one declined stamp, so ends that each reach less than half an advance still
 * leave paper between them. That bound is what makes runs disjoint, and
 * disjoint runs are what let the painter batch them without compositing an
 * overlap twice. It also gives a single-stamp run a body: without it a lone
 * fleck would be a degenerate line, and at low pressure most runs are lone
 * flecks.
 */
const RUN_END_FACTOR = 0.9;

/**
 * How much of its lane a mark may decline to fill.
 *
 * Irregularity here only ever *removes* graphite: a mark is narrowed by this
 * fraction and then placed anywhere in the slack that leaves, so it wanders and
 * wobbles while staying inside its own lane. Jitter that could push a mark out
 * of its lane would put two runs on top of each other, and two runs on top of
 * each other is a darker patch the artist did not draw.
 */
const WIDTH_JITTER = 0.18;

/**
 * The most of a tip that graphite ever covers.
 *
 * Below one so even a hard press leaves tooth showing, which is what stops a
 * pressed pencil from resolving into the same solid line a pen draws.
 */
const FULL_COVERAGE = 0.92;

/**
 * Independent hash channels. Adding one must not perturb the others.
 *
 * Ink is addressed per lane as well as per cell, because the tooth lattice is
 * coarser than the distance between two lanes: without the lane, a wide tip
 * would ink or decline across its whole width at once and the grain would come
 * out as rungs. The channels sit in separate ranges so the two lattices cannot
 * collide on a cell that happens to carry the same coordinates in both.
 */
const CHANNEL_INK = 0x100;
const CHANNEL_LATERAL = 1;
const CHANNEL_WIDTH = 2;

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
interface MutableRibbon {
  readonly left: number[];
  readonly right: number[];
}

/** Where one grain lane's open run stood, so it can be reopened exactly. */
interface LaneCheckpoint {
  /** Index into the ribbon list, or -1 when the lane has no run open. */
  readonly ribbon: number;
  readonly leftLength: number;
  readonly rightLength: number;
}

interface EmissionCheckpoint {
  readonly previous: EvaluatedSample | null;
  /** Distance still to travel before the next stamp lands. */
  readonly residual: number;
  readonly stampCount: number;
  readonly ribbonCount: number;
  readonly markCount: number;
  readonly lanes: readonly LaneCheckpoint[];
}

const CLOSED_LANE: LaneCheckpoint = Object.freeze({
  ribbon: -1,
  leftLength: 0,
  rightLength: 0,
});

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
  readonly #toothCell: number;
  readonly #fleckCell: number;
  readonly #lanes: number;
  readonly #laneOffsets: readonly number[];
  readonly #laneHalfWidth: number;
  readonly #runEnd: number;
  readonly #alpha: number;
  readonly #stamps: BrushStamp[] = [];
  readonly #ribbons: MutableRibbon[] = [];
  /** Which ribbon each lane is currently extending, or -1 for none. */
  readonly #openRibbons: number[];
  readonly #settledExtent: Extent = emptyExtent();
  #markCount = 0;
  #provisionalExtent: Extent = emptyExtent();
  #checkpoint: EmissionCheckpoint;
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
      Math.max(MINIMUM_LANES, Math.round(nominalRadius / GRAIN_LANE_SPAN)),
    );
    this.#toothCell = GRAIN_TOOTH / renderedScale;
    this.#fleckCell = GRAIN_FLECK / renderedScale;
    this.#laneOffsets = Object.freeze(
      Array.from({ length: this.#lanes }, (_, lane) => (2 * (lane + 0.5)) / this.#lanes - 1),
    );
    this.#laneHalfWidth = 1 / this.#lanes;
    this.#runEnd = (this.#spacing * RUN_END_FACTOR) / 2;
    this.#alpha = clamp(brush.opacity, 0, 1);
    this.#openRibbons = Array.from({ length: this.#lanes }, () => -1);
    this.#checkpoint = Object.freeze({
      previous: null,
      residual: 0,
      stampCount: 0,
      ribbonCount: 0,
      markCount: 0,
      lanes: Object.freeze(Array.from({ length: this.#lanes }, () => CLOSED_LANE)),
    });
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
    const reopen = this.#openRibbons.slice();
    this.#closeOpenLanes();
    // Reopening is what lets the next frame continue a run rather than start a
    // new one; the far end it just wrote is discarded by the rewind first.
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      this.#openRibbons[lane] = reopen[lane] ?? -1;
    }
    if (final) this.#finalized = true;
  }

  /**
   * The current stamp stream.
   *
   * `stamps` and `ribbons` alias evaluator state so a live frame allocates
   * nothing proportional to the stroke; they are valid until the next `append`.
   * Use {@link frozenGeometry} for anything retained.
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
      ribbons: frozen ? Object.freeze(this.#ribbons.map(freezeRibbon)) : this.#ribbons,
      markCount: this.#markCount,
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

  /**
   * Rewinds to the last settled moment.
   *
   * Every lane is put back to the run it was extending and the length that run
   * had, so a frame throws away only what the open tail produced. A run opened
   * during the tail simply ceases to exist when the ribbon list is truncated,
   * and its lane is recorded as closed.
   */
  #restoreCheckpoint(): void {
    const checkpoint = this.#checkpoint;
    this.#stamps.length = checkpoint.stampCount;
    this.#ribbons.length = checkpoint.ribbonCount;
    this.#markCount = checkpoint.markCount;
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      const state = checkpoint.lanes[lane] ?? CLOSED_LANE;
      this.#openRibbons[lane] = state.ribbon;
      if (state.ribbon < 0) continue;
      const ribbon = this.#ribbons[state.ribbon];
      if (ribbon === undefined) {
        this.#openRibbons[lane] = -1;
        continue;
      }
      ribbon.left.length = state.leftLength;
      ribbon.right.length = state.rightLength;
    }
    this.#previous = checkpoint.previous;
    this.#residual = checkpoint.residual;
  }

  #saveCheckpoint(): void {
    this.#checkpoint = Object.freeze({
      previous: this.#previous,
      residual: this.#residual,
      stampCount: this.#stamps.length,
      ribbonCount: this.#ribbons.length,
      markCount: this.#markCount,
      lanes: Object.freeze(
        this.#openRibbons.map((ribbon) => {
          if (ribbon < 0) return CLOSED_LANE;
          const open = this.#ribbons[ribbon];
          return Object.freeze({
            ribbon,
            leftLength: open?.left.length ?? 0,
            rightLength: open?.right.length ?? 0,
          });
        }),
      ),
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
   *
   * A lane that inks extends the run it already has open, by appending one
   * vertex pair and nothing else. A lane that declines closes its run, which is
   * where the run's far end is appended. Nothing already written is ever
   * revised, so a rewind is a truncation.
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
    const tooth = this.#toothCell;
    const fleck = this.#fleckCell;
    const normalX = -tangentY;
    const normalY = tangentX;
    const extent = settled ? this.#settledExtent : this.#provisionalExtent;
    let markCount = 0;
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      // Both lattices are asked about where this lane's graphite would actually
      // land, not about where the tip's centre is. Addressing the mark's own
      // patch of paper is what makes the grain two-dimensional and what keeps
      // it attached to the artwork rather than to a position in a stream.
      const laneOffset = requireOffset(this.#laneOffsets, lane) * radius;
      const markX = x + normalX * laneOffset;
      const markY = y + normalY * laneOffset;
      const threshold = unitFromHash(
        brushHash(seed, Math.floor(markX / tooth), Math.floor(markY / tooth), CHANNEL_INK + lane),
      );
      if (threshold >= coverage) {
        this.#closeLane(lane, extent);
        continue;
      }
      const fleckX = Math.floor(markX / fleck);
      const fleckY = Math.floor(markY / fleck);
      const lateral = unitFromHash(brushHash(seed, fleckX, fleckY, CHANNEL_LATERAL)) * 2 - 1;
      const widthNoise = unitFromHash(brushHash(seed, fleckX, fleckY, CHANNEL_WIDTH));
      const laneHalf = this.#laneHalfWidth * radius;
      const halfWidth = laneHalf * (1 - WIDTH_JITTER * widthNoise);
      // Narrowed first, then moved within exactly the slack that leaves, so the
      // mark can never reach into the lane beside it.
      const offset = laneOffset + lateral * (laneHalf - halfWidth);
      const acrossX = normalX * halfWidth;
      const acrossY = normalY * halfWidth;
      const leftX = x + normalX * offset + acrossX;
      const leftY = y + normalY * offset + acrossY;
      const rightX = x + normalX * offset - acrossX;
      const rightY = y + normalY * offset - acrossY;
      // Left forward then right backward is one winding whichever way the
      // stroke travels, because `(tangent, normal)` is always the same handed
      // pair. A non-zero fill therefore unions overlapping runs instead of
      // cancelling them into holes.
      const open = this.#openRibbons[lane] ?? -1;
      if (open < 0) {
        const behindX = tangentX * this.#runEnd;
        const behindY = tangentY * this.#runEnd;
        this.#openRibbons[lane] = this.#ribbons.length;
        this.#ribbons.push({
          left: [leftX - behindX, leftY - behindY, leftX, leftY],
          right: [rightX - behindX, rightY - behindY, rightX, rightY],
        });
        foldPoint(extent, leftX - behindX, leftY - behindY);
        foldPoint(extent, rightX - behindX, rightY - behindY);
      } else {
        const ribbon = requireRibbon(this.#ribbons, open);
        ribbon.left.push(leftX, leftY);
        ribbon.right.push(rightX, rightY);
      }
      foldPoint(extent, leftX, leftY);
      foldPoint(extent, rightX, rightY);
      markCount += 1;
    }
    this.#markCount += markCount;
    this.#stamps.push(
      Object.freeze({ index: this.#stamps.length, x, y, radius, coverage, markCount }),
    );
    // The nominal tip is folded whether or not the grain inked it, so the bound
    // always contains the hit geometry a selection frame and the eraser read.
    foldDisc(extent, { x, y, radius, coverage });
  }

  /**
   * Ends one lane's run of graphite.
   *
   * The far end is extrapolated from the run's own last two vertices rather
   * than remembered from the stamp that wrote them. That is deliberate: a
   * remembered value would be state outside the arrays, and rewinding the
   * arrays would leave it pointing at a stamp the rewind had just discarded.
   * Derived from what the run contains, it cannot go stale.
   */
  #closeLane(lane: number, extent: Extent): void {
    const open = this.#openRibbons[lane] ?? -1;
    if (open < 0) return;
    this.#openRibbons[lane] = -1;
    const ribbon = this.#ribbons[open];
    if (ribbon === undefined) return;
    extendRunEnd(ribbon.left, this.#runEnd, extent);
    extendRunEnd(ribbon.right, this.#runEnd, extent);
  }

  /**
   * Ends every run the tail left open.
   *
   * These vertices are provisional in exactly the way the tail is: the next
   * frame rewinds past them, and the frame after re-derives them from wherever
   * the run has got to. At the terminal sample they are simply the last thing
   * written, which is why lifting the pencil moves nothing.
   */
  #closeOpenLanes(): void {
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      this.#closeLane(lane, this.#provisionalExtent);
      // The lane stays logically open across frames; only its far end is
      // provisional, so the checkpoint's own record of it is what reopens it.
    }
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

/** Appends the far end of a run, extrapolated from the two vertices before it. */
function extendRunEnd(side: number[], reach: number, extent: Extent): void {
  const length = side.length;
  const x = side[length - 2];
  const y = side[length - 1];
  const previousX = side[length - 4];
  const previousY = side[length - 3];
  if (x === undefined || y === undefined || previousX === undefined || previousY === undefined) {
    return;
  }
  const deltaX = x - previousX;
  const deltaY = y - previousY;
  const span = Math.hypot(deltaX, deltaY);
  if (span <= EPSILON) return;
  const endX = x + (deltaX / span) * reach;
  const endY = y + (deltaY / span) * reach;
  side.push(endX, endY);
  foldPoint(extent, endX, endY);
}

function foldPoint(extent: Extent, x: number, y: number): void {
  extent.minimumX = Math.min(extent.minimumX, x);
  extent.minimumY = Math.min(extent.minimumY, y);
  extent.maximumX = Math.max(extent.maximumX, x);
  extent.maximumY = Math.max(extent.maximumY, y);
}

function freezeRibbon(ribbon: MutableRibbon): StampRibbon {
  return Object.freeze({
    left: Object.freeze([...ribbon.left]),
    right: Object.freeze([...ribbon.right]),
  });
}

function requireRibbon(ribbons: readonly MutableRibbon[], index: number): MutableRibbon {
  const ribbon = ribbons[index];
  if (ribbon === undefined) throw new RangeError(`Missing Pencil ribbon at index ${index}.`);
  return ribbon;
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
