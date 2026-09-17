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
 * the character of the mark. So the stroke is a stream of tip placements, a
 * grain field fixed in the stroke's own space decides which patches of paper
 * under each tip take graphite, and consecutive placements that agree are drawn
 * as one tapered streak.
 *
 * Seven decisions carry the design, and two of them are about the rasterizer
 * rather than about pencils.
 *
 * - **Placement is by distance, not by sample.** An arc-length cursor walks the
 *   smoothed centerline and drops a stamp every fixed advance, so the mark is
 *   the same whether the device reported 60 or 240 samples per second, and a
 *   fast flick cannot leave a gap: stamps follow the path, not the events.
 * - **Pressure moves coverage, not alpha.** Every mark in a stroke is painted at
 *   one alpha, and the streaks of graphite are laid out so that no two of them
 *   overlap, so the deposited tone is the brush's own opacity wherever graphite
 *   landed and nowhere darker. What pressure changes is how much of the tip's
 *   paper receives graphite -- which is what darkness on paper physically is,
 *   and the only tonal variation Canvas 2D can paint without compositing an
 *   overlap twice. Pressure also widens the tip, through the same durable
 *   response every other strategy reads.
 * - **The tip has a profile, not an edge.** Deposition is certain through the
 *   core and fades to nothing at the rim, so the silhouette breaks up into
 *   individual grains instead of ending at a mathematical wall. A dry medium
 *   that stops dead at its own radius reads as a shape, not as a material.
 * - **The grain field is a field in the artwork's space.** Whether a patch of
 *   paper catches graphite is hashed from the patch, so neighbouring stamps
 *   agree about it, the texture survives being overdrawn by the stroke's own
 *   overlap, and pressing harder *reveals more of the same paper* rather than
 *   dealing a new pattern. A value drawn from a sequence would be reshuffled by
 *   anything that changed the stamp count, and the tooth would fill in solid
 *   wherever stamps overlapped.
 * - **The tip's own divisions drift.** Graphite is gathered into filaments
 *   across the tip, because that is how a tip loaded with medium actually
 *   deposits it; but filaments fixed at the same offsets for a whole stroke
 *   paint parallel rails, which is a picture of the implementation rather than
 *   of a pencil. So the divisions are carried by two smooth fields in the
 *   artwork's space -- one sliding the whole set sideways, one breathing it
 *   wider and narrower -- which wander the filaments without ever reordering
 *   them. See {@link DRIFT_SHIFT} for why that matters.
 * - **A filament's consecutive graphite is one tapered streak, not one contour
 *   per stamp.** Stamps overlap by construction, so a contour each would hand
 *   the rasterizer tens of thousands of disjoint shapes to resolve against one
 *   another for a picture their union already describes -- measured at 195 ms a
 *   frame where the merged form costs single digits. A run of inked stamps in
 *   one filament is therefore accumulated into a single streak, pointed at both
 *   ends. Every vertex is appended and never revised, so rewinding a run to a
 *   settled length is a truncation and cannot leave a stale value behind --
 *   which is what makes the merged form safe to build incrementally.
 * - **Streaks never overlap one another, so the painter may batch them.** The
 *   tip's divisions tile it exactly and drift together rather than
 *   independently, so no filament can reach into the one beside it; and a
 *   streak's far end always stops short of where the next streak in the same
 *   filament begins. That buys the freedom to paint streaks in small groups:
 *   one `fill()` over thousands of disjoint contours is quadratic in Canvas 2D
 *   and was measured at 155 ms a frame, where the same contours in batches are
 *   linear and cost single digits.
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

/**
 * Stamp advance as a fraction of nominal diameter, with page-space guard rails.
 *
 * The advance is matched to a filament's *width* rather than to the paper's
 * tooth, because that is what keeps the grain isotropic: a mark is about one
 * filament across and about one advance long, and two numbers of the same order
 * give a texture with no direction in it. Much finer buys nothing -- two stamps
 * that overlap ask the same paper the same question and get the same answer, so
 * the second one only lengthens streaks already open -- and costs a contour
 * every time a streak is cut, which is the whole of Pencil's repaint budget.
 * Much coarser combs the texture out along the stroke.
 */
const SPACING_WIDTH_FACTOR = 0.5;
const MINIMUM_SPACING_FLOOR = 0.4;
const MINIMUM_SPACING_CEILING = 1.5;

const MAXIMUM_SMOOTHING_RADIUS = 4;

/**
 * The paper's tooth, in painted page units, anchored in the stroke's own space
 * so the texture keeps one physical size whatever the object's scale.
 *
 * This is the only lattice the ink decision reads, and it is deliberately fine:
 * a patch this size is well under a pixel at ordinary zoom, which is what lets
 * the eye integrate thousands of them into a tone rather than count them. The
 * previous model split the decision into a coarse "does this catch" lattice and
 * a fine "how does it wobble" one; the coarse half is what made the grain read
 * as cells, and the wobble is now carried by the drift fields instead.
 */
const GRAIN_TOOTH = 0.62;

/**
 * How much tip one filament wants before the tip is divided again.
 *
 * Filament count comes from the brush's *nominal* radius and never from the
 * pressure-varied one: a tip that gained and lost filaments as the hand pressed
 * would reshuffle its own grain mid-stroke. Two at the minimum: with one, a
 * declined tooth breaks the mark across its whole width, and a pencil that
 * skips entirely reads as a dashed line rather than as graphite. The span is
 * wider than {@link GRAIN_TOOTH} so that two filaments never sample the same
 * patch of paper as each other, which is what would come out as rungs.
 */
const FILAMENT_SPAN = 1.3;
const MINIMUM_FILAMENTS = 2;
const MAXIMUM_FILAMENTS = 24;

/**
 * How far a streak reaches past the stamps at its two ends, as a fraction of
 * the advance: half of this at each end, so 0.4 of an advance.
 *
 * Under one is the point. Two streaks in one filament are separated by at least
 * one declined stamp, so ends that each reach less than half an advance still
 * leave paper between them. That bound is what makes streaks disjoint, and
 * disjoint streaks are what let the painter batch them without compositing an
 * overlap twice. It also gives a single-stamp streak a body: without it a lone
 * grain would be a degenerate line, and at low pressure most streaks are lone
 * grains.
 */
const RUN_END_FACTOR = 0.8;

/**
 * How many stamps one streak may absorb before it is cut and a new one started:
 * a base, and a per-filament spread on top of it.
 *
 * Two reasons for cutting at all, neither of them about pencils. A streak is one
 * contour, and the painter batches contours in the order they were opened; an
 * unbounded streak would sit in an early batch while the graphite beside it
 * landed in a much later one, and two fills that share an edge composite that
 * edge twice. It also bounds the vertex count of any single contour, which keeps
 * the cost of closing one predictable.
 *
 * The spread is why there are two constants. A firm stroke saturates its core,
 * so every filament inks from the same stamp and, on a single shared limit,
 * every filament also *cuts* on the same stamp -- which lines the gaps up across
 * the width and paints a faint rung every dozen page units. Drawing each
 * filament's limit from the seed scatters the cuts instead. It is the same
 * lesson as the drift fields, one level down: anything periodic and shared
 * across the tip becomes visible structure.
 *
 * The cut is taken at fixed stamps -- every filament has its own limit and its
 * own phase, both drawn from the seed -- rather than after a fixed number of
 * inked stamps. That is what keeps pressure a threshold on one field: a cut
 * that depended on how long the streak happened to be would fall in different
 * places at different pressures, and a firm stroke would open gaps that a light
 * one did not have. Addressed rather than counted, one more time.
 *
 * The cut is taken at the end of a stamp rather than the start of the next, so
 * the gap it leaves is the same gap a declined tooth leaves and cannot read as
 * a seam.
 */
const MINIMUM_RUN_STAMPS = 13;
const RUN_STAMP_SPREAD = 13;

/**
 * The tip's deposition profile, as fractions of the nominal radius.
 *
 * Flat at {@link TIP_PEAK} within {@link TIP_CORE}, then falling smoothly to
 * nothing at {@link TIP_REACH}. The core is what gives a small pencil a
 * continuous line instead of a chain of beads; the falloff is what gives every
 * pencil an edge made of grains. Reach is past one so the outermost grains land
 * slightly beyond the nominal rim, which is what a real tip does and what stops
 * the silhouette from looking cut.
 *
 * The peak is deliberately above one: it is a multiplier on the deposition
 * probability, not a probability itself, so the core of a firm stroke saturates
 * and only the grain field's own clumping opens voids in it. Without that, a
 * two-pixel pencil -- which is three filaments wide at most -- breaks wherever
 * any one of them declines, and reads as a dashed line rather than as a line
 * drawn with a sharp pencil.
 */
const TIP_PEAK = 1.36;
const TIP_CORE = 0.46;
const TIP_REACH = 1.08;

/**
 * How far the tip's divisions wander, as fractions of one filament's width.
 *
 * `DRIFT_SHIFT` slides the whole set of divisions sideways; `DRIFT_STRETCH`
 * breathes it wider and narrower about the tip's centre. Both are read from
 * smooth fields in the artwork's space, and both are applied to every filament
 * of a stamp at once, which is the property that matters: an affine map of the
 * lateral axis moves the divisions without ever reordering them, so the
 * filaments still tile the tip exactly and still cannot overlap. Drifting each
 * filament independently would be easier to write and would put two streaks on
 * top of each other, which is a darker patch the artist did not draw.
 *
 * Without this the divisions sit at the same offsets for the whole stroke and
 * paint parallel rails -- the single most conspicuous defect of the first
 * Pencil, and the reason it read as a patterned brush rather than as graphite.
 */
const DRIFT_SHIFT = 0.85;
const DRIFT_STRETCH = 0.22;
const DRIFT_CELL = 4.5;

/**
 * How much graphite gathers into clumps, and over what distance.
 *
 * Real graphite is not white noise: it crumbs, so neighbouring patches of paper
 * take it together and leave together. A smooth field in the artwork's space
 * modulates the deposition probability by this fraction, which turns an even
 * stipple into small dark clusters and small voids without moving a single
 * grain. Kept modest on purpose -- large amplitude at this scale reads as
 * blotches rather than as tooth.
 *
 * The clusters are sized against the tip rather than fixed in page units, and
 * the reason is the small end of the range. A cluster wider than the tip gates
 * every filament at once, so a four-pixel pencil loses its whole line wherever
 * the field dips and comes out dashed. Held under the tip's own width, the same
 * field instead varies *across* the mark, which is what clumping is supposed to
 * look like. A broader, softer tip gathering larger crumbs than a sharp one is
 * also the physically honest reading.
 */
const CLUMP_AMOUNT = 0.46;
const CLUMP_TIP_FACTOR = 0.45;
const CLUMP_CELL_FLOOR = 1.1;
const CLUMP_CELL_CEILING = 7;

/**
 * The most of a tip's core that graphite ever covers.
 *
 * Below one so even a hard press leaves tooth showing, which is what stops a
 * pressed pencil from resolving into the same solid line a pen draws. It is
 * read together with {@link TIP_PEAK}: the product is what the core of a firm
 * stroke actually deposits at, and it sits just above one so that the voids
 * left in a pressed core are the ones the clump field opens rather than an even
 * scatter of misses.
 *
 * Just above one, and not far above it. A core that saturates completely has no
 * tooth left in it, and -- less obviously -- its filaments then ink without a
 * break for the whole length of the stroke, so each one shares a long unbroken
 * edge with the filament beside it. Those edges are correct geometry and still
 * paint badly: a boundary pixel that two contours each half cover is composited
 * twice when they fall in different fills, and comes out lighter than either, so
 * a faint thread appears along the boundary. Keeping the clump field able to
 * open the core is what keeps those edges short, and it is the same fix as
 * giving a pressed pencil visible paper.
 */
const FULL_COVERAGE = 0.82;

/**
 * Independent hash channels. Adding one must not perturb the others.
 *
 * The ink channel is addressed by the patch of paper alone, with no filament
 * index in it: the tooth is a property of the sheet, so two filaments crossing
 * one patch must agree about it, and a pass that comes back over its own mark
 * must find the paper it already found. Putting the filament in this channel is
 * what made the first Pencil's grain a property of the brush's internals rather
 * than of the artwork.
 */
const CHANNEL_INK = 1;
const CHANNEL_CLUMP = 2;
const CHANNEL_SHIFT = 3;
const CHANNEL_STRETCH = 4;
const CHANNEL_RUN_LIMIT = 5;
const CHANNEL_RUN_PHASE = 6;

interface EvaluatedSample {
  readonly x: number;
  readonly y: number;
  /** Page-space radius, already divided by the rendered scale. */
  readonly radius: number;
  /** Fraction of the tip's core that inks at this sample, 0..1. */
  readonly coverage: number;
}

interface MutableRibbon {
  readonly left: number[];
  readonly right: number[];
}

/** Where one filament's open streak stood, so it can be reopened exactly. */
interface LaneCheckpoint {
  /** Index into the ribbon list, or -1 when the filament has no streak open. */
  readonly ribbon: number;
  readonly leftLength: number;
  readonly rightLength: number;
}

/**
 * Where stamp emission may resume without recomputing anything settled.
 *
 * Restoring it is a handful of assignments, which is what keeps a frame's cost
 * independent of how long the stroke already is.
 */
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
  readonly #clumpCell: number;
  readonly #driftCell: number;
  readonly #lanes: number;
  readonly #laneSpan: number;
  readonly #runEnd: number;
  readonly #alpha: number;
  readonly #stamps: BrushStamp[] = [];
  readonly #ribbons: MutableRibbon[] = [];
  /** Which streak each filament is currently extending, or -1 for none. */
  readonly #openRibbons: number[];
  /** Which stamps cut each filament's streak: every `limit`, offset by `phase`. */
  readonly #runLimits: readonly number[];
  readonly #runPhases: readonly number[];
  /** Scratch for one stamp's division offsets, reused to allocate nothing. */
  readonly #divisions: number[];
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
    this.#lanes = Math.min(
      MAXIMUM_FILAMENTS,
      Math.max(MINIMUM_FILAMENTS, Math.round(brush.size / FILAMENT_SPAN)),
    );
    this.#laneSpan = 2 / this.#lanes;
    this.#toothCell = GRAIN_TOOTH / renderedScale;
    this.#clumpCell =
      clamp(brush.size * CLUMP_TIP_FACTOR, CLUMP_CELL_FLOOR, CLUMP_CELL_CEILING) / renderedScale;
    this.#driftCell = DRIFT_CELL / renderedScale;
    this.#runEnd = (this.#spacing * RUN_END_FACTOR) / 2;
    this.#alpha = clamp(brush.opacity, 0, 1);
    this.#openRibbons = Array.from({ length: this.#lanes }, () => -1);
    const limits = Array.from(
      { length: this.#lanes },
      (_, lane) =>
        MINIMUM_RUN_STAMPS + (brushHash(this.#seed, lane, 0, CHANNEL_RUN_LIMIT) % RUN_STAMP_SPREAD),
    );
    this.#runLimits = Object.freeze(limits);
    this.#runPhases = Object.freeze(
      limits.map((limit, lane) => brushHash(this.#seed, lane, 0, CHANNEL_RUN_PHASE) % limit),
    );
    this.#divisions = Array.from({ length: this.#lanes + 1 }, () => 0);
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
    // Reopening is what lets the next frame continue a streak rather than start
    // a new one; the far end it just wrote is discarded by the rewind first.
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
    // Folded at exactly the tip's radius, because a tap is painted as exactly
    // that disc: the grain never ran, so nothing of it can have reached past it.
    const resting = stamps.length === 0 ? previous : null;
    if (resting !== null) foldDisc(extent, resting.x, resting.y, resting.radius);
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
   * Every filament is put back to the streak it was extending and the length
   * that streak had, so a frame throws away only what the open tail produced. A
   * streak opened during the tail simply ceases to exist when the ribbon list is
   * truncated, and its filament is recorded as closed.
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
   * The tip is divided into filaments by a set of divisions that drift in the
   * artwork's space, each filament asks the grain field whether its patch of
   * paper takes graphite at the local deposition probability, and each answer
   * either extends a streak or ends one.
   *
   * Because the answer is hashed from the patch rather than from the stamp's
   * position in the stream, two stamps overlapping the same paper agree about
   * it -- so the gaps survive the stroke's own overlap instead of filling in,
   * and raising the probability only ever *adds* graphite rather than moving it.
   *
   * A filament that inks extends the streak it already has open by appending one
   * vertex pair and nothing else. One that declines closes its streak, which is
   * where the streak's point is appended. Nothing already written is ever
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
    const normalX = -tangentY;
    const normalY = tangentX;
    const extent = settled ? this.#settledExtent : this.#provisionalExtent;
    const divisions = this.#divisions;
    const stampIndex = this.#stamps.length;
    // One affine map of the lateral axis, shared by every filament of this
    // stamp. Order is preserved, so the filaments still tile the tip exactly.
    const shift =
      (smoothField(seed, x / this.#driftCell, y / this.#driftCell, CHANNEL_SHIFT) - 0.5) *
      2 *
      DRIFT_SHIFT *
      this.#laneSpan;
    const stretch =
      1 +
      (smoothField(seed, x / this.#driftCell, y / this.#driftCell, CHANNEL_STRETCH) - 0.5) *
        2 *
        DRIFT_STRETCH;
    for (let division = 0; division <= this.#lanes; division += 1) {
      divisions[division] = (division * this.#laneSpan - 1) * stretch + shift;
    }
    let markCount = 0;
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      const near = requireOffset(divisions, lane);
      const far = requireOffset(divisions, lane + 1);
      const middle = (near + far) / 2;
      const markX = x + normalX * middle * radius;
      const markY = y + normalY * middle * radius;
      // Both fields are asked about where this filament's graphite would
      // actually land, not about where the tip's centre is. Addressing the
      // mark's own patch of paper is what makes the grain two-dimensional and
      // what keeps it attached to the artwork rather than to a position in a
      // stream.
      const clump =
        1 +
        (smoothField(seed, markX / this.#clumpCell, markY / this.#clumpCell, CHANNEL_CLUMP) - 0.5) *
          2 *
          CLUMP_AMOUNT;
      const deposit = coverage * tipProfile(middle) * clump;
      const threshold = unitFromHash(
        brushHash(seed, Math.floor(markX / tooth), Math.floor(markY / tooth), CHANNEL_INK),
      );
      if (threshold >= deposit) {
        this.#closeLane(lane, extent);
        continue;
      }
      const halfWidth = ((far - near) / 2) * radius;
      const acrossX = normalX * halfWidth;
      const acrossY = normalY * halfWidth;
      const leftX = markX + acrossX;
      const leftY = markY + acrossY;
      const rightX = markX - acrossX;
      const rightY = markY - acrossY;
      // Left forward then right backward is one winding whichever way the
      // stroke travels, because `(tangent, normal)` is always the same handed
      // pair. A non-zero fill therefore unions overlapping streaks instead of
      // cancelling them into holes.
      const open = this.#openRibbons[lane] ?? -1;
      if (open < 0) {
        // A streak starts at a point, not at a squared end: the flat ends of
        // the first Pencil's runs are what made its graphite read as brickwork.
        const behindX = markX - tangentX * this.#runEnd;
        const behindY = markY - tangentY * this.#runEnd;
        this.#openRibbons[lane] = this.#ribbons.length;
        this.#ribbons.push({
          left: [behindX, behindY, leftX, leftY],
          right: [behindX, behindY, rightX, rightY],
        });
        foldPoint(extent, behindX, behindY);
      } else {
        const ribbon = requireRibbon(this.#ribbons, open);
        ribbon.left.push(leftX, leftY);
        ribbon.right.push(rightX, rightY);
      }
      foldPoint(extent, leftX, leftY);
      foldPoint(extent, rightX, rightY);
      // Checked whether or not this stamp opened the streak, so that the cut
      // falls at the same stamps however long the streak happens to be. Cutting
      // only streaks that were already open would let a firm stroke cut where a
      // light one had just started, and the firm mark would have a gap the light
      // one did not.
      const limit = requireOffset(this.#runLimits, lane);
      if ((stampIndex + requireOffset(this.#runPhases, lane)) % limit === 0) {
        this.#closeLane(lane, extent);
      }
      markCount += 1;
    }
    this.#markCount += markCount;
    this.#stamps.push(
      Object.freeze({ index: this.#stamps.length, x, y, radius, coverage, markCount }),
    );
    // The reach of the tip is folded whether or not the grain inked it, so the
    // bound always contains both the hit geometry a selection frame and the
    // eraser read and the furthest a grain of this stamp could have landed.
    foldDisc(extent, x, y, radius * (TIP_REACH + DRIFT_SHIFT * this.#laneSpan));
  }

  /**
   * Ends one filament's streak of graphite.
   *
   * The point is extrapolated from the streak's own last two cross-sections
   * rather than remembered from the stamp that wrote them. That is deliberate: a
   * remembered value would be state outside the arrays, and rewinding the arrays
   * would leave it pointing at a stamp the rewind had just discarded. Derived
   * from what the streak contains, it cannot go stale.
   */
  #closeLane(lane: number, extent: Extent): void {
    const open = this.#openRibbons[lane] ?? -1;
    if (open < 0) return;
    this.#openRibbons[lane] = -1;
    const ribbon = this.#ribbons[open];
    if (ribbon === undefined) return;
    const point = runEndPoint(ribbon, this.#runEnd);
    if (point === null) return;
    ribbon.left.push(point.x, point.y);
    ribbon.right.push(point.x, point.y);
    foldPoint(extent, point.x, point.y);
  }

  /**
   * Ends every streak the tail left open.
   *
   * These vertices are provisional in exactly the way the tail is: the next
   * frame rewinds past them, and the frame after re-derives them from wherever
   * the streak has got to. At the terminal sample they are simply the last thing
   * written, which is why lifting the pencil moves nothing.
   */
  #closeOpenLanes(): void {
    for (let lane = 0; lane < this.#lanes; lane += 1) {
      this.#closeLane(lane, this.#provisionalExtent);
      // The filament stays logically open across frames; only its point is
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

/**
 * How certain deposition is at one lateral position on the tip, in units of the
 * nominal radius.
 *
 * Flat through the core and smoothstepped to nothing at the reach. Smoothstep
 * rather than a straight ramp because a linear falloff leaves a visible corner
 * where it meets the core, and the corner is exactly the kind of geometric
 * signature this model exists to hide.
 */
function tipProfile(offset: number): number {
  const distance = Math.abs(offset);
  if (distance <= TIP_CORE) return TIP_PEAK;
  if (distance >= TIP_REACH) return 0;
  const t = (distance - TIP_CORE) / (TIP_REACH - TIP_CORE);
  const eased = t * t * (3 - 2 * t);
  return TIP_PEAK * (1 - eased);
}

/**
 * One smooth deterministic field over the artwork's space, in `[0, 1]`.
 *
 * Value noise: the four lattice corners around the sample, blended by a
 * smoothstep so the result has no seams at cell boundaries. Coordinates arrive
 * already divided by the field's own cell size, so one implementation serves
 * fields of different scales. Four hashes a sample is the price of a field with
 * no visible lattice, and it is the reason the drift fields are sampled once per
 * stamp rather than once per filament.
 */
function smoothField(seed: number, x: number, y: number, channel: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const easedX = fractionX * fractionX * (3 - 2 * fractionX);
  const easedY = fractionY * fractionY * (3 - 2 * fractionY);
  const topLeft = unitFromHash(brushHash(seed, cellX, cellY, channel));
  const topRight = unitFromHash(brushHash(seed, cellX + 1, cellY, channel));
  const bottomLeft = unitFromHash(brushHash(seed, cellX, cellY + 1, channel));
  const bottomRight = unitFromHash(brushHash(seed, cellX + 1, cellY + 1, channel));
  const top = topLeft + (topRight - topLeft) * easedX;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * easedX;
  return top + (bottom - top) * easedY;
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

/**
 * The point a streak closes at: its last cross-section's centre, carried
 * forward along the direction the streak was travelling.
 */
function runEndPoint(ribbon: MutableRibbon, reach: number): { x: number; y: number } | null {
  const left = ribbon.left;
  const right = ribbon.right;
  const length = left.length;
  if (length < 4 || right.length !== length) return null;
  const x = ((left[length - 2] as number) + (right[length - 2] as number)) / 2;
  const y = ((left[length - 1] as number) + (right[length - 1] as number)) / 2;
  const previousX = ((left[length - 4] as number) + (right[length - 4] as number)) / 2;
  const previousY = ((left[length - 3] as number) + (right[length - 3] as number)) / 2;
  const deltaX = x - previousX;
  const deltaY = y - previousY;
  const span = Math.hypot(deltaX, deltaY);
  if (span <= EPSILON) return null;
  return { x: x + (deltaX / span) * reach, y: y + (deltaY / span) * reach };
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

function foldDisc(extent: Extent, x: number, y: number, radius: number): void {
  extent.minimumX = Math.min(extent.minimumX, x - radius);
  extent.minimumY = Math.min(extent.minimumY, y - radius);
  extent.maximumX = Math.max(extent.maximumX, x + radius);
  extent.maximumY = Math.max(extent.maximumY, y + radius);
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

function requireOffset(offsets: readonly number[], index: number): number {
  const offset = offsets[index];
  if (offset === undefined) throw new RangeError(`Missing Pencil division at index ${index}.`);
  return offset;
}

function normalizePressure(pressure: number): number {
  return Number.isFinite(pressure) ? clamp(pressure, 0, 1) : 0.5;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
