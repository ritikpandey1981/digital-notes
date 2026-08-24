import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRUSH_PRESET_IDS,
  DEFAULT_BRUSH_PRESETS,
  createBrushToolStateStore,
  type DrawingToolKind,
} from "../index";

const FAMILIES = ["pencil", "pen", "marker", "highlighter"] as const;

describe("Phase 17C brush catalog and tool state", () => {
  it("publishes the exact immutable professional brush catalog and explicit defaults", () => {
    expect(DEFAULT_BRUSH_PRESETS.map(({ id, name, family }) => ({ id, name, family }))).toEqual([
      { id: "pencil-hb", name: "HB", family: "pencil" },
      { id: "pencil-2b", name: "2B", family: "pencil" },
      { id: "pencil-4b", name: "4B", family: "pencil" },
      { id: "pencil-mechanical", name: "Mechanical Pencil", family: "pencil" },
      { id: "pen-fineliner", name: "Fineliner", family: "pen" },
      { id: "pen-technical", name: "Technical Pen", family: "pen" },
      { id: "pen-brush", name: "Brush Pen", family: "pen" },
      { id: "marker-felt", name: "Felt Marker", family: "marker" },
      { id: "marker-broad", name: "Broad Marker", family: "marker" },
      { id: "highlighter-default", name: "Default Highlighter", family: "highlighter" },
    ]);
    expect(DEFAULT_BRUSH_PRESET_IDS).toEqual({
      pencil: "pencil-hb",
      pen: "pen-fineliner",
      marker: "marker-felt",
      highlighter: "highlighter-default",
    });
    expect(DEFAULT_BRUSH_PRESETS.every(Object.isFrozen)).toBe(true);
  });

  it("keeps immutable catalog definitions separate from mutable family state", () => {
    const store = createBrushToolStateStore();
    const preset = store.activePreset("pencil");
    const initialState = store.activeState("pencil");

    store.updateActiveToolState("pencil", {
      color: "#4f46e5",
      size: 6,
      opacity: 0.75,
      smoothing: { mode: "average", amount: 0.4 },
    });

    expect(store.activePreset("pencil")).toBe(preset);
    expect(preset.defaults).toMatchObject({ color: "#343434", size: 2, opacity: 0.78 });
    expect(store.activeState("pencil")).toMatchObject({
      family: "pencil",
      presetId: "pencil-hb",
      color: { hex: "#4f46e5" },
      size: 6,
      opacity: 0.75,
      smoothing: { mode: "average", amount: 0.4 },
    });
    expect(initialState).toMatchObject({ color: { hex: "#343434" }, size: 2, opacity: 0.78 });
    expect(Object.isFrozen(preset)).toBe(true);
    expect(Object.isFrozen(store.activeState("pencil"))).toBe(true);
  });

  it("retains independent state for every family across switching and updates", () => {
    const store = createBrushToolStateStore();
    const colors = ["#334155", "#2563eb", "#be123c", "#4ade80"] as const;
    FAMILIES.forEach((family, index) => {
      store.updateActiveToolState(family, {
        color: colors[index]!,
        size: 4 + index,
        opacity: 0.4 + index * 0.1,
        smoothing: {
          mode: family === "highlighter" ? "none" : "average",
          amount: family === "highlighter" ? 0 : index * 0.1,
        },
      });
    });
    FAMILIES.forEach((family, index) => {
      expect(store.activeState(family)).toMatchObject({
        family,
        color: { hex: colors[index]! },
        size: 4 + index,
        opacity: 0.4 + index * 0.1,
      });
    });
  });

  it.each([
    ["pencil", "pencil-4b"],
    ["pen", "pen-brush"],
    ["marker", "marker-broad"],
  ] as const)("retains %s color but resets other values when selecting a preset", (family, id) => {
    const store = createBrushToolStateStore();
    store.updateActiveToolState(family, {
      color: "#7c3aed",
      size: 31,
      opacity: 0.41,
      smoothing: { mode: "average", amount: 0.91 },
    });
    const preset = store.presetsFor(family).find((candidate) => candidate.id === id);
    if (preset === undefined) throw new Error(`${id} is unavailable.`);

    store.selectPreset(family, id);

    expect(store.activeState(family)).toMatchObject({
      presetId: id,
      color: { hex: "#7c3aed" },
      size: preset.defaults.size,
      opacity: preset.defaults.opacity,
      smoothing: preset.defaults.smoothing,
    });
    expect(preset.defaults.color).not.toBe("#7c3aed");
  });

  it("resolves the intended renderer and pressure capability for every preset", () => {
    const store = createBrushToolStateStore();
    const expectations: Readonly<Record<string, readonly [string, boolean]>> = {
      "pencil-hb": ["outline", true],
      "pencil-2b": ["outline", true],
      "pencil-4b": ["outline", true],
      "pencil-mechanical": ["centerline", false],
      "pen-fineliner": ["centerline", false],
      "pen-technical": ["centerline", false],
      "pen-brush": ["outline", true],
      "marker-felt": ["centerline", false],
      "marker-broad": ["centerline", false],
      "highlighter-default": ["centerline", false],
    };
    for (const family of FAMILIES) {
      for (const preset of store.presetsFor(family)) {
        store.selectPreset(family, preset.id);
        const resolved = store.resolvedBrush(family);
        expect([resolved.renderer.kind, resolved.dynamics.pressureSize.enabled]).toEqual(
          expectations[preset.id],
        );
      }
    }
  });

  it("resolves JSON-safe snapshots and keeps historical strokes stable", () => {
    const store = createBrushToolStateStore();
    store.selectPreset("pen", "pen-brush");
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
      presetId: "pen-brush",
      color: "#111111",
      size: 6,
      opacity: 1,
      renderer: { kind: "outline" },
    });
    expect(JSON.parse(JSON.stringify(stroke.brush))).toEqual(stroke.brush);
    expect(Object.isFrozen(stroke.brush.dynamics.pressureSize.curve)).toBe(true);
  });

  it.each(FAMILIES)("ignores no-op %s updates and exposes immutable snapshots", (family) => {
    const store = createBrushToolStateStore();
    const active = store.activeState(family);
    const before = store.snapshot();
    const after = store.updateActiveToolState(family, {
      color: active.color,
      size: active.size,
      opacity: active.opacity,
      smoothing: active.smoothing,
    });

    expect(after.version).toBe(before.version);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.activeStates)).toBe(true);
  });

  it("rejects cross-family preset selection", () => {
    const store = createBrushToolStateStore();
    expect(() => store.selectPreset("marker", "pen-brush")).toThrow(/not registered for marker/u);
  });

  it("exposes all four drawing family identities to the public type boundary", () => {
    const families: readonly DrawingToolKind[] = FAMILIES;
    expect(families).toHaveLength(4);
  });
});
