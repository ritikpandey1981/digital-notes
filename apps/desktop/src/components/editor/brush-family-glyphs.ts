import type { DrawingToolKind } from "@folio/editor";
import { Highlighter, Paintbrush, Pencil, PenTool, type LucideIcon } from "lucide-react";

/**
 * One glyph per brush family, owned here rather than by either surface that
 * draws it.
 *
 * The Tool Dock and the radial Brush Library both label a brush by the
 * instrument it is, and they were each keeping their own copy of that mapping.
 * Two tables answering one question is two tables that can drift, and the
 * question is not a rendering question: it is preset-family metadata, and it
 * belongs beside the catalogue rather than inside a component.
 *
 * Deliberately coarse, and deliberately family-level. Every pencil shares the
 * pencil, every pen the nib: a per-brush specimen would promise that
 * forty-five distinct behaviours exist, and they do not. Names carry the
 * distinction, through the accessible name on every cell and slot.
 *
 * **Nothing here is durable.** A glyph is not part of a stroke, a
 * `ResolvedBrushSnapshot` or a `.folio` file, and a saved project never names
 * one. Changing an icon changes what the editor looks like and nothing about
 * what any artwork is.
 */
export const BRUSH_FAMILY_GLYPHS: Readonly<Record<DrawingToolKind, LucideIcon>> = Object.freeze({
  // A pencil reads as a pencil. The dry-media strategy that shipped behind this
  // family needs a tool the artist recognises by shape, not the vector nib the
  // pens use -- the two make visibly different marks and must not look alike.
  pencil: Pencil,
  pen: PenTool,
  marker: Paintbrush,
  highlighter: Highlighter,
});

/**
 * A stable name per glyph, for tests and for the `data-` attributes the dock
 * and the wheel report.
 *
 * Asserting which instrument a slot is showing should not require reading an
 * icon component's identity or comparing pixels.
 */
const FAMILY_GLYPH_NAMES: Readonly<Record<DrawingToolKind, string>> = Object.freeze({
  pencil: "pencil",
  pen: "pen-nib",
  marker: "brush",
  highlighter: "highlighter",
});

/** The reported name of that glyph, or `""` where a slot holds no brush. */
export function brushFamilyGlyphName(family: DrawingToolKind | undefined): string {
  return family === undefined ? "" : (FAMILY_GLYPH_NAMES[family] ?? "");
}

/** Every family the mapping covers, for drift tests. */
export function brushFamilyGlyphNames(): Readonly<Record<DrawingToolKind, string>> {
  return FAMILY_GLYPH_NAMES;
}
