import { createEditableColor, type EditableColor } from "@folio/document";
import {
  createBrushPreset,
  resolveBrushPreset,
  type BrushFamily,
  type BrushPreset,
  type BrushPressureCurve,
  type BrushRendererKind,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "@folio/ink";

export type DrawingToolKind = BrushFamily;
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

export const DEFAULT_BRUSH_PRESET_IDS: Readonly<Record<DrawingToolKind, string>> = Object.freeze({
  pencil: "pencil-hb",
  pen: "pen-fineliner",
  marker: "marker-felt",
  highlighter: "highlighter-default",
});

export const DEFAULT_BRUSH_PRESETS: readonly BrushPreset[] = Object.freeze([
  createCatalogPreset({
    id: "pencil-hb",
    name: "HB",
    family: "pencil",
    color: "#343434",
    size: 2,
    opacity: 0.78,
    smoothing: 0.2,
    pressureRange: [0.65, 1.25],
    renderer: "outline",
  }),
  createCatalogPreset({
    id: "pencil-2b",
    name: "2B",
    family: "pencil",
    color: "#343434",
    size: 3,
    opacity: 0.86,
    smoothing: 0.18,
    pressureRange: [0.55, 1.35],
    renderer: "outline",
  }),
  createCatalogPreset({
    id: "pencil-4b",
    name: "4B",
    family: "pencil",
    color: "#343434",
    size: 5,
    opacity: 0.9,
    smoothing: 0.16,
    pressureRange: [0.45, 1.5],
    renderer: "outline",
  }),
  createCatalogPreset({
    id: "pencil-mechanical",
    name: "Mechanical Pencil",
    family: "pencil",
    color: "#343434",
    size: 1.2,
    opacity: 0.85,
    smoothing: 0.12,
    renderer: "centerline",
  }),
  createCatalogPreset({
    id: "pen-fineliner",
    name: "Fineliner",
    family: "pen",
    color: "#111111",
    size: 2,
    opacity: 1,
    smoothing: 0.2,
    renderer: "centerline",
  }),
  // The one preset on the real brush engine. It resolves no pressure response,
  // so a constant width is what the snapshot says and not merely what the
  // strategy does. Every other preset stays on its frozen legacy strategy until
  // a phase gives it a real one.
  createCatalogPreset({
    id: "pen-technical",
    name: "Technical Pen",
    family: "pen",
    color: "#111111",
    size: 1.5,
    opacity: 1,
    smoothing: 0.3,
    renderer: "technical-pen",
  }),
  // The expressive pen, and the one preset on the pressure strategy. Its width
  // range is the one it already had, so the mark it makes is the mark it made;
  // what is new is that the opacity response the model has always carried is
  // finally evaluated. A light touch lays down less ink, which is the whole
  // reason the field exists. Strokes already saved keep naming outline@1 and
  // keep rendering as they were drawn.
  createCatalogPreset({
    id: "pen-brush",
    name: "Brush Pen",
    family: "pen",
    color: "#111111",
    size: 6,
    opacity: 1,
    smoothing: 0.18,
    pressureRange: [0.35, 1.65],
    opacityRange: [0.7, 1],
    opacityCurve: Object.freeze({ kind: "power", exponent: 0.55 }),
    renderer: "pressure-pen",
  }),
  createCatalogPreset({
    id: "marker-felt",
    name: "Felt Marker",
    family: "marker",
    color: "#1f2937",
    size: 8,
    opacity: 0.9,
    smoothing: 0.22,
    renderer: "centerline",
  }),
  createCatalogPreset({
    id: "marker-broad",
    name: "Broad Marker",
    family: "marker",
    color: "#1f2937",
    size: 16,
    opacity: 0.82,
    smoothing: 0.25,
    renderer: "centerline",
  }),
  createCatalogPreset({
    id: "highlighter-default",
    name: "Default Highlighter",
    family: "highlighter",
    color: "#facc15",
    size: 12,
    opacity: 0.34,
    smoothing: 0,
    renderer: "centerline",
  }),
]);

class BrushToolStateStoreImplementation implements BrushToolStateStore {
  readonly #presets: readonly BrushPreset[];
  #activeStates: Readonly<Record<DrawingToolKind, ActiveToolState>>;
  #version = 0;

  constructor(presets: readonly BrushPreset[]) {
    this.#presets = Object.freeze(presets.map(createBrushPreset));
    if (new Set(this.#presets.map(({ id }) => id)).size !== this.#presets.length) {
      throw new TypeError("Brush preset identities must be unique.");
    }
    const defaults = Object.fromEntries(
      (Object.keys(DEFAULT_BRUSH_PRESET_IDS) as DrawingToolKind[]).map((family) => {
        const preset = this.#presets.find(({ id }) => id === DEFAULT_BRUSH_PRESET_IDS[family]);
        const fallback = this.#presets.find((candidate) => candidate.family === family);
        const selected = preset?.family === family ? preset : fallback;
        if (selected === undefined) {
          throw new TypeError(`Brush presets require at least one ${family} definition.`);
        }
        return [family, createActiveState(selected)];
      }),
    ) as Record<DrawingToolKind, ActiveToolState>;
    this.#activeStates = Object.freeze(defaults);
  }

  snapshot(): BrushToolStateStoreSnapshot {
    return Object.freeze({
      presets: this.#presets,
      activeStates: this.#activeStates,
      activePresetIds: Object.freeze({
        pencil: this.#activeStates.pencil.presetId,
        pen: this.#activeStates.pen.presetId,
        marker: this.#activeStates.marker.presetId,
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
    const active = this.#activeStates[family];
    if (active.presetId === presetId) return this.snapshot();
    this.installState(family, createActiveState(preset, active.color));
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

interface CatalogPresetInput {
  readonly id: string;
  readonly name: string;
  readonly family: DrawingToolKind;
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
  readonly smoothing: number;
  readonly pressureRange?: readonly [number, number];
  readonly opacityRange?: readonly [number, number];
  readonly opacityCurve?: BrushPressureCurve;
  readonly renderer: BrushRendererKind;
}

function createCatalogPreset(input: CatalogPresetInput): BrushPreset {
  const pressureEnabled = input.pressureRange !== undefined;
  return createBrushPreset({
    id: input.id,
    version: 1,
    name: input.name,
    family: input.family,
    defaults: Object.freeze({
      color: input.color,
      size: input.size,
      opacity: input.opacity,
      smoothing: Object.freeze({
        mode: input.smoothing === 0 ? "none" : "average",
        amount: input.smoothing,
      }),
    }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: pressureEnabled,
        minimumFactor: input.pressureRange?.[0] ?? 1,
        maximumFactor: input.pressureRange?.[1] ?? 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
      pressureOpacity: Object.freeze({
        enabled: input.opacityRange !== undefined,
        minimumFactor: input.opacityRange?.[0] ?? 1,
        maximumFactor: input.opacityRange?.[1] ?? 1,
        curve: input.opacityCurve ?? Object.freeze({ kind: "linear", exponent: 1 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: input.renderer }),
  });
}

function createActiveState(preset: BrushPreset, retainedColor?: EditableColor): ActiveToolState {
  return freezeActiveState({
    family: preset.family,
    presetId: preset.id,
    color: createEditableColor({
      hex: retainedColor?.hex ?? preset.defaults.color,
      opacity: preset.defaults.opacity,
    }),
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
