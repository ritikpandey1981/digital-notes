import { BRUSH_LIBRARY_CATALOGUE, type BrushLibraryEntry } from "./brush-library-catalogue";

/**
 * Pure polar geometry for the radial Brush Library.
 *
 * The construction borrows the geometric logic of a Copic-style colour wheel,
 * following the reference-adaptation policy in
 * `docs/design/folio-design-system.md` rather than copying an artefact:
 *
 *  - the selected drawing preset slot is the centre
 *  - concentric tracks radiate from it with no radial gap between them
 *  - every cell has the same radial thickness, whatever its track
 *  - every cell has the same *physical* tangential width, so each track derives
 *    its own angular span from its radius: inner tracks take a wider angle per
 *    cell, outer tracks a narrower one, and every cell reads as the same size
 *    of control
 *  - each track is an ALMOST complete ring: it places its configured number of
 *    full-size cells and then simply stops, leaving one moderate gap. Nothing
 *    is stretched or justified to close it
 *  - each ring's gap is positioned by naming where its centre should sit, and
 *    the three centres are deliberately far apart, so no shared wedge ever
 *    appears. The irregularity is designed and deterministic, never generated
 *    at runtime
 *
 * The catalogue fills the tracks sequentially. Family boundaries are ignored:
 * a track may begin in pencils and end in pens, which is the point — geometry
 * and taxonomy are separate.
 *
 * Angles are degrees in screen space: 0° points right, into the canvas, and
 * negative angles point upward. Nothing here reads the DOM or React state.
 */

export interface RadialLibraryConfiguration {
  /** Clear radius around the slot centre, before the first track begins. */
  readonly hubRadius: number;
  /** Radial height of every cell in every track. Constant by design. */
  readonly trackThickness: number;
  /**
   * Physical tangential width of every cell, measured along its mid-radius.
   * Each track converts this into its own angular span.
   */
  readonly targetCellWidth: number;
  /**
   * The gap each ring introduces itself, innermost first.
   *
   * A ring inherits every gap introduced inside it and adds its own, so the
   * empty space cuts outward as a radial channel rather than being paved over
   * by the next ring. The centres are deliberately spread so the channels stay
   * separate instead of merging into one wedge.
   */
  readonly directGaps: readonly AngularInterval[];
  /** Safety bound on ring creation; rings stop as soon as the catalogue does. */
  readonly maximumTracks: number;
}

/** A clockwise arc, normalised so `startDegrees` is in [0, 360). */
export interface AngularInterval {
  readonly startDegrees: number;
  readonly widthDegrees: number;
}

function interval(centerDegrees: number, widthDegrees: number): AngularInterval {
  return Object.freeze({
    startDegrees: normalizeDegrees(centerDegrees - widthDegrees / 2),
    widthDegrees,
  });
}

/**
 * Starting values for the first visual evaluation, not settled constants.
 * They live here so geometry can be tuned without touching the component.
 */
export const RADIAL_LIBRARY_CONFIGURATION: RadialLibraryConfiguration = Object.freeze({
  hubRadius: 90,
  trackThickness: 64,
  targetCellWidth: 72,
  // Three rings rather than five: fewer, taller, calmer. Each ring introduces
  // one gap at its own angle; the widths match the composition already
  // approved, now stated directly instead of falling out of a leftover.
  directGaps: Object.freeze([interval(210, 21.86), interval(55, 27.31), interval(305, 29.98)]),
  maximumTracks: 6,
});

export interface RadialCell {
  readonly brush: BrushLibraryEntry;
  /** Zero-based track, innermost first. */
  readonly trackIndex: number;
  /** Zero-based position within the track. */
  readonly indexInTrack: number;
  /** Zero-based position in the catalogue. */
  readonly catalogueIndex: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngleDegrees: number;
  readonly endAngleDegrees: number;
  /** Radius through the middle of the cell, where the specimen sits. */
  readonly midRadius: number;
  /** Angle through the middle of the cell. */
  readonly midAngleDegrees: number;
  /** Arc length along `midRadius`. Approximately `targetCellWidth` everywhere. */
  readonly arcLength: number;
  /** This track's derived angular span per cell. */
  readonly cellAngleDegrees: number;
}

export interface RadialTrack {
  readonly index: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly midRadius: number;
  /** Angular span of one cell in this track, derived from its radius. */
  readonly cellAngleDegrees: number;
  /** The gap this ring introduces, or null when it only inherits. */
  readonly directGap: AngularInterval | null;
  /** Gaps introduced by every ring inside this one. */
  readonly inheritedGaps: readonly AngularInterval[];
  /** Inherited plus direct, merged: no cell may touch any of these. */
  readonly blockedIntervals: readonly AngularInterval[];
  /** The arcs left over, where full-size cells may be packed. */
  readonly allowedArcs: readonly AngularInterval[];
  /** How many whole cells the allowed arcs can hold. */
  readonly capacity: number;
  readonly cells: readonly RadialCell[];
}

export interface RadialLibraryLayout {
  readonly centerX: number;
  readonly centerY: number;
  readonly configuration: RadialLibraryConfiguration;
  readonly tracks: readonly RadialTrack[];
  /** Every cell, catalogue order, flattened across tracks. */
  readonly cells: readonly RadialCell[];
  /** Outermost edge of the outermost track, for bounds reporting. */
  readonly outerRadius: number;
}

export interface RadialCenter {
  readonly x: number;
  readonly y: number;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wraps any angle into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Floating-point slack, so a cell that fits exactly is not rejected. */
const ANGLE_EPSILON = 1e-9;

/**
 * Pointer travel, in CSS px, before a press becomes a rotation drag.
 *
 * Matches the editor's existing convention (`LAYER_DRAG_THRESHOLD`, and the
 * selection controller's click threshold) so a steady hand never rotates the
 * wheel by accident.
 */
export const RADIAL_ROTATION_DRAG_THRESHOLD = 4;

/**
 * The angle from the axle to a point, in the same screen space the geometry
 * uses: 0 degrees points right and positive angles turn downward.
 */
export function pointerAngleDegrees(center: RadialCenter, x: number, y: number): number {
  return radiansToDegrees(Math.atan2(y - center.y, x - center.x));
}

/**
 * The shortest signed way round from one angle to another, in (-180, 180].
 *
 * This is what stops the wheel snapping through a whole turn when atan2 wraps
 * between +180 and -180: 179 degrees to -179 degrees is a 2 degree nudge
 * forward, not a 358 degree lurch backward.
 */
export function shortestAngularDelta(fromDegrees: number, toDegrees: number): number {
  return normalizeDegrees(toDegrees - fromDegrees + 180) - 180;
}

/**
 * Which way the wheel disappears: straight back through the dock.
 *
 * Parameterised rather than hard-coded so a future right-hand dock mirrors the
 * aperture by changing one value instead of rewriting the fade.
 */
export type DockSide = "left" | "right";

export function hiddenDirectionDegrees(dockSide: DockSide): number {
  // 0 degrees points right, into the canvas; 180 points back through a
  // left-hand dock.
  return dockSide === "left" ? 180 : 0;
}

export interface RadialApertureConfiguration {
  readonly dockSide: DockSide;
  /** Half-width of the fully hidden wedge, measured from the hidden direction. */
  readonly hiddenCoreDegrees: number;
  /** How far beyond the core opacity climbs back to full. */
  readonly transitionDegrees: number;
}

/** Starting aperture for visual evaluation, not a settled constant. */
export const RADIAL_APERTURE: RadialApertureConfiguration = Object.freeze({
  dockSide: "left",
  hiddenCoreDegrees: 15,
  transitionDegrees: 30,
});

/** Below this a cell is treated as absent: invisible, and not interactive. */
export const RADIAL_VISIBILITY_EPSILON = 0.02;

/**
 * Spatial visibility of one angle, from the dock-side aperture outward.
 *
 * Purely positional: nothing here knows about time, rotation history, or how
 * the library was opened. A cell's opacity is a function of where it currently
 * is, which is what makes the wheel read as passing under the dock rather than
 * animating.
 */
export function computeAngularVisibility(
  angleDegrees: number,
  aperture: RadialApertureConfiguration = RADIAL_APERTURE,
): number {
  const separation = Math.abs(
    shortestAngularDelta(hiddenDirectionDegrees(aperture.dockSide), angleDegrees),
  );
  if (!Number.isFinite(separation)) return 1;
  if (separation <= aperture.hiddenCoreDegrees) return 0;
  const edge = aperture.hiddenCoreDegrees + aperture.transitionDegrees;
  if (separation >= edge) return 1;
  const t = (separation - aperture.hiddenCoreDegrees) / aperture.transitionDegrees;
  // Smoothstep, so the band has no visible kink at either boundary.
  return t * t * (3 - 2 * t);
}

/**
 * Visibility of a whole cell, sampled across its arc.
 *
 * The centre alone is not enough: an inner-ring cell spans nearly 34 degrees,
 * more than the hidden core, so a centre-only rule would blink it out while a
 * third of it was still in clear view. Averaging the two edges with the centre
 * lets a wide cell fade in proportion to how much of it has actually entered
 * the aperture, and costs one extra evaluation per edge.
 */
export function computeCellVisibility(
  cell: Readonly<{ startAngleDegrees: number; endAngleDegrees: number }>,
  aperture: RadialApertureConfiguration = RADIAL_APERTURE,
): number {
  const samples = [
    cell.startAngleDegrees,
    (cell.startAngleDegrees + cell.endAngleDegrees) / 2,
    cell.endAngleDegrees,
  ];
  const total = samples.reduce((sum, angle) => sum + computeAngularVisibility(angle, aperture), 0);
  return total / samples.length;
}

/**
 * Tunable inertia for the wheel's coast after a genuine rotation drag.
 *
 * Grouped here rather than scattered through the pointer handlers so the feel
 * can be adjusted in one place, and so the physics stays testable without a
 * window. Every value is an explicit unit: this is the one place where the
 * radial model deals in time as well as angle.
 */
export interface RadialInertiaConfiguration {
  /** Below this a release is treated as a stop, not a fling. */
  readonly minimumReleaseVelocityDegreesPerSecond: number;
  /** Ceiling on release speed, so a flick cannot become a spin. */
  readonly maximumReleaseVelocityDegreesPerSecond: number;
  /** Exponential decay rate, per second. Larger settles sooner. */
  readonly frictionPerSecond: number;
  /** Coasting ends once speed falls below this. */
  readonly stopVelocityDegreesPerSecond: number;
  /** How much of the end of the gesture the release speed is measured over. */
  readonly sampleWindowMilliseconds: number;
}

export const RADIAL_INERTIA: RadialInertiaConfiguration = Object.freeze({
  // Measured in the real window: a deliberate drag that ends by stopping
  // settles under this, while an intentional flick clears it comfortably.
  minimumReleaseVelocityDegreesPerSecond: 18,
  // A quarter turn or so of coast at most. This is a selector, not a wheel of
  // fortune, and near-axle drags can otherwise report absurd angular speed.
  maximumReleaseVelocityDegreesPerSecond: 420,
  // Measured: at 5.5 a capped flick still ran 720ms, past the intended settle.
  // 6.5 brings every gesture from a slow scrub to a hard flick inside roughly
  // 130-610ms, and holds the longest coast to about 65 degrees.
  frictionPerSecond: 6.5,
  stopVelocityDegreesPerSecond: 8,
  sampleWindowMilliseconds: 80,
});

/** One timestamped point on the accumulated rotation, taken during a drag. */
export interface RotationSample {
  readonly timeMs: number;
  /**
   * Accumulated offset, already unwrapped through `shortestAngularDelta`.
   *
   * Unwrapped rather than raw, so measuring across the +/-180 seam reports the
   * small step the user actually made instead of a near-full turn backward.
   */
  readonly rotationDegrees: number;
}

/**
 * Drops samples the release speed should no longer be influenced by.
 *
 * The end of the gesture is what the user means: averaging a whole slow drag
 * that finished with a flick would throw most of the flick away.
 *
 * A gesture that has gone quiet has come to rest, whatever it was doing before.
 * Holding the wheel still and then letting go must stop it, so a buffer whose
 * newest sample has itself aged out reports nothing rather than reviving the
 * speed the hand had already given up.
 */
export function trimRotationSamples(
  samples: readonly RotationSample[],
  nowMs: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): readonly RotationSample[] {
  const newest = samples[samples.length - 1];
  if (newest === undefined) return [];
  if (nowMs - newest.timeMs > configuration.sampleWindowMilliseconds) return [];
  const oldest = nowMs - configuration.sampleWindowMilliseconds;
  const recent = samples.filter((sample) => sample.timeMs >= oldest);
  // One anchor from just outside the window, so a sparse but live drag can
  // still be measured instead of reading as a single point.
  if (recent.length >= 2) return recent;
  return samples.slice(-2);
}

/**
 * Signed angular speed at release, in degrees per second.
 *
 * Zero whenever there is nothing meaningful to measure — one sample, or two
 * that share a timestamp — so a degenerate event stream can never produce a
 * NaN or an infinite velocity that would be clamped into a real fling.
 */
export function releaseVelocityDegreesPerSecond(
  samples: readonly RotationSample[],
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): number {
  if (samples.length < 2) return 0;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const elapsedMs = last.timeMs - first.timeMs;
  if (!(elapsedMs > 0)) return 0;
  const velocity = ((last.rotationDegrees - first.rotationDegrees) / elapsedMs) * 1_000;
  if (!Number.isFinite(velocity)) return 0;
  return clampAngularVelocity(velocity, configuration);
}

/** Limits speed while keeping direction. */
export function clampAngularVelocity(
  velocityDegreesPerSecond: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): number {
  if (!Number.isFinite(velocityDegreesPerSecond)) return 0;
  const limit = configuration.maximumReleaseVelocityDegreesPerSecond;
  const magnitude = Math.min(Math.abs(velocityDegreesPerSecond), limit);
  return Math.sign(velocityDegreesPerSecond) * magnitude;
}

/** Whether a release was decisive enough to coast rather than stop dead. */
export function shouldStartInertia(
  velocityDegreesPerSecond: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): boolean {
  if (!Number.isFinite(velocityDegreesPerSecond)) return false;
  return Math.abs(velocityDegreesPerSecond) >= configuration.minimumReleaseVelocityDegreesPerSecond;
}

/**
 * Speed after coasting for one frame.
 *
 * Exponential in elapsed time rather than a per-frame multiplier, so the wheel
 * decelerates identically at 60Hz and 120Hz and a dropped frame costs no extra
 * momentum. Splitting a step in two is exactly equivalent to taking it whole.
 */
export function decayAngularVelocity(
  velocityDegreesPerSecond: number,
  frameMilliseconds: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): number {
  if (!Number.isFinite(velocityDegreesPerSecond) || !Number.isFinite(frameMilliseconds)) return 0;
  if (frameMilliseconds <= 0) return velocityDegreesPerSecond;
  return (
    velocityDegreesPerSecond *
    Math.exp((-configuration.frictionPerSecond * frameMilliseconds) / 1_000)
  );
}

/**
 * Degrees travelled during one coasting frame.
 *
 * The exact integral of the decaying speed over the frame, not `velocity * dt`.
 * A rectangular step overshoots on a long frame and would make the coast depend
 * on frame rate even though the decay does not.
 */
export function integrateAngularMotion(
  velocityDegreesPerSecond: number,
  frameMilliseconds: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): number {
  if (!Number.isFinite(velocityDegreesPerSecond) || !Number.isFinite(frameMilliseconds)) return 0;
  if (frameMilliseconds <= 0) return 0;
  const seconds = frameMilliseconds / 1_000;
  const friction = configuration.frictionPerSecond;
  if (friction <= 0) return velocityDegreesPerSecond * seconds;
  return (velocityDegreesPerSecond * (1 - Math.exp(-friction * seconds))) / friction;
}

/** Whether the coast has slowed enough to stop and release the frame loop. */
export function hasSettled(
  velocityDegreesPerSecond: number,
  configuration: RadialInertiaConfiguration = RADIAL_INERTIA,
): boolean {
  if (!Number.isFinite(velocityDegreesPerSecond)) return true;
  return Math.abs(velocityDegreesPerSecond) < configuration.stopVelocityDegreesPerSecond;
}

/**
 * Timing for the instrument unfolding from, and collapsing back into, its slot.
 *
 * Opening is deliberate; closing gets out of the artist's way. The stagger is
 * per ring rather than per cell: forty-five brushes dealt out one at a time
 * would read as a card trick, while four rings arriving a beat apart reads as
 * depth.
 */
export interface RadialOpenMotionConfiguration {
  readonly openMilliseconds: number;
  readonly closeMilliseconds: number;
  /**
   * Delay added per ring along the open timeline.
   *
   * The close inherits the same *fraction* of its own shorter timeline, which
   * works out at about 14ms per ring, so nothing needs to be configured twice.
   */
  readonly ringStaggerMilliseconds: number;
  /** Fraction of a ring's expansion by which its reveal opacity is complete. */
  readonly revealCompleteAt: number;
  /**
   * Ring-local progress by which the circumferential sweep has finished.
   *
   * Short of 1 on purpose: the ring should be legible as a whole ring while it
   * makes its last, smallest movement into place, rather than still missing
   * cells at the final frame.
   */
  readonly angularCompleteAt: number;
}

export const RADIAL_OPEN_MOTION: RadialOpenMotionConfiguration = Object.freeze({
  openMilliseconds: 320,
  closeMilliseconds: 210,
  ringStaggerMilliseconds: 26,
  // Opacity finishes before the radius does, so what the eye reads is the
  // structure being built outward rather than a panel fading up. Set from the
  // real window: the glyphs are a fixed size while the radii are not, so a
  // ring near the hub crowds its own icons. Holding the ramp until 70% keeps
  // those crowded frames faint, and still leaves the last third of the travel
  // at full strength where the structure is what carries the motion.
  revealCompleteAt: 0.7,
  angularCompleteAt: 0.8,
});

/**
 * This instrument's own presentation curve.
 *
 * Deliberately *not* `PROFESSIONAL_EASE`, and deliberately not a change to it:
 * the shared token stays exactly as every other Folio surface uses it. Folio's
 * curve puts 40% of the travel into the first 10% of the time and is settled
 * to within 5% by 47% of the duration, which is right for a small panel
 * arriving but hides the middle of a four-ring unfolding — the very part this
 * choreography exists to show. This one reaches the same 95% at 58% of the
 * duration instead, keeping an immediate response while leaving a readable
 * middle, and still settling calmly with no overshoot.
 *
 * There is deliberately no second curve for closing. The collapse is this same
 * choreography traversed backwards, and an ease-out played in reverse *is* an
 * ease-in: the instrument leaves its final position gently and accelerates into
 * the slot, which is both the sharper closing character the design calls for
 * and the correct physical reading for something falling back into its socket.
 *
 * Sharing one curve is what makes a reversal continuous. Two curves disagree
 * about how much of the travel a given progress represents, so interrupting an
 * opening would snap the rings to a different size on the first closing frame.
 */
export const RADIAL_OPEN_EASE: readonly [number, number, number, number] = Object.freeze([
  0.2, 0.75, 0.3, 1,
]);

/** Holds a progress value inside [0, 1], treating a broken input as 0. */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress;
}

/**
 * Evaluates a CSS-style cubic Bezier easing at `progress`.
 *
 * The curve is defined by its two control points with the endpoints pinned at
 * (0,0) and (1,1), so this is the same curve a `cubic-bezier()` declaration
 * would produce — the animation is driven per frame in script rather than by
 * CSS, and reusing the declared curve keeps the two identical.
 */
export function easeWithBezier(
  progress: number,
  curve: readonly [number, number, number, number],
): number {
  const clamped = clampProgress(progress);
  if (clamped === 0 || clamped === 1) return clamped;
  const [x1, y1, x2, y2] = curve;
  // Solve x(t) = progress for t, then read y(t). Newton converges in a few
  // steps for these curves; bisection is the guard for a flat gradient.
  let t = clamped;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const x = bezierAxis(t, x1, x2) - clamped;
    if (Math.abs(x) < 1e-6) return bezierAxis(t, y1, y2);
    const gradient = bezierAxisGradient(t, x1, x2);
    if (Math.abs(gradient) < 1e-6) break;
    t -= x / gradient;
  }
  let low = 0;
  let high = 1;
  t = clamped;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const x = bezierAxis(t, x1, x2);
    if (Math.abs(x - clamped) < 1e-6) break;
    if (x < clamped) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezierAxis(t, y1, y2);
}

function bezierAxis(t: number, a1: number, a2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * a1 + 3 * inverse * t * t * a2 + t * t * t;
}

function bezierAxisGradient(t: number, a1: number, a2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * a1 + 6 * inverse * t * (a2 - a1) + 3 * t * t * (1 - a2);
}

export function easeOpenProgress(progress: number): number {
  return easeWithBezier(progress, RADIAL_OPEN_EASE);
}

/** Which way the presentation is currently running. */
export type RadialPresentationPhase = "closed" | "opening" | "open" | "closing";

/**
 * How far along its own share of the timeline one ring is, before easing.
 *
 * The stagger is a fraction of the whole unfolding rather than a fixed number
 * of milliseconds, so the same choreography plays over either duration: 22ms
 * per ring while opening becomes about 14ms per ring over the shorter close.
 *
 * Ring 0 leads, so opening propagates outward. Running the same timeline
 * backwards makes the outermost ring the first to start retracting and the
 * innermost the last to vanish, which is the reversed depth a collapse wants —
 * no second, oppositely-staggered timeline is needed to produce it.
 */
export function ringLocalProgress(
  globalProgress: number,
  ringIndex: number,
  ringCount: number,
  timing: RadialOpenMotionConfiguration = RADIAL_OPEN_MOTION,
): number {
  const staggerFraction =
    timing.openMilliseconds > 0 ? timing.ringStaggerMilliseconds / timing.openMilliseconds : 0;
  const start = ringIndex * staggerFraction;
  // Whatever is left of the timeline once the outermost ring has waited its
  // turn, so that ring still lands exactly on the end.
  const span = 1 - Math.max(0, ringCount - 1) * staggerFraction;
  if (!(span > 0)) return clampProgress(globalProgress);
  return clampProgress((clampProgress(globalProgress) - start) / span);
}

/**
 * The eased expansion of one ring at one point in the unfolding.
 *
 * Purely a function of progress: opening and closing traverse this same shape
 * in opposite directions, which is what makes interrupting either one
 * continuous. Nothing here knows which way the presentation is currently going.
 */
export function ringExpansion(
  globalProgress: number,
  ringIndex: number,
  ringCount: number,
  timing: RadialOpenMotionConfiguration = RADIAL_OPEN_MOTION,
): number {
  return ringRadialExpansion(ringLocalProgress(globalProgress, ringIndex, ringCount, timing));
}

/** How far out a ring has grown, from its own local progress. */
export function ringRadialExpansion(localProgress: number): number {
  return easeOpenProgress(localProgress);
}

/**
 * Which way the reveal front travels, and where it starts.
 *
 * The origin is the dock-side hidden direction, so cells are uncovered from
 * behind the Tool Dock and swept out into the canvas: the toolbar reads as the
 * place the instrument is kept rather than as an edge the wheel happens to be
 * clipped by. It is the same bearing the spatial fade hides through, which is
 * why the two read as one idea — a cell is uncovered exactly where it would
 * otherwise be hidden.
 *
 * One direction for every ring. Alternating them would look decorative and
 * mechanical rather than like a single object being wound out.
 */
export type RadialSweepDirection = "clockwise" | "counter-clockwise";

export interface RadialSweepConfiguration {
  readonly direction: RadialSweepDirection;
  /**
   * Angular width of the soft edge at the front, in degrees.
   *
   * Wide enough that a cell fades in rather than popping — about one inner-ring
   * cell, or two outer-ring cells — and narrow enough that the front still
   * reads as a travelling edge rather than a general brightening.
   */
  readonly featherDegrees: number;
}

export const RADIAL_SWEEP: RadialSweepConfiguration = Object.freeze({
  // Screen space here has 0 to the right and angles increasing downward, so
  // increasing bearings run clockwise on screen. Starting at the left-hand dock
  // and increasing takes the front up over the top of the axle and down the
  // canvas-facing side, which is the direction that reads as the instrument
  // being drawn out of the toolbar rather than swung in front of it.
  direction: "clockwise",
  featherDegrees: 28,
});

/**
 * Where the reveal front has reached, in degrees travelled from the origin.
 *
 * Linear in the ring's own progress, unlike the radius. The two are doing
 * different jobs: the radius is a body settling into place and wants an
 * ease-out, while the front is a construction edge and reads best at a steady
 * angular speed. Easing it too would make the sweep lurch and then crawl,
 * which is exactly the "settles too early" problem this revision exists to fix.
 *
 * It travels a whole turn plus one feather, so the last cell reached is fully
 * uncovered rather than left mid-fade.
 */
export function ringAngularRevealProgress(
  localProgress: number,
  timing: RadialOpenMotionConfiguration = RADIAL_OPEN_MOTION,
): number {
  if (timing.angularCompleteAt <= 0) return 1;
  return clampProgress(clampProgress(localProgress) / timing.angularCompleteAt);
}

export function revealFrontDegrees(
  angularProgress: number,
  sweep: RadialSweepConfiguration = RADIAL_SWEEP,
): number {
  return clampProgress(angularProgress) * (360 + sweep.featherDegrees);
}

/**
 * How far one cell has been uncovered by the passing front, in [0, 1].
 *
 * Measured against the cell's *current on-screen* bearing, so a wheel that was
 * left rotated still reels back into the dock rather than into wherever the
 * catalogue happens to have been turned to. Gaps need no handling at all: a gap
 * holds no cell, so there is nothing there for the front to uncover, and the
 * channel stays empty at every frame by construction.
 */
export function cellCircumferentialReveal(
  cellMidAngleDegrees: number,
  angularProgress: number,
  originDegrees: number = hiddenDirectionDegrees(RADIAL_APERTURE.dockSide),
  sweep: RadialSweepConfiguration = RADIAL_SWEEP,
): number {
  if (!Number.isFinite(cellMidAngleDegrees)) return 0;
  const front = revealFrontDegrees(angularProgress, sweep);
  // Distance from the origin measured the way the front travels, so both sweep
  // directions use one comparison.
  const travelled =
    sweep.direction === "clockwise"
      ? normalizeDegrees(cellMidAngleDegrees - originDegrees)
      : normalizeDegrees(originDegrees - cellMidAngleDegrees);
  if (sweep.featherDegrees <= 0) return front >= travelled ? 1 : 0;
  const uncovered = (front - travelled) / sweep.featherDegrees;
  if (uncovered <= 0) return 0;
  if (uncovered >= 1) return 1;
  // Smoothstep, so the leading edge has no visible seam either side.
  return uncovered * uncovered * (3 - 2 * uncovered);
}

/**
 * The three independent presentation factors, multiplied.
 *
 * Kept as one named step rather than an expression buried in the view, and
 * kept as three separate inputs rather than one blended number: where a cell
 * is relative to the dock, how established its ring is, and how far the sweep
 * has uncovered it are different ideas that happen to compose.
 */
export function combineRevealFactors(
  spatialVisibility: number,
  ringEstablishment: number,
  circumferential: number,
): number {
  const product = spatialVisibility * ringEstablishment * circumferential;
  if (!Number.isFinite(product)) return 0;
  if (product <= 0) return 0;
  return product >= 1 ? 1 : product;
}

/**
 * Opacity supporting one ring's arrival.
 *
 * Deliberately secondary: it completes early so the motion the eye follows is
 * the radius growing outward, not a fade. Multiplied with the dock-side spatial
 * visibility rather than replacing it.
 */
export function ringRevealOpacity(
  expansion: number,
  timing: RadialOpenMotionConfiguration = RADIAL_OPEN_MOTION,
): number {
  const clamped = clampProgress(expansion);
  if (clamped >= timing.revealCompleteAt) return 1;
  if (timing.revealCompleteAt <= 0) return 1;
  return clamped / timing.revealCompleteAt;
}

/**
 * The same cell, with its radii interpolated between the hub and their final
 * values.
 *
 * Only the radii move. Every angle a cell owns is already final at the first
 * frame, which is what keeps the catalogue order fixed, stops the wheel
 * appearing to spin as it opens, and leaves the propagated gap channels exactly
 * where the frozen geometry put them at every intermediate frame.
 *
 * Presentation-time only: the approved static model is never mutated, and at
 * full expansion the original cell is returned untouched rather than rebuilt,
 * so the final geometry is exactly the frozen geometry.
 */
export function expandCell(
  cell: RadialCell,
  expansion: number,
  hubRadius: number = RADIAL_LIBRARY_CONFIGURATION.hubRadius,
): RadialCell {
  const clamped = clampProgress(expansion);
  if (clamped >= 1) return cell;
  const innerRadius = hubRadius + (cell.innerRadius - hubRadius) * clamped;
  const outerRadius = hubRadius + (cell.outerRadius - hubRadius) * clamped;
  return Object.freeze({
    ...cell,
    innerRadius,
    outerRadius,
    midRadius: (innerRadius + outerRadius) / 2,
  });
}

function rotateInterval(source: AngularInterval, offsetDegrees: number): AngularInterval {
  return Object.freeze({
    startDegrees: normalizeDegrees(source.startDegrees + offsetDegrees),
    widthDegrees: source.widthDegrees,
  });
}

/**
 * Merges blocked arcs, joining any that touch or overlap.
 *
 * Two configured gaps that happened to meet would otherwise leave a zero-width
 * sliver of "allowed" arc between them, which no cell could ever occupy.
 */
export function mergeIntervals(source: readonly AngularInterval[]): readonly AngularInterval[] {
  if (source.length === 0) return Object.freeze([]);
  const sorted = [...source].sort((first, second) => first.startDegrees - second.startDegrees);
  const merged: { startDegrees: number; widthDegrees: number }[] = [];
  for (const candidate of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      candidate.startDegrees <= previous.startDegrees + previous.widthDegrees + ANGLE_EPSILON
    ) {
      const end = Math.max(
        previous.startDegrees + previous.widthDegrees,
        candidate.startDegrees + candidate.widthDegrees,
      );
      previous.widthDegrees = end - previous.startDegrees;
      continue;
    }
    merged.push({ startDegrees: candidate.startDegrees, widthDegrees: candidate.widthDegrees });
  }
  return Object.freeze(merged.map((entry) => Object.freeze({ ...entry })));
}

/** The arcs left open by a merged set of blocked arcs, in clockwise order. */
export function complementIntervals(
  blocked: readonly AngularInterval[],
): readonly AngularInterval[] {
  if (blocked.length === 0) {
    return Object.freeze([Object.freeze({ startDegrees: 0, widthDegrees: 360 })]);
  }
  const allowed: AngularInterval[] = [];
  for (const [index, gap] of blocked.entries()) {
    const from = gap.startDegrees + gap.widthDegrees;
    const next = blocked[(index + 1) % blocked.length]!;
    const to = index + 1 < blocked.length ? next.startDegrees : next.startDegrees + 360;
    const width = to - from;
    if (width > ANGLE_EPSILON) {
      allowed.push(Object.freeze({ startDegrees: normalizeDegrees(from), widthDegrees: width }));
    }
  }
  return Object.freeze(allowed);
}

/** A point on the circle of radius `radius` about `center`, at `degrees`. */
export function polarPoint(
  center: RadialCenter,
  radius: number,
  degrees: number,
): Readonly<{ x: number; y: number }> {
  const radians = degreesToRadians(degrees);
  return Object.freeze({
    x: center.x + radius * Math.cos(radians),
    y: center.y + radius * Math.sin(radians),
  });
}

/**
 * Builds the whole layout about one centre.
 *
 * The centre is supplied by the caller, which measures the selected slot: this
 * function never assumes where the dock is, so each of the five slots produces
 * a different origin.
 */
export function buildRadialLibraryLayout(
  center: RadialCenter,
  configuration: RadialLibraryConfiguration = RADIAL_LIBRARY_CONFIGURATION,
  catalogue: readonly BrushLibraryEntry[] = BRUSH_LIBRARY_CATALOGUE,
  /**
   * Reserved for the future rotation pass. Applied uniformly to every cell in
   * every track, so the whole library turns as one rigid instrument. Nothing in
   * the UI writes this yet.
   */
  rotationOffsetDegrees = 0,
): RadialLibraryLayout {
  const tracks: RadialTrack[] = [];
  const cells: RadialCell[] = [];
  let catalogueIndex = 0;
  // Gaps accumulate outward: ring N is blocked by everything rings 1..N-1
  // introduced, plus whatever it introduces itself.
  let inheritedGaps: AngularInterval[] = [];

  for (let trackIndex = 0; trackIndex < configuration.maximumTracks; trackIndex += 1) {
    // A ring only exists if there is still catalogue left to put in it.
    if (catalogueIndex >= catalogue.length) break;
    const innerRadius = configuration.hubRadius + trackIndex * configuration.trackThickness;
    const outerRadius = innerRadius + configuration.trackThickness;
    const midRadius = (innerRadius + outerRadius) / 2;
    // The heart of the construction: one physical cell width, converted into
    // this track's own angular span. arcLength = radius x angle, so holding the
    // arc length fixed makes the angle shrink as the radius grows.
    const cellAngleDegrees = radiansToDegrees(configuration.targetCellWidth / midRadius);
    const directGap = configuration.directGaps[trackIndex] ?? null;
    const ownInherited = Object.freeze([...inheritedGaps]);
    const blockedIntervals = mergeIntervals(
      directGap === null ? inheritedGaps : [...inheritedGaps, directGap],
    );
    const allowedArcs = complementIntervals(blockedIntervals);
    const trackCells: RadialCell[] = [];
    let capacity = 0;

    for (const arc of allowedArcs) {
      // Whole cells only. A cell that would not fit inside this arc is not
      // shrunk, stretched, or allowed to bridge the gap: it simply waits for
      // the next arc, or the next ring.
      const fits = Math.floor(arc.widthDegrees / cellAngleDegrees + ANGLE_EPSILON);
      capacity += fits;
      for (let indexInArc = 0; indexInArc < fits; indexInArc += 1) {
        const brush = catalogue[catalogueIndex];
        if (brush === undefined) break;
        const startAngleDegrees =
          arc.startDegrees + indexInArc * cellAngleDegrees + rotationOffsetDegrees;
        const endAngleDegrees = startAngleDegrees + cellAngleDegrees;
        const cell: RadialCell = Object.freeze({
          brush,
          trackIndex,
          indexInTrack: trackCells.length,
          catalogueIndex,
          innerRadius,
          outerRadius,
          startAngleDegrees,
          endAngleDegrees,
          midRadius,
          midAngleDegrees: (startAngleDegrees + endAngleDegrees) / 2,
          arcLength: midRadius * degreesToRadians(cellAngleDegrees),
          cellAngleDegrees,
        });
        trackCells.push(cell);
        cells.push(cell);
        catalogueIndex += 1;
      }
    }

    tracks.push(
      Object.freeze({
        index: trackIndex,
        innerRadius,
        outerRadius,
        midRadius,
        cellAngleDegrees,
        directGap: directGap === null ? null : rotateInterval(directGap, rotationOffsetDegrees),
        inheritedGaps: Object.freeze(
          ownInherited.map((gap) => rotateInterval(gap, rotationOffsetDegrees)),
        ),
        blockedIntervals: Object.freeze(
          blockedIntervals.map((gap) => rotateInterval(gap, rotationOffsetDegrees)),
        ),
        allowedArcs: Object.freeze(
          allowedArcs.map((arc) => rotateInterval(arc, rotationOffsetDegrees)),
        ),
        capacity,
        cells: Object.freeze(trackCells),
      }),
    );

    if (directGap !== null) inheritedGaps = [...inheritedGaps, directGap];
  }

  const outermost = tracks[tracks.length - 1];
  return Object.freeze({
    centerX: center.x,
    centerY: center.y,
    configuration,
    tracks: Object.freeze(tracks),
    cells: Object.freeze(cells),
    outerRadius: outermost?.outerRadius ?? configuration.hubRadius,
  });
}

/**
 * An annular sector: inner arc, radial edge, outer arc back, radial edge home.
 *
 * A real curved rectangle, not a rotated box — the two long edges are genuine
 * circular arcs, which is what makes the stack read as a wheel.
 */
export function annularSectorPath(center: RadialCenter, cell: RadialCell): string {
  const sweep = cell.endAngleDegrees - cell.startAngleDegrees;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const innerStart = polarPoint(center, cell.innerRadius, cell.startAngleDegrees);
  const innerEnd = polarPoint(center, cell.innerRadius, cell.endAngleDegrees);
  const outerEnd = polarPoint(center, cell.outerRadius, cell.endAngleDegrees);
  const outerStart = polarPoint(center, cell.outerRadius, cell.startAngleDegrees);
  return [
    `M ${round(innerStart.x)} ${round(innerStart.y)}`,
    `A ${round(cell.innerRadius)} ${round(cell.innerRadius)} 0 ${largeArc} 1 ${round(innerEnd.x)} ${round(innerEnd.y)}`,
    `L ${round(outerEnd.x)} ${round(outerEnd.y)}`,
    `A ${round(cell.outerRadius)} ${round(cell.outerRadius)} 0 ${largeArc} 0 ${round(outerStart.x)} ${round(outerStart.y)}`,
    "Z",
  ].join(" ");
}

/**
 * A complete 360-degree annulus used only for radial pointer ownership.
 *
 * Two half-circle arcs avoid the SVG full-circle special case. The inner loop
 * runs in the opposite direction and the caller uses the even-odd fill rule,
 * leaving the hub genuinely empty while making every visual gap in one ring a
 * continuous physical interaction surface.
 */
export function completeAnnulusPath(
  center: RadialCenter,
  innerRadius: number,
  outerRadius: number,
): string {
  const outerRight = round(center.x + outerRadius);
  const outerLeft = round(center.x - outerRadius);
  const innerRight = round(center.x + innerRadius);
  const innerLeft = round(center.x - innerRadius);
  const centerY = round(center.y);
  return [
    `M ${outerRight} ${centerY}`,
    `A ${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerLeft} ${centerY}`,
    `A ${round(outerRadius)} ${round(outerRadius)} 0 1 1 ${outerRight} ${centerY}`,
    "Z",
    `M ${innerRight} ${centerY}`,
    `A ${round(innerRadius)} ${round(innerRadius)} 0 1 0 ${innerLeft} ${centerY}`,
    `A ${round(innerRadius)} ${round(innerRadius)} 0 1 0 ${innerRight} ${centerY}`,
    "Z",
  ].join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
