import { describe, expect, it } from "vitest";
import { createFloatingToolWidgetRegistry } from "./floating-tool-widget-registry";

describe("floating tool widget registry", () => {
  it("maps every current floating tool into one shared widget lifecycle", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(registry.registeredTools()).toEqual(["Pen", "Highlighter", "Shapes"]);
    expect(registry.widgetFor("Pen")).toBe("drawing-options");
    expect(registry.widgetFor("Highlighter")).toBe("drawing-options");
    expect(registry.widgetFor("Shapes")).toBe("shapes");
    expect(registry.widgetFor("Select")).toBeNull();
  });
});
