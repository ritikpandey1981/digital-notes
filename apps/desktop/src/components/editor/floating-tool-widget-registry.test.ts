import { describe, expect, it } from "vitest";
import {
  createFloatingToolWidgetRegistry,
  resolveFloatingWidgetAfterToolSelection,
} from "./floating-tool-widget-registry";

describe("floating tool widget registry", () => {
  it("maps every current floating tool into one shared widget lifecycle", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(registry.registeredTools()).toEqual([
      "Pencil",
      "Pen",
      "Marker",
      "Highlighter",
      "Eraser",
      "Shapes",
    ]);
    expect(registry.widgetFor("Pencil")).toBe("drawing-options");
    expect(registry.widgetFor("Pen")).toBe("drawing-options");
    expect(registry.widgetFor("Highlighter")).toBe("drawing-options");
    expect(registry.widgetFor("Marker")).toBe("drawing-options");
    // The Eraser owns its own size, so it carries a settings widget like every
    // other creation-adjacent tool.
    expect(registry.widgetFor("Eraser")).toBe("drawing-options");
    expect(registry.widgetFor("Shapes")).toBe("shapes");
    expect(registry.widgetFor("Select")).toBeNull();
  });

  it("activates an inactive brush without opening settings", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Select", "Pen", null, registry)).toBeNull();
    expect(
      resolveFloatingWidgetAfterToolSelection("Pen", "Highlighter", "drawing-options", registry),
    ).toBeNull();
    expect(
      resolveFloatingWidgetAfterToolSelection("Highlighter", "Marker", "drawing-options", registry),
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

  it("reopens the registered widget when its active tool is clicked again", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Pen", "Pen", null, registry)).toBe(
      "drawing-options",
    );
    expect(resolveFloatingWidgetAfterToolSelection("Shapes", "Shapes", null, registry)).toBe(
      "shapes",
    );
  });

  it("never closes open settings through tool selection alone", () => {
    const registry = createFloatingToolWidgetRegistry();

    // The dock's options affordance owns closing settings; selecting a tool
    // must not make a persistent panel disappear underneath the user.
    expect(resolveFloatingWidgetAfterToolSelection("Pen", "Pen", "drawing-options", registry)).toBe(
      "drawing-options",
    );
  });

  it("keeps the transient shape chooser toggling from its own tool button", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(
      resolveFloatingWidgetAfterToolSelection("Shapes", "Shapes", "shapes", registry),
    ).toBeNull();
    expect(resolveFloatingWidgetAfterToolSelection("Shapes", "Shapes", null, registry)).toBe(
      "shapes",
    );
  });

  it("never invents settings for tools without a registered widget", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(resolveFloatingWidgetAfterToolSelection("Select", "Select", null, registry)).toBeNull();
    expect(resolveFloatingWidgetAfterToolSelection("Move", "Move", null, registry)).toBeNull();
    expect(
      resolveFloatingWidgetAfterToolSelection("Select", "Select", "drawing-options", registry),
    ).toBeNull();
  });

  it("gives the Eraser the same settings lifecycle as every brush", () => {
    const registry = createFloatingToolWidgetRegistry();

    expect(
      resolveFloatingWidgetAfterToolSelection("Pen", "Eraser", "drawing-options", registry),
    ).toBeNull();
    expect(resolveFloatingWidgetAfterToolSelection("Eraser", "Eraser", null, registry)).toBe(
      "drawing-options",
    );
    expect(
      resolveFloatingWidgetAfterToolSelection("Eraser", "Eraser", "drawing-options", registry),
    ).toBe("drawing-options");
  });
});
