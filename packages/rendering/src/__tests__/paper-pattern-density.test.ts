import { describe, expect, it } from "vitest";
import { paperPatternAlpha } from "../renderer";

describe("paper pattern density", () => {
  it("hides the pattern once its spacing approaches the pixel grid", () => {
    expect(paperPatternAlpha(0)).toBe(0);
    expect(paperPatternAlpha(2)).toBe(0);
    expect(paperPatternAlpha(4)).toBe(0);
  });

  it("draws the pattern at full strength once it is comfortably readable", () => {
    expect(paperPatternAlpha(12)).toBe(1);
    expect(paperPatternAlpha(24)).toBe(1);
    expect(paperPatternAlpha(240)).toBe(1);
  });

  it("fades between the two thresholds instead of switching abruptly", () => {
    const midpoint = paperPatternAlpha(8);
    expect(midpoint).toBeGreaterThan(0);
    expect(midpoint).toBeLessThan(1);
    expect(paperPatternAlpha(6)).toBeLessThan(midpoint);
    expect(paperPatternAlpha(10)).toBeGreaterThan(midpoint);
  });

  it("keeps a 24 unit grid quiet at low zoom and solid at reading zoom", () => {
    // A 24 unit grid at 25% used to render as a moire field.
    expect(paperPatternAlpha(24 * 0.25)).toBeLessThan(0.35);
    expect(paperPatternAlpha(24 * 0.63)).toBe(1);
    expect(paperPatternAlpha(24 * 1)).toBe(1);
  });

  it("treats a spacing that is not finite as unusable rather than drawing it", () => {
    expect(paperPatternAlpha(Number.NaN)).toBe(0);
    expect(paperPatternAlpha(Number.POSITIVE_INFINITY)).toBe(0);
    expect(paperPatternAlpha(-10)).toBe(0);
  });
});
