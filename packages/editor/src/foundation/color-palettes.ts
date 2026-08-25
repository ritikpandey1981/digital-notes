import { normalizeArtworkHex } from "./color-conversion";

export type PaletteSource = "built-in" | "user" | "lesson";

export interface ColorPalette {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
  readonly source: PaletteSource;
}

export interface ColorPaletteInput {
  readonly id: string;
  readonly name: string;
  readonly colors: readonly string[];
  readonly source: PaletteSource;
}

export type UserColorPaletteInput = Omit<ColorPaletteInput, "source">;

export const DEFAULT_COLOR_PALETTE_ID = "basic";

export function createColorPalette(input: ColorPaletteInput): ColorPalette {
  const id = requireNonEmpty(input.id, "Palette ID");
  const name = requireNonEmpty(input.name, "Palette name");
  if (input.source !== "built-in" && input.source !== "user" && input.source !== "lesson") {
    throw new TypeError("Palette source must be built-in, user, or lesson.");
  }
  if (!Array.isArray(input.colors) || input.colors.length === 0) {
    throw new TypeError("A palette must contain at least one color.");
  }
  const colors = Object.freeze(input.colors.map(normalizeArtworkHex));
  if (new Set(colors).size !== colors.length) {
    throw new TypeError("Palette colors must be unique after canonicalization.");
  }
  return Object.freeze({ id, name, colors, source: input.source });
}

const BASIC_PALETTE = createColorPalette({
  id: "basic",
  name: "Basic",
  source: "built-in",
  colors: [
    "#111111",
    "#4b5563",
    "#2563eb",
    "#4f46e5",
    "#9333ea",
    "#db2777",
    "#dc2626",
    "#ea580c",
    "#ca8a04",
    "#16a34a",
  ],
});

const SKETCH_PALETTE = createColorPalette({
  id: "sketch",
  name: "Sketch",
  source: "built-in",
  colors: [
    "#343434",
    "#6b4f3a",
    "#8b5e3c",
    "#b08968",
    "#d4a373",
    "#c9ada7",
    "#6b705c",
    "#3f4e4f",
    "#5f6f94",
    "#9a8c98",
  ],
});

const MONOCHROME_PALETTE = createColorPalette({
  id: "monochrome",
  name: "Monochrome",
  source: "built-in",
  colors: [
    "#000000",
    "#111111",
    "#343434",
    "#4b5563",
    "#6b7280",
    "#9ca3af",
    "#d1d5db",
    "#f3f4f6",
    "#ffffff",
  ],
});

export const BUILT_IN_COLOR_PALETTES: readonly ColorPalette[] = freezePaletteCatalog([
  BASIC_PALETTE,
  SKETCH_PALETTE,
  MONOCHROME_PALETTE,
]);

/** Phase 14 compatibility alias backed by the authoritative Basic built-in palette. */
export const EDITOR_PRESET_COLORS: readonly string[] = BUILT_IN_COLOR_PALETTES[0]!.colors;

export function freezePaletteCatalog(
  inputs: readonly ColorPaletteInput[],
): readonly ColorPalette[] {
  const palettes = Object.freeze(inputs.map(createColorPalette));
  if (new Set(palettes.map(({ id }) => id)).size !== palettes.length) {
    throw new TypeError("Palette catalog IDs must be unique.");
  }
  return palettes;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}
