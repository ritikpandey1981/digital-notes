import { describe, expect, it } from "vitest";
import {
  RADIAL_OPEN_MOTION,
  ringExpansion,
  ringLocalProgress,
} from "../radial-brush-library-model";

/**
 * How far the unfolding can move while it still reports the same progress.
 *
 * `data-library-open-progress` and `data-track-expansion` both reach the DOM
 * through `toFixed(3)`, so a reading is up to half a unit of the last decimal
 * away from the value the window held. Two samples can therefore print one
 * progress while describing moments nearly a whole unit apart -- and because
 * the expansion is an eased function of progress, a ring can have moved much
 * further than that unit in between.
 *
 * `electron-radial-open-close.spec.ts` allows for exactly that when it compares
 * two samples at one reported progress. This is the measurement that allowance
 * is set from: if the ease is steepened, the stagger lengthened or a ring
 * added, the span grows, and this fails here with the reason rather than
 * turning that spec intermittent.
 */
const REPORTED_PROGRESS_HALF_STEP = 0.0005;
/** The expansion's own rounding, on both of the two samples being compared. */
const REPORTED_EXPANSION_STEP = 0.001;
/** `SAME_PROGRESS_EXPANSION_SPREAD` in electron-radial-open-close.spec.ts. */
const SPEC_ALLOWANCE = 0.0075;
/** The wheel the dock builds; the same spec pins this at four. */
const RING_COUNT = 4;

/** The widest an expansion can swing inside one reported progress step. */
function widestSpanWithinOneReportedProgress(ringCount: number): number {
  let widest = 0;
  for (let ring = 0; ring < ringCount; ring += 1) {
    for (let step = 0; step <= 20_000; step += 1) {
      const progress = step / 20_000;
      const span =
        ringExpansion(
          Math.min(1, progress + REPORTED_PROGRESS_HALF_STEP),
          ring,
          ringCount,
          RADIAL_OPEN_MOTION,
        ) -
        ringExpansion(
          Math.max(0, progress - REPORTED_PROGRESS_HALF_STEP),
          ring,
          ringCount,
          RADIAL_OPEN_MOTION,
        );
      if (span > widest) widest = span;
    }
  }
  return widest;
}

describe("what one reported progress step can hide", () => {
  it("stays inside what the radial spec allows for it", () => {
    const widest = widestSpanWithinOneReportedProgress(RING_COUNT);
    // The curve is genuinely faster than the progress it is reported against:
    // this is the fact the spec's older one-decimal tolerance did not account
    // for, and the reason it could fail on a sampling coincidence.
    expect(widest, "the expansion moves no faster than its reported progress").toBeGreaterThan(
      REPORTED_EXPANSION_STEP,
    );
    expect(
      widest + REPORTED_EXPANSION_STEP,
      "electron-radial-open-close.spec.ts must widen SAME_PROGRESS_EXPANSION_SPREAD to match",
    ).toBeLessThanOrEqual(SPEC_ALLOWANCE);
  });

  it("leaves the allowance far short of the depth the stagger creates", () => {
    // The thing that assertion exists to catch: a collapse staggered the other
    // way round, which would swap the innermost ring for the outermost at the
    // same progress. That difference is the depth of the stagger itself, and it
    // is two orders of magnitude past the allowance.
    let deepest = 0;
    for (let step = 0; step <= 5_000; step += 1) {
      const progress = step / 5_000;
      const depth =
        ringExpansion(progress, 0, RING_COUNT, RADIAL_OPEN_MOTION) -
        ringExpansion(progress, RING_COUNT - 1, RING_COUNT, RADIAL_OPEN_MOTION);
      if (depth > deepest) deepest = depth;
    }
    expect(deepest).toBeGreaterThan(SPEC_ALLOWANCE * 20);
  });

  it("is a property of the stagger, not of one ring", () => {
    // Every ring travels the same curve over its own share of the timeline, so
    // each one has a steep stretch and the span is not specific to the leader.
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      expect(widestSpanWithinOneReportedProgress(ring + 1)).toBeGreaterThan(
        REPORTED_EXPANSION_STEP,
      );
    }
  });

  it("keeps every ring's expansion a non-decreasing function of progress", () => {
    // The contract the spec is really asserting. If this were ever false the
    // spec would be right to fail, whatever its tolerance.
    for (let ring = 0; ring < RING_COUNT; ring += 1) {
      let previous = -1;
      for (let step = 0; step <= 5_000; step += 1) {
        const value = ringExpansion(step / 5_000, ring, RING_COUNT, RADIAL_OPEN_MOTION);
        expect(value, `ring ${ring} at ${step / 5_000}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
      expect(ringLocalProgress(1, ring, RING_COUNT, RADIAL_OPEN_MOTION)).toBe(1);
    }
  });
});
