import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createBrushToolStateStore } from "../index";

describe("Phase 17A brush tool state", () => {
  it("keeps immutable catalog definitions separate from mutable active state", () => {
    const store = createBrushToolStateStore();
    const preset = store.activePreset("pen");
    const initialState = store.activeState("pen");

    store.updateActiveToolState("pen", {
      color: "#4f46e5",
      size: 6,
      opacity: 0.75,
      smoothing: { mode: "average", amount: 0.4 },
    });

    expect(store.activePreset("pen")).toBe(preset);
    expect(preset.defaults).toMatchObject({ color: "#111111", size: 2, opacity: 1 });
    expect(store.activeState("pen")).toMatchObject({
      family: "pen",
      presetId: preset.id,
      color: { hex: "#4f46e5" },
      size: 6,
      opacity: 0.75,
      smoothing: { mode: "average", amount: 0.4 },
    });
    expect(initialState).toMatchObject({ color: { hex: "#111111" }, size: 2, opacity: 1 });
    expect(Object.isFrozen(preset)).toBe(true);
    expect(Object.isFrozen(store.activeState("pen"))).toBe(true);
  });

  it("retains independent family state across switching and updates", () => {
    const store = createBrushToolStateStore();
    store.updateActiveToolState("pen", { color: "#2563eb", size: 8, opacity: 0.8 });
    const pen = store.activeState("pen");
    store.updateActiveToolState("highlighter", {
      color: "#4ade80",
      size: 16,
      opacity: 0.25,
    });

    expect(store.activeState("pen")).toBe(pen);
    expect(store.activeState("highlighter")).toMatchObject({
      family: "highlighter",
      color: { hex: "#4ade80" },
      size: 16,
      opacity: 0.25,
    });
    expect(store.resolvedBrush("pen").dynamics.pressureSize.enabled).toBe(true);
    expect(store.resolvedBrush("pen").renderer.kind).toBe("outline");
    expect(store.resolvedBrush("highlighter").dynamics.pressureSize.enabled).toBe(false);
    expect(store.resolvedBrush("highlighter").renderer.kind).toBe("centerline");
  });

  it("selects immutable defaults into active state without modifying the catalog", () => {
    const store = createBrushToolStateStore();
    store.updateActiveToolState("pen", { size: 9 });
    const blue = store.presetsFor("pen").find(({ id }) => id === "pen-blue");
    if (blue === undefined) throw new Error("Blue preset is unavailable.");

    store.selectPreset("pen", blue.id);

    expect(store.activePreset("pen")).toBe(blue);
    expect(store.activeState("pen")).toMatchObject({
      presetId: "pen-blue",
      color: { hex: "#2563eb" },
      size: 4,
      opacity: 1,
    });
    expect(blue.defaults.size).toBe(4);
  });

  it("resolves deterministic JSON-safe snapshots and keeps existing strokes stable", () => {
    const store = createBrushToolStateStore();
    const initialSnapshot = store.resolvedBrush("pen");
    const builder = new StrokeBuilder({
      id: "brush-state-stroke",
      timestamp: 100,
      brush: initialSnapshot,
      style: {
        color: initialSnapshot.color,
        width: initialSnapshot.size,
        opacity: initialSnapshot.opacity,
        pressureEnabled: initialSnapshot.dynamics.pressureSize.enabled,
      },
    });
    builder.addPoint({
      x: 1,
      y: 2,
      timestamp: 100,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
    const stroke = builder.finalize();

    store.updateActiveToolState("pen", { color: "#dc2626", size: 12, opacity: 0.5 });

    expect(stroke.brush).toEqual(initialSnapshot);
    expect(stroke.brush).toMatchObject({
      color: "#111111",
      size: 2,
      opacity: 1,
      renderer: { kind: "outline" },
    });
    expect(store.resolvedBrush("pen")).toMatchObject({
      color: "#dc2626",
      size: 12,
      opacity: 0.5,
    });
    expect(JSON.parse(JSON.stringify(stroke.brush))).toEqual(stroke.brush);
    expect(Object.isFrozen(stroke.brush.dynamics.pressureSize.curve)).toBe(true);
  });

  it("ignores no-op state updates and exposes immutable snapshots", () => {
    const store = createBrushToolStateStore();
    const before = store.snapshot();
    const after = store.updateActiveToolState("pen", {
      color: "#111111",
      size: 2,
      opacity: 1,
      smoothing: { mode: "none", amount: 0 },
    });

    expect(after.version).toBe(before.version);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.activeStates)).toBe(true);
  });
});
