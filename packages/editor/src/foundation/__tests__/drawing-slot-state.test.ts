import { describe, expect, it } from "vitest";
import { createDrawingSlotStore, type DrawingSlotDescriptor } from "../drawing-slot-state";
import { DEFAULT_BRUSH_PRESETS } from "../pen-presets";

/** The five dock slots, described exactly as the desktop app describes them. */
const SLOTS: readonly DrawingSlotDescriptor[] = Object.freeze([
  { id: "pencil", family: "pencil", presetId: null, brushId: "hb-pencil" },
  { id: "pen", family: "pen", presetId: "pen-fineliner", brushId: "fineliner" },
  { id: "brush-pen", family: "pen", presetId: "pen-brush", brushId: "brush-pen-soft" },
  { id: "marker", family: "marker", presetId: null, brushId: "felt-marker" },
  { id: "highlighter", family: "highlighter", presetId: null, brushId: null },
]);

const GEL_PEN = Object.freeze({
  brushId: "gel-pen",
  family: "pen" as const,
  fallbackPresetId: "pen-fineliner",
});
const TECHNICAL = Object.freeze({
  brushId: "technical-pen",
  family: "pen" as const,
  fallbackPresetId: "pen-technical",
});

function store() {
  return createDrawingSlotStore(SLOTS);
}

describe("slot independence", () => {
  it("gives every slot its own state", () => {
    const slots = store().snapshot().slots;
    expect(Object.keys(slots).sort()).toEqual(
      ["brush-pen", "highlighter", "marker", "pen", "pencil"].sort(),
    );
    for (const slot of SLOTS) {
      expect(slots[slot.id]!.slotId).toBe(slot.id);
      expect(slots[slot.id]!.brushId).toBe(slot.brushId);
    }
  });

  it("separates two slots that share one brush family", () => {
    // The case the old family-keyed store could not express: Pen and Brush Pen
    // are both `pen`, and used to share a single cell of state.
    const state = store();
    expect(state.stateFor("pen").presetId).toBe("pen-fineliner");
    expect(state.stateFor("brush-pen").presetId).toBe("pen-brush");
    expect(state.stateFor("pen").size).not.toBe(state.stateFor("brush-pen").size);
  });

  it("changes only the named slot", () => {
    const state = store();
    const before = state.snapshot().slots;
    state.assignBrush("pen", TECHNICAL);
    const after = state.snapshot().slots;
    expect(after.pen).not.toBe(before.pen);
    // Every other slot is the identical frozen object it was before.
    for (const id of ["pencil", "brush-pen", "marker", "highlighter"]) {
      expect(after[id], `${id} untouched`).toBe(before[id]);
    }
  });

  it("remembers each slot's assignment independently", () => {
    const state = store();
    state.assignBrush("pen", TECHNICAL);
    state.assignBrush("brush-pen", GEL_PEN);
    expect(state.stateFor("pen").brushId).toBe("technical-pen");
    expect(state.stateFor("brush-pen").brushId).toBe("gel-pen");
    expect(state.stateFor("pencil").brushId).toBe("hb-pencil");
  });

  it("keeps an assignment across any number of reads", () => {
    // Activation used to re-pin a family default and silently discard the
    // choice. There is nothing to re-pin now: reading a slot cannot change it.
    const state = store();
    state.assignBrush("pen", TECHNICAL);
    for (let read = 0; read < 5; read += 1) {
      state.stateFor("brush-pen");
      state.resolvedBrush("pencil");
      state.stateFor("pen");
    }
    expect(state.stateFor("pen").brushId).toBe("technical-pen");
    expect(state.stateFor("pen").presetId).toBe("pen-technical");
  });

  it("keeps per-slot property edits separate", () => {
    const state = store();
    state.updateProperties("pen", { size: 9 });
    expect(state.stateFor("pen").size).toBe(9);
    expect(state.stateFor("brush-pen").size).toBe(6);
    expect(state.stateFor("pencil").size).toBe(2);
  });
});

describe("assignment semantics", () => {
  it("records the identity, not merely the preset", () => {
    const state = store();
    state.assignBrush("pen", GEL_PEN);
    // Gel Pen and Fineliner share a backing preset today. The slot still knows
    // which brush the artist chose, so a later engine phase can give Gel Pen
    // its own behaviour without any slot losing its identity.
    expect(state.stateFor("pen").brushId).toBe("gel-pen");
    expect(state.stateFor("pen").presetId).toBe("pen-fineliner");
  });

  it("adopts the backing preset's defaults for width, opacity and smoothing", () => {
    const state = store();
    state.updateProperties("pen", { size: 20, opacity: 0.3 });
    state.assignBrush("pen", TECHNICAL);
    const technical = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === "pen-technical")!;
    expect(state.stateFor("pen").size).toBe(technical.defaults.size);
    expect(state.stateFor("pen").opacity).toBe(technical.defaults.opacity);
    expect(state.stateFor("pen").smoothing).toEqual(technical.defaults.smoothing);
  });

  it("carries the slot's colour across a reassignment", () => {
    const state = store();
    state.updateProperties("pen", { color: "#2244ff" });
    state.assignBrush("pen", TECHNICAL);
    expect(state.stateFor("pen").color.hex).toBe("#2244ff");
  });

  it("accepts a brush from any family, because a slot is a position", () => {
    // A slot is a stable physical position that owns preferences; family is a
    // property of whatever brush it happens to hold. Assigning a pen to the
    // pencil slot is ordinary, not an error.
    const state = store();
    state.assignBrush("pencil", GEL_PEN);
    expect(state.stateFor("pencil").brushId).toBe("gel-pen");
    expect(state.stateFor("pencil").family).toBe("pen");
    expect(state.stateFor("pencil").presetId).toBe("pen-fineliner");
    expect(state.stateFor("pencil").slotId, "the slot itself never moves").toBe("pencil");
  });

  it("lets every slot take every family", () => {
    const families = [
      { brushId: "hb-pencil", family: "pencil" as const, fallbackPresetId: "pencil-hb" },
      { brushId: "gel-pen", family: "pen" as const, fallbackPresetId: "pen-fineliner" },
      { brushId: "broad-marker", family: "marker" as const, fallbackPresetId: "marker-broad" },
    ];
    for (const slot of SLOTS) {
      for (const assignment of families) {
        const state = store();
        state.assignBrush(slot.id, assignment);
        expect(state.stateFor(slot.id).family, `${slot.id} <- ${assignment.family}`).toBe(
          assignment.family,
        );
        expect(state.stateFor(slot.id).brushId).toBe(assignment.brushId);
        expect(state.stateFor(slot.id).presetId).toBe(assignment.fallbackPresetId);
      }
    }
  });

  it("gives the fifth slot the same freedom as the rest", () => {
    // It started as the Highlighter, whose family has no catalogue entries.
    // That must not leave it a dead slot.
    const state = store();
    expect(state.stateFor("highlighter").brushId).toBeNull();
    state.assignBrush("highlighter", {
      brushId: "broad-marker",
      family: "marker",
      fallbackPresetId: "marker-broad",
    });
    expect(state.stateFor("highlighter").family).toBe("marker");
    state.assignBrush("highlighter", {
      brushId: "hb-pencil",
      family: "pencil",
      fallbackPresetId: "pencil-hb",
    });
    expect(state.stateFor("highlighter").family).toBe("pencil");
    expect(state.stateFor("highlighter").presetId).toBe("pencil-hb");
  });

  it("keeps a cross-family reassignment to the one slot", () => {
    const state = store();
    const before = state.snapshot().slots;
    state.assignBrush("pen", {
      brushId: "broad-marker",
      family: "marker",
      fallbackPresetId: "marker-broad",
    });
    for (const id of ["pencil", "brush-pen", "marker", "highlighter"]) {
      expect(state.snapshot().slots[id], `${id} untouched`).toBe(before[id]);
    }
    expect(state.stateFor("pen").family).toBe("marker");
  });

  it("adopts the new family's preset defaults and keeps the colour", () => {
    const state = store();
    state.updateProperties("pen", { color: "#2244ff", size: 20 });
    state.assignBrush("pen", {
      brushId: "broad-marker",
      family: "marker",
      fallbackPresetId: "marker-broad",
    });
    const broad = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === "marker-broad")!;
    expect(state.stateFor("pen").size).toBe(broad.defaults.size);
    expect(state.stateFor("pen").opacity).toBe(broad.defaults.opacity);
    expect(state.stateFor("pen").smoothing).toEqual(broad.defaults.smoothing);
    expect(state.stateFor("pen").color.hex, "colour is carried across").toBe("#2244ff");
  });

  it("offers the new family's presets after a cross-family move", () => {
    const state = store();
    state.assignBrush("pen", {
      brushId: "broad-marker",
      family: "marker",
      fallbackPresetId: "marker-broad",
    });
    for (const preset of state.presetsFor("pen")) expect(preset.family).toBe("marker");
  });

  it("resolves a cross-family slot to the new backing", () => {
    const state = store();
    state.assignBrush("pencil", {
      brushId: "broad-marker",
      family: "marker",
      fallbackPresetId: "marker-broad",
    });
    const brush = state.resolvedBrush("pencil");
    expect(brush.presetId).toBe("marker-broad");
    expect(brush.family).toBe("marker");
  });

  it("refuses a preset the engine does not have", () => {
    const state = store();
    expect(() =>
      state.assignBrush("pen", { brushId: "x", family: "pen", fallbackPresetId: "pen-imaginary" }),
    ).toThrow(/not registered/u);
  });

  it("drops the identity when a raw preset is chosen instead", () => {
    // Tool Options knows nothing of library identities, so a slot stops
    // claiming one its preset no longer backs rather than showing a stale name.
    const state = store();
    state.selectPreset("pen", "pen-technical");
    expect(state.stateFor("pen").brushId).toBeNull();
    expect(state.stateFor("pen").presetId).toBe("pen-technical");
  });

  it("is a no-op when the same identity is assigned again", () => {
    const state = store();
    const version = state.snapshot().version;
    state.assignBrush("pen", {
      brushId: "fineliner",
      family: "pen",
      fallbackPresetId: "pen-fineliner",
    });
    expect(state.snapshot().version).toBe(version);
  });
});

describe("resolution", () => {
  it("resolves a slot to a real brush snapshot", () => {
    const brush = store().resolvedBrush("pen");
    expect(brush.presetId).toBe("pen-fineliner");
    expect(brush.family).toBe("pen");
    expect(Number.isFinite(brush.size)).toBe(true);
    expect(brush.opacity).toBeGreaterThan(0);
    expect(brush.opacity).toBeLessThanOrEqual(1);
  });

  it("reflects an assignment in what the next stroke would use", () => {
    const state = store();
    const before = state.resolvedBrush("pen");
    state.assignBrush("pen", TECHNICAL);
    const after = state.resolvedBrush("pen");
    expect(after.presetId).toBe("pen-technical");
    expect(after.size).not.toBe(before.size);
  });

  it("offers only the active slot's family in its preset list", () => {
    for (const slot of SLOTS) {
      for (const preset of store().presetsFor(slot.id)) {
        expect(preset.family).toBe(slot.family);
      }
    }
  });

  it("rejects an unregistered slot rather than inventing one", () => {
    expect(() => store().stateFor("nope")).toThrow(/not registered/u);
  });

  it("never produces an invalid slot state", () => {
    const state = store();
    expect(() => state.updateProperties("pen", { size: 0 })).toThrow();
    expect(() => state.updateProperties("pen", { size: Number.NaN })).toThrow();
    expect(() => state.updateProperties("pen", { opacity: 2 })).toThrow();
    for (const slot of SLOTS) {
      const current = state.stateFor(slot.id);
      expect(Number.isFinite(current.size)).toBe(true);
      expect(current.size).toBeGreaterThan(0);
      expect(current.opacity).toBeGreaterThanOrEqual(0);
      expect(current.opacity).toBeLessThanOrEqual(1);
      expect(Object.isFrozen(current)).toBe(true);
    }
  });
});

describe("construction", () => {
  it("requires unique slot identities", () => {
    expect(() =>
      createDrawingSlotStore([
        { id: "pen", family: "pen", presetId: null, brushId: null },
        { id: "pen", family: "pen", presetId: null, brushId: null },
      ]),
    ).toThrow(/unique/u);
  });

  it("requires at least one slot", () => {
    expect(() => createDrawingSlotStore([])).toThrow(/at least one/iu);
  });

  it("carries no document, History or command surface", () => {
    // The whole store is preferences. Nothing on it can reach artwork.
    const state = store();
    const surface = Object.keys(state).join(" ");
    expect(surface).not.toMatch(/history|command|document|page|layer/iu);
  });
});
