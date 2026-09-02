import { hexToRgb, type RgbColor } from "@folio/editor";

export type ToolDockAppearance = "light" | "dark";

export interface ToolDockGlyphContrast {
  readonly contrastRatio: number;
  readonly needsKeyline: boolean;
}

/**
 * Deliberately below text-accessibility thresholds: these are compact artwork
 * colour previews, and a keyline should appear only when the thin glyph would
 * otherwise merge into the dock. Ordinary red, orange, blue, violet and medium
 * gray stay plain; genuinely pale-on-light and dark-on-dark colours get help.
 */
export const TOOL_DOCK_GLYPH_KEYLINE_THRESHOLD = 2;

/** Mirrors the existing light/dark Tool Dock surface tokens for pure contrast calculation. */
const TOOL_DOCK_SURFACES: Readonly<
  Record<ToolDockAppearance, Readonly<{ base: string; selected: string }>>
> = Object.freeze({
  light: Object.freeze({ base: "#ffffff", selected: "#f7f7f5" }),
  dark: Object.freeze({ base: "#332f2b", selected: "#2d2926" }),
});

/** Determines presentation support without altering the canonical artwork colour. */
export function resolveToolDockGlyphContrast(
  glyphColor: string,
  appearance: ToolDockAppearance,
  selected: boolean,
): ToolDockGlyphContrast {
  const surfaces = TOOL_DOCK_SURFACES[appearance];
  const surface = selected ? surfaces.selected : surfaces.base;
  const contrastRatio = contrastRatioBetween(glyphColor, surface);
  return Object.freeze({
    contrastRatio,
    needsKeyline: contrastRatio < TOOL_DOCK_GLYPH_KEYLINE_THRESHOLD,
  });
}

function contrastRatioBetween(first: string, second: string): number {
  const firstLuminance = relativeLuminance(hexToRgb(first));
  const secondLuminance = relativeLuminance(hexToRgb(second));
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor): number {
  const red = linearChannel(color.red);
  const green = linearChannel(color.green);
  const blue = linearChannel(color.blue);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}
