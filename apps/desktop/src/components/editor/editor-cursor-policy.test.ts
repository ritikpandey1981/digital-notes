import { describe, expect, it } from "vitest";
import type { EditorTool } from "./editor-types";
import { cursorPresentationForTool } from "./editor-cursor-policy";

describe("desktop editor cursor policy", () => {
  it("gives pen, highlighter, and eraser distinct custom cursors", () => {
    const pen = cursorPresentationForTool("Pen");
    const highlighter = cursorPresentationForTool("Highlighter");
    const eraser = cursorPresentationForTool("Eraser");

    expect(pen.id).toBe("pen");
    expect(highlighter.id).toBe("highlighter");
    expect(eraser.id).toBe("eraser");
    expect(pen.css).toContain("data:image/svg+xml");
    expect(new Set([pen.css, highlighter.css, eraser.css])).toHaveLength(3);
  });

  it("defines a cursor presentation for every desktop tool", () => {
    const tools: readonly EditorTool[] = [
      "Select",
      "Move",
      "Rotate",
      "Scale",
      "Pen",
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
      "pen",
      "highlighter",
      "eraser",
      "shapes",
      "text",
      "image",
      "table",
      "sticky-note",
    ]);
  });

  it("uses one crosshair cursor for the unified Shapes tool", () => {
    expect(cursorPresentationForTool("Shapes")).toEqual({ id: "shapes", css: "crosshair" });
  });

  it("leaves interactive selection cursors under the editor engine's control", () => {
    expect(cursorPresentationForTool("Select").css).toBeNull();
    expect(cursorPresentationForTool("Move").css).toBeNull();
    expect(cursorPresentationForTool("Rotate").css).toBeNull();
    expect(cursorPresentationForTool("Scale").css).toBeNull();
  });
});
