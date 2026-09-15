import type { DrawingToolKind } from "@folio/editor";
import { DEFAULT_BRUSH_PRESETS } from "@folio/editor";
import { Highlighter, Paintbrush, Pencil, PenTool } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  BRUSH_FAMILY_GLYPHS,
  brushFamilyGlyphName,
  brushFamilyGlyphNames,
} from "./brush-family-glyphs";
import { BRUSH_LIBRARY_CATALOGUE } from "./brush-library-catalogue";
import { DRAWING_SLOTS, UTILITY_SLOTS } from "./tool-dock-model";

const FAMILIES: readonly DrawingToolKind[] = ["pencil", "pen", "marker", "highlighter"];

describe("brush family glyphs", () => {
  it("shows a pencil for the pencil family and a nib for the pens", () => {
    // The two make visibly different marks, so they must not look alike in the
    // dock or in the wheel.
    expect(BRUSH_FAMILY_GLYPHS.pencil).toBe(Pencil);
    expect(BRUSH_FAMILY_GLYPHS.pen).toBe(PenTool);
    expect(BRUSH_FAMILY_GLYPHS.marker).toBe(Paintbrush);
    expect(BRUSH_FAMILY_GLYPHS.highlighter).toBe(Highlighter);
    expect(BRUSH_FAMILY_GLYPHS.pencil).not.toBe(BRUSH_FAMILY_GLYPHS.pen);
  });

  it("names one distinct glyph per family", () => {
    const names = FAMILIES.map((family) => brushFamilyGlyphName(family));
    expect(names).toEqual(["pencil", "pen-nib", "brush", "highlighter"]);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(brushFamilyGlyphNames()).sort()).toEqual(
      [...FAMILIES].sort((first, second) => first.localeCompare(second)),
    );
  });

  it("reports nothing for a slot that holds no brush", () => {
    // A utility slot keeps its own semantic icon, so the family mapping must
    // decline rather than guess one.
    expect(brushFamilyGlyphName(undefined)).toBe("");
  });

  it("covers every family a preset or a catalogue identity can put in a slot", () => {
    for (const preset of DEFAULT_BRUSH_PRESETS) {
      expect(BRUSH_FAMILY_GLYPHS[preset.family]).toBeDefined();
      expect(brushFamilyGlyphName(preset.family)).not.toBe("");
    }
    for (const entry of BRUSH_LIBRARY_CATALOGUE) {
      expect(BRUSH_FAMILY_GLYPHS[entry.family]).toBeDefined();
    }
    for (const slot of DRAWING_SLOTS) expect(BRUSH_FAMILY_GLYPHS[slot.family]).toBeDefined();
    // Utilities are not brushes and are deliberately absent from the mapping.
    expect(UTILITY_SLOTS.length).toBeGreaterThan(0);
  });

  it("gives the Pencil preset a different glyph from both engine pens", () => {
    // The three presets on the real engine, by the family each one belongs to.
    const glyphOf = (presetId: string): unknown => {
      const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === presetId);
      expect(preset).toBeDefined();
      return preset === undefined ? null : BRUSH_FAMILY_GLYPHS[preset.family];
    };
    expect(glyphOf("pencil-hb")).toBe(Pencil);
    expect(glyphOf("pen-technical")).toBe(PenTool);
    expect(glyphOf("pen-brush")).toBe(PenTool);
    expect(glyphOf("pencil-hb")).not.toBe(glyphOf("pen-technical"));
  });
});
