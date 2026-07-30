import { describe, expect, it } from "vitest";
import {
  constrainOpacityForTool,
  defaultOpacityForTool,
  displayOpacityForTool,
  MAX_HIGHLIGHTER_OPACITY,
  maximumOpacityForTool,
  MIN_DRAWING_OPACITY,
  modelOpacityForTool,
} from "./drawing-style-policy";

describe("drawing style UX policy", () => {
  it("keeps pen opacity unrestricted within the shared valid range", () => {
    expect(constrainOpacityForTool("Pen", 0.72)).toBe(0.72);
    expect(constrainOpacityForTool("Pen", 2)).toBe(1);
    expect(constrainOpacityForTool("Pen", 0)).toBe(MIN_DRAWING_OPACITY);
    expect(maximumOpacityForTool("Pen")).toBe(1);
    expect(defaultOpacityForTool("Pen")).toBe(1);
  });

  it("caps highlighter opacity so it remains visually distinct from pen ink", () => {
    expect(constrainOpacityForTool("Highlighter", 1)).toBe(MAX_HIGHLIGHTER_OPACITY);
    expect(constrainOpacityForTool("Highlighter", 0.3)).toBe(0.3);
    expect(maximumOpacityForTool("Highlighter")).toBe(MAX_HIGHLIGHTER_OPACITY);
    expect(defaultOpacityForTool("Highlighter")).toBe(0.34);
  });

  it("rejects non-finite opacity input", () => {
    expect(() => constrainOpacityForTool("Highlighter", Number.NaN)).toThrow(RangeError);
    expect(() => modelOpacityForTool("Highlighter", Number.NaN)).toThrow(RangeError);
  });

  it("normalizes the highlighter model range to a complete 10–100% UI range", () => {
    expect(displayOpacityForTool("Highlighter", MIN_DRAWING_OPACITY)).toBeCloseTo(0.1);
    expect(displayOpacityForTool("Highlighter", MAX_HIGHLIGHTER_OPACITY)).toBeCloseTo(1);
    expect(modelOpacityForTool("Highlighter", 0.1)).toBeCloseTo(MIN_DRAWING_OPACITY);
    expect(modelOpacityForTool("Highlighter", 1)).toBeCloseTo(MAX_HIGHLIGHTER_OPACITY);
    expect(
      modelOpacityForTool("Highlighter", displayOpacityForTool("Highlighter", 0.34)),
    ).toBeCloseTo(0.34);
  });

  it("uses identity display mapping for pen opacity", () => {
    expect(displayOpacityForTool("Pen", 0.72)).toBe(0.72);
    expect(modelOpacityForTool("Pen", 0.72)).toBe(0.72);
  });
});
