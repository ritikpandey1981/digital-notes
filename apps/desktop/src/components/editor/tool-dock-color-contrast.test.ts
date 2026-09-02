import { describe, expect, it } from "vitest";
import {
  TOOL_DOCK_GLYPH_KEYLINE_THRESHOLD,
  resolveToolDockGlyphContrast,
} from "./tool-dock-color-contrast";

describe("Tool Dock stored-colour contrast", () => {
  it("keylines genuinely dark colours on the dark dock without assisting ordinary colours", () => {
    for (const color of ["#000000", "#111111", "#222222", "#4b5563"]) {
      expect(resolveToolDockGlyphContrast(color, "dark", false).needsKeyline, color).toBe(true);
    }
    for (const color of ["#ff7a45", "#2563eb", "#dc2626", "#6b7280"]) {
      expect(resolveToolDockGlyphContrast(color, "dark", false).needsKeyline, color).toBe(false);
    }
  });

  it("keylines genuinely pale colours on the light dock without assisting ordinary colours", () => {
    for (const color of ["#ffffff", "#fafafa", "#e5e7eb", "#fef9c3"]) {
      expect(resolveToolDockGlyphContrast(color, "light", false).needsKeyline, color).toBe(true);
    }
    for (const color of ["#000000", "#ff7a45", "#2563eb", "#dc2626", "#7c3aed"]) {
      expect(resolveToolDockGlyphContrast(color, "light", false).needsKeyline, color).toBe(false);
    }
  });

  it("uses the selected surface for contrast without dropping support for dark graphite", () => {
    for (const color of ["#000000", "#4b5563"]) {
      const assisted = resolveToolDockGlyphContrast(color, "dark", true);
      expect(assisted.contrastRatio, color).toBeLessThan(TOOL_DOCK_GLYPH_KEYLINE_THRESHOLD);
      expect(assisted.needsKeyline, color).toBe(true);
    }
  });
});
