import { describe, expect, it } from "vitest";
import { createEditorHistoryManager, createHistoryController } from "../index";
import type { HistoryNotification } from "../index";
import {
  counter,
  createCounterCommand,
  createDocumentSessionFixture,
} from "./editor-history-fixtures";

describe("generic History controller", () => {
  it("publishes successful execution before returning and while lifecycle is completed", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const timeline: string[] = [];
    let notification: HistoryNotification | undefined;
    controller.subscribe((event) => {
      timeline.push("notification");
      notification = event;
      expect(fixture.current.value).toBe(1);
      expect(manager.getHistoryState().executionState.phase).toBe("completed");
    });
    const command = createCounterCommand({
      id: "ordered-execute",
      execute: (document) => {
        timeline.push("command");
        return counter(document.value + 1);
      },
    });

    const result = controller.executeCommand(command);
    timeline.push("return");

    expect(timeline).toEqual(["command", "notification", "return"]);
    expect(notification).toMatchObject({
      operation: "execute",
      outcome: "succeeded",
      command: { id: "ordered-execute" },
      state: {
        historyVersion: 1,
        executionCounter: 1,
        executionState: { phase: "completed", operation: "execute", outcome: "succeeded" },
      },
    });
    expect(notification?.state).toBe(result);
    expect(controller.getHistoryState().executionState.phase).toBe("idle");
  });

  it("publishes one ordered notification for execute, undo, and redo", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((event) => notifications.push(event));

    controller.executeCommand(createCounterCommand({ id: "lifecycle" }));
    controller.undo();
    controller.redo();

    expect(notifications.map(({ operation }) => operation)).toEqual(["execute", "undo", "redo"]);
    expect(notifications.map(({ outcome }) => outcome)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(notifications.map(({ state }) => state.historyVersion)).toEqual([1, 2, 3]);
    expect(notifications.map(({ state }) => state.executionCounter)).toEqual([1, 2, 3]);
    expect(notifications.every(({ state }) => state.executionState.phase === "completed")).toBe(
      true,
    );
  });

  it("does not notify for empty undo, empty redo, or clear", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((event) => notifications.push(event));

    controller.undo();
    controller.redo();
    controller.executeCommand(createCounterCommand({ id: "clear-me" }));
    notifications.length = 0;
    const cleared = controller.clearHistory();

    expect(notifications).toEqual([]);
    expect(cleared).toMatchObject({ undoDepth: 0, redoDepth: 0, historyVersion: 2 });
    expect(fixture.current.value).toBe(1);
  });

  it("publishes frozen notifications with frozen state and command metadata", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    let notification: HistoryNotification | undefined;
    controller.subscribe((event) => {
      notification = event;
    });

    controller.executeCommand(createCounterCommand({ id: "immutable-event" }));

    expect(Object.isFrozen(notification)).toBe(true);
    expect(Object.isFrozen(notification?.command)).toBe(true);
    expect(Object.isFrozen(notification?.state)).toBe(true);
    expect(Object.isFrozen(notification?.state.executionState)).toBe(true);
  });

  it("supports listener removal with an idempotent unsubscribe callback", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const received: string[] = [];
    const unsubscribeFirst = controller.subscribe(() => received.push("first"));
    controller.subscribe(() => received.push("second"));

    controller.executeCommand(createCounterCommand({ id: "before-unsubscribe" }));
    unsubscribeFirst();
    unsubscribeFirst();
    controller.executeCommand(createCounterCommand({ id: "after-unsubscribe" }));

    expect(received).toEqual(["first", "second", "second"]);
  });

  it("isolates listener failures and continues notifying remaining listeners", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const received: string[] = [];
    controller.subscribe(() => {
      received.push("throwing");
      throw new Error("Listener failure.");
    });
    controller.subscribe(() => received.push("healthy"));

    expect(() =>
      controller.executeCommand(createCounterCommand({ id: "listener-isolation" })),
    ).not.toThrow();

    expect(received).toEqual(["throwing", "healthy"]);
    expect(fixture.current.value).toBe(1);
    expect(controller.getHistoryState()).toMatchObject({ undoDepth: 1, historyVersion: 1 });
  });

  it("delegates state queries directly to its owned manager", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    controller.executeCommand(createCounterCommand({ id: "delegated" }));

    expect(controller.canUndo()).toBe(manager.canUndo());
    expect(controller.canRedo()).toBe(manager.canRedo());
    expect(controller.getHistoryVersion()).toBe(manager.getHistoryVersion());
    expect(controller.getHistoryState()).toEqual(manager.getHistoryState());
  });
});
