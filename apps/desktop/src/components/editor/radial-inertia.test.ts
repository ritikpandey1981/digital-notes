import { describe, expect, it } from "vitest";
import { BRUSH_LIBRARY_CATALOGUE } from "./brush-library-catalogue";
import {
  RADIAL_APERTURE,
  RADIAL_INERTIA,
  RADIAL_LIBRARY_CONFIGURATION,
  RADIAL_ROTATION_DRAG_THRESHOLD,
  buildRadialLibraryLayout,
  hiddenDirectionDegrees,
  clampAngularVelocity,
  computeCellVisibility,
  decayAngularVelocity,
  hasSettled,
  integrateAngularMotion,
  releaseVelocityDegreesPerSecond,
  shortestAngularDelta,
  shouldStartInertia,
  trimRotationSamples,
  type RadialCenter,
  type RotationSample,
} from "./radial-brush-library-model";

const CENTER: RadialCenter = Object.freeze({ x: 200, y: 300 });

/**
 * Rebuilds the sample buffer the component keeps during a drag.
 *
 * Angles are raw pointer bearings; the deltas are unwrapped exactly as the move
 * handler unwraps them, so a gesture crossing the seam is modelled honestly
 * rather than being handed an already-correct answer.
 */
function samplesFromBearings(
  bearings: readonly (readonly [timeMs: number, angleDegrees: number])[],
): RotationSample[] {
  let travelled = 0;
  const samples: RotationSample[] = [];
  for (const [index, [timeMs, angle]] of bearings.entries()) {
    if (index > 0) {
      travelled += shortestAngularDelta(bearings[index - 1]![1], angle);
    }
    samples.push({ timeMs, rotationDegrees: travelled });
  }
  return samples;
}

/** Coasts to a stop, reporting how far and how long it ran. */
function coast(
  initialVelocity: number,
  frameMs = 16.667,
): { degrees: number; milliseconds: number; frames: number } {
  let velocity = initialVelocity;
  let degrees = 0;
  let milliseconds = 0;
  let frames = 0;
  while (!hasSettled(velocity) && frames < 10_000) {
    degrees += integrateAngularMotion(velocity, frameMs);
    velocity = decayAngularVelocity(velocity, frameMs);
    milliseconds += frameMs;
    frames += 1;
  }
  return { degrees, milliseconds, frames };
}

describe("release velocity", () => {
  it("reports nothing for a gesture that never moved", () => {
    expect(releaseVelocityDegreesPerSecond([])).toBe(0);
    expect(releaseVelocityDegreesPerSecond([{ timeMs: 10, rotationDegrees: 4 }])).toBe(0);
  });

  it("reports nothing when two samples share a timestamp", () => {
    const velocity = releaseVelocityDegreesPerSecond([
      { timeMs: 10, rotationDegrees: 0 },
      { timeMs: 10, rotationDegrees: 30 },
    ]);
    expect(velocity).toBe(0);
    expect(Number.isFinite(velocity)).toBe(true);
  });

  it("measures degrees per second from the accumulated rotation", () => {
    // 60 degrees over 200ms is 300 degrees/second.
    expect(
      releaseVelocityDegreesPerSecond([
        { timeMs: 0, rotationDegrees: 0 },
        { timeMs: 200, rotationDegrees: 60 },
      ]),
    ).toBeCloseTo(300, 9);
  });

  it("keeps the sign of a clockwise release", () => {
    const velocity = releaseVelocityDegreesPerSecond(
      samplesFromBearings([
        [0, 10],
        [50, 20],
        [100, 30],
      ]),
    );
    expect(velocity).toBeGreaterThan(0);
    expect(velocity).toBeCloseTo(200, 6);
  });

  it("keeps the sign of a counter-clockwise release", () => {
    const velocity = releaseVelocityDegreesPerSecond(
      samplesFromBearings([
        [0, 30],
        [50, 20],
        [100, 10],
      ]),
    );
    expect(velocity).toBeLessThan(0);
    expect(velocity).toBeCloseTo(-200, 6);
  });

  it("reads a small forward step across the +179 -> -179 seam", () => {
    // Raw subtraction would call this -358 degrees in 100ms: a full-turn
    // backward fling from a two degree nudge forward.
    const velocity = releaseVelocityDegreesPerSecond(
      samplesFromBearings([
        [0, 179],
        [100, -179],
      ]),
    );
    expect(velocity).toBeCloseTo(20, 6);
  });

  it("reads a small backward step across the -179 -> +179 seam", () => {
    const velocity = releaseVelocityDegreesPerSecond(
      samplesFromBearings([
        [0, -179],
        [100, 179],
      ]),
    );
    expect(velocity).toBeCloseTo(-20, 6);
  });

  it("stays correct for a fast sweep that crosses the seam mid-gesture", () => {
    const velocity = releaseVelocityDegreesPerSecond(
      samplesFromBearings([
        [0, 160],
        [40, 175],
        [80, -170],
        [120, -155],
      ]),
    );
    // 45 degrees over 120ms, uninterrupted by the wrap.
    expect(velocity).toBeCloseTo(375, 6);
  });

  it("clamps an extreme release rather than letting it spin", () => {
    const velocity = releaseVelocityDegreesPerSecond([
      { timeMs: 0, rotationDegrees: 0 },
      { timeMs: 8, rotationDegrees: 140 },
    ]);
    expect(velocity).toBe(RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond);
  });
});

describe("sample window", () => {
  it("weights the end of the gesture, not the whole of it", () => {
    // A long slow drag that finishes with a flick must release at flick speed.
    const samples: RotationSample[] = [
      { timeMs: 0, rotationDegrees: 0 },
      { timeMs: 400, rotationDegrees: 8 },
      { timeMs: 460, rotationDegrees: 12 },
      { timeMs: 500, rotationDegrees: 40 },
    ];
    const windowed = releaseVelocityDegreesPerSecond(trimRotationSamples(samples, 500));
    const wholeGesture = releaseVelocityDegreesPerSecond(samples);
    expect(wholeGesture).toBeCloseTo(80, 6);
    expect(windowed).toBeGreaterThan(wholeGesture * 3);
  });

  it("keeps only the configured window", () => {
    const samples: RotationSample[] = [
      { timeMs: 0, rotationDegrees: 0 },
      { timeMs: 300, rotationDegrees: 10 },
      { timeMs: 950, rotationDegrees: 20 },
      { timeMs: 1_000, rotationDegrees: 30 },
    ];
    expect(RADIAL_INERTIA.sampleWindowMilliseconds).toBe(80);
    expect(trimRotationSamples(samples, 1_000)).toHaveLength(2);
  });

  it("stops a wheel that was held still before release", () => {
    const samples: RotationSample[] = [
      { timeMs: 0, rotationDegrees: 0 },
      { timeMs: 100, rotationDegrees: 25 },
    ];
    // Moved quickly, then held for half a second and let go. The hand had
    // already stopped the wheel; releasing must not revive the old speed.
    const trimmed = trimRotationSamples(samples, 600);
    expect(trimmed).toHaveLength(0);
    expect(releaseVelocityDegreesPerSecond(trimmed)).toBe(0);
    expect(shouldStartInertia(releaseVelocityDegreesPerSecond(trimmed))).toBe(false);
  });

  it("still measures a live but sparsely sampled drag", () => {
    const samples: RotationSample[] = [
      { timeMs: 0, rotationDegrees: 0 },
      { timeMs: 100, rotationDegrees: 25 },
    ];
    // The last move is recent, so the anchor just outside the window is kept
    // rather than leaving a single unmeasurable point.
    const trimmed = trimRotationSamples(samples, 120);
    expect(trimmed).toHaveLength(2);
    expect(releaseVelocityDegreesPerSecond(trimmed)).toBeCloseTo(250, 6);
  });
});

describe("starting inertia", () => {
  it("does not start for a still release", () => {
    expect(shouldStartInertia(0)).toBe(false);
  });

  it("does not start for a slow, deliberate release", () => {
    expect(shouldStartInertia(5)).toBe(false);
    expect(shouldStartInertia(-12)).toBe(false);
    expect(shouldStartInertia(RADIAL_INERTIA.minimumReleaseVelocityDegreesPerSecond - 0.1)).toBe(
      false,
    );
  });

  it("starts for a meaningful flick in either direction", () => {
    expect(shouldStartInertia(RADIAL_INERTIA.minimumReleaseVelocityDegreesPerSecond)).toBe(true);
    expect(shouldStartInertia(200)).toBe(true);
    expect(shouldStartInertia(-200)).toBe(true);
  });

  it("never starts on a degenerate measurement", () => {
    expect(shouldStartInertia(Number.NaN)).toBe(false);
    expect(shouldStartInertia(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("treats a sub-threshold press as a click with no fling", () => {
    // The component only begins sampling once the gesture passes the drag
    // threshold, so a click has no samples at all and releases at zero.
    expect(RADIAL_ROTATION_DRAG_THRESHOLD).toBe(4);
    expect(shouldStartInertia(releaseVelocityDegreesPerSecond([]))).toBe(false);
  });
});

describe("clamping", () => {
  it("limits speed while keeping direction", () => {
    const limit = RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond;
    expect(clampAngularVelocity(5_000)).toBe(limit);
    expect(clampAngularVelocity(-5_000)).toBe(-limit);
  });

  it("leaves an ordinary release untouched", () => {
    expect(clampAngularVelocity(180)).toBe(180);
    expect(clampAngularVelocity(-180)).toBe(-180);
  });

  it("collapses a degenerate velocity to a stop", () => {
    expect(clampAngularVelocity(Number.NaN)).toBe(0);
    expect(clampAngularVelocity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("deceleration", () => {
  it("reduces speed monotonically", () => {
    let velocity = 300;
    for (let frame = 0; frame < 40; frame += 1) {
      const next = decayAngularVelocity(velocity, 16.667);
      expect(Math.abs(next)).toBeLessThan(Math.abs(velocity));
      velocity = next;
    }
  });

  it("preserves direction all the way down", () => {
    let forward = 250;
    let backward = -250;
    for (let frame = 0; frame < 40; frame += 1) {
      forward = decayAngularVelocity(forward, 16.667);
      backward = decayAngularVelocity(backward, 16.667);
      expect(forward).toBeGreaterThan(0);
      expect(backward).toBeLessThan(0);
    }
  });

  it("decays by elapsed time, not by frame count", () => {
    // The whole point of exponential decay in seconds: 120Hz must not brake
    // twice as hard as 60Hz.
    const sixtyHz = coast(300, 1_000 / 60);
    const oneTwentyHz = coast(300, 1_000 / 120);
    // The decay itself is exact in elapsed time; only where the coast lands
    // relative to the stop threshold is quantised, so the settle times may
    // differ by up to one frame of the slower rate and no more.
    expect(Math.abs(oneTwentyHz.milliseconds - sixtyHz.milliseconds)).toBeLessThanOrEqual(
      1_000 / 60,
    );
    // Same reason: the last partial frame before the threshold differs, so the
    // distances agree proportionally rather than to an absolute fraction of a
    // degree. A frame-rate dependent decay would diverge by tens of percent.
    const drift = Math.abs(oneTwentyHz.degrees - sixtyHz.degrees) / Math.abs(sixtyHz.degrees);
    expect(drift, "the coast is the same length at either refresh rate").toBeLessThan(0.01);
    expect(oneTwentyHz.frames).toBeGreaterThan(sixtyHz.frames * 1.9);
  });

  it("splits a frame with no loss: 16ms equals 8ms + 8ms", () => {
    const whole = decayAngularVelocity(300, 16);
    const split = decayAngularVelocity(decayAngularVelocity(300, 8), 8);
    expect(split).toBeCloseTo(whole, 12);
  });

  it("advances the same rotation whether a frame is split or whole", () => {
    const whole = integrateAngularMotion(300, 16);
    const firstHalf = integrateAngularMotion(300, 8);
    const split = firstHalf + integrateAngularMotion(decayAngularVelocity(300, 8), 8);
    expect(split).toBeCloseTo(whole, 12);
  });

  it("holds still across a zero-length or backward frame", () => {
    expect(integrateAngularMotion(300, 0)).toBe(0);
    expect(decayAngularVelocity(300, 0)).toBe(300);
    expect(integrateAngularMotion(300, -5)).toBe(0);
  });

  it("produces no NaN or Infinity for any plausible frame", () => {
    for (const frameMs of [0.5, 1, 8, 16.667, 33, 120, 1_000]) {
      for (const velocity of [-420, -18, 0, 18, 420]) {
        expect(Number.isFinite(decayAngularVelocity(velocity, frameMs))).toBe(true);
        expect(Number.isFinite(integrateAngularMotion(velocity, frameMs))).toBe(true);
      }
    }
    expect(integrateAngularMotion(Number.NaN, 16)).toBe(0);
    expect(decayAngularVelocity(300, Number.NaN)).toBe(0);
  });
});

describe("integration and settling", () => {
  it("moves the wheel the way the release was going", () => {
    expect(integrateAngularMotion(200, 16)).toBeGreaterThan(0);
    expect(integrateAngularMotion(-200, 16)).toBeLessThan(0);
  });

  it("advances slightly less than velocity times time over a frame", () => {
    // A rectangular step would move 200 * 0.016 = 3.2 degrees. Integrating the
    // decay across the frame instead gives 3.04: the shortfall is the friction
    // applied during the frame rather than only at its end, and it is what
    // keeps a long frame from overshooting.
    const advance = integrateAngularMotion(200, 16);
    expect(advance).toBeLessThan(3.2);
    expect(advance).toBeGreaterThan(3.0);
    expect(advance).toBeCloseTo(3.039, 3);
  });

  it("stops rather than creeping forever", () => {
    const settled = coast(RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond);
    expect(settled.frames).toBeLessThan(10_000);
    expect(hasSettled(0)).toBe(true);
    expect(hasSettled(RADIAL_INERTIA.stopVelocityDegreesPerSecond - 0.01)).toBe(true);
    expect(hasSettled(RADIAL_INERTIA.stopVelocityDegreesPerSecond)).toBe(false);
  });

  it("settles a moderate flick within a few hundred milliseconds", () => {
    const settled = coast(250);
    expect(settled.milliseconds).toBeGreaterThan(300);
    expect(settled.milliseconds).toBeLessThan(700);
  });

  it("keeps even the fastest permitted flick well under one turn", () => {
    const settled = coast(RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond);
    expect(Math.abs(settled.degrees)).toBeLessThan(180);
    expect(settled.milliseconds).toBeLessThan(1_000);
  });

  it("barely coasts at all from a slow release", () => {
    const settled = coast(RADIAL_INERTIA.minimumReleaseVelocityDegreesPerSecond);
    expect(Math.abs(settled.degrees)).toBeLessThan(5);
    expect(settled.milliseconds).toBeLessThan(250);
  });

  it("accumulates past a full turn without corrupting the offset", () => {
    let offset = 350;
    let velocity = RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond;
    while (!hasSettled(velocity)) {
      offset += integrateAngularMotion(velocity, 16.667);
      velocity = decayAngularVelocity(velocity, 16.667);
    }
    // Crosses 360 mid-coast and simply keeps counting: nothing wraps the
    // shared offset, exactly as during a manual drag.
    expect(offset).toBeGreaterThan(360);
    expect(Number.isFinite(offset)).toBe(true);
  });
});

describe("inertia changes nothing but the shared offset", () => {
  it("leaves geometry identical at any offset an inertial coast can reach", () => {
    const base = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0);
    for (const offset of [17.4, 76, 412.9, -389.2]) {
      const rotated = buildRadialLibraryLayout(
        CENTER,
        RADIAL_LIBRARY_CONFIGURATION,
        undefined,
        offset,
      );
      expect(rotated.cells).toHaveLength(base.cells.length);
      expect(rotated.tracks).toHaveLength(base.tracks.length);
      for (const [index, cell] of base.cells.entries()) {
        const moved = rotated.cells[index]!;
        // Same instrument, same catalogue order, same physical size: only the
        // bearing differs, and it differs by the offset for every ring alike.
        expect(moved.brush.id).toBe(cell.brush.id);
        expect(moved.trackIndex).toBe(cell.trackIndex);
        expect(moved.arcLength).toBeCloseTo(cell.arcLength, 9);
        expect(moved.innerRadius).toBe(cell.innerRadius);
        expect(moved.outerRadius).toBe(cell.outerRadius);
        expect(moved.cellAngleDegrees).toBeCloseTo(cell.cellAngleDegrees, 9);
        expect(
          shortestAngularDelta(cell.midAngleDegrees + offset, moved.midAngleDegrees),
        ).toBeCloseTo(0, 6);
      }
    }
  });

  it("keeps the propagated channels empty while coasting", () => {
    for (const offset of [23.5, 198.2, 471.6]) {
      const layout = buildRadialLibraryLayout(
        CENTER,
        RADIAL_LIBRARY_CONFIGURATION,
        undefined,
        offset,
      );
      expect(layout.cells).toHaveLength(BRUSH_LIBRARY_CATALOGUE.length);
      expect(layout.tracks.map((track) => track.cells.length).reduce((a, b) => a + b, 0)).toBe(
        BRUSH_LIBRARY_CATALOGUE.length,
      );
    }
  });

  it("lets the existing spatial fade recompute untouched during a coast", () => {
    // Fade is a function of position only, so a cell carried by momentum fades
    // by exactly the same rule as one carried by a finger.
    let velocity = 300;
    // Start the cell 50 degrees short of the dock so the coast actually carries
    // it into the aperture. Left at offset 0 it stays in clear view for the
    // whole coast and the test would assert nothing.
    const restingMid = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0)
      .cells[0]!.midAngleDegrees;
    let offset = hiddenDirectionDegrees(RADIAL_APERTURE.dockSide) - 50 - restingMid;
    const seen: number[] = [];
    while (!hasSettled(velocity)) {
      offset += integrateAngularMotion(velocity, 16.667);
      velocity = decayAngularVelocity(velocity, 16.667);
      const layout = buildRadialLibraryLayout(
        CENTER,
        RADIAL_LIBRARY_CONFIGURATION,
        undefined,
        offset,
      );
      const visibility = computeCellVisibility(layout.cells[0]!);
      expect(visibility).toBeGreaterThanOrEqual(0);
      expect(visibility).toBeLessThanOrEqual(1);
      seen.push(visibility);
    }
    // A 300 deg/s flick carries the cell far enough to actually change state.
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.1);
    // Reaching the same offset by any means gives the same opacity.
    const byHand = buildRadialLibraryLayout(
      CENTER,
      RADIAL_LIBRARY_CONFIGURATION,
      undefined,
      offset,
    );
    expect(computeCellVisibility(byHand.cells[0]!)).toBeCloseTo(seen[seen.length - 1]!, 12);
  });

  it("carries no document, History, or brush state", () => {
    for (const value of Object.values(RADIAL_INERTIA)) {
      expect(typeof value).toBe("number");
    }
    // The configuration is inert data, so nothing here can reach the document.
    expect(Object.isFrozen(RADIAL_INERTIA)).toBe(true);
  });
});

describe("interrupting a coast", () => {
  it("models a new grab as an immediate stop, not a blend", () => {
    // The component calls stopInertia() on pointerdown; the modelled outcome is
    // that the wheel contributes nothing further of its own.
    let velocity = 300;
    velocity = decayAngularVelocity(velocity, 16.667);
    expect(velocity).toBeGreaterThan(0);
    const grabbed = 0;
    expect(integrateAngularMotion(grabbed, 16.667)).toBe(0);
    expect(hasSettled(grabbed)).toBe(true);
  });

  it("starts a reopened library from rest", () => {
    // Rotation and velocity are component state that dies with the surface.
    expect(hasSettled(0)).toBe(true);
    const fresh = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0);
    const base = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0);
    expect(fresh.cells.map((cell) => cell.midAngleDegrees)).toEqual(
      base.cells.map((cell) => cell.midAngleDegrees),
    );
  });
});
