import { describe, expect, it } from "vitest";
import type { ContextHint } from "./context-hint-registry";
import { createContextHintRegistry } from "./context-hint-registry";

describe("context hint registry", () => {
  it("registers only the approved Select hint with the final wording", () => {
    const registry = createContextHintRegistry();

    expect(registry.registeredTools()).toEqual(["Select"]);
    expect(registry.resolve("Select")).toEqual({
      id: "select-overlapping-object",
      tool: "Select",
      text: "Tip: Alt + Click → Select object beneath",
    });
    expect(registry.resolve("Pen")).toBeNull();
  });

  it("accepts future tool registrations without changing status-bar code", () => {
    const futureHint: ContextHint = Object.freeze({
      id: "pen-straight-stroke",
      tool: "Pen",
      text: "Shift • Draw straight strokes",
    });

    expect(createContextHintRegistry([futureHint]).resolve("Pen")).toEqual(futureHint);
  });
});
