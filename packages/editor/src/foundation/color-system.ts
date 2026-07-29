import { createEditableColor, type EditableColor, type EditableColorInput } from "@folio/document";

export const EDITOR_PRESET_COLORS: readonly EditableColor[] = Object.freeze(
  [
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
  ].map((hex) => createEditableColor(hex)),
);

export interface EditorColorSystemSnapshot {
  readonly presetColors: readonly EditableColor[];
  readonly recentColors: readonly EditableColor[];
}

export interface EditorColorSystem {
  readonly snapshot: () => EditorColorSystemSnapshot;
  readonly createColor: (input: EditableColorInput | string) => EditableColor;
  readonly remember: (color: EditableColor) => EditorColorSystemSnapshot;
  readonly clearRecent: () => EditorColorSystemSnapshot;
}

export interface EditorColorSystemOptions {
  readonly presetColors?: readonly (EditableColorInput | string)[];
  readonly recentLimit?: number;
}

class EditorColorSystemImplementation implements EditorColorSystem {
  readonly #presetColors: readonly EditableColor[];
  readonly #recentLimit: number;
  #recentColors: readonly EditableColor[] = Object.freeze([]);

  constructor(options: EditorColorSystemOptions) {
    const recentLimit = options.recentLimit ?? 8;
    if (!Number.isSafeInteger(recentLimit) || recentLimit < 1) {
      throw new RangeError("Recent color limit must be a positive safe integer.");
    }
    this.#recentLimit = recentLimit;
    this.#presetColors = Object.freeze(
      (options.presetColors ?? EDITOR_PRESET_COLORS).map((color) => createEditableColor(color)),
    );
  }

  snapshot(): EditorColorSystemSnapshot {
    return Object.freeze({ presetColors: this.#presetColors, recentColors: this.#recentColors });
  }

  createColor(input: EditableColorInput | string): EditableColor {
    return createEditableColor(input);
  }

  remember(color: EditableColor): EditorColorSystemSnapshot {
    const immutableColor = createEditableColor(color);
    this.#recentColors = Object.freeze(
      [
        immutableColor,
        ...this.#recentColors.filter(
          (candidate) =>
            candidate.hex !== immutableColor.hex || candidate.opacity !== immutableColor.opacity,
        ),
      ].slice(0, this.#recentLimit),
    );
    return this.snapshot();
  }

  clearRecent(): EditorColorSystemSnapshot {
    this.#recentColors = Object.freeze([]);
    return this.snapshot();
  }
}

export function createEditorColorSystem(options: EditorColorSystemOptions = {}): EditorColorSystem {
  return new EditorColorSystemImplementation(options);
}
