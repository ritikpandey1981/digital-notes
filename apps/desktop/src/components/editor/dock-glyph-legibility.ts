import { hexToRgb, type RgbColor } from "@folio/editor";

export type DockAppearance = "light" | "dark";

/**
 * The surfaces a drawing slot's glyph is actually drawn on.
 *
 * Both dock capsules are `folio-floating-surface`, so an idle slot sits on
 * `--folio-surface`. A selected one adds `--folio-accent-soft` on top, which is
 * translucent; the value here is that mix already composited, because a
 * contrast ratio needs an opaque colour. These mirror `apps/desktop/src/
 * styles.css` and the E2E dock spec checks them against the live tokens, so a
 * token that moves without this moving is caught rather than quietly wrong.
 */
export const DOCK_GLYPH_SURFACES: Readonly<
  Record<DockAppearance, Readonly<{ base: string; selected: string }>>
> = Object.freeze({
  light: Object.freeze({ base: "#ffffff", selected: "#ebe9f5" }),
  dark: Object.freeze({ base: "#332f2b", selected: "#433d4a" }),
});

/**
 * Deliberately below the text-accessibility thresholds.
 *
 * These are compact previews of an artwork colour, not text, and the treatment
 * is worth having only where the glyph would otherwise merge into the dock.
 * Ordinary red, orange, blue, violet and medium grey stay plain at this level;
 * genuinely pale-on-light and dark-on-dark colours get help. The number is the
 * one the earlier dock work arrived at for this same surface.
 */
export const DOCK_GLYPH_CONTOUR_THRESHOLD = 2;

/** Which of a slot's two backgrounds a ratio is being measured against. */
export type DockGlyphSurface = "base" | "selected";

/** How far a slot's artwork colour stands out from the dock underneath it. */
export function dockGlyphContrastRatio(
  glyphColor: string,
  appearance: DockAppearance,
  surface: DockGlyphSurface = "base",
): number {
  return contrastRatioBetween(glyphColor, DOCK_GLYPH_SURFACES[appearance][surface]);
}

/**
 * Whether this glyph needs a contour drawn behind it to be seen.
 *
 * Measured against the dock's own surface, never the selected one. Accent-soft
 * lifts a dark dock by a little -- enough to carry black across a threshold,
 * nowhere near enough to make black readable -- and deciding per state would
 * take the treatment away from the one slot the artist is using and put it back
 * when they moved on. A colour either stands out in this appearance or it does
 * not, and selection is a control treatment rather than a different background.
 *
 * Nothing here changes the colour: the answer decides only whether the glyph is
 * given something to stand against, which is why a slot showing black still
 * shows black.
 */
export function dockGlyphNeedsContour(glyphColor: string, appearance: DockAppearance): boolean {
  return dockGlyphContrastRatio(glyphColor, appearance) < DOCK_GLYPH_CONTOUR_THRESHOLD;
}

function contrastRatioBetween(first: string, second: string): number {
  const firstLuminance = relativeLuminance(hexToRgb(first));
  const secondLuminance = relativeLuminance(hexToRgb(second));
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * linearChannel(color.red) +
    0.7152 * linearChannel(color.green) +
    0.0722 * linearChannel(color.blue)
  );
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}
