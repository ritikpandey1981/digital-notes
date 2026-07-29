import {
  createEditableColor,
  createEditableStyle,
  type EditableColor,
  type EditableStyle,
} from "@folio/document";

export type DrawingToolKind = "pen" | "highlighter";
export type BrushType = "round";

export interface PenPressureSettings {
  readonly enabled: boolean;
}

export interface PenPreset {
  readonly id: string;
  readonly name: string;
  readonly kind: DrawingToolKind;
  readonly style: EditableStyle;
  readonly pressure: PenPressureSettings;
  readonly brushType: BrushType;
}

export interface PenPresetPatch {
  readonly color?: EditableColor | string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly pressureEnabled?: boolean;
}

export interface PenPresetStoreSnapshot {
  readonly presets: readonly PenPreset[];
  readonly activePresetIds: Readonly<Record<DrawingToolKind, string>>;
  readonly version: number;
}

export interface PenPresetStore {
  readonly snapshot: () => PenPresetStoreSnapshot;
  readonly presetsFor: (kind: DrawingToolKind) => readonly PenPreset[];
  readonly activePreset: (kind: DrawingToolKind) => PenPreset;
  readonly selectPreset: (kind: DrawingToolKind, presetId: string) => PenPresetStoreSnapshot;
  readonly updateActivePreset: (
    kind: DrawingToolKind,
    patch: PenPresetPatch,
  ) => PenPresetStoreSnapshot;
}

export const EDITOR_STROKE_WIDTHS: readonly number[] = Object.freeze([1, 2, 4, 6, 8, 12, 16]);

export const DEFAULT_PEN_PRESETS: readonly PenPreset[] = Object.freeze([
  createPreset("pen-black", "Black", "pen", "#111111", 2, 1, true),
  createPreset("pen-blue", "Blue", "pen", "#2563eb", 4, 1, true),
  createPreset("pen-red", "Red", "pen", "#dc2626", 6, 1, true),
  createPreset("highlighter-yellow", "Yellow", "highlighter", "#facc15", 12, 0.34, false),
  createPreset("highlighter-green", "Green", "highlighter", "#4ade80", 12, 0.3, false),
  createPreset("highlighter-pink", "Pink", "highlighter", "#f472b6", 16, 0.3, false),
]);

class PenPresetStoreImplementation implements PenPresetStore {
  #presets: readonly PenPreset[];
  #activePresetIds: Readonly<Record<DrawingToolKind, string>>;
  #version = 0;

  constructor(presets: readonly PenPreset[]) {
    this.#presets = Object.freeze(presets.map(freezePreset));
    const pen = this.#presets.find(({ kind }) => kind === "pen");
    const highlighter = this.#presets.find(({ kind }) => kind === "highlighter");
    if (pen === undefined || highlighter === undefined) {
      throw new TypeError("Pen presets require at least one pen and one highlighter.");
    }
    if (new Set(this.#presets.map(({ id }) => id)).size !== this.#presets.length) {
      throw new TypeError("Pen preset identities must be unique.");
    }
    this.#activePresetIds = Object.freeze({ pen: pen.id, highlighter: highlighter.id });
  }

  snapshot(): PenPresetStoreSnapshot {
    return Object.freeze({
      presets: this.#presets,
      activePresetIds: this.#activePresetIds,
      version: this.#version,
    });
  }

  presetsFor(kind: DrawingToolKind): readonly PenPreset[] {
    return Object.freeze(this.#presets.filter((preset) => preset.kind === kind));
  }

  activePreset(kind: DrawingToolKind): PenPreset {
    const preset = this.#presets.find(({ id }) => id === this.#activePresetIds[kind]);
    if (preset === undefined) throw new Error("Active " + kind + " preset is unavailable.");
    return preset;
  }

  selectPreset(kind: DrawingToolKind, presetId: string): PenPresetStoreSnapshot {
    const preset = this.#presets.find(({ id }) => id === presetId);
    if (preset === undefined || preset.kind !== kind) {
      throw new TypeError("Preset '" + presetId + "' is not registered for " + kind + ".");
    }
    if (this.#activePresetIds[kind] === presetId) return this.snapshot();
    this.#activePresetIds = Object.freeze({ ...this.#activePresetIds, [kind]: presetId });
    this.#version += 1;
    return this.snapshot();
  }

  updateActivePreset(kind: DrawingToolKind, patch: PenPresetPatch): PenPresetStoreSnapshot {
    const active = this.activePreset(kind);
    const opacity = patch.opacity ?? active.style.strokeColor.opacity;
    const color = createEditableColor({
      ...(typeof patch.color === "string"
        ? { hex: patch.color }
        : patch.color === undefined
          ? { hex: active.style.strokeColor.hex }
          : { hex: patch.color.hex, rgb: patch.color.rgb }),
      opacity,
    });
    const replacement = freezePreset({
      ...active,
      style: createEditableStyle({
        ...active.style,
        strokeColor: color,
        strokeWidth: patch.strokeWidth ?? active.style.strokeWidth,
      }),
      pressure: Object.freeze({ enabled: patch.pressureEnabled ?? active.pressure.enabled }),
    });
    this.#presets = Object.freeze(
      this.#presets.map((preset) => (preset.id === replacement.id ? replacement : preset)),
    );
    this.#version += 1;
    return this.snapshot();
  }
}

export function createPenPresetStore(
  presets: readonly PenPreset[] = DEFAULT_PEN_PRESETS,
): PenPresetStore {
  return new PenPresetStoreImplementation(presets);
}

function createPreset(
  id: string,
  name: string,
  kind: DrawingToolKind,
  color: string,
  strokeWidth: number,
  opacity: number,
  pressureEnabled: boolean,
): PenPreset {
  return freezePreset({
    id,
    name,
    kind,
    style: createEditableStyle({
      strokeColor: createEditableColor({ hex: color, opacity }),
      strokeWidth,
      blendMode: kind === "highlighter" ? "multiply" : "normal",
    }),
    pressure: Object.freeze({ enabled: pressureEnabled }),
    brushType: "round",
  });
}

function freezePreset(preset: PenPreset): PenPreset {
  if (preset.id.trim().length === 0 || preset.name.trim().length === 0) {
    throw new TypeError("Pen presets require an identity and display name.");
  }
  return Object.freeze({
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    style: createEditableStyle(preset.style),
    pressure: Object.freeze({ enabled: preset.pressure.enabled }),
    brushType: preset.brushType,
  });
}
