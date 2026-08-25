import { createEditableColor, type EditableColor, type EditableColorInput } from "@folio/document";
import {
  BUILT_IN_COLOR_PALETTES,
  DEFAULT_COLOR_PALETTE_ID,
  EDITOR_PRESET_COLORS,
  createColorPalette,
  freezePaletteCatalog,
  type ColorPalette,
  type ColorPaletteInput,
  type UserColorPaletteInput,
} from "./color-palettes";

export const RECENT_COLOR_CAPACITY = 10;
export const FAVORITE_COLOR_CAPACITY = 256;

export interface EditorColorSystemSnapshot {
  /** Phase 14 compatibility view; always the authoritative Basic palette. */
  readonly presetColors: readonly string[];
  readonly recentColors: readonly string[];
  readonly favoriteColors: readonly string[];
  readonly palettes: readonly ColorPalette[];
  readonly activePaletteId: string;
  readonly activePalette: ColorPalette;
}

export interface EditorColorSystem {
  readonly snapshot: () => EditorColorSystemSnapshot;
  readonly createColor: (input: EditableColorInput | string) => EditableColor;
  readonly remember: (color: EditableColorInput | string) => EditorColorSystemSnapshot;
  readonly clearRecent: () => EditorColorSystemSnapshot;
  readonly addFavorite: (color: EditableColorInput | string) => EditorColorSystemSnapshot;
  readonly removeFavorite: (color: string) => EditorColorSystemSnapshot;
  readonly setActivePalette: (paletteId: string) => EditorColorSystemSnapshot;
  readonly addUserPalette: (palette: UserColorPaletteInput) => EditorColorSystemSnapshot;
  readonly replaceUserPalette: (palette: UserColorPaletteInput) => EditorColorSystemSnapshot;
  readonly removeUserPalette: (paletteId: string) => EditorColorSystemSnapshot;
}

export interface EditorColorSystemOptions {
  readonly palettes?: readonly ColorPaletteInput[];
  readonly activePaletteId?: string;
  readonly initialFavorites?: readonly (EditableColorInput | string)[];
}

/** Lifecycle contract reserved for shared Phase 18B color controls. */
export interface ColorTargetAdapter {
  readonly id: string;
  readonly getCurrentColor: () => string;
  readonly begin: () => boolean;
  readonly preview: (canonicalHex: string) => boolean;
  readonly commit: () => boolean;
  readonly cancel: () => boolean;
}

class EditorColorSystemImplementation implements EditorColorSystem {
  #palettes: readonly ColorPalette[];
  #activePaletteId: string;
  #recentColors: readonly string[] = Object.freeze([]);
  #favoriteColors: readonly string[];

  constructor(options: EditorColorSystemOptions) {
    const runtimePalettes = (options.palettes ?? []).map((palette) => {
      if (palette.source === "built-in") {
        throw new TypeError("Runtime palettes cannot claim the built-in source.");
      }
      return createColorPalette(palette);
    });
    this.#palettes = freezePaletteCatalog([...BUILT_IN_COLOR_PALETTES, ...runtimePalettes]);
    this.#activePaletteId = options.activePaletteId ?? DEFAULT_COLOR_PALETTE_ID;
    this.requirePalette(this.#activePaletteId);
    const favorites = (options.initialFavorites ?? []).map(canonicalHex);
    if (new Set(favorites).size !== favorites.length) {
      throw new TypeError("Initial Favorite colors must be unique.");
    }
    if (favorites.length > FAVORITE_COLOR_CAPACITY) {
      throw new RangeError(`Favorite colors cannot exceed ${FAVORITE_COLOR_CAPACITY}.`);
    }
    this.#favoriteColors = Object.freeze(favorites);
  }

  snapshot(): EditorColorSystemSnapshot {
    return Object.freeze({
      presetColors: EDITOR_PRESET_COLORS,
      recentColors: this.#recentColors,
      favoriteColors: this.#favoriteColors,
      palettes: this.#palettes,
      activePaletteId: this.#activePaletteId,
      activePalette: this.requirePalette(this.#activePaletteId),
    });
  }

  createColor(input: EditableColorInput | string): EditableColor {
    return createEditableColor(input);
  }

  remember(color: EditableColorInput | string): EditorColorSystemSnapshot {
    const hex = canonicalHex(color);
    this.#recentColors = Object.freeze(
      [hex, ...this.#recentColors.filter((candidate) => candidate !== hex)].slice(
        0,
        RECENT_COLOR_CAPACITY,
      ),
    );
    return this.snapshot();
  }

  clearRecent(): EditorColorSystemSnapshot {
    this.#recentColors = Object.freeze([]);
    return this.snapshot();
  }

  addFavorite(color: EditableColorInput | string): EditorColorSystemSnapshot {
    const hex = canonicalHex(color);
    if (this.#favoriteColors.includes(hex)) return this.snapshot();
    if (this.#favoriteColors.length >= FAVORITE_COLOR_CAPACITY) {
      throw new RangeError(`Favorite colors cannot exceed ${FAVORITE_COLOR_CAPACITY}.`);
    }
    this.#favoriteColors = Object.freeze([...this.#favoriteColors, hex]);
    return this.snapshot();
  }

  removeFavorite(color: string): EditorColorSystemSnapshot {
    const hex = canonicalHex(color);
    if (!this.#favoriteColors.includes(hex)) return this.snapshot();
    this.#favoriteColors = Object.freeze(
      this.#favoriteColors.filter((candidate) => candidate !== hex),
    );
    return this.snapshot();
  }

  setActivePalette(paletteId: string): EditorColorSystemSnapshot {
    const palette = this.requirePalette(paletteId);
    this.#activePaletteId = palette.id;
    return this.snapshot();
  }

  addUserPalette(input: UserColorPaletteInput): EditorColorSystemSnapshot {
    const palette = createColorPalette({ ...input, source: "user" });
    if (this.#palettes.some(({ id }) => id === palette.id)) {
      throw new TypeError(`Palette '${palette.id}' is already registered.`);
    }
    this.#palettes = Object.freeze([...this.#palettes, palette]);
    return this.snapshot();
  }

  replaceUserPalette(input: UserColorPaletteInput): EditorColorSystemSnapshot {
    const palette = createColorPalette({ ...input, source: "user" });
    const index = this.#palettes.findIndex(({ id }) => id === palette.id);
    const existing = this.#palettes[index];
    if (existing === undefined || existing.source !== "user") {
      throw new TypeError(`User palette '${palette.id}' is not registered.`);
    }
    this.#palettes = Object.freeze(
      this.#palettes.map((candidate, candidateIndex) =>
        candidateIndex === index ? palette : candidate,
      ),
    );
    return this.snapshot();
  }

  removeUserPalette(paletteId: string): EditorColorSystemSnapshot {
    const existing = this.requirePalette(paletteId);
    if (existing.source !== "user") {
      throw new TypeError(`Palette '${paletteId}' is read-only.`);
    }
    this.#palettes = Object.freeze(
      this.#palettes.filter((candidate) => candidate.id !== existing.id),
    );
    if (this.#activePaletteId === existing.id) {
      this.#activePaletteId = DEFAULT_COLOR_PALETTE_ID;
    }
    return this.snapshot();
  }

  private requirePalette(paletteId: string): ColorPalette {
    if (typeof paletteId !== "string" || paletteId.trim().length === 0) {
      throw new TypeError("Palette ID must not be empty.");
    }
    const palette = this.#palettes.find(({ id }) => id === paletteId.trim());
    if (palette === undefined) throw new TypeError(`Palette '${paletteId}' is not registered.`);
    return palette;
  }
}

export function createEditorColorSystem(options: EditorColorSystemOptions = {}): EditorColorSystem {
  return new EditorColorSystemImplementation(options);
}

function canonicalHex(input: EditableColorInput | string): string {
  return createEditableColor(input).hex;
}
