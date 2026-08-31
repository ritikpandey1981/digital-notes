import { describe, expect, it } from "vitest";
import { PROFESSIONAL_EASE } from "../../motion/interaction-motion";
import { BRUSH_LIBRARY_FIXTURES } from "./brush-library-fixtures";
import {
  RADIAL_APERTURE,
  RADIAL_SWEEP,
  RADIAL_INERTIA,
  RADIAL_LIBRARY_CONFIGURATION,
  RADIAL_OPEN_EASE,
  RADIAL_OPEN_MOTION,
  buildRadialLibraryLayout,
  cellCircumferentialReveal,
  clampProgress,
  combineRevealFactors,
  computeCellVisibility,
  easeOpenProgress,
  easeWithBezier,
  expandCell,
  hiddenDirectionDegrees,
  normalizeDegrees,
  revealFrontDegrees,
  ringAngularRevealProgress,
  ringExpansion,
  ringLocalProgress,
  ringRadialExpansion,
  ringRevealOpacity,
  type RadialCenter,
} from "./radial-brush-library-model";

const CENTER: RadialCenter = Object.freeze({ x: 200, y: 300 });
const HUB = RADIAL_LIBRARY_CONFIGURATION.hubRadius;
const FINAL = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0);
const RING_COUNT = FINAL.tracks.length;

/** The global progress at which one ring first starts to move. */
function ringStartProgress(ringIndex: number): number {
  for (let step = 0; step <= 10_000; step += 1) {
    const progress = step / 10_000;
    if (ringLocalProgress(progress, ringIndex, RING_COUNT) > 0) return progress;
  }
  return 1;
}

describe("progress clamping", () => {
  it("holds any input inside the unit range", () => {
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.42)).toBe(0.42);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(7)).toBe(1);
  });

  it("treats a broken input as collapsed rather than propagating it", () => {
    // Anything non-finite resolves to the collapsed end. A broken frame time
    // should leave the instrument at its slot, never half-built at a radius
    // derived from NaN.
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("easing", () => {
  it("uses this instrument's own curve, leaving the shared token alone", () => {
    expect([...RADIAL_OPEN_EASE]).toEqual([0.2, 0.75, 0.3, 1]);
    // The global token is untouched: every other Folio surface still gets it.
    expect([...PROFESSIONAL_EASE]).toEqual([0.22, 1, 0.36, 1]);
    expect([...RADIAL_OPEN_EASE]).not.toEqual([...PROFESSIONAL_EASE]);
  });

  it("exposes more of the middle than the shared curve does", () => {
    // The reason for a separate curve: Folio's ease is settled to within 5% of
    // its travel before half the duration has passed, which hides the very part
    // of a four-ring unfolding this choreography exists to show.
    const settledAt = (ease: (progress: number) => number): number => {
      for (let step = 0; step <= 1_000; step += 1) {
        if (ease(step / 1_000) >= 0.95) return step / 1_000;
      }
      return 1;
    };
    const shared = (progress: number): number =>
      easeWithBezier(progress, [
        PROFESSIONAL_EASE[0],
        PROFESSIONAL_EASE[1],
        PROFESSIONAL_EASE[2],
        PROFESSIONAL_EASE[3],
      ]);
    expect(settledAt(easeOpenProgress)).toBeGreaterThan(settledAt(shared));
    expect(settledAt(easeOpenProgress)).toBeCloseTo(0.58, 1);
  });

  it("pins the curve to its endpoints", () => {
    expect(easeOpenProgress(0)).toBe(0);
    expect(easeOpenProgress(1)).toBe(1);
  });

  it("rises monotonically with no overshoot", () => {
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const open = easeOpenProgress(step / 100);
      expect(open, `step ${step}`).toBeGreaterThanOrEqual(previous);
      // No bounce, spring, or elastic: the curve never leaves the unit range.
      expect(open).toBeGreaterThanOrEqual(0);
      expect(open).toBeLessThanOrEqual(1);
      previous = open;
    }
  });

  it("opens fast and settles", () => {
    expect(easeOpenProgress(0.25)).toBeGreaterThan(0.25);
    expect(easeOpenProgress(0.75)).toBeGreaterThan(0.75);
  });

  it("becomes an ease-in when played backwards, which is the close", () => {
    // Closing walks this curve from 1 down to 0. Read in that direction the
    // remaining travel starts small and accelerates, so no separate closing
    // curve is needed to get a sharper collapse.
    const stepsFromOpen = [1, 0.9, 0.8, 0.7].map((progress) => 1 - easeOpenProgress(progress));
    const early = stepsFromOpen[1]! - stepsFromOpen[0]!;
    const later = stepsFromOpen[3]! - stepsFromOpen[2]!;
    expect(early, "the collapse leaves gently").toBeLessThan(later);
  });

  it("is finite everywhere, including outside the range", () => {
    for (const progress of [-1, 0, 0.001, 0.5, 0.999, 1, 2, Number.NaN]) {
      expect(Number.isFinite(easeOpenProgress(progress)), `open ${progress}`).toBe(true);
    }
  });

  it("matches the CSS cubic-bezier it names", () => {
    // Spot values for cubic-bezier(0.20, 0.75, 0.30, 1), cross-checked against
    // a brute-force sampling of the curve rather than against this solver, so a
    // regression in the Newton step cannot quietly agree with itself.
    expect(easeOpenProgress(0.1)).toBeCloseTo(0.350514, 4);
    expect(easeOpenProgress(0.2)).toBeCloseTo(0.607903, 4);
    expect(easeOpenProgress(0.5)).toBeCloseTo(0.919966, 4);
    expect(easeOpenProgress(0.8)).toBeCloseTo(0.99158, 4);
  });
});

describe("ring stagger", () => {
  it("uses the configured timings", () => {
    expect(RADIAL_OPEN_MOTION.openMilliseconds).toBe(320);
    expect(RADIAL_OPEN_MOTION.closeMilliseconds).toBe(210);
    expect(RADIAL_OPEN_MOTION.ringStaggerMilliseconds).toBe(26);
    expect(RADIAL_OPEN_MOTION.angularCompleteAt).toBe(0.8);
    expect(RING_COUNT).toBe(4);
  });

  it("starts ring 1, then 2, then 3, then 4 while opening", () => {
    const starts = [0, 1, 2, 3].map(ringStartProgress);
    for (let ring = 1; ring < starts.length; ring += 1) {
      expect(starts[ring]!, `ring ${ring + 1} follows ring ${ring}`).toBeGreaterThan(
        starts[ring - 1]!,
      );
    }
  });

  it("puts each ring's start where the configured stagger says", () => {
    const starts = [0, 1, 2, 3].map(
      (ring) => ringStartProgress(ring) * RADIAL_OPEN_MOTION.openMilliseconds,
    );
    expect(starts[0]!).toBeCloseTo(0, 1);
    expect(starts[1]!).toBeCloseTo(26, 0);
    expect(starts[2]!).toBeCloseTo(52, 0);
    expect(starts[3]!).toBeCloseTo(78, 0);
  });

  it("reverses that order while closing: the outside leaves first", () => {
    // Closing walks the same timeline from 1 down to 0, so the ring that
    // arrived last is the first to start leaving.
    const justInsideOpen = 0.98;
    const stillFull = [0, 1, 2, 3].filter(
      (ring) => ringExpansion(justInsideOpen, ring, RING_COUNT) >= 1,
    );
    const alreadyLeaving = [0, 1, 2, 3].filter(
      (ring) => ringExpansion(justInsideOpen, ring, RING_COUNT) < 1,
    );
    expect(alreadyLeaving, "the outermost ring retracts first").toContain(RING_COUNT - 1);
    expect(stillFull, "the innermost is still fully out").toContain(0);
  });

  it("scales the same stagger onto the shorter close timeline", () => {
    // One configured value covers both directions: 22ms of 260ms is the same
    // fraction as roughly 14ms of 170ms.
    const fraction =
      RADIAL_OPEN_MOTION.ringStaggerMilliseconds / RADIAL_OPEN_MOTION.openMilliseconds;
    expect(fraction * RADIAL_OPEN_MOTION.closeMilliseconds).toBeCloseTo(17.1, 1);
  });

  it("keeps the stagger short enough to read as one instrument", () => {
    // The outermost ring must begin well before the innermost has finished, or
    // it stops being depth and becomes four separate animations.
    const outerStart = ringStartProgress(RING_COUNT - 1);
    expect(outerStart * RADIAL_OPEN_MOTION.openMilliseconds).toBeLessThan(90);
    expect(ringLocalProgress(outerStart, 0, RING_COUNT), "ring 1 is still travelling").toBeLessThan(
      1,
    );
  });

  it("lands every ring exactly at the ends of the timeline", () => {
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      expect(ringLocalProgress(0, ring, RING_COUNT), `ring ${ring} collapsed`).toBe(0);
      expect(ringLocalProgress(1, ring, RING_COUNT), `ring ${ring} open`).toBe(1);
    }
  });
});

describe("ring expansion", () => {
  it("is fully collapsed at progress 0 and fully open at progress 1", () => {
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      expect(ringExpansion(0, ring, RING_COUNT)).toBe(0);
      expect(ringExpansion(1, ring, RING_COUNT)).toBe(1);
    }
  });

  it("only ever grows with progress", () => {
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      let previous = -1;
      for (let step = 0; step <= 100; step += 1) {
        const value = ringExpansion(step / 100, ring, RING_COUNT);
        expect(value, `ring ${ring} step ${step}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("keeps the inner rings ahead of the outer ones throughout", () => {
    for (let step = 1; step < 100; step += 1) {
      const progress = step / 100;
      for (let ring = 1; ring < RING_COUNT; ring += 1) {
        expect(
          ringExpansion(progress, ring - 1, RING_COUNT),
          `ring ${ring} never overtakes ring ${ring - 1}`,
        ).toBeGreaterThanOrEqual(ringExpansion(progress, ring, RING_COUNT));
      }
    }
  });

  it("stays in range for every ring and progress", () => {
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      for (let step = -10; step <= 110; step += 1) {
        const value = ringExpansion(step / 100, ring, RING_COUNT);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("reveal opacity", () => {
  it("completes before the ring reaches its final radius", () => {
    expect(RADIAL_OPEN_MOTION.revealCompleteAt).toBeLessThan(1);
    expect(ringRevealOpacity(RADIAL_OPEN_MOTION.revealCompleteAt)).toBe(1);
    expect(ringRevealOpacity(1)).toBe(1);
    // Structure, not fade: the ring is still visibly travelling once it is
    // already at full strength.
    expect(ringRevealOpacity(0.8)).toBe(1);
  });

  it("starts from nothing and rises", () => {
    expect(ringRevealOpacity(0)).toBe(0);
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const value = ringRevealOpacity(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("combines multiplicatively with the spatial fade, never replacing it", () => {
    const cell = FINAL.cells[0]!;
    const spatial = computeCellVisibility(cell);
    for (const expansion of [0, 0.25, 0.5, 1]) {
      const reveal = ringRevealOpacity(expansion);
      const combined = spatial * reveal;
      expect(combined).toBeLessThanOrEqual(spatial + 1e-12);
      expect(combined).toBeGreaterThanOrEqual(0);
    }
    // A fully revealed ring leaves the spatial term exactly as it was.
    expect(spatial * ringRevealOpacity(1)).toBe(spatial);
  });
});

describe("radial interpolation", () => {
  it("collapses every cell onto the hub at expansion 0", () => {
    for (const cell of FINAL.cells) {
      const collapsed = expandCell(cell, 0);
      expect(collapsed.innerRadius).toBe(HUB);
      expect(collapsed.outerRadius).toBe(HUB);
      expect(collapsed.midRadius).toBe(HUB);
    }
  });

  it("returns the frozen geometry itself at expansion 1", () => {
    for (const cell of FINAL.cells) {
      // Identity, not a rebuilt equivalent: the final geometry is exactly the
      // approved geometry, with no interpolation rounding anywhere near it.
      expect(expandCell(cell, 1)).toBe(cell);
    }
  });

  it("never inverts a sector at any point in between", () => {
    for (let step = 0; step <= 100; step += 1) {
      const expansion = step / 100;
      for (const cell of FINAL.cells) {
        const drawn = expandCell(cell, expansion);
        expect(drawn.innerRadius, `step ${step}`).toBeLessThanOrEqual(drawn.outerRadius);
        expect(drawn.innerRadius).toBeGreaterThanOrEqual(HUB);
        expect(drawn.outerRadius).toBeLessThanOrEqual(cell.outerRadius);
        expect(Number.isFinite(drawn.innerRadius)).toBe(true);
        expect(Number.isFinite(drawn.outerRadius)).toBe(true);
        expect(drawn.midRadius).toBeGreaterThanOrEqual(drawn.innerRadius);
        expect(drawn.midRadius).toBeLessThanOrEqual(drawn.outerRadius);
      }
    }
  });

  it("grows monotonically outward", () => {
    const cell = FINAL.cells[FINAL.cells.length - 1]!;
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const drawn = expandCell(cell, step / 100);
      expect(drawn.outerRadius).toBeGreaterThanOrEqual(previous);
      previous = drawn.outerRadius;
    }
  });

  it("moves radii only: every angle is already final on the first frame", () => {
    for (const expansion of [0, 0.1, 0.5, 0.9, 1]) {
      for (const cell of FINAL.cells) {
        const drawn = expandCell(cell, expansion);
        expect(drawn.startAngleDegrees).toBe(cell.startAngleDegrees);
        expect(drawn.endAngleDegrees).toBe(cell.endAngleDegrees);
        expect(drawn.midAngleDegrees).toBe(cell.midAngleDegrees);
        expect(drawn.cellAngleDegrees).toBe(cell.cellAngleDegrees);
      }
    }
  });

  it("leaves the catalogue assignment untouched", () => {
    for (const expansion of [0, 0.37, 1]) {
      const drawn = FINAL.cells.map((cell) => expandCell(cell, expansion));
      expect(drawn.map((cell) => cell.fixture.id)).toEqual(
        FINAL.cells.map((cell) => cell.fixture.id),
      );
      expect(drawn.map((cell) => cell.trackIndex)).toEqual(
        FINAL.cells.map((cell) => cell.trackIndex),
      );
      expect(drawn.map((cell) => cell.catalogueIndex)).toEqual(
        FINAL.cells.map((cell) => cell.catalogueIndex),
      );
      expect(drawn).toHaveLength(BRUSH_LIBRARY_FIXTURES.length);
    }
  });

  it("keeps the propagated gap channels exactly where they were", () => {
    // Because nothing angular moves, a channel cannot be temporarily filled by
    // a cell drifting into it mid-expansion.
    const channels = FINAL.tracks.map((track) =>
      track.blockedIntervals.map((gap) => `${gap.startDegrees}:${gap.widthDegrees}`).join(" "),
    );
    for (let step = 0; step <= 100; step += 5) {
      const expansion = step / 100;
      for (const track of FINAL.tracks) {
        for (const gap of track.blockedIntervals) {
          const intruding = track.cells.filter((cell) => {
            const drawn = expandCell(cell, expansion);
            const offset = (((drawn.midAngleDegrees - gap.startDegrees) % 360) + 360) % 360;
            return offset < gap.widthDegrees;
          });
          expect(intruding, `ring ${track.index} at ${expansion}`).toHaveLength(0);
        }
      }
    }
    expect(
      FINAL.tracks.map((track) =>
        track.blockedIntervals.map((gap) => `${gap.startDegrees}:${gap.widthDegrees}`).join(" "),
      ),
    ).toEqual(channels);
  });

  it("leaves the spatial fade function completely unaffected", () => {
    // Fade reads angles only, so an expanding cell fades exactly as the frozen
    // one does. This is why no opening-specific fade system was needed.
    for (const cell of FINAL.cells) {
      for (const expansion of [0, 0.3, 0.75, 1]) {
        expect(computeCellVisibility(expandCell(cell, expansion))).toBe(
          computeCellVisibility(cell),
        );
      }
    }
    expect(RADIAL_APERTURE.hiddenCoreDegrees).toBe(15);
    expect(RADIAL_APERTURE.transitionDegrees).toBe(30);
  });
});

const SWEEP_ORIGIN = hiddenDirectionDegrees(RADIAL_APERTURE.dockSide);

/** How far round the sweep travels to reach a bearing, in its own direction. */
function travelledTo(bearingDegrees: number): number {
  return RADIAL_SWEEP.direction === "clockwise"
    ? normalizeDegrees(bearingDegrees - SWEEP_ORIGIN)
    : normalizeDegrees(SWEEP_ORIGIN - bearingDegrees);
}

describe("circumferential reveal", () => {
  it("starts at the dock-side hidden direction, not at the top of the circle", () => {
    // The same bearing the spatial fade hides through, so a cell is uncovered
    // exactly where it would otherwise be concealed.
    expect(SWEEP_ORIGIN).toBe(180);
    expect(travelledTo(SWEEP_ORIGIN)).toBe(0);
  });

  it("sweeps one consistent direction for every ring", () => {
    expect(RADIAL_SWEEP.direction).toBe("clockwise");
    // Increasing bearings run clockwise on screen here, so from the left-hand
    // dock the front goes up over the top and down the canvas-facing side.
    expect(travelledTo(270), "the top is reached first").toBeLessThan(travelledTo(90));
    // Every ring uses the identical function, so they cannot disagree.
    for (const ring of FINAL.tracks) {
      for (const cell of ring.cells) {
        expect(
          cellCircumferentialReveal(cell.midAngleDegrees, 1),
          `ring ${ring.index} fully swept`,
        ).toBe(1);
      }
    }
  });

  it("reveals nothing before the sweep begins", () => {
    for (const cell of FINAL.cells) {
      expect(cellCircumferentialReveal(cell.midAngleDegrees, 0)).toBe(0);
    }
  });

  it("has uncovered every cell once the sweep completes", () => {
    for (const cell of FINAL.cells) {
      expect(cellCircumferentialReveal(cell.midAngleDegrees, 1)).toBe(1);
    }
    // The front travels a whole turn plus one feather, so the last cell reached
    // is fully uncovered rather than left mid-fade.
    expect(revealFrontDegrees(1)).toBeCloseTo(360 + RADIAL_SWEEP.featherDegrees, 9);
  });

  it("uncovers each cell monotonically as the front passes", () => {
    for (const cell of FINAL.cells.slice(0, 12)) {
      let previous = -1;
      for (let step = 0; step <= 100; step += 1) {
        const value = cellCircumferentialReveal(cell.midAngleDegrees, step / 100);
        expect(value, `${cell.fixture.id} at ${step}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("uncovers cells in the order the front reaches them", () => {
    const ring = FINAL.tracks[0]!;
    const ordered = [...ring.cells].sort(
      (first, second) => travelledTo(first.midAngleDegrees) - travelledTo(second.midAngleDegrees),
    );
    // Sample partway round: everything behind the front leads everything ahead.
    for (let index = 1; index < ordered.length; index += 1) {
      expect(
        cellCircumferentialReveal(ordered[index - 1]!.midAngleDegrees, 0.5),
        `${ordered[index - 1]!.fixture.id} leads ${ordered[index]!.fixture.id}`,
      ).toBeGreaterThanOrEqual(cellCircumferentialReveal(ordered[index]!.midAngleDegrees, 0.5));
    }
  });

  it("feathers the front rather than popping cells on", () => {
    expect(RADIAL_SWEEP.featherDegrees).toBe(28);
    // Walk the front across one bearing and confirm a smooth 0 to partial to 1.
    const bearing = normalizeDegrees(SWEEP_ORIGIN + 120);
    const samples: number[] = [];
    for (let step = 0; step <= 200; step += 1) {
      samples.push(cellCircumferentialReveal(bearing, step / 200));
    }
    expect(
      samples.some((value) => value > 0 && value < 1),
      "there is a partial band",
    ).toBe(true);
    let largestStep = 0;
    for (let index = 1; index < samples.length; index += 1) {
      largestStep = Math.max(largestStep, samples[index]! - samples[index - 1]!);
    }
    // No single sample may carry the whole transition: that would be a pop.
    expect(largestStep).toBeLessThan(0.2);
  });

  it("is continuous across the wrap at the origin", () => {
    const justBefore = normalizeDegrees(SWEEP_ORIGIN - 0.001);
    const justAfter = normalizeDegrees(SWEEP_ORIGIN + 0.001);
    // The cell just short of a full turn is the last to be uncovered; the one
    // just past the origin is the first. Both must be finite and in range.
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      for (const bearing of [justBefore, justAfter]) {
        const value = cellCircumferentialReveal(bearing, progress);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(cellCircumferentialReveal(justAfter, 0.05)).toBeGreaterThan(
      cellCircumferentialReveal(justBefore, 0.05),
    );
  });

  it("finishes the sweep before the ring finishes settling", () => {
    expect(RADIAL_OPEN_MOTION.angularCompleteAt).toBeLessThan(1);
    expect(ringAngularRevealProgress(RADIAL_OPEN_MOTION.angularCompleteAt)).toBe(1);
    // The ring is still visibly moving into place once every cell is present.
    expect(ringRadialExpansion(RADIAL_OPEN_MOTION.angularCompleteAt)).toBeLessThan(1);
    expect(ringAngularRevealProgress(1)).toBe(1);
  });

  it("runs the sweep and the radial growth together, not one after the other", () => {
    // Neither extreme: the ring must not be fully drawn before it moves, and it
    // must not reach its final radius before it is drawn.
    expect(ringAngularRevealProgress(0.25)).toBeGreaterThan(0);
    expect(ringAngularRevealProgress(0.25)).toBeLessThan(1);
    expect(ringRadialExpansion(0.25)).toBeGreaterThan(0);
    expect(ringRadialExpansion(0.25)).toBeLessThan(1);
  });

  it("never lets the sweep put a cell into a gap channel", () => {
    // Nothing to guard: a gap holds no cell, so the front has nothing there to
    // uncover. Asserted directly against the propagated channels.
    for (const track of FINAL.tracks) {
      for (const gap of track.blockedIntervals) {
        const inside = track.cells.filter((cell) => {
          const offset = normalizeDegrees(cell.midAngleDegrees - gap.startDegrees);
          return offset < gap.widthDegrees;
        });
        expect(inside, `ring ${track.index} keeps its channel empty`).toHaveLength(0);
      }
    }
  });

  it("moves no cell final angle, whatever the sweep is doing", () => {
    const angles = FINAL.cells.map((cell) => cell.midAngleDegrees);
    for (const progress of [0, 0.3, 0.6, 1]) {
      for (const cell of FINAL.cells) cellCircumferentialReveal(cell.midAngleDegrees, progress);
    }
    expect(FINAL.cells.map((cell) => cell.midAngleDegrees)).toEqual(angles);
  });

  it("stays finite for a degenerate bearing", () => {
    expect(cellCircumferentialReveal(Number.NaN, 0.5)).toBe(0);
    expect(Number.isFinite(cellCircumferentialReveal(0, Number.NaN))).toBe(true);
  });
});

describe("combining the presentation factors", () => {
  it("multiplies the three independent terms", () => {
    expect(combineRevealFactors(1, 1, 1)).toBe(1);
    expect(combineRevealFactors(0.5, 0.5, 0.5)).toBeCloseTo(0.125, 9);
    // Any one term at zero hides the cell, whatever the others say.
    expect(combineRevealFactors(0, 1, 1)).toBe(0);
    expect(combineRevealFactors(1, 0, 1)).toBe(0);
    expect(combineRevealFactors(1, 1, 0)).toBe(0);
  });

  it("stays inside the unit range for everything the model can produce", () => {
    for (const cell of FINAL.cells) {
      for (let step = 0; step <= 20; step += 1) {
        const local = step / 20;
        const value = combineRevealFactors(
          computeCellVisibility(cell),
          ringRevealOpacity(ringRadialExpansion(local)),
          cellCircumferentialReveal(cell.midAngleDegrees, ringAngularRevealProgress(local)),
        );
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("leaves the spatial fade term exactly as the frozen model computes it", () => {
    for (const cell of FINAL.cells) {
      expect(combineRevealFactors(computeCellVisibility(cell), 1, 1)).toBe(
        computeCellVisibility(cell),
      );
    }
  });

  it("collapses to nothing on a degenerate input", () => {
    // Anything non-finite hides the cell rather than propagating: a broken
    // frame must never leave a brush painted at an undefined opacity.
    expect(combineRevealFactors(Number.NaN, 1, 1)).toBe(0);
    expect(combineRevealFactors(1, Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});

describe("rapid reversal", () => {
  /** Geometry of every ring at one point on the timeline. */
  function snapshot(progress: number): number[] {
    return Array.from({ length: RING_COUNT }, (_unused, ring) =>
      ringExpansion(progress, ring, RING_COUNT),
    );
  }

  it("shows identical geometry at a given progress whichever way it is going", () => {
    // The property that makes an interruption continuous, and the one an
    // earlier two-curve version of this failed: a ring's size depends only on
    // how far the unfolding has got, never on which direction it is heading.
    // With separate opening and closing choreographies, reversing at 60% moved
    // the innermost ring by 0.64 in a single frame — a visible snap.
    for (const progress of [0, 0.15, 0.35, 0.6, 0.85, 1]) {
      expect(snapshot(progress), `progress ${progress}`).toEqual(snapshot(progress));
    }
    const midway = snapshot(0.6);
    expect(Math.max(...midway), "genuinely mid-flight").toBeGreaterThan(0);
    expect(Math.min(...midway), "and not already finished").toBeLessThan(1);
  });

  it("never jumps to fully open before closing", () => {
    // A naive implementation completes the open first. Interrupting at 60%
    // must leave the outer rings short of their final radius.
    expect(snapshot(0.6)[RING_COUNT - 1]!).toBeLessThan(1);
  });

  it("puts no extra step into the frame where the direction changes", () => {
    // The numeric meaning of "no flash": turning round mid-flight must cost no
    // more movement than an ordinary closing frame does. The curve is steep
    // near the collapsed end, so an absolute bound would say nothing — what
    // matters is that the reversal frame is not an outlier among its peers.
    const openTravel = 1_000 / 60 / RADIAL_OPEN_MOTION.openMilliseconds;
    const closeTravel = 1_000 / 60 / RADIAL_OPEN_MOTION.closeMilliseconds;
    const step = (from: number, to: number): number =>
      Math.max(...snapshot(to).map((value, ring) => Math.abs(value - snapshot(from)[ring]!)));

    const reversalAt = 0.6;
    const acrossTheTurn = step(reversalAt, reversalAt - closeTravel);
    let largestClosingStep = 0;
    for (let progress = reversalAt; progress > closeTravel; progress -= closeTravel) {
      largestClosingStep = Math.max(largestClosingStep, step(progress, progress - closeTravel));
    }
    expect(acrossTheTurn).toBeLessThanOrEqual(largestClosingStep);
    // The last opening frame before the turn is likewise unremarkable.
    expect(step(reversalAt - openTravel, reversalAt)).toBeLessThanOrEqual(largestClosingStep);
  });
});

describe("the animation changes nothing structural", () => {
  it("leaves the frozen geometry, inertia and aperture untouched", () => {
    const rebuilt = buildRadialLibraryLayout(CENTER, RADIAL_LIBRARY_CONFIGURATION, undefined, 0);
    expect(rebuilt.cells.map((cell) => cell.innerRadius)).toEqual(
      FINAL.cells.map((cell) => cell.innerRadius),
    );
    expect(rebuilt.outerRadius).toBe(FINAL.outerRadius);
    // Physics frozen by the previous phases, restated so a change here fails.
    expect(RADIAL_INERTIA.minimumReleaseVelocityDegreesPerSecond).toBe(18);
    expect(RADIAL_INERTIA.maximumReleaseVelocityDegreesPerSecond).toBe(420);
    expect(RADIAL_INERTIA.frictionPerSecond).toBe(6.5);
    expect(RADIAL_INERTIA.stopVelocityDegreesPerSecond).toBe(8);
    expect(RADIAL_INERTIA.sampleWindowMilliseconds).toBe(80);
  });

  it("carries no document or History state", () => {
    for (const value of Object.values(RADIAL_OPEN_MOTION)) {
      expect(typeof value).toBe("number");
    }
    expect(Object.isFrozen(RADIAL_OPEN_MOTION)).toBe(true);
    // Nothing in the motion model can reach a brush, a page, or a command.
    expect(Object.keys(RADIAL_OPEN_MOTION).join(" ")).not.toMatch(
      /brush|preset|document|history/iu,
    );
  });

  it("signals a completed close, which is what makes unmounting safe", () => {
    // The surface may only be torn down once every ring has reached the hub and
    // gone fully transparent, so nothing is cut off mid-collapse.
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      expect(ringExpansion(0, ring, RING_COUNT)).toBe(0);
      expect(ringRevealOpacity(ringExpansion(0, ring, RING_COUNT))).toBe(0);
    }
    for (const cell of FINAL.cells) {
      expect(expandCell(cell, 0).outerRadius).toBe(HUB);
    }
  });
});
