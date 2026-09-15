import { evaluatePressureResponse } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createDrawingSlotStore } from "../foundation/drawing-slot-state";
import {
  DEFAULT_BRUSH_PRESET_IDS,
  DEFAULT_BRUSH_PRESETS,
  createBrushToolStateStore,
} from "../foundation/pen-presets";

/**
 * The one pencil on the real brush engine.
 *
 * Exactly one preset moves per phase, and this is the gate that keeps a later
 * phase from migrating the rest of the catalogue by accident. The other three
 * pencils stay on their frozen legacy strategies until E6 maps them.
 */

const PENCIL_ID = "pencil-hb";

describe("the Pencil preset", () => {
  it("is the only preset on the pencil strategy, and is the family's default", () => {
    const onPencil = DEFAULT_BRUSH_PRESETS.filter((preset) => preset.renderer.kind === "pencil");
    expect(onPencil.map(({ id }) => id)).toEqual([PENCIL_ID]);
    // Moving the default is the point: the pencil slot a fresh session opens on
    // is the one the new strategy draws.
    expect(DEFAULT_BRUSH_PRESET_IDS.pencil).toBe(PENCIL_ID);

    for (const preset of DEFAULT_BRUSH_PRESETS) {
      if (preset.id === PENCIL_ID) continue;
      expect(["centerline", "outline", "technical-pen", "pressure-pen"]).toContain(
        preset.renderer.kind,
      );
    }
    // The three pencils a later phase will map are untouched, strategy and all.
    for (const id of ["pencil-2b", "pencil-4b", "pencil-mechanical"]) {
      const preset = DEFAULT_BRUSH_PRESETS.find((entry) => entry.id === id);
      expect(preset?.renderer.kind).not.toBe("pencil");
    }
  });

  it("keeps the identity and the width range it already had", () => {
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === PENCIL_ID);
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    expect(preset.renderer).toEqual({ version: 1, kind: "pencil" });
    expect(preset.name).toBe("HB");
    expect(preset.family).toBe("pencil");
    expect(preset.defaults.size).toBe(2);
    expect(preset.defaults.opacity).toBe(0.78);
    expect(preset.defaults.color).toBe("#343434");
    // Unchanged from the outline configuration it had, so the mark it makes is
    // the width it made.
    expect(preset.dynamics.pressureSize).toEqual({
      enabled: true,
      minimumFactor: 0.65,
      maximumFactor: 1.25,
      curve: { kind: "linear", exponent: 1 },
    });
  });

  it("reads the durable opacity response as its coverage response", () => {
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === PENCIL_ID);
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    const coverage = preset.dynamics.pressureOpacity;
    expect(coverage.enabled).toBe(true);
    expect(coverage.maximumFactor).toBe(1);
    // A light touch is visibly sparser without vanishing; a firm press lays
    // down everything the tip has.
    expect(evaluatePressureResponse(coverage, 1)).toBeCloseTo(1, 9);
    expect(evaluatePressureResponse(coverage, 0.05)).toBeGreaterThan(0.4);
    expect(evaluatePressureResponse(coverage, 0.05)).toBeLessThan(0.62);
    expect(evaluatePressureResponse(coverage, 0.5)).toBeGreaterThan(
      evaluatePressureResponse(coverage, 0.05),
    );
  });

  it("works in a generic drawing slot without pencil-specific slot state", () => {
    const slots = createDrawingSlotStore([
      { id: "pen", family: "pen", presetId: "pen-technical", brushId: "technical-pen" },
    ]);
    slots.updateProperties("pen", { color: "#2b6cb0" });

    // A pencil in the slot the dock seeded as a pen: nothing about the slot is
    // pencil-shaped, and the family follows the brush.
    slots.assignBrush("pen", {
      brushId: "hb-pencil",
      family: "pencil",
      fallbackPresetId: PENCIL_ID,
    });
    const assigned = slots.stateFor("pen");
    expect(assigned.family).toBe("pencil");
    expect(assigned.presetId).toBe(PENCIL_ID);
    expect(assigned.color.hex).toBe("#2b6cb0");
    expect(slots.resolvedBrush("pen").renderer).toEqual({ version: 1, kind: "pencil" });

    slots.updateProperties("pen", {
      size: 5,
      opacity: 0.5,
      smoothing: { mode: "average", amount: 0.7 },
    });
    const resolved = slots.resolvedBrush("pen");
    expect(resolved.size).toBe(5);
    expect(resolved.opacity).toBe(0.5);
    expect(resolved.smoothing).toEqual({ mode: "average", amount: 0.7 });
    expect(resolved.renderer.kind).toBe("pencil");

    // Switching away and back restores the pen, then the pencil, unchanged.
    slots.assignBrush("pen", {
      brushId: "technical-pen",
      family: "pen",
      fallbackPresetId: "pen-technical",
    });
    expect(slots.resolvedBrush("pen").renderer.kind).toBe("technical-pen");
    slots.assignBrush("pen", {
      brushId: "hb-pencil",
      family: "pencil",
      fallbackPresetId: PENCIL_ID,
    });
    expect(slots.resolvedBrush("pen").renderer.kind).toBe("pencil");
    expect(slots.stateFor("pen").color.hex).toBe("#2b6cb0");
  });

  it("is reachable from the family store without disturbing the other presets", () => {
    const store = createBrushToolStateStore();
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("pencil");

    store.selectPreset("pencil", "pencil-2b");
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("outline");
    store.selectPreset("pencil", PENCIL_ID);
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("pencil");
    expect(store.resolvedBrush("pen").renderer.kind).toBe("centerline");
    expect(store.resolvedBrush("marker").renderer.kind).toBe("centerline");
    expect(store.resolvedBrush("highlighter").renderer.kind).toBe("centerline");
  });
});
