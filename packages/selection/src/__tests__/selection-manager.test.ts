import { describe, expect, it, vi } from "vitest";
import { createSelectionManager } from "../index";

describe("SelectionManager", () => {
  it("starts with a deeply immutable identity-only empty state", () => {
    const manager = createSelectionManager();
    const state = manager.getSelection();
    expect(state).toEqual({
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedObjectType: null,
      selectionTimestamp: null,
      selectionVersion: 0,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.selectedObjectIds)).toBe(true);
    expect(manager.hasSelection()).toBe(false);
  });

  it("selects by stable identity and replaces immutable state", () => {
    const manager = createSelectionManager({ now: () => 42 });
    const initial = manager.getSelection();
    const selected = manager.selectObject({ objectId: "object-1", objectType: "ink" });
    expect(selected).toEqual({
      selectedObjectId: "object-1",
      selectedObjectIds: ["object-1"],
      selectedObjectType: "ink",
      selectionTimestamp: 42,
      selectionVersion: 1,
    });
    expect(manager.isSelected("object-1")).toBe(true);
    expect(manager.hasSelection()).toBe(true);
    expect(initial.selectedObjectId).toBeNull();
    expect(Object.isFrozen(selected)).toBe(true);
  });

  it("does not recreate or notify for a repeated selection", () => {
    const listener = vi.fn();
    const manager = createSelectionManager({ now: () => 1 });
    manager.subscribe(listener);
    const first = manager.selectObject({ objectId: "object-1", objectType: "ink" });
    const repeated = manager.selectObject({ objectId: "object-1", objectType: "ink" });
    expect(repeated).toBe(first);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("replaces and clears selection with monotonic versions", () => {
    let timestamp = 0;
    const manager = createSelectionManager({ now: () => ++timestamp });
    manager.selectObject({ objectId: "object-1", objectType: "ink" });
    const replaced = manager.selectObject({ objectId: "object-2", objectType: "ink" });
    const cleared = manager.clearSelection();
    expect(replaced.selectionVersion).toBe(2);
    expect(cleared).toMatchObject({
      selectedObjectId: null,
      selectedObjectType: null,
      selectionTimestamp: 3,
      selectionVersion: 3,
    });
    expect(manager.clearSelection()).toBe(cleared);
  });

  it("subscribes and unsubscribes without retaining duplicate notifications", () => {
    const manager = createSelectionManager({ now: () => 1 });
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    manager.selectObject({ objectId: "object-1", objectType: "ink" });
    unsubscribe();
    unsubscribe();
    manager.clearSelection();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].selectedObjectId).toBe("object-1");
    expect(listener.mock.calls[0]?.[1].selectedObjectId).toBeNull();
  });

  it("ignores empty identities and rejects invalid clock implementations", () => {
    const manager = createSelectionManager({ now: () => Number.NaN });
    const initial = manager.getSelection();
    expect(manager.selectObject({ objectId: " ", objectType: "ink" })).toBe(initial);
    expect(() => manager.selectObject({ objectId: "object", objectType: "ink" })).toThrow(
      RangeError,
    );
  });
});
