import { createPenPresetStore } from "@folio/editor";
import { describe, expect, it } from "vitest";
import { createDefaultToolOptionsDescriptorRegistry } from "./tool-options-registry";

describe("tool options descriptor registry", () => {
  it("registers only the configurable tools without tool-specific widget branching", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();

    expect(registry.registeredTools()).toEqual(["Pen", "Highlighter"]);
    expect(registry.describe("Select", presets.activePreset("pen"))).toBeNull();
    expect(registry.describe("Eraser", presets.activePreset("pen"))).toBeNull();
  });

  it("describes continuous pen width and opacity through immutable property descriptors", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();
    presets.updateActivePreset("pen", { color: "#2563eb", strokeWidth: 5.8, opacity: 0.63 });

    const descriptor = registry.describe("Pen", presets.activePreset("pen"));
    expect(descriptor).not.toBeNull();
    expect(descriptor?.properties.map(({ key }) => key)).toEqual([
      "strokeColor",
      "strokeWidth",
      "opacity",
    ]);
    expect(descriptor?.properties[1]).toMatchObject({
      value: 5.8,
      defaultValue: 2,
      constraints: { minimum: 0.5, maximum: 30, step: 0.1 },
    });
    expect(descriptor?.properties[2]).toMatchObject({
      value: 0.63,
      defaultValue: 1,
      constraints: { minimum: 0.1, maximum: 1, step: 0.01 },
    });
    expect(descriptor?.preview).toMatchObject({ color: "#2563eb", width: 5.8, opacity: 0.63 });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor?.properties)).toBe(true);
  });

  it("gives highlighter the same controls with its distinct opacity ceiling", () => {
    const registry = createDefaultToolOptionsDescriptorRegistry();
    const presets = createPenPresetStore();
    const descriptor = registry.describe("Highlighter", presets.activePreset("highlighter"));
    const opacity = descriptor?.properties.find(({ key }) => key === "opacity");

    expect(opacity).toMatchObject({
      defaultValue: 0.34,
      constraints: { minimum: 0.1, maximum: 0.45, step: 0.01 },
    });
    expect(descriptor?.preview.pressureEnabled).toBe(false);
  });
});
