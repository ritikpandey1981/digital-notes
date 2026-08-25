import { describe, expect, it } from "vitest";
import type { EditorTool } from "./editor-types";
import {
  brushCursorDiameter,
  cursorPresentationForTool,
  nativeCursorForBrushRegion,
  pointIsWithinBrushPage,
  usesImperativeBrushCursor,
} from "./editor-cursor-policy";

describe("desktop editor cursor policy", () => {
  it("starts brush tools with the native arrow until the imperative ring is page-eligible", () => {
    const brushes = ["Pencil", "Pen", "Marker", "Highlighter"] as const;
    const eraser = cursorPresentationForTool("Eraser");

    expect(brushes.map((tool) => cursorPresentationForTool(tool).css)).toEqual([
      "default",
      "default",
      "default",
      "default",
    ]);
    expect(eraser.id).toBe("eraser");
    expect(eraser.css).toContain("data:image/svg+xml");
  });

  it("defines a cursor presentation for every desktop tool", () => {
    const tools: readonly EditorTool[] = [
      "Select",
      "Move",
      "Rotate",
      "Scale",
      "Pencil",
      "Pen",
      "Marker",
      "Highlighter",
      "Eraser",
      "Shapes",
      "Text",
      "Image",
      "Table",
      "Sticky Note",
    ];

    expect(tools.map((tool) => cursorPresentationForTool(tool).id)).toEqual([
      "select",
      "move",
      "rotate",
      "scale",
      "pencil",
      "pen",
      "marker",
      "highlighter",
      "eraser",
      "shapes",
      "text",
      "image",
      "table",
      "sticky-note",
    ]);
  });

  it("starts Shapes with a black crosshair before returning to the adaptive native cursor", () => {
    const shapes = cursorPresentationForTool("Shapes");

    expect(shapes.id).toBe("shapes");
    expect(shapes.css).toContain("data:image/svg+xml");
    expect(shapes.css).toContain("%23111111");
    expect(shapes.css).not.toContain("%232563eb");
    expect(shapes.adaptiveCss).toBe("crosshair");
  });

  it("leaves interactive selection cursors under the editor engine's control", () => {
    expect(cursorPresentationForTool("Select").css).toBeNull();
    expect(cursorPresentationForTool("Move").css).toBeNull();
    expect(cursorPresentationForTool("Rotate").css).toBeNull();
    expect(cursorPresentationForTool("Scale").css).toBeNull();
  });

  it("scales nominal brush size with zoom while enforcing the CSS visibility minimum", () => {
    expect(brushCursorDiameter(1, 0.5)).toBe(7);
    expect(brushCursorDiameter(12, 1)).toBe(12);
    expect(brushCursorDiameter(12, 2)).toBe(24);
    expect(() => brushCursorDiameter(0, 1)).toThrow(RangeError);
  });

  it("limits the ring to brush tools and the visible page hit region", () => {
    expect(
      ["Pencil", "Pen", "Marker", "Highlighter"].every((tool) =>
        usesImperativeBrushCursor(tool as EditorTool),
      ),
    ).toBe(true);
    expect(usesImperativeBrushCursor("Eraser")).toBe(false);
    const page = { x: 100, y: 80, width: 600, height: 800 };
    expect(pointIsWithinBrushPage({ x: 100, y: 80 }, page)).toBe(true);
    expect(pointIsWithinBrushPage({ x: 700, y: 880 }, page)).toBe(true);
    expect(pointIsWithinBrushPage({ x: 99, y: 80 }, page)).toBe(false);
    expect(nativeCursorForBrushRegion(true)).toBe("none");
    expect(nativeCursorForBrushRegion(false)).toBe("default");
  });
});
