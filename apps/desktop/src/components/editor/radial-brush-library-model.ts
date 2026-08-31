import { BRUSH_LIBRARY_FIXTURES, type BrushFixture } from "./brush-library-fixtures";

/**
 * Pure polar geometry for the radial Brush Library.
 *
 * The construction borrows the geometric logic of a Copic-style colour wheel,
 * described in `docs/design/concepts-reference.md` §5 as a principle to adapt
 * rather than an artefact to copy:
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
  readonly fixture: BrushFixture;
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
  catalogue: readonly BrushFixture[] = BRUSH_LIBRARY_FIXTURES,
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
        const fixture = catalogue[catalogueIndex];
        if (fixture === undefined) break;
        const startAngleDegrees =
          arc.startDegrees + indexInArc * cellAngleDegrees + rotationOffsetDegrees;
        const endAngleDegrees = startAngleDegrees + cellAngleDegrees;
        const cell: RadialCell = Object.freeze({
          fixture,
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
