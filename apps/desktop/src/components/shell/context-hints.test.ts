import { describe, expect, it } from "vitest";
import type { ContextHint } from "./context-hint-registry";
import { createContextHintRegistry } from "./context-hint-registry";

describe("context hint registry", () => {
  it("resolves the approved tool and shape-subtype hints with their exact wording", () => {
    const registry = createContextHintRegistry();

    expect(registry.registeredTools()).toEqual(["Select", "Shapes"]);
    expect(registry.resolve({ tool: "Select" })).toEqual({
      id: "select-overlapping-object",
      tool: "Select",
      text: "Tip: Alt + Click → Select object beneath",
    });
    expect(registry.resolve({ tool: "Shapes", shapeKind: "rectangle" })).toEqual({
      id: "shape-perfect-square",
      tool: "Shapes",
      shapeKind: "rectangle",
      text: "Tip: Hold Shift → Draw a perfect square",
    });
    expect(registry.resolve({ tool: "Shapes", shapeKind: "ellipse" })).toEqual({
      id: "shape-perfect-circle",
      tool: "Shapes",
      shapeKind: "ellipse",
      text: "Tip: Hold Shift → Draw a perfect circle",
    });
  });

  it("returns no shape hint for Line, Pen, or Highlighter and falls back to Select", () => {
    const registry = createContextHintRegistry();

    expect(registry.resolve({ tool: "Shapes", shapeKind: "line" })).toBeNull();
    expect(registry.resolve({ tool: "Pen", shapeKind: "rectangle" })).toBeNull();
    expect(registry.resolve({ tool: "Highlighter", shapeKind: "ellipse" })).toBeNull();
    expect(registry.resolve({ tool: "Select", shapeKind: "ellipse" })?.id).toBe(
      "select-overlapping-object",
    );
  });

  it("updates immediately as callers supply new workspace context", () => {
    const registry = createContextHintRegistry();
    const contexts = [
      { tool: "Shapes", shapeKind: "rectangle" },
      { tool: "Shapes", shapeKind: "ellipse" },
      { tool: "Shapes", shapeKind: "line" },
      { tool: "Select", shapeKind: "line" },
      { tool: "Pen", shapeKind: "line" },
    ] as const;

    expect(contexts.map((context) => registry.resolve(context)?.id ?? null)).toEqual([
      "shape-perfect-square",
      "shape-perfect-circle",
      null,
      "select-overlapping-object",
      null,
    ]);
  });

  it("accepts future contextual registrations without changing status-bar code", () => {
    const futureHint: ContextHint = Object.freeze({
      id: "pen-straight-stroke",
      tool: "Pen",
      text: "Shift • Draw straight strokes",
    });

    expect(createContextHintRegistry([futureHint]).resolve({ tool: "Pen" })).toEqual(futureHint);
  });
});
