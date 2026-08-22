import { createPenPresetStore } from "@folio/editor";
import { describe, expect, it } from "vitest";
import { createShapeToolState, DEFAULT_SHAPE_DRAWING_STYLE } from "./shape-tool-state";

describe("shape tool state", () => {
  it("starts with an explicit black shape style independent from changed Pen state", () => {
    const presets = createPenPresetStore();
    presets.updateActivePreset("pen", { color: "#2563eb", strokeWidth: 8, opacity: 0.65 });
    const shapes = createShapeToolState();

    expect(shapes.snapshot()).toMatchObject({
      activeShape: "line",
      style: DEFAULT_SHAPE_DRAWING_STYLE,
      version: 0,
    });
    expect(shapes.snapshot().style).toEqual({
      color: "#111111",
      width: 2,
      opacity: 1,
      pressureEnabled: false,
    });
    expect(presets.activePreset("pen").style.strokeColor.hex).toBe("#2563eb");
  });

  it("retains Shape color, width, opacity, and subtype without mutating drawing presets", () => {
    const presets = createPenPresetStore();
    presets.updateActivePreset("pen", { color: "#2563eb", strokeWidth: 8, opacity: 0.65 });
    presets.updateActivePreset("highlighter", {
      color: "#4ade80",
      strokeWidth: 16,
      opacity: 0.25,
    });
    const penBeforeShapes = presets.activePreset("pen");
    const highlighterBeforeShapes = presets.activePreset("highlighter");
    const shapes = createShapeToolState();

    shapes.selectShape("rectangle");
    shapes.updateStyle({ strokeColor: "#dc2626", strokeWidth: 7, opacity: 0.4 });
    shapes.selectShape("ellipse");

    expect(shapes.snapshot()).toMatchObject({
      activeShape: "ellipse",
      style: { color: "#dc2626", width: 7, opacity: 0.4, pressureEnabled: false },
    });
    expect(presets.activePreset("pen")).toEqual(penBeforeShapes);
    expect(presets.activePreset("highlighter")).toEqual(highlighterBeforeShapes);

    shapes.selectShape("rectangle");
    expect(shapes.snapshot().style).toEqual({
      color: "#dc2626",
      width: 7,
      opacity: 0.4,
      pressureEnabled: false,
    });
  });

  it("uses immutable successors and ignores no-op updates", () => {
    const shapes = createShapeToolState();
    const initial = shapes.snapshot();
    const unchanged = shapes.updateStyle({ strokeColor: "#111111", strokeWidth: 2, opacity: 1 });
    const changed = shapes.updateStyle({ strokeColor: "#dc2626" });

    expect(unchanged.version).toBe(initial.version);
    expect(changed.version).toBe(initial.version + 1);
    expect(initial.style.color).toBe("#111111");
    expect(changed.style.color).toBe("#dc2626");
    expect(Object.isFrozen(changed)).toBe(true);
    expect(Object.isFrozen(changed.style)).toBe(true);
  });
});
