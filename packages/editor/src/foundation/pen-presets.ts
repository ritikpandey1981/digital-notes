import { createEditableColor, type EditableColor } from "@folio/document";
import {
  createBrushPreset,
  resolveBrushPreset,
  type BrushFamily,
  type BrushPreset,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "@folio/ink";

export type DrawingToolKind = Extract<BrushFamily, "pen" | "highlighter">;
export type ResolvedDrawingBrush = ResolvedBrushSnapshot;

export interface ActiveToolState {
  readonly family: DrawingToolKind;
  readonly presetId: string;
  readonly color: EditableColor;
  readonly size: number;
  readonly opacity: number;
  readonly smoothing: BrushSmoothing;
}

export interface ActiveToolStatePatch {
  readonly color?: EditableColor | string;
  readonly size?: number;
  /** Compatibility spelling for the pre-17A public editor boundary. */
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly smoothing?: BrushSmoothing;
}

export interface BrushToolStateStoreSnapshot {
  readonly presets: readonly BrushPreset[];
  readonly activeStates: Readonly<Record<DrawingToolKind, ActiveToolState>>;
  /** Compatibility projection for consumers that only need preset selection identity. */
  readonly activePresetIds: Readonly<Record<DrawingToolKind, string>>;
  readonly version: number;
}

export interface BrushToolStateStore {
  readonly snapshot: () => BrushToolStateStoreSnapshot;
  readonly presetsFor: (family: DrawingToolKind) => readonly BrushPreset[];
  readonly activePreset: (family: DrawingToolKind) => BrushPreset;
  readonly activeState: (family: DrawingToolKind) => ActiveToolState;
  readonly resolvedBrush: (family: DrawingToolKind) => ResolvedBrushSnapshot;
  readonly selectPreset: (family: DrawingToolKind, presetId: string) => BrushToolStateStoreSnapshot;
  readonly updateActiveToolState: (
    family: DrawingToolKind,
    patch: ActiveToolStatePatch,
  ) => BrushToolStateStoreSnapshot;
  /** Compatibility adapter; updates ActiveToolState and never mutates a preset definition. */
  readonly updateActivePreset: (
    family: DrawingToolKind,
    patch: ActiveToolStatePatch,
  ) => BrushToolStateStoreSnapshot;
}

export const EDITOR_STROKE_WIDTHS: readonly number[] = Object.freeze([1, 2, 4, 6, 8, 12, 16]);

export const DEFAULT_BRUSH_PRESETS: readonly BrushPreset[] = Object.freeze([
  createCurrentPreset("pen-black", "Black", "pen", "#111111", 2, 1, true),
  createCurrentPreset("pen-blue", "Blue", "pen", "#2563eb", 4, 1, true),
  createCurrentPreset("pen-red", "Red", "pen", "#dc2626", 6, 1, true),
  createCurrentPreset("highlighter-yellow", "Yellow", "highlighter", "#facc15", 12, 0.34, false),
  createCurrentPreset("highlighter-green", "Green", "highlighter", "#4ade80", 12, 0.3, false),
  createCurrentPreset("highlighter-pink", "Pink", "highlighter", "#f472b6", 16, 0.3, false),
]);

class BrushToolStateStoreImplementation implements BrushToolStateStore {
  readonly #presets: readonly BrushPreset[];
  #activeStates: Readonly<Record<DrawingToolKind, ActiveToolState>>;
  #version = 0;

  constructor(presets: readonly BrushPreset[]) {
    this.#presets = Object.freeze(presets.map(createBrushPreset));
    const pen = this.#presets.find(({ family }) => family === "pen");
    const highlighter = this.#presets.find(({ family }) => family === "highlighter");
    if (pen === undefined || highlighter === undefined) {
      throw new TypeError("Brush presets require at least one pen and one highlighter.");
    }
    if (new Set(this.#presets.map(({ id }) => id)).size !== this.#presets.length) {
      throw new TypeError("Brush preset identities must be unique.");
    }
    this.#activeStates = Object.freeze({
      pen: createActiveState(pen),
      highlighter: createActiveState(highlighter),
    });
  }

  snapshot(): BrushToolStateStoreSnapshot {
    return Object.freeze({
      presets: this.#presets,
      activeStates: this.#activeStates,
      activePresetIds: Object.freeze({
        pen: this.#activeStates.pen.presetId,
        highlighter: this.#activeStates.highlighter.presetId,
      }),
      version: this.#version,
    });
  }

  presetsFor(family: DrawingToolKind): readonly BrushPreset[] {
    return Object.freeze(this.#presets.filter((preset) => preset.family === family));
  }

  activePreset(family: DrawingToolKind): BrushPreset {
    const state = this.activeState(family);
    const preset = this.#presets.find(({ id }) => id === state.presetId);
    if (preset === undefined || preset.family !== family) {
      throw new Error(`Active ${family} preset is unavailable.`);
    }
    return preset;
  }

  activeState(family: DrawingToolKind): ActiveToolState {
    return this.#activeStates[family];
  }

  resolvedBrush(family: DrawingToolKind): ResolvedBrushSnapshot {
    const state = this.activeState(family);
    return resolveBrushPreset(this.activePreset(family), {
      color: state.color.hex,
      size: state.size,
      opacity: state.opacity,
      smoothing: state.smoothing,
    });
  }

  selectPreset(family: DrawingToolKind, presetId: string): BrushToolStateStoreSnapshot {
    const preset = this.#presets.find(({ id }) => id === presetId);
    if (preset === undefined || preset.family !== family) {
      throw new TypeError(`Preset '${presetId}' is not registered for ${family}.`);
    }
    if (this.#activeStates[family].presetId === presetId) return this.snapshot();
    this.installState(family, createActiveState(preset));
    return this.snapshot();
  }

  updateActiveToolState(
    family: DrawingToolKind,
    patch: ActiveToolStatePatch,
  ): BrushToolStateStoreSnapshot {
    const active = this.activeState(family);
    const size = patch.size ?? patch.strokeWidth ?? active.size;
    const opacity = patch.opacity ?? active.opacity;
    const color = createEditableColor({
      ...(typeof patch.color === "string"
        ? { hex: patch.color }
        : patch.color === undefined
          ? { hex: active.color.hex, rgb: active.color.rgb }
          : { hex: patch.color.hex, rgb: patch.color.rgb }),
      opacity,
    });
    const replacement = freezeActiveState({
      family,
      presetId: active.presetId,
      color,
      size,
      opacity,
      smoothing: patch.smoothing ?? active.smoothing,
    });
    if (activeStatesEqual(active, replacement)) return this.snapshot();
    this.installState(family, replacement);
    return this.snapshot();
  }

  updateActivePreset(
    family: DrawingToolKind,
    patch: ActiveToolStatePatch,
  ): BrushToolStateStoreSnapshot {
    return this.updateActiveToolState(family, patch);
  }

  private installState(family: DrawingToolKind, state: ActiveToolState): void {
    this.#activeStates = Object.freeze({ ...this.#activeStates, [family]: state });
    this.#version += 1;
  }
}

export function createBrushToolStateStore(
  presets: readonly BrushPreset[] = DEFAULT_BRUSH_PRESETS,
): BrushToolStateStore {
  return new BrushToolStateStoreImplementation(presets);
}

function createCurrentPreset(
  id: string,
  name: string,
  family: DrawingToolKind,
  color: string,
  size: number,
  opacity: number,
  pressureEnabled: boolean,
): BrushPreset {
  return createBrushPreset({
    id,
    version: 1,
    name,
    family,
    defaults: Object.freeze({
      color,
      size,
      opacity,
      smoothing: Object.freeze({ mode: "none", amount: 0 }),
    }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: pressureEnabled,
        minimumFactor: pressureEnabled ? 0.5 : 1,
        maximumFactor: pressureEnabled ? 1.5 : 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "centerline" }),
  });
}

function createActiveState(preset: BrushPreset): ActiveToolState {
  if (preset.family !== "pen" && preset.family !== "highlighter") {
    throw new TypeError("Only implemented drawing families can have active editor state.");
  }
  return freezeActiveState({
    family: preset.family,
    presetId: preset.id,
    color: createEditableColor({ hex: preset.defaults.color, opacity: preset.defaults.opacity }),
    size: preset.defaults.size,
    opacity: preset.defaults.opacity,
    smoothing: preset.defaults.smoothing,
  });
}

function freezeActiveState(state: ActiveToolState): ActiveToolState {
  if (!Number.isFinite(state.size) || state.size <= 0) {
    throw new RangeError("Active brush size must be positive.");
  }
  if (!Number.isFinite(state.opacity) || state.opacity < 0 || state.opacity > 1) {
    throw new RangeError("Active brush opacity must be between zero and one.");
  }
  if (
    state.smoothing.mode !== "none" &&
    state.smoothing.mode !== "average" &&
    state.smoothing.mode !== "catmull-rom" &&
    state.smoothing.mode !== "bezier"
  ) {
    throw new TypeError("Active brush smoothing mode is invalid.");
  }
  if (
    !Number.isFinite(state.smoothing.amount) ||
    state.smoothing.amount < 0 ||
    state.smoothing.amount > 1
  ) {
    throw new RangeError("Active brush smoothing amount must be between zero and one.");
  }
  const smoothing = Object.freeze({ mode: state.smoothing.mode, amount: state.smoothing.amount });
  return Object.freeze({
    family: state.family,
    presetId: state.presetId,
    color: createEditableColor(state.color),
    size: state.size,
    opacity: state.opacity,
    smoothing,
  });
}

function activeStatesEqual(left: ActiveToolState, right: ActiveToolState): boolean {
  return (
    left.family === right.family &&
    left.presetId === right.presetId &&
    left.color.hex === right.color.hex &&
    left.opacity === right.opacity &&
    left.size === right.size &&
    left.smoothing.mode === right.smoothing.mode &&
    left.smoothing.amount === right.smoothing.amount
  );
}

// Phase 17A compatibility names. These aliases point at the single brush catalog/state system.
export type PenPreset = BrushPreset;
export type PenPresetPatch = ActiveToolStatePatch;
export type PenPresetStore = BrushToolStateStore;
export type PenPresetStoreSnapshot = BrushToolStateStoreSnapshot;
export const DEFAULT_PEN_PRESETS = DEFAULT_BRUSH_PRESETS;
export const createPenPresetStore = createBrushToolStateStore;
