import { describe, expect, it } from "vitest";
import {
  DOCK_GLYPH_CONTOUR_THRESHOLD,
  DOCK_GLYPH_SURFACES,
  dockGlyphContrastRatio,
  dockGlyphNeedsContour,
} from "./dock-glyph-legibility";

/** The colours the dark-appearance complaint was raised about. */
const DARK_ARTWORK = ["#000000", "#111111", "#00008b", "#8b0000"] as const;
/** Colours that carry themselves on a dark dock and must be left alone. */
const BRIGHT_ARTWORK = ["#ffffff", "#22c55e", "#eab308", "#2563eb", "#dc2626"] as const;

describe("a dark artwork colour cannot be seen on a dark dock", () => {
  it("leaves near-black colours below the level a glyph needs", () => {
    for (const color of DARK_ARTWORK) {
      const ratio = dockGlyphContrastRatio(color, "dark");
      expect(ratio, `${color} on the dark dock`).toBeLessThan(DOCK_GLYPH_CONTOUR_THRESHOLD);
      // Not marginally below: these are within a hair of the dock itself.
      expect(ratio).toBeLessThan(1.7);
    }
  });

  it("is not rescued by selecting the slot", () => {
    for (const color of DARK_ARTWORK) {
      // Accent-soft lifts the dock a little. Black reaches 2.0 on a selected
      // dark slot -- across the threshold, and no more readable for it, which
      // is why the treatment is not decided per state.
      expect(
        dockGlyphContrastRatio(color, "dark", "selected"),
        `${color} on a selected dark slot`,
      ).toBeLessThan(2.1);
    }
  });

  it("is the same problem in reverse for a pale colour on a light dock", () => {
    expect(dockGlyphContrastRatio("#ffffff", "light")).toBe(1);
    expect(dockGlyphNeedsContour("#ffffff", "light")).toBe(true);
    expect(dockGlyphNeedsContour("#fffdf8", "light")).toBe(true);
  });
});

describe("only the colours that need help are given it", () => {
  it("offers a contour to every colour that would otherwise disappear", () => {
    for (const color of DARK_ARTWORK) {
      expect(dockGlyphNeedsContour(color, "dark"), color).toBe(true);
    }
  });

  it("leaves a colour that already stands out completely alone", () => {
    for (const color of BRIGHT_ARTWORK) {
      expect(dockGlyphNeedsContour(color, "dark"), `${color} on dark`).toBe(false);
    }
    for (const color of ["#000000", "#16a34a", "#ca8a04", "#059669", "#2563eb"]) {
      expect(dockGlyphNeedsContour(color, "light"), `${color} on light`).toBe(false);
    }
  });

  it("treats each appearance as its own problem", () => {
    // Black is the unreadable one in dark and the clearest one in light.
    expect(dockGlyphNeedsContour("#000000", "dark")).toBe(true);
    expect(dockGlyphNeedsContour("#000000", "light")).toBe(false);
    expect(dockGlyphNeedsContour("#ffffff", "light")).toBe(true);
    expect(dockGlyphNeedsContour("#ffffff", "dark")).toBe(false);
  });
});

describe("the surfaces the decision is made against", () => {
  it("names an opaque colour for every state a glyph is drawn in", () => {
    for (const appearance of ["light", "dark"] as const) {
      for (const surface of [
        DOCK_GLYPH_SURFACES[appearance].base,
        DOCK_GLYPH_SURFACES[appearance].selected,
      ]) {
        expect(surface, `${appearance} surface`).toMatch(/^#[0-9a-f]{6}$/u);
      }
    }
  });

  it("keeps a selected slot close to the dock it sits in", () => {
    // Selection is a control treatment, not a change of background. These
    // parting company is what would make a per-state decision tempting and
    // wrong, so the distance between them is worth holding down.
    for (const appearance of ["light", "dark"] as const) {
      const { base, selected } = DOCK_GLYPH_SURFACES[appearance];
      expect(dockGlyphContrastRatio(base, appearance, "selected"), appearance).toBeLessThan(1.35);
      expect(selected).not.toBe(base);
    }
  });
});
