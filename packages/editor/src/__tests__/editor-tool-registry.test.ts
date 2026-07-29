import { describe, expect, it, vi } from "vitest";
import { createEditorToolRegistry, type EditorTool } from "../index";

describe("EditorToolRegistry", () => {
  it("owns activation, event delegation, temporary rendering, and cleanup", () => {
    const calls: string[] = [];
    const cursor = vi.fn();
    const first = tool("select", calls);
    const second = tool("pen", calls);
    const registry = createEditorToolRegistry({
      setCursor: cursor,
      requestTemporaryRender: () => calls.push("request-render"),
    });
    registry.register(first);
    registry.register(second);
    registry.activate("select");
    registry.handlePointer("down", {} as PointerEvent);
    registry.handleKeyboard("down", {} as KeyboardEvent);
    registry.renderTemporary();
    registry.activate("pen");
    registry.handlePointer("move", {} as PointerEvent);
    registry.destroy();

    expect(calls).toEqual([
      "select:activate",
      "select:pointer-down",
      "select:key-down",
      "select:render",
      "select:deactivate",
      "pen:activate",
      "pen:pointer-move",
      "pen:deactivate",
      "select:cleanup",
      "pen:cleanup",
    ]);
    expect(cursor).toHaveBeenCalledWith("crosshair");
    expect(registry.snapshot().destroyed).toBe(true);
    expect(() => registry.activate("select")).toThrow("destroyed");
  });

  it("rejects duplicates and restores the previous tool after activation failure", () => {
    const registry = createEditorToolRegistry({
      setCursor: () => undefined,
      requestTemporaryRender: () => undefined,
    });
    const stable = tool("stable", []);
    registry.register(stable);
    registry.activate("stable");
    registry.register({
      id: "broken",
      cursor: "wait",
      activate: () => {
        throw new Error("activation failed");
      },
    });
    expect(() => registry.register(stable)).toThrow("registered");
    expect(() => registry.activate("broken")).toThrow("activation failed");
    expect(registry.snapshot().activeToolId).toBe("stable");
  });
});

function tool(id: string, calls: string[]): EditorTool {
  return {
    id,
    cursor: id === "pen" ? "crosshair" : "default",
    activate: () => calls.push(id + ":activate"),
    deactivate: () => calls.push(id + ":deactivate"),
    pointerDown: () => calls.push(id + ":pointer-down"),
    pointerMove: () => calls.push(id + ":pointer-move"),
    keyboardDown: () => calls.push(id + ":key-down"),
    renderTemporary: () => calls.push(id + ":render"),
    cleanup: () => calls.push(id + ":cleanup"),
  };
}
