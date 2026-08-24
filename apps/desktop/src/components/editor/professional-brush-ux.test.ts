import { createBrushToolStateStore, type DrawingToolKind } from "@folio/editor";
import { describe, expect, it } from "vitest";
import type { EditorTool } from "./editor-types";
import { createFloatingToolWidgetRegistry } from "./floating-tool-widget-registry";
import { createDefaultToolOptionsDescriptorRegistry } from "./tool-options-registry";

describe("Phase 17C professional brush UX composition", () => {
  it("keeps every catalog family registered with one settings and widget lifecycle", () => {
    const tools = [
      "Pencil",
      "Pen",
      "Marker",
      "Highlighter",
    ] as const satisfies readonly EditorTool[];
    const families = [
      "pencil",
      "pen",
      "marker",
      "highlighter",
    ] as const satisfies readonly DrawingToolKind[];
    const store = createBrushToolStateStore();
    const options = createDefaultToolOptionsDescriptorRegistry();
    const widgets = createFloatingToolWidgetRegistry();

    expect(options.registeredTools()).toEqual(tools);
    tools.forEach((tool, index) => {
      const family = families[index];
      if (family === undefined) throw new Error(`${tool} has no brush family.`);
      expect(store.presetsFor(family).length).toBeGreaterThan(0);
      expect(widgets.widgetFor(tool)).toBe("drawing-options");
      expect(options.describe(tool, store.resolvedBrush(family))).not.toBeNull();
    });
  });
});
