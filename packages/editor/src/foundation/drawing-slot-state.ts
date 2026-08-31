import { createEditableColor, type EditableColor } from "@folio/document";
import { resolveBrushPreset, type BrushPreset, type BrushSmoothing } from "@folio/ink";
import {
  DEFAULT_BRUSH_PRESETS,
  DEFAULT_BRUSH_PRESET_IDS,
  type ActiveToolStatePatch,
  type DrawingToolKind,
  type ResolvedDrawingBrush,
} from "./pen-presets";

/**
 * Per-slot ownership of drawing configuration.
 *
 * The dock has always presented several independent drawing presets, but the
 * state behind them was keyed by brush *family*. Two slots sharing a family
 * therefore shared one cell of state, and the UI papered over it by re-pinning
 * a preset every time a slot was activated — so any choice the artist made was
 * silently discarded the next time they pressed that slot, and two slots of one
 * family fought over a single entry.
 *
 * This module is the missing ownership boundary: one state per slot, each
 * remembering its own brush identity and its own working values. Re-activating
 * a slot restores what that slot held rather than resetting it.
 *
 * Slots are described by the caller rather than enumerated here, so this stays
 * a state machine over presets and never learns what a dock looks like.
 *
 * Editor preference state throughout. Nothing here touches a Page, a Layer, an
 * ObjectCollection or History; the only thing that reaches the document is the
 * resolved snapshot frozen into a new Stroke, exactly as before.
 */

export interface DrawingSlotDescriptor {
  readonly id: string;
  readonly family: DrawingToolKind;
  /** Preset the slot starts on, or null to take the family's default. */
  readonly presetId: string | null;
  /**
   * Library identity the slot starts holding, or null when it holds none.
   *
   * Null is a real state rather than a gap to fill: a slot whose family has no
   * catalogue entries must report no identity rather than guess at one.
   */
  readonly brushId: string | null;
}

/** A library identity being assigned, resolved by the caller that owns the catalogue. */
export interface DrawingSlotBrushAssignment {
  readonly brushId: string;
  readonly family: DrawingToolKind;
  /** The real preset that renders this identity today. */
  readonly fallbackPresetId: string;
}

export interface DrawingSlotState {
  readonly slotId: string;
  readonly brushId: string | null;
  readonly presetId: string;
  readonly family: DrawingToolKind;
  readonly color: EditableColor;
  readonly size: number;
  readonly opacity: number;
  readonly smoothing: BrushSmoothing;
}

export interface DrawingSlotStoreSnapshot {
  readonly slots: Readonly<Record<string, DrawingSlotState>>;
  readonly version: number;
}

export interface DrawingSlotStore {
  readonly snapshot: () => DrawingSlotStoreSnapshot;
  readonly stateFor: (slotId: string) => DrawingSlotState;
  readonly resolvedBrush: (slotId: string) => ResolvedDrawingBrush;
  readonly presetsFor: (slotId: string) => readonly BrushPreset[];
  /**
   * Assigns a library identity, adopting the preset and family that back it.
   *
   * Any brush may go in any slot: the slot is a stable physical position that
   * owns preferences, and family is a property of whatever brush it holds.
   */
  readonly assignBrush: (
    slotId: string,
    assignment: DrawingSlotBrushAssignment,
  ) => DrawingSlotStoreSnapshot;
  /** Selects a raw preset, as the existing Tool Options list does. */
  readonly selectPreset: (slotId: string, presetId: string) => DrawingSlotStoreSnapshot;
  readonly updateProperties: (
    slotId: string,
    patch: ActiveToolStatePatch,
  ) => DrawingSlotStoreSnapshot;
}

class DrawingSlotStoreImplementation implements DrawingSlotStore {
  readonly #presets: readonly BrushPreset[];
  #slots: Readonly<Record<string, DrawingSlotState>>;
  #version = 0;

  constructor(descriptors: readonly DrawingSlotDescriptor[], presets: readonly BrushPreset[]) {
    if (descriptors.length === 0) throw new TypeError("At least one drawing slot is required.");
    if (new Set(descriptors.map(({ id }) => id)).size !== descriptors.length) {
      throw new TypeError("Drawing slot identities must be unique.");
    }
    this.#presets = presets;
    const initial: Record<string, DrawingSlotState> = {};
    for (const descriptor of descriptors) {
      // A slot starts on the preset it was already pinned to, so a fresh
      // session presents exactly the brushes the dock always presented.
      const presetId = descriptor.presetId ?? DEFAULT_BRUSH_PRESET_IDS[descriptor.family];
      const preset = this.#presetOrThrow(presetId, descriptor.family);
      initial[descriptor.id] = stateFromPreset(descriptor.id, preset, descriptor.brushId);
    }
    this.#slots = Object.freeze(initial);
  }

  snapshot(): DrawingSlotStoreSnapshot {
    return Object.freeze({ slots: this.#slots, version: this.#version });
  }

  stateFor(slotId: string): DrawingSlotState {
    const state = this.#slots[slotId];
    if (state === undefined) throw new TypeError(`Drawing slot '${slotId}' is not registered.`);
    return state;
  }

  resolvedBrush(slotId: string): ResolvedDrawingBrush {
    const state = this.stateFor(slotId);
    return resolveBrushPreset(this.#presetOrThrow(state.presetId, state.family), {
      color: state.color.hex,
      size: state.size,
      opacity: state.opacity,
      smoothing: state.smoothing,
    });
  }

  presetsFor(slotId: string): readonly BrushPreset[] {
    const family = this.stateFor(slotId).family;
    return Object.freeze(this.#presets.filter((preset) => preset.family === family));
  }

  assignBrush(slotId: string, assignment: DrawingSlotBrushAssignment): DrawingSlotStoreSnapshot {
    const state = this.stateFor(slotId);
    // A slot is a position, not a tool. Any brush may be assigned to any slot,
    // and the slot's family, backing preset and resolved properties all follow
    // the brush that was chosen — the slot identity itself never moves.
    const preset = this.#presetOrThrow(assignment.fallbackPresetId, assignment.family);
    if (state.brushId === assignment.brushId && state.presetId === preset.id) {
      return this.snapshot();
    }
    // Adopting the preset's own defaults is the established behaviour of
    // `selectPreset`: choosing a different brush is choosing its character, not
    // keeping the previous brush's numbers under a new name. Colour is the
    // documented exception and is carried across.
    this.#install(slotId, stateFromPreset(slotId, preset, assignment.brushId, state.color));
    return this.snapshot();
  }

  selectPreset(slotId: string, presetId: string): DrawingSlotStoreSnapshot {
    const state = this.stateFor(slotId);
    // Tool Options offers only the current family's presets, so this stays a
    // same-family change; a cross-family move comes from the library instead.
    const preset = this.#presetOrThrow(presetId, state.family);
    if (state.presetId === presetId) return this.snapshot();
    // Reached from the Tool Options preset list, which knows nothing of library
    // identities. The slot stops claiming an identity its preset no longer
    // backs rather than displaying a stale one.
    this.#install(slotId, stateFromPreset(slotId, preset, null, state.color));
    return this.snapshot();
  }

  updateProperties(slotId: string, patch: ActiveToolStatePatch): DrawingSlotStoreSnapshot {
    const state = this.stateFor(slotId);
    const opacity = patch.opacity ?? state.opacity;
    const color = createEditableColor({
      ...(typeof patch.color === "string"
        ? { hex: patch.color }
        : patch.color === undefined
          ? { hex: state.color.hex, rgb: state.color.rgb }
          : { hex: patch.color.hex, rgb: patch.color.rgb }),
      opacity,
    });
    const replacement = freezeSlotState({
      ...state,
      color,
      size: patch.size ?? patch.strokeWidth ?? state.size,
      opacity,
      smoothing: patch.smoothing ?? state.smoothing,
    });
    if (slotStatesEqual(state, replacement)) return this.snapshot();
    this.#install(slotId, replacement);
    return this.snapshot();
  }

  #presetOrThrow(presetId: string, family: DrawingToolKind): BrushPreset {
    const preset = this.#presets.find(({ id }) => id === presetId);
    if (preset === undefined || preset.family !== family) {
      throw new TypeError(`Preset '${presetId}' is not registered for ${family}.`);
    }
    return preset;
  }

  #install(slotId: string, state: DrawingSlotState): void {
    // Only the named slot is replaced. This is the whole point of the layer:
    // every other slot is the same frozen object it was a moment ago.
    this.#slots = Object.freeze({ ...this.#slots, [slotId]: state });
    this.#version += 1;
  }
}

export function createDrawingSlotStore(
  descriptors: readonly DrawingSlotDescriptor[],
  presets: readonly BrushPreset[] = DEFAULT_BRUSH_PRESETS,
): DrawingSlotStore {
  return new DrawingSlotStoreImplementation(descriptors, presets);
}

function stateFromPreset(
  slotId: string,
  preset: BrushPreset,
  brushId: string | null,
  retainedColor?: EditableColor,
): DrawingSlotState {
  return freezeSlotState({
    slotId,
    brushId,
    presetId: preset.id,
    family: preset.family,
    color: createEditableColor({
      hex: retainedColor?.hex ?? preset.defaults.color,
      opacity: preset.defaults.opacity,
    }),
    size: preset.defaults.size,
    opacity: preset.defaults.opacity,
    smoothing: preset.defaults.smoothing,
  });
}

function freezeSlotState(state: DrawingSlotState): DrawingSlotState {
  if (!Number.isFinite(state.size) || state.size <= 0) {
    throw new RangeError("Drawing slot size must be positive.");
  }
  if (!Number.isFinite(state.opacity) || state.opacity < 0 || state.opacity > 1) {
    throw new RangeError("Drawing slot opacity must be between zero and one.");
  }
  if (
    !Number.isFinite(state.smoothing.amount) ||
    state.smoothing.amount < 0 ||
    state.smoothing.amount > 1
  ) {
    throw new RangeError("Drawing slot smoothing amount must be between zero and one.");
  }
  return Object.freeze({
    slotId: state.slotId,
    brushId: state.brushId,
    presetId: state.presetId,
    family: state.family,
    color: createEditableColor(state.color),
    size: state.size,
    opacity: state.opacity,
    smoothing: Object.freeze({ mode: state.smoothing.mode, amount: state.smoothing.amount }),
  });
}

function slotStatesEqual(left: DrawingSlotState, right: DrawingSlotState): boolean {
  return (
    left.brushId === right.brushId &&
    left.presetId === right.presetId &&
    left.color.hex === right.color.hex &&
    left.size === right.size &&
    left.opacity === right.opacity &&
    left.smoothing.mode === right.smoothing.mode &&
    left.smoothing.amount === right.smoothing.amount
  );
}
