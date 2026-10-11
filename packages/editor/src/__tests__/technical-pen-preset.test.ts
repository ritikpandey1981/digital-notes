import { describe, expect, it } from "vitest";
import { DEFAULT_BRUSH_PRESETS, createBrushToolStateStore } from "../foundation/pen-presets";
import { createDrawingSlotStore } from "../foundation/drawing-slot-state";

/**
 * The one catalogue entry on the real brush engine. Everything else stays on a
 * frozen legacy strategy, so this is also the gate that keeps a later phase
 * from migrating the catalogue by accident.
 */

const TECHNICAL_PEN_ID = "pen-technical";

describe("the Technical Pen preset", () => {
  it("is the only preset on the new strategy", () => {
    const onNewStrategy = DEFAULT_BRUSH_PRESETS.filter(
      (preset) => preset.renderer.kind === "technical-pen",
    );
    expect(onNewStrategy.map(({ id }) => id)).toEqual([TECHNICAL_PEN_ID]);

    for (const preset of DEFAULT_BRUSH_PRESETS) {
      if (preset.id === TECHNICAL_PEN_ID) continue;
      expect(["centerline", "outline", "pressure-pen", "pencil", "marker"]).toContain(
        preset.renderer.kind,
      );
    }
  });

  it("resolves a snapshot that cannot vary width or opacity with pressure", () => {
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === TECHNICAL_PEN_ID);
    expect(preset).toBeDefined();
    if (preset === undefined) return;

    expect(preset.renderer).toEqual({ version: 1, kind: "technical-pen" });
    expect(preset.dynamics.pressureSize.enabled).toBe(false);
    expect(preset.dynamics.pressureSize.minimumFactor).toBe(1);
    expect(preset.dynamics.pressureSize.maximumFactor).toBe(1);
    expect(preset.dynamics.pressureOpacity.enabled).toBe(false);
  });

  it("keeps its strategy through slot assignment while the slot keeps its colour", () => {
    const slots = createDrawingSlotStore([
      { id: "pen", family: "pen", presetId: "pen-fineliner", brushId: "fineliner" },
    ]);
    slots.updateProperties("pen", { color: "#2b6cb0" });
    expect(slots.stateFor("pen").color.hex).toBe("#2b6cb0");

    slots.assignBrush("pen", {
      brushId: "technical-pen",
      family: "pen",
      fallbackPresetId: TECHNICAL_PEN_ID,
    });

    const state = slots.stateFor("pen");
    expect(state.brushId).toBe("technical-pen");
    expect(state.presetId).toBe(TECHNICAL_PEN_ID);
    // Colour survives a brush change; the rest adopts the new brush's defaults.
    expect(state.color.hex).toBe("#2b6cb0");
    expect(slots.resolvedBrush("pen").renderer).toEqual({ version: 1, kind: "technical-pen" });
    expect(slots.resolvedBrush("pen").color).toBe("#2b6cb0");
  });

  it("carries slot width, opacity and smoothing overrides into the snapshot", () => {
    const slots = createDrawingSlotStore([
      { id: "pen", family: "pen", presetId: TECHNICAL_PEN_ID, brushId: "technical-pen" },
    ]);
    slots.updateProperties("pen", {
      size: 3.5,
      opacity: 0.65,
      smoothing: { mode: "average", amount: 0.8 },
    });

    const resolved = slots.resolvedBrush("pen");
    expect(resolved.renderer.kind).toBe("technical-pen");
    expect(resolved.size).toBe(3.5);
    expect(resolved.opacity).toBe(0.65);
    expect(resolved.smoothing).toEqual({ mode: "average", amount: 0.8 });
    expect(resolved.dynamics.pressureSize.enabled).toBe(false);
  });

  it("is reachable from the family store without disturbing the other presets", () => {
    const store = createBrushToolStateStore();
    store.selectPreset("pen", TECHNICAL_PEN_ID);
    expect(store.resolvedBrush("pen").renderer.kind).toBe("technical-pen");

    store.selectPreset("pen", "pen-brush");
    expect(store.resolvedBrush("pen").renderer.kind).toBe("pressure-pen");
    expect(store.resolvedBrush("marker").renderer.kind).toBe("marker");
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("pencil");
  });
});
