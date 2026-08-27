import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERASER_SIZE,
  describeEraserToolOptions,
  ERASER_WIDTH_CONSTRAINTS,
} from "./tool-options-registry";
import { pagePresetOptions, pageThumbnailSize, parsePageExtent } from "./page-navigator-model";

describe("Eraser tool options", () => {
  it("describes an Eraser that owns its own size", () => {
    const descriptor = describeEraserToolOptions(24);

    expect(descriptor.tool).toBe("Eraser");
    expect(descriptor.preset).toBeNull();
    expect(descriptor.properties.map(({ key }) => key)).toEqual(["strokeWidth"]);
    expect(descriptor.properties[0]?.value).toBe(24);
    expect(descriptor.properties[0]?.defaultValue).toBe(DEFAULT_ERASER_SIZE);
    expect(descriptor.preview.width).toBe(24);
  });

  it("keeps the Eraser size independent of any brush default", () => {
    // The Eraser reports whatever size it was given; nothing about a pen
    // preset can reach it.
    expect(describeEraserToolOptions(3).properties[0]?.value).toBe(3);
    expect(describeEraserToolOptions(96).properties[0]?.value).toBe(96);
    expect(ERASER_WIDTH_CONSTRAINTS.minimum).toBeGreaterThan(0);
    expect(ERASER_WIDTH_CONSTRAINTS.maximum).toBeGreaterThan(ERASER_WIDTH_CONSTRAINTS.minimum);
  });

  it("validates only sizes inside the Eraser's own range", () => {
    const property = describeEraserToolOptions(DEFAULT_ERASER_SIZE).properties[0];
    expect(property?.validate(ERASER_WIDTH_CONSTRAINTS.minimum)).toBe(true);
    expect(property?.validate(ERASER_WIDTH_CONSTRAINTS.maximum)).toBe(true);
    expect(property?.validate(ERASER_WIDTH_CONSTRAINTS.minimum - 1)).toBe(false);
    expect(property?.validate(ERASER_WIDTH_CONSTRAINTS.maximum + 1)).toBe(false);
  });
});

describe("page extent validation", () => {
  it("accepts values inside the supported range", () => {
    expect(parsePageExtent("800")).toBe(800);
    expect(parsePageExtent(" 640 ")).toBe(640);
    expect(parsePageExtent("640.4")).toBe(640);
  });

  it("rejects entries the panel must report rather than silently discard", () => {
    for (const invalid of ["0", "-50", "99999", "abc", "", "   "]) {
      expect(parsePageExtent(invalid)).toBeNull();
    }
  });
});

describe("page preset options", () => {
  it("omits Custom until the geometry actually is custom", () => {
    expect(pagePresetOptions("a4").map(({ id }) => id)).not.toContain("custom");
    expect(pagePresetOptions("custom").map(({ id }) => id)).toContain("custom");
  });
});

describe("page thumbnail sizing", () => {
  it("follows the page aspect so landscape reads as landscape", () => {
    const landscape = pageThumbnailSize({ width: 1123, height: 794 });
    const portrait = pageThumbnailSize({ width: 794, height: 1123 });

    expect(landscape.width).toBeGreaterThan(landscape.height);
    expect(portrait.width).toBeLessThan(portrait.height);
    expect(landscape.height).toBe(portrait.height);
  });

  it("clamps extreme aspects so one page cannot dominate the filmstrip", () => {
    const wide = pageThumbnailSize({ width: 20_000, height: 64 });
    const tall = pageThumbnailSize({ width: 64, height: 20_000 });

    expect(wide.width).toBeLessThanOrEqual(104);
    expect(tall.width).toBeGreaterThanOrEqual(44);
  });
});
