import { describe, expect, it } from "vitest";
import {
  createFloatingToolWidgetRegistry,
  resolveFloatingWidgetAfterToolSelection,
} from "./floating-tool-widget-registry";

describe("floating tool widget registry", () => {
  it("maps every current floating tool into one shared widget lifecycle", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(registry.registeredTools()).toEqual(["Pen", "Highlighter", "Shapes"]);
    expect(registry.widgetFor("Pen")).toBe("drawing-options");
    expect(registry.widgetFor("Highlighter")).toBe("drawing-options");
    expect(registry.widgetFor("Shapes")).toBe("shapes");
    expect(registry.widgetFor("Select")).toBeNull();
  });

  it("activates an inactive Pen or Highlighter without opening settings", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Select", "Pen", null, registry)).toBeNull();
    expect(
      resolveFloatingWidgetAfterToolSelection("Pen", "Highlighter", "drawing-options", registry),
    ).toBeNull();
  });

  it("opens the subtype chooser when Shapes becomes active", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(
      resolveFloatingWidgetAfterToolSelection("Pen", "Shapes", "drawing-options", registry),
    ).toBe("shapes");
    expect(resolveFloatingWidgetAfterToolSelection("Select", "Shapes", null, registry)).toBe(
      "shapes",
    );
  });

  it("toggles the registered widget only when its active tool is clicked again", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Pen", "Pen", null, registry)).toBe(
      "drawing-options",
    );
    expect(
      resolveFloatingWidgetAfterToolSelection("Pen", "Pen", "drawing-options", registry),
    ).toBeNull();
    expect(resolveFloatingWidgetAfterToolSelection("Shapes", "Shapes", null, registry)).toBe(
      "shapes",
    );
  });

  it("never invents settings for tools without a registered widget", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Select", "Select", null, registry)).toBeNull();
    expect(resolveFloatingWidgetAfterToolSelection("Eraser", "Eraser", null, registry)).toBeNull();
  });
});
