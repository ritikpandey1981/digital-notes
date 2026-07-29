import { ObjectFactory } from "@folio/document";
import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import {
  createDefaultPropertyDescriptorRegistry,
  createEditorColorSystem,
  createPenPresetStore,
} from "../index";

describe("Phase 14 editor foundation", () => {
  it("maintains a bounded, deduplicated recent-color list", () => {
    const colors = createEditorColorSystem({ recentLimit: 2 });
    const blue = colors.createColor({ hex: "#2563eb", opacity: 0.5 });
    colors.remember(blue);
    colors.remember(colors.createColor("#dc2626"));
    colors.remember(blue);
    expect(colors.snapshot().recentColors.map(({ hex }) => hex)).toEqual(["#2563eb", "#dc2626"]);
    expect(colors.snapshot().presetColors.length).toBeGreaterThan(4);
  });

  it("preserves independent pen and highlighter presets", () => {
    const presets = createPenPresetStore();
    const originalPen = presets.activePreset("pen");
    const originalHighlighter = presets.activePreset("highlighter");
    presets.updateActivePreset("pen", {
      color: "#4f46e5",
      strokeWidth: 8,
      opacity: 0.8,
    });
    const changedPen = presets.activePreset("pen");
    expect(changedPen.id).toBe(originalPen.id);
    expect(changedPen.style.strokeColor.hex).toBe("#4f46e5");
    expect(changedPen.style.strokeColor.opacity).toBe(0.8);
    expect(changedPen.style.strokeWidth).toBe(8);
    expect(presets.activePreset("highlighter")).toEqual(originalHighlighter);
    expect(originalPen.style.strokeColor.hex).toBe("#111111");
  });

  it("exposes ink properties through a provider instead of panel type switches", () => {
    const builder = new StrokeBuilder({
      id: "foundation-stroke",
      style: { color: "#2563eb", width: 6, opacity: 0.4 },
    });
    builder.addPoint({
      x: 10,
      y: 20,
      timestamp: 1,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
    const object = new ObjectFactory({
      createId: () => "foundation-object",
      now: () => "2026-07-29T10:00:00.000Z",
    }).createInkObject({ stroke: builder.finalize() });
    const registry = createDefaultPropertyDescriptorRegistry();
    const descriptors = registry.describe(object);
    expect(descriptors.map(({ key }) => key)).toEqual(["strokeColor", "strokeWidth", "opacity"]);
    expect(descriptors[1]?.value).toBe(6);
    expect(descriptors[2]?.validate(0.75)).toBe(true);
    expect(descriptors[2]?.validate(2)).toBe(false);
    expect(Object.isFrozen(descriptors)).toBe(true);
  });
});
