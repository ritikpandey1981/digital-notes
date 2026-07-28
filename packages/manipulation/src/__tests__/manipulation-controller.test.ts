import { describe, expect, it, vi } from "vitest";
import {
  createManipulationController,
  createManipulationManager,
  type ManipulationCommit,
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
  const onCommit = vi.fn((commit: ManipulationCommit) => commit.sessionId.length > 0);
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
    expect(commit).not.toHaveProperty("kind");
    expect(Object.isFrozen(commit)).toBe(true);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit.mock.calls[0]?.[0]).toBe(commit);
    expect(controller.getManipulationState().phase).toBe("idle");
  });

  it("publishes the generalized immutable result while preserving the legacy callback", () => {
    const sources = createSources([createObject()], "object-1");
    const onResult = vi.fn(() => true);
    const controller = createManipulationController({
      manager: createManipulationManager({
        configuration: { dragThreshold: 0 },
        createSessionId: () => "translation-session",
        now: () => 10,
      }),
      ...sources,
      onResult,
    });

    controller.handlePointer(pointer("down", 0, 0));
    const result = controller.handlePointer(pointer("up", 10, 5));

    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith(result);
    expect(result).toMatchObject({
      kind: "translation",
      sessionId: "translation-session",
      finalObjectTranslation: { x: 10, y: 5 },
    });
    if (result?.kind !== "translation") throw new Error("Expected a translation result.");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.translation)).toBe(true);
    expect(Object.isFrozen(result?.initialObjectTranslation)).toBe(true);
    expect(Object.isFrozen(result?.finalObjectTranslation)).toBe(true);
    controller.destroy();
  });

  it("publishes an immutable center-pivot rotation result through the same lifecycle", () => {
    const object = createObject();
    const center = {
      x: object.bounds.x + object.bounds.width / 2,
      y: object.bounds.y + object.bounds.height / 2,
    };
    const sources = createSources([object], object.id);
    const onResult = vi.fn(() => true);
    const controller = createManipulationController({
      manager: createManipulationManager({
        configuration: { dragThreshold: 0 },
        createSessionId: () => "rotation-session",
        now: () => 11,
      }),
      ...sources,
      onResult,
    });

    controller.handlePointer(pointer("down", center.x + 20, center.y, { kind: "rotation" }));
    const result = controller.handlePointer(pointer("up", center.x, center.y + 20));

    expect(result).toMatchObject({
      kind: "rotation",
      sessionId: "rotation-session",
      initialObjectRotation: 0,
      finalObjectRotation: Math.PI / 2,
    });
    if (result?.kind !== "rotation") throw new Error("Expected a rotation result.");
    expect(result.rotation.deltaRadians).toBeCloseTo(Math.PI / 2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rotation)).toBe(true);
    expect(onResult).toHaveBeenCalledWith(result);
    controller.destroy();
  });

  it("publishes an immutable uniform-scale result and rejects a center-origin session", () => {
    const object = createObject();
    const center = {
      x: object.bounds.x + object.bounds.width / 2,
      y: object.bounds.y + object.bounds.height / 2,
    };
    const sources = createSources([object], object.id);
    const onResult = vi.fn(() => true);
    const controller = createManipulationController({
      manager: createManipulationManager({
        configuration: { dragThreshold: 0 },
        createSessionId: () => "scale-session",
        now: () => 12,
      }),
      ...sources,
      onResult,
    });

    controller.handlePointer(pointer("down", center.x, center.y, { kind: "scale" }));
    expect(controller.hasActiveSession()).toBe(false);
    controller.handlePointer(pointer("down", center.x + 10, center.y, { kind: "scale" }));
    const result = controller.handlePointer(pointer("up", center.x + 20, center.y));

    expect(result).toMatchObject({
      kind: "scale",
      sessionId: "scale-session",
      initialObjectScale: 1,
      finalObjectScale: 2,
    });
    if (result?.kind !== "scale") throw new Error("Expected a scale result.");
    expect(result.scale.factor).toBe(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scale)).toBe(true);
    expect(onResult).toHaveBeenCalledWith(result);
    controller.destroy();
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

  it("cancels immediately when the active object becomes hidden or locked", () => {
    const hidden = harness();
    hidden.controller.handlePointer(pointer("down", 0, 0));
    hidden.controller.handlePointer(pointer("move", 20, 0));
    hidden.objectSource.setObjects([createObject("object-1", false, false)]);
    hidden.controller.handlePointer(pointer("move", 25, 0));
    expect(hidden.controller.getManipulationState().phase).toBe("idle");
    expect(hidden.onCommit).not.toHaveBeenCalled();

    const locked = harness();
    locked.controller.handlePointer(pointer("down", 0, 0));
    locked.controller.handlePointer(pointer("move", 20, 0));
    locked.objectSource.setObjects([createObject("object-1", true)]);
    locked.controller.handlePointer(pointer("move", 25, 0));
    expect(locked.controller.getManipulationState().phase).toBe("idle");
    expect(locked.onCommit).not.toHaveBeenCalled();
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
