import { describe, expect, it, vi } from "vitest";
import { createManipulationManager } from "../index";
import { pagePoint } from "./fixtures";

function manager(threshold = 4) {
  return createManipulationManager({
    configuration: { dragThreshold: threshold },
    createSessionId: () => "session-1",
    now: () => 42,
  });
}

describe("ManipulationManager", () => {
  it("owns a deeply immutable identity-only Preparing state", () => {
    const subject = manager();
    const state = subject.beginSession({
      objectId: "object-1",
      pointerId: 7,
      position: pagePoint(10, 20),
      initialObjectTranslation: { x: 3, y: 4 },
    });
    expect(state).toMatchObject({
      phase: "preparing",
      sessionId: "session-1",
      objectId: "object-1",
      pointerId: 7,
      translation: { translationX: 0, translationY: 0 },
      finalObjectTranslation: { x: 3, y: 4 },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.dragOrigin)).toBe(true);
    expect(Object.isFrozen(state.translation)).toBe(true);
  });

  it("keeps Preparing below and exactly at threshold, then remains Dragging", () => {
    const subject = manager(5);
    subject.beginSession({
      objectId: "object",
      pointerId: 1,
      position: pagePoint(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
    });
    expect(subject.updateSession(pagePoint(3, 4)).phase).toBe("preparing");
    expect(subject.updateSession(pagePoint(5.001, 0)).phase).toBe("dragging");
    expect(subject.updateSession(pagePoint(0, 0)).phase).toBe("dragging");
  });

  it("emits explicit commit and cancel transition paths before Idle", () => {
    const committed = manager(0);
    const commitPhases: string[] = [];
    committed.subscribe((state) => commitPhases.push(state.phase));
    committed.beginSession({
      objectId: "object",
      pointerId: 1,
      position: pagePoint(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
    });
    committed.updateSession(pagePoint(1, 0));
    committed.commitSession();
    expect(commitPhases).toEqual(["preparing", "dragging", "committing", "idle"]);

    const cancelled = manager();
    const cancelPhases: string[] = [];
    cancelled.subscribe((state) => cancelPhases.push(state.phase));
    cancelled.beginSession({
      objectId: "object",
      pointerId: 1,
      position: pagePoint(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
    });
    cancelled.cancelSession();
    expect(cancelPhases).toEqual(["preparing", "cancelling", "idle"]);
  });

  it("returns existing references for illegal or repeated transitions", () => {
    const subject = manager();
    const idle = subject.getState();
    expect(subject.updateSession(pagePoint(1, 1))).toBe(idle);
    expect(subject.commitSession()).toBe(idle);
    expect(subject.cancelSession()).toBe(idle);
    const preparing = subject.beginSession({
      objectId: "object",
      pointerId: 1,
      position: pagePoint(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
    });
    expect(
      subject.beginSession({
        objectId: "other",
        pointerId: 2,
        position: pagePoint(1, 1),
        initialObjectTranslation: { x: 0, y: 0 },
      }),
    ).toBe(preparing);
    expect(subject.updateSession(pagePoint(0, 0))).toBe(preparing);
    expect(subject.commitSession()).toBe(preparing);
  });

  it("supports idempotent subscriptions and validates configuration", () => {
    const subject = manager();
    const listener = vi.fn();
    const unsubscribe = subject.subscribe(listener);
    unsubscribe();
    unsubscribe();
    subject.beginSession({
      objectId: "object",
      pointerId: 1,
      position: pagePoint(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
    });
    expect(listener).not.toHaveBeenCalled();
    expect(() => createManipulationManager({ configuration: { dragThreshold: -1 } })).toThrow(
      RangeError,
    );
  });
});
