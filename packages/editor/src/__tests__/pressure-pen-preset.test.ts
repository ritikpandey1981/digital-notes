import { evaluatePressureResponse } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createDrawingSlotStore } from "../foundation/drawing-slot-state";
import { DEFAULT_BRUSH_PRESETS, createBrushToolStateStore } from "../foundation/pen-presets";

/**
 * The catalogue side of Pressure Pen.
 *
 * One preset moved, and it is the one that was already the expressive pen:
 * Brush Pen keeps its identity, its name, its size and the width range it has
 * always had. What changed is the strategy that reads them, and that the
 * opacity response the model has carried since Phase 17A is finally evaluated.
 * Everything else stays on its frozen legacy strategy, which is what this file
 * exists to keep true.
 */

const PRESSURE_PEN_ID = "pen-brush";

describe("the Pressure Pen preset", () => {
  it("is the only preset on the pressure strategy", () => {
    const onPressure = DEFAULT_BRUSH_PRESETS.filter(
      (preset) => preset.renderer.kind === "pressure-pen",
    );
    expect(onPressure.map(({ id }) => id)).toEqual([PRESSURE_PEN_ID]);

    for (const preset of DEFAULT_BRUSH_PRESETS) {
      if (preset.id === PRESSURE_PEN_ID) continue;
      expect(["centerline", "outline", "technical-pen", "pencil", "marker"]).toContain(
        preset.renderer.kind,
      );
    }
  });

  it("keeps the width range it already had and gains a real opacity response", () => {
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === PRESSURE_PEN_ID);
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    expect(preset.renderer).toEqual({ version: 1, kind: "pressure-pen" });
    expect(preset.name).toBe("Brush Pen");
    expect(preset.defaults.size).toBe(6);
    expect(preset.dynamics.pressureSize).toEqual({
      enabled: true,
      minimumFactor: 0.35,
      maximumFactor: 1.65,
      curve: { kind: "linear", exponent: 1 },
    });

    const opacity = preset.dynamics.pressureOpacity;
    expect(opacity.enabled).toBe(true);
    expect(opacity.maximumFactor).toBe(1);
    // A light touch is visibly lighter without disappearing, and a firm press
    // is the brush's own opacity and nothing more.
    expect(evaluatePressureResponse(opacity, 1)).toBeCloseTo(1, 9);
    expect(evaluatePressureResponse(opacity, 0.05)).toBeGreaterThan(0.6);
    expect(evaluatePressureResponse(opacity, 0.05)).toBeLessThan(0.85);
    expect(evaluatePressureResponse(opacity, 0.5)).toBeGreaterThan(
      evaluatePressureResponse(opacity, 0.05),
    );
  });

  it("leaves every other preset's dynamics exactly as they were", () => {
    for (const preset of DEFAULT_BRUSH_PRESETS) {
      // Pencil reads the same durable response, as coverage rather than as
      // alpha, so it is the one other preset that legitimately enables it.
      if (preset.id === PRESSURE_PEN_ID || preset.id === "pencil-hb") continue;
      expect(preset.dynamics.pressureOpacity).toEqual({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      });
    }
  });

  it("keeps its strategy through slot assignment while the slot keeps its colour", () => {
    const slots = createDrawingSlotStore([
      { id: "pen", family: "pen", presetId: "pen-fineliner", brushId: "fineliner" },
    ]);
    slots.updateProperties("pen", { color: "#2b6cb0" });

    slots.assignBrush("pen", {
      brushId: "brush-pen-soft",
      family: "pen",
      fallbackPresetId: PRESSURE_PEN_ID,
    });

    const state = slots.stateFor("pen");
    expect(state.brushId).toBe("brush-pen-soft");
    expect(state.presetId).toBe(PRESSURE_PEN_ID);
    // Colour survives a brush change; the rest adopts the new brush's defaults.
    expect(state.color.hex).toBe("#2b6cb0");
    expect(state.size).toBe(6);
    expect(state.opacity).toBe(1);
    expect(state.smoothing).toEqual({ mode: "average", amount: 0.18 });

    const resolved = slots.resolvedBrush("pen");
    expect(resolved.renderer).toEqual({ version: 1, kind: "pressure-pen" });
    expect(resolved.color).toBe("#2b6cb0");
  });

  it("carries slot width, opacity and smoothing overrides into the snapshot", () => {
    const slots = createDrawingSlotStore([
      { id: "pen", family: "pen", presetId: PRESSURE_PEN_ID, brushId: "brush-pen-soft" },
    ]);
    slots.updateProperties("pen", {
      size: 11,
      opacity: 0.6,
      smoothing: { mode: "average", amount: 0.7 },
    });

    const resolved = slots.resolvedBrush("pen");
    expect(resolved.renderer.kind).toBe("pressure-pen");
    expect(resolved.size).toBe(11);
    expect(resolved.opacity).toBe(0.6);
    expect(resolved.smoothing).toEqual({ mode: "average", amount: 0.7 });
    // An override changes the brush, never the response curve that reads it.
    expect(resolved.dynamics.pressureSize.maximumFactor).toBe(1.65);
    expect(resolved.dynamics.pressureOpacity.enabled).toBe(true);
  });

  it("is reachable from the family store without disturbing the other presets", () => {
    const store = createBrushToolStateStore();
    store.selectPreset("pen", PRESSURE_PEN_ID);
    expect(store.resolvedBrush("pen").renderer.kind).toBe("pressure-pen");

    store.selectPreset("pen", "pen-technical");
    expect(store.resolvedBrush("pen").renderer.kind).toBe("technical-pen");
    expect(store.resolvedBrush("marker").renderer.kind).toBe("marker");
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("pencil");
  });
});
