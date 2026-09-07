/**
 * Geometry for the exploded Layers stack.
 *
 * Pure maths over measured workspace space. It owns no DOM, no document and no
 * state, so the spatial arrangement can be reasoned about and tested without a
 * window -- and so the component stays a renderer of this result rather than a
 * place where offsets accumulate.
 *
 * Nothing here touches the document. Every value is presentation.
 */

/** The tunable half of the geometry, kept together so candidates are comparable. */
export interface SpatialStackTuning {
  /** Share of the measured free workspace one plane may span. */
  readonly planeWidthRatio: number;
  readonly tiltDegrees: number;
  /** Toward the viewer per step down the stack. */
  readonly depthPerPlane: number;
  /** Separation as a share of a plane's own apparent height. */
  readonly separationRatio: number;
  readonly perspective: number;
}

/**
 * Chosen by visual comparison against candidates A, B and C.
 *
 * B read as genuine sheets: A stayed too flat to be worth the perspective, and
 * C tipped far enough that the foreshortened artwork began to fight the viewer.
 * The values are deliberately grouped so the whole look moves together.
 *
 * `separationRatio` is large on purpose. The stack is a window onto an
 * arrangement rather than a picture of all of it: roughly two or three sheets
 * are meaningfully visible at once, and navigation brings the rest through. A
 * separation small enough to fit ten Layers on screen would be a compressed
 * overview, which is not what this view is for.
 *
 * Sheet size no longer trades against it. `planeWidthRatio` caps how much of
 * the free width one sheet may span, `usefulSheetScale` decides how large a
 * single sheet is, and neither depends on the layer count or the gaps.
 */
export const SPATIAL_STACK_GEOMETRY = Object.freeze({
  planeWidthRatio: 0.8,
  tiltDegrees: 35,
  depthPerPlane: 48,
  separationRatio: 0.72,
  perspective: 1100,
  /**
   * Paper sits further from Layer 1 than layers sit from each other.
   *
   * The page's own sheet is not a Layer, and the extra distance is what says so
   * without adding any chrome.
   */
  paperGapMultiplier: 1.3,
  /**
   * Sheet size, as a share of the largest single sheet the workspace allows.
   *
   * Derived from the workspace and the page rather than a global pixel
   * constant, so a small window scales everything down together.
   *
   * Deliberately close to one, and deliberately independent of both the layer
   * count and the separation. Shrinking the sheets until the whole stack fitted
   * on screen is what turned this view into small previews floating in the
   * middle of the workspace. Navigation moves through the arrangement instead,
   * so the page keeps its size and the stack simply gets taller.
   */
  usefulSheetScale: 0.84,
  /**
   * How close to the camera the nearest sheet may come, as a share of the
   * perspective distance.
   *
   * Depth accumulates down the stack, so without a ceiling a deep document
   * pushes its top sheet far enough forward that perspective magnifies it past
   * the workspace -- and, far enough, through the camera entirely. The step
   * between neighbours is what the eye actually reads here, and only three
   * sheets are ever in the composition, so a deep stack gives up a little of
   * that step rather than the focused sheet giving up its surface.
   */
  maximumDepthShare: 0.24,
  /** Breathing room kept above and below the whole stack. */
  verticalPadding: 24,
  /** Hard floor so a pathological stack still fits its own scroller. */
  absoluteMinimumGap: 6,
});

/**
 * The separation choreography: one page delaminating into its sheets.
 *
 * Everything is expressed as a share of a single normalized progress rather
 * than as per-sheet clocks, so a reversal is a change of direction on one value
 * instead of a set of timers that have to be unwound. This is the same
 * discipline the Radial Brush Library uses.
 */
export const SPATIAL_STACK_MOTION = Object.freeze({
  openMilliseconds: 320,
  /** Closing is quicker: putting something away should not be a performance. */
  closeMilliseconds: 260,
  /** Per-sheet offset down the stack, converted to a share of the open pass. */
  staggerMilliseconds: 18,
  /**
   * How tilted the page already is when the sheets are still coincident.
   *
   * Not zero: a perfectly flat collapsed state reads as a rectangle that
   * suddenly becomes a scene. Starting part-tipped means the page is visibly
   * the same object throughout, and the remaining rotation is what carries the
   * eye into the arrangement.
   */
  collapsedTiltRatio: 0.32,
  /** The page finishes tipping before the sheets start to come apart. */
  tiltWindow: 0.45,
  /** Separation begins only once the backdrop is fully opaque. */
  separationStart: 0.18,
  /** Total lead the top sheet may take over the bottom one. */
  maximumStaggerSpan: 0.4,
  /**
   * How quickly the workspace backdrop reaches full opacity.
   *
   * Short enough to be one frame of the real open, and it completes well before
   * `separationStart`. Both matter: the live canvas must never be visible
   * behind the arrangement, and while the backdrop is still arriving the sheets
   * are all still lying on the opaque paper with nothing to see through them.
   * A slow-motion capture of an earlier, longer ramp showed the live page
   * flashing behind the collapsed sheet, which is what set this value.
   */
  backdropWindow: 0.06,
});

export interface SpatialStackLayoutInput {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly workspaceWidth: number;
  readonly workspaceHeight: number;
  readonly layerCount: number;
  /** Candidate overrides. Production passes nothing and takes the chosen look. */
  readonly tuning?: Partial<SpatialStackTuning>;
}

/** One positioned sheet. `storageIndex` is -1 for the paper base. */
export interface SpatialStackPlane {
  /** Canonical bottom-to-top Layer index, or -1 for the page's paper. */
  readonly storageIndex: number;
  /** 0 at the visual top of the stack, increasing downward. */
  readonly displayIndex: number;
  readonly translateY: number;
  readonly translateZ: number;
  /** Explicit paint order. Never left to 3D sorting; see the component. */
  readonly zIndex: number;
}

export interface SpatialStackLayout {
  readonly planeWidth: number;
  readonly planeHeight: number;
  readonly perspective: number;
  readonly tiltDegrees: number;
  readonly gap: number;
  /** The wider distance between the bottom Layer and the page's paper. */
  readonly paperGap: number;
  readonly depthPerPlane: number;
  /** Total vertical space the arranged stack occupies, tilt included. */
  readonly stackHeight: number;
  /**
   * True when the arrangement is taller than the workspace it is shown in.
   *
   * Expected for all but the shallowest documents: sheets keep their size and
   * the stack is navigated rather than fitted. Reported for tests and
   * diagnostics; there is no scroll container to turn on.
   */
  readonly scrolls: boolean;
  readonly paper: SpatialStackPlane;
  /** Visual order: index 0 is the topmost Layer, last is the bottom Layer. */
  readonly layers: readonly SpatialStackPlane[];
}

/**
 * Arranges the paper base and every Layer plane inside the measured workspace.
 *
 * Laid out top-first: display index 0 is the topmost Layer, which is the *last*
 * Layer in canonical bottom-to-top storage. The paper base always takes the
 * final slot, below every Layer, and never participates in Layer ordering.
 *
 * Planes fan downward and toward the viewer, so the sheet nearest the eye is
 * the paper. `rotateX` foreshortens each plane, so the height that must fit is
 * the *apparent* height rather than the plane's own.
 *
 * Sizing priority is artwork first: the plane is only shrunk down to a minimum
 * useful scale, after which the stack scrolls rather than turning the page into
 * a thumbnail.
 */
export function computeSpatialLayerStackLayout(input: SpatialStackLayoutInput): SpatialStackLayout {
  const tuning: SpatialStackTuning = { ...SPATIAL_STACK_GEOMETRY, ...input.tuning };
  const geometry = SPATIAL_STACK_GEOMETRY;
  const layerCount = Math.max(1, Math.floor(input.layerCount));
  const aspect =
    input.pageWidth > 0 && input.pageHeight > 0 ? input.pageHeight / input.pageWidth : 1;

  const workspaceWidth = Math.max(0, input.workspaceWidth);
  const workspaceHeight = Math.max(0, input.workspaceHeight);
  const availableHeight = Math.max(64, workspaceHeight - geometry.verticalPadding * 2);

  const foreshortening = Math.cos((tuning.tiltDegrees * Math.PI) / 180);
  const widthBudget = Math.max(1, workspaceWidth * tuning.planeWidthRatio);

  // Uniform, whatever the depth. Compressing a tall stack to make it fit is
  // what produced a compressed overview, and the arrangement is navigated now,
  // so its total height costs nothing.
  const ratio = tuning.separationRatio;

  /**
   * Sheet size answers one question: how large can a single sheet be here?
   *
   * Not how many sheets there are, and not how far apart they sit. The stack is
   * navigated rather than fitted, so nothing is gained by dividing the page
   * down to make room for gaps -- that is what made these read as previews. A
   * document with ten Layers gets the same sheet as a document with one, and
   * the arrangement grows taller instead.
   */
  const oneSheetWidth = Math.min(widthBudget, availableHeight / foreshortening / aspect);
  const planeWidth = oneSheetWidth * geometry.usefulSheetScale;
  const planeHeight = planeWidth * aspect;
  const apparentHeight = planeHeight * foreshortening;

  const gap = Math.max(apparentHeight * ratio, geometry.absoluteMinimumGap);
  const paperGap = gap * geometry.paperGapMultiplier;
  const stackHeight = apparentHeight + gap * (layerCount - 1) + paperGap;

  // Bounded, so the nearest sheet never approaches the camera.
  const depthPerPlane = Math.min(
    tuning.depthPerPlane,
    (geometry.maximumDepthShare * tuning.perspective) / (layerCount + 1),
  );

  const plane = (
    storageIndex: number,
    displayIndex: number,
    translateY: number,
  ): SpatialStackPlane =>
    Object.freeze({
      storageIndex,
      displayIndex,
      translateY,
      // Depth and paint order follow compositing, not screen position: the top
      // Layer is nearest and paints last, and the paper is furthest and paints
      // first. Inverting this lets the opaque page cover every sheet above it.
      translateZ: (layerCount - displayIndex) * depthPerPlane,
      zIndex: layerCount + 1 - displayIndex,
    });

  const layers = Array.from({ length: layerCount }, (_unused, displayIndex) =>
    // Display runs top-first; storage runs bottom-to-top. Mirrored exactly once.
    plane(layerCount - 1 - displayIndex, displayIndex, displayIndex * gap),
  );

  return Object.freeze({
    planeWidth,
    planeHeight,
    perspective: tuning.perspective,
    tiltDegrees: tuning.tiltDegrees,
    gap,
    paperGap,
    depthPerPlane,
    stackHeight,
    scrolls: stackHeight > availableHeight + 0.5,
    paper: plane(-1, layerCount, (layerCount - 1) * gap + paperGap),
    layers: Object.freeze(layers),
  });
}

/** One interpolated moment of the separation, ready to be handed to CSS. */
export interface SpatialStackFrame {
  /** Normalized progress: 0 is the collapsed page, 1 is the arranged stack. */
  readonly progress: number;
  readonly tiltDegrees: number;
  readonly foreshortening: number;
  readonly backdropOpacity: number;
  /** True once every sheet has finished travelling. */
  readonly settled: boolean;
  /** The base sheet. Stationary by design: the Layers move, the page does not. */
  readonly paper: SpatialStackPlane;
  readonly layers: readonly SpatialStackPlane[];
}

const clamp01 = (value: number): number =>
  !Number.isFinite(value) ? 0 : value < 0 ? 0 : value > 1 ? 1 : value;

/** Decelerating arrival. Read backwards by a close, which is what makes it quicker. */
const easeOut = (value: number): number => 1 - (1 - value) ** 3;

/**
 * Interpolates the arranged stack back toward the page it came from.
 *
 * `progress` 1 returns the approved open geometry unchanged, so the settled
 * arrangement is decided in one place and the choreography only ever travels
 * toward it. `progress` 0 is the collapsed page: every sheet lying on the paper
 * at the paper's own depth, tilted just enough to read as the same object.
 *
 * The paper never moves. Sheets lift away from it, which is the whole claim the
 * view makes -- paper is the page's own base, and Layers are the transparent
 * artwork sitting on it.
 *
 * Pure, total and deterministic: no clock, no DOM, no state. The component owns
 * only the value of `progress`.
 */
export function computeSpatialLayerStackFrame(
  layout: SpatialStackLayout,
  progress: number,
): SpatialStackFrame {
  const motion = SPATIAL_STACK_MOTION;
  const settledProgress = clamp01(progress);

  // The page tips first and finishes early, so the sheets come apart into an
  // arrangement the eye has already been given the shape of.
  // Arrival is exact rather than interpolated-to-nearly: once the page has
  // finished tipping it holds the approved angle itself, not a value a rounding
  // error away from it.
  const tiltProgress = easeOut(clamp01(settledProgress / motion.tiltWindow));
  const tiltDegrees =
    tiltProgress >= 1
      ? layout.tiltDegrees
      : layout.tiltDegrees *
        (motion.collapsedTiltRatio + (1 - motion.collapsedTiltRatio) * tiltProgress);

  const layerCount = layout.layers.length;
  // The top sheet leads and has the furthest to travel, so the stack peels
  // rather than expanding as one block. A tall stack shares a fixed lead out
  // between more sheets instead of taking longer.
  const staggerPerPlane =
    layerCount > 1
      ? Math.min(
          motion.staggerMilliseconds / motion.openMilliseconds,
          motion.maximumStaggerSpan / (layerCount - 1),
        )
      : 0;

  const collapsedY = layout.paper.translateY;
  const collapsedZ = layout.paper.translateZ;
  const layers = layout.layers.map((plane) => {
    const start = motion.separationStart + plane.displayIndex * staggerPerPlane;
    const span = Math.max(1e-6, 1 - start);
    const local = easeOut(clamp01((settledProgress - start) / span));
    // A sheet that has arrived is exactly where the layout put it, so the
    // settled stack is the approved geometry rather than a copy of it.
    if (local >= 1) return plane;
    return Object.freeze({
      ...plane,
      translateY: collapsedY + (plane.translateY - collapsedY) * local,
      translateZ: collapsedZ + (plane.translateZ - collapsedZ) * local,
    });
  });

  return Object.freeze({
    progress: settledProgress,
    tiltDegrees,
    foreshortening: Math.cos((tiltDegrees * Math.PI) / 180),
    backdropOpacity: clamp01(settledProgress / motion.backdropWindow),
    settled: settledProgress >= 1,
    paper: layout.paper,
    layers: Object.freeze(layers),
  });
}

/**
 * Layer-to-layer navigation through an open stack.
 *
 * The stack is taller than the workspace by design -- sheets are sized for
 * their artwork, not shrunk until they all fit -- so the open view needs a way
 * to move through it. It navigates between sheets rather than scrolling to
 * arbitrary positions: one Layer is focused, and the arrangement is offset so
 * that Layer sits in a fixed place in the free workspace.
 */
export const SPATIAL_STACK_NAVIGATION = Object.freeze({
  /**
   * Where the focused sheet's *lower edge* sits, as a share of the free
   * workspace height.
   *
   * A shelf near the bottom, not a centre line. The sheet being inspected wants
   * its whole surface above the fold and the next sheet visible over it, so
   * what has to be pinned is the bottom edge -- pinning the centre leaves the
   * lower half of a deep, magnified sheet hanging off the bottom of the
   * workspace, and pinning it high wastes the room the next sheet needs.
   *
   * Measured against the sheet's *projected* edge, so this holds whatever the
   * page shape, the tilt, or the sheet's own depth in the stack.
   */
  focusBottomRatio: 0.9,
  /** Wheel distance that commits one Layer step. */
  wheelStepThreshold: 90,
  /**
   * Minimum time between two committed steps.
   *
   * A trackpad emits a stream of small deltas and a flick emits a few large
   * ones; without this, either can fly through the whole stack from one
   * gesture. Paired with the cap below, one gesture moves at most one Layer per
   * interval however the hardware reports it.
   */
  minimumStepIntervalMs: 140,
  /**
   * How far from the shelf a sheet stays a full participant, in gaps.
   *
   * A little over one, so the sheet directly above and the one directly below
   * the focused sheet are fully present even while the arrangement is moving
   * between them.
   */
  emphasisHoldGaps: 1.25,
  /** Where a sheet has left the composition entirely, in gaps from the shelf. */
  emphasisFadeGaps: 1.7,
  /**
   * Settle constant for the focus offset; the visible move is roughly 4x this.
   *
   * Raised with the separation. One step now carries a sheet more than twice as
   * far as it used to, and holding the old constant turned that into a throw
   * rather than a movement. Still short enough to feel direct, and retargeting
   * is unaffected -- a new target is simply a new destination from wherever the
   * value has reached.
   */
  settleTimeConstantMs: 70,
});

/**
 * Where a sheet's lower-right corner actually lands, relative to its centre.
 *
 * A plane is not where its box is. `rotateX` foreshortens it and `translateZ`
 * magnifies it, by different amounts for every sheet in the stack, and the
 * lower edge rotates toward the viewer so it is nearer -- and larger -- than
 * the rest of the sheet. One definition, used by the focus shelf to decide
 * where a sheet has to sit and by the component to hang its label.
 *
 * `tiltDegrees` is passed in rather than read off the layout because the stack
 * is still tipping while it opens, and a label has to track its sheet through
 * that rather than wait at the angle it is heading for.
 */
export function projectSheetCorner(
  layout: SpatialStackLayout,
  plane: SpatialStackPlane,
  tiltDegrees: number,
): { readonly x: number; readonly y: number } {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const halfHeight = layout.planeHeight / 2;
  const depth = plane.translateZ + halfHeight * Math.sin(tilt);
  const magnification = layout.perspective / Math.max(1, layout.perspective - depth);
  return {
    x: (layout.planeWidth / 2) * magnification,
    y: halfHeight * Math.cos(tilt) * magnification,
  };
}

export interface FocusedStackOffsetInput {
  readonly layout: SpatialStackLayout;
  /** Index into the layout's visual order. Paper is not addressable. */
  readonly focusedVisualIndex: number;
  /** Measured height of the free workspace the stack is presented in. */
  readonly viewportHeight: number;
  /** Overrides the shelf. Defaults to the measured focus shelf. */
  readonly focusBottomY?: number;
}

/**
 * How far the arrangement must be offset to bring one Layer onto the shelf.
 *
 * Positive moves the stack up, which is what brings a lower sheet into view.
 * Deliberately unclamped: the arrangement extends past the workspace in both
 * directions, which is what makes every Layer reachable at a useful size rather
 * than only the ones that happen to fit.
 *
 * The sheet is placed by its projected lower edge, so a sheet high in a deep
 * stack -- magnified by its own depth -- sits at the same shelf as a shallow
 * one instead of hanging off the bottom of the workspace.
 *
 * Pure and deterministic: no DOM, no scroll container, no state.
 */
export function computeFocusedStackOffset(input: FocusedStackOffsetInput): number {
  const { layout } = input;
  const count = layout.layers.length;
  if (count === 0) return 0;
  const requested = Number.isFinite(input.focusedVisualIndex)
    ? Math.round(input.focusedVisualIndex)
    : 0;
  const index = Math.min(Math.max(requested, 0), count - 1);
  const viewportHeight = Number.isFinite(input.viewportHeight)
    ? Math.max(0, input.viewportHeight)
    : 0;
  const shelf =
    input.focusBottomY !== undefined && Number.isFinite(input.focusBottomY)
      ? input.focusBottomY
      : viewportHeight * SPATIAL_STACK_NAVIGATION.focusBottomRatio;
  const plane = layout.layers[index]!;
  const projectedBottom =
    plane.translateY +
    layout.planeHeight / 2 +
    projectSheetCorner(layout, plane, layout.tiltDegrees).y;
  return projectedBottom - shelf;
}

/** One gesture's worth of accumulated wheel movement. */
export interface WheelNavigationState {
  readonly accumulated: number;
  readonly lastStepMs: number;
}

export const EMPTY_WHEEL_NAVIGATION: WheelNavigationState = Object.freeze({
  accumulated: 0,
  lastStepMs: Number.NEGATIVE_INFINITY,
});

export interface WheelNavigationResult {
  readonly state: WheelNavigationState;
  /**
   * Movement in visual order: -1 toward the top of the stack, +1 toward the
   * paper, 0 when the gesture has not yet earned a step.
   */
  readonly step: number;
}

/**
 * Turns a stream of wheel deltas into discrete Layer steps.
 *
 * Pure, so the feel can be reasoned about and tested without a window: state in,
 * state out. Reversing direction clears whatever was banked, so a change of mind
 * takes effect immediately rather than having to pay off the previous gesture.
 */
export function accumulateWheelNavigation(
  state: WheelNavigationState,
  deltaY: number,
  nowMs: number,
): WheelNavigationResult {
  const navigation = SPATIAL_STACK_NAVIGATION;
  if (!Number.isFinite(deltaY) || deltaY === 0) return { state, step: 0 };

  // A reversal is a new gesture, not a continuation of the old one.
  const reversed = Math.sign(deltaY) !== Math.sign(state.accumulated);
  const carried = reversed ? 0 : state.accumulated;
  // Capped, so a single large flick cannot bank several steps and then spend
  // them one interval after another.
  const accumulated = Math.max(
    -navigation.wheelStepThreshold,
    Math.min(navigation.wheelStepThreshold, carried + deltaY),
  );

  const ready = Math.abs(accumulated) >= navigation.wheelStepThreshold;
  const rested = nowMs - state.lastStepMs >= navigation.minimumStepIntervalMs;
  if (!ready || !rested) return { state: { ...state, accumulated }, step: 0 };

  return {
    state: { accumulated: 0, lastStepMs: nowMs },
    // Wheeling away from the viewer walks up the stack, which is a smaller
    // visual index: display order runs top-first.
    step: accumulated > 0 ? 1 : -1,
  };
}

/**
 * How strongly a sheet takes part in the settled composition.
 *
 * The stack is a view of three sheets: the one being worked on, the one above
 * it and the one below. Everything further away still exists, is still
 * navigable and is still in the accessibility tree -- it simply stops
 * competing for the eye, because a settled view of nine faint trapezoids is
 * the compressed overview this whole arrangement exists to replace.
 *
 * Measured from the live offset rather than from the index distance, so the
 * falloff is continuous: a sheet fades in as it approaches the shelf and out as
 * it leaves, in step with the navigation instead of switching at the moment the
 * active Layer changes.
 *
 * 1 is a full participant; 0 is out of the composition entirely.
 */
export function computeSheetEmphasis(
  layout: SpatialStackLayout,
  plane: SpatialStackPlane,
  offset: number,
  viewportHeight: number,
): number {
  const navigation = SPATIAL_STACK_NAVIGATION;
  if (layout.gap <= 0) return 1;
  const shelf =
    (Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0) *
    navigation.focusBottomRatio;
  const projectedBottom =
    plane.translateY +
    layout.planeHeight / 2 +
    projectSheetCorner(layout, plane, layout.tiltDegrees).y;
  const gapsAway = Math.abs(projectedBottom - (offset + shelf)) / layout.gap;
  if (!Number.isFinite(gapsAway)) return 0;
  const fade = navigation.emphasisFadeGaps - navigation.emphasisHoldGaps;
  if (fade <= 0) return gapsAway <= navigation.emphasisHoldGaps ? 1 : 0;
  return clamp01(1 - (gapsAway - navigation.emphasisHoldGaps) / fade);
}
