import { createPenPresetStore, type DrawingToolKind } from "@folio/editor";
import { describe, expect, it } from "vitest";
import { createDefaultToolOptionsDescriptorRegistry } from "./tool-options-registry";

describe("tool options descriptor registry", () => {
  it("registers only the configurable tools without tool-specific widget branching", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();

    expect(registry.registeredTools()).toEqual(["Pencil", "Pen", "Marker", "Highlighter"]);
    expect(registry.describe("Select", presets.resolvedBrush("pen"))).toBeNull();
    expect(registry.describe("Eraser", presets.resolvedBrush("pen"))).toBeNull();
  });

  it("does not expose creation properties for the unified Shapes tool", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const pen = createPenPresetStore().resolvedBrush("pen");

    expect(registry.describe("Shapes", pen)).toBeNull();
  });

  it("describes continuous pen width and opacity through immutable property descriptors", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();
    presets.updateActivePreset("pen", { color: "#2563eb", strokeWidth: 5.8, opacity: 0.63 });

    const descriptor = registry.describe(
      "Pen",
      presets.resolvedBrush("pen"),
      presetSelection(presets, "pen"),
    );
    expect(descriptor).not.toBeNull();
    expect(descriptor?.properties.map(({ key }) => key)).toEqual([
      "strokeColor",
      "strokeWidth",
      "opacity",
      "smoothing",
    ]);
    expect(descriptor?.properties[1]).toMatchObject({
      value: 5.8,
      defaultValue: 2,
      constraints: { minimum: 0.5, maximum: 40, step: 0.1 },
    });
    expect(descriptor?.properties[2]).toMatchObject({
      value: 0.63,
      defaultValue: 1,
      constraints: { minimum: 0.1, maximum: 1, step: 0.01 },
    });
    expect(descriptor?.preview).toMatchObject({ color: "#2563eb", width: 5.8, opacity: 0.63 });
    expect(descriptor?.preset).toMatchObject({
      activeId: "pen-fineliner",
      options: [
        { id: "pen-fineliner", name: "Fineliner" },
        { id: "pen-technical", name: "Technical Pen" },
        { id: "pen-brush", name: "Brush Pen" },
      ],
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor?.properties)).toBe(true);
  });

  it("shows the complete opacity scale while preserving the highlighter model ceiling", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();
    const descriptor = registry.describe(
      "Highlighter",
      presets.resolvedBrush("highlighter"),
      presetSelection(presets, "highlighter"),
    );
    const opacity = descriptor?.properties.find(({ key }) => key === "opacity");

    expect(opacity).toMatchObject({
      constraints: { minimum: 0.1, maximum: 1, step: 0.01 },
    });
    expect(opacity?.value).toBeCloseTo(0.717_142_857);
    expect(opacity?.defaultValue).toBeCloseTo(0.717_142_857);
    expect(opacity?.toModelValue?.(1)).toBeCloseTo(0.45);
    expect(opacity?.toModelValue?.(0.717_142_857)).toBeCloseTo(0.34);
    expect(descriptor?.preview.opacity).toBe(0.34);
    expect(descriptor?.preview.pressureEnabled).toBe(false);
    expect(descriptor?.preset).toBeNull();
    expect(descriptor?.properties.some(({ key }) => key === "smoothing")).toBe(false);
  });

  it.each([
    ["Pencil", "pencil", 4],
    ["Pen", "pen", 3],
    ["Marker", "marker", 2],
  ] as const)("exposes %s presets and smoothing", (tool, family, presetCount) => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();
    const descriptor = registry.describe(
      tool,
      presets.resolvedBrush(family),
      presetSelection(presets, family),
    );

    expect(descriptor?.preset?.options).toHaveLength(presetCount);
    expect(descriptor?.properties.find(({ key }) => key === "smoothing")).toMatchObject({
      constraints: { minimum: 0, maximum: 1, step: 0.01 },
      displayScale: 100,
      unit: "%",
    });
  });
});

function presetSelection(store: ReturnType<typeof createPenPresetStore>, family: DrawingToolKind) {
  return {
    activeId: store.activeState(family).presetId,
    options: store.presetsFor(family).map((preset) => ({
      id: preset.id,
      name: preset.name,
      defaultSize: preset.defaults.size,
      defaultOpacity: preset.defaults.opacity,
      defaultSmoothing: preset.defaults.smoothing.amount,
    })),
  };
}
