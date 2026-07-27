import { describe, expect, it, vi } from "vitest";
import {
  createManipulationController,
  createManipulationManager,
  type ManipulationPointerInput,
} from "../index";
import { createObject, createSources, pagePoint } from "./fixtures";

function pointer(
  phase: ManipulationPointerInput["phase"],
  x: number,
  y: number,
  overrides: Partial<ManipulationPointerInput> = {},
): ManipulationPointerInput {
  return {
    phase,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    position: pagePoint(x, y),
    ...overrides,
  };
}

function harness(objects = [createObject()], selectedId: string | null = "object-1") {
  const sources = createSources(objects, selectedId);
  const onCommit = vi.fn(() => true);
  const manager = createManipulationManager({
    createSessionId: () => "session",
    now: () => 10,
  });
  const controller = createManipulationController({ manager, ...sources, onCommit });
  return { controller, manager, onCommit, ...sources };
}

describe("ManipulationController", () => {
  it("commits one immutable origin-relative translation after a fast drag", () => {
    const { controller, onCommit } = harness();
    controller.handlePointer(pointer("down", 10, 10));
    const commit = controller.handlePointer(pointer("up", 90, 55));
    expect(commit).toMatchObject({
      objectId: "object-1",
      translation: { translationX: 80, translationY: 45 },
      finalObjectTranslation: { x: 80, y: 45 },
    });
    expect(Object.isFrozen(commit)).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(controller.getManipulationState().phase).toBe("idle");
  });

  it("uses the initial pointer rather than accumulating event deltas", () => {
    const direct = harness();
    direct.controller.handlePointer(pointer("down", 0, 0));
    const directCommit = direct.controller.handlePointer(pointer("up", 100, 75));

    const frequent = harness();
    frequent.controller.handlePointer(pointer("down", 0, 0));
    for (let index = 1; index <= 100; index += 1) {
      frequent.controller.handlePointer(pointer("move", index, index * 0.75));
    }
    const frequentCommit = frequent.controller.handlePointer(pointer("up", 100, 75));
    expect(frequentCommit?.translation).toEqual(directCommit?.translation);
  });

  it("cancels below and exactly at threshold without requesting replacement", () => {
    const below = harness();
    below.controller.handlePointer(pointer("down", 0, 0));
    expect(below.controller.handlePointer(pointer("up", 3, 0))).toBeNull();
    expect(below.onCommit).not.toHaveBeenCalled();

    const exact = harness();
    exact.controller.handlePointer(pointer("down", 0, 0));
    expect(exact.controller.handlePointer(pointer("up", 4, 0))).toBeNull();
    expect(exact.onCommit).not.toHaveBeenCalled();
  });

  it("cancels pointer cancellation and leaves commit untouched", () => {
    const { controller, onCommit } = harness();
    controller.handlePointer(pointer("down", 0, 0));
    controller.handlePointer(pointer("move", 20, 0));
    controller.handlePointer(pointer("cancel", 20, 0));
    expect(controller.getManipulationState().phase).toBe("idle");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("ignores missing selection, invalid identity, locked objects, and secondary input", () => {
    const none = harness([], null);
    none.controller.handlePointer(pointer("down", 0, 0));
    expect(none.controller.hasActiveSession()).toBe(false);

    const invalid = harness([], "missing");
    invalid.controller.handlePointer(pointer("down", 0, 0));
    expect(invalid.controller.hasActiveSession()).toBe(false);

    const locked = harness([createObject("object-1", true)]);
    locked.controller.handlePointer(pointer("down", 0, 0));
    expect(locked.controller.hasActiveSession()).toBe(false);

    const secondary = harness();
    secondary.controller.handlePointer(pointer("down", 0, 0, { isPrimary: false }));
    secondary.controller.handlePointer(pointer("down", 0, 0, { button: 2 }));
    expect(secondary.controller.hasActiveSession()).toBe(false);
  });

  it("ignores repeated pointer ownership events and null outside-page input", () => {
    const { controller, onCommit } = harness();
    controller.handlePointer(pointer("down", 0, 0));
    const preparing = controller.getManipulationState();
    controller.handlePointer(pointer("down", 10, 10, { pointerId: 2 }));
    controller.handlePointer(pointer("move", 20, 20, { pointerId: 2 }));
    controller.handlePointer(pointer("up", 20, 20, { pointerId: 2 }));
    expect(controller.getManipulationState()).toBe(preparing);
    controller.handlePointer(pointer("move", 0, 0, { position: null }));
    expect(controller.getManipulationState()).toBe(preparing);
    controller.handlePointer(pointer("up", 0, 0));
    controller.handlePointer(pointer("up", 0, 0));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels when object or notebook context disappears before commit", () => {
    const removed = harness();
    removed.controller.handlePointer(pointer("down", 0, 0));
    removed.controller.handlePointer(pointer("move", 20, 0));
    removed.objectSource.setObjects([]);
    expect(removed.controller.handlePointer(pointer("up", 20, 0))).toBeNull();
    expect(removed.onCommit).not.toHaveBeenCalled();

    const switched = harness();
    switched.controller.handlePointer(pointer("down", 0, 0));
    switched.controller.handlePointer(pointer("move", 20, 0));
    switched.selectionSource.select(null);
    expect(switched.controller.handlePointer(pointer("up", 20, 0))).toBeNull();
    expect(switched.controller.getManipulationState().phase).toBe("idle");
  });

  it("clears an unexpected active session during editor destruction", () => {
    const { controller, onCommit } = harness();
    controller.handlePointer(pointer("down", 0, 0));
    controller.handlePointer(pointer("move", 20, 0));
    controller.destroy();
    controller.destroy();
    expect(controller.getManipulationState().phase).toBe("idle");
    expect(controller.handlePointer(pointer("up", 20, 0))).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels cleanly when the editor rejects or throws during immutable replacement", () => {
    const rejectedSources = createSources([createObject()], "object-1");
    const rejectedManager = createManipulationManager();
    const rejected = createManipulationController({
      manager: rejectedManager,
      ...rejectedSources,
      onCommit: () => false,
    });
    rejected.handlePointer(pointer("down", 0, 0));
    rejected.handlePointer(pointer("move", 20, 0));
    expect(rejected.handlePointer(pointer("up", 20, 0))).toBeNull();
    expect(rejected.getManipulationState().phase).toBe("idle");

    const error = vi.fn();
    const throwingSources = createSources([createObject()], "object-1");
    const throwing = createManipulationController({
      manager: createManipulationManager(),
      ...throwingSources,
      onCommit: () => {
        throw new Error("replacement failed");
      },
      onError: error,
    });
    throwing.handlePointer(pointer("down", 0, 0));
    throwing.handlePointer(pointer("move", 20, 0));
    expect(throwing.handlePointer(pointer("up", 20, 0))).toBeNull();
    expect(throwing.getManipulationState().phase).toBe("idle");
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "replacement failed" }));
  });

  it.each([100, 1_000, 5_000])(
    "uses direct object lookup without copying a %i-object document",
    (count) => {
      const selected = createObject(`object-${count - 1}`);
      const shared = Array.from({ length: count - 1 }, (_, index) =>
        createObject(`object-${index}`),
      );
      const { controller, onCommit } = harness([...shared, selected], selected.id);
      controller.handlePointer(pointer("down", 0, 0));
      controller.handlePointer(pointer("move", 10, 10));
      controller.handlePointer(pointer("up", 10, 10));
      expect(onCommit).toHaveBeenCalledOnce();
    },
  );
});
