import { describe, expect, it } from "vitest";
import {
  HistoryError,
  createEditorHistoryManager,
  createHistoryController,
  isHistoryError,
} from "../index";
import type {
  EditorCommand,
  HistoryListener,
  HistoryNotification,
  IHistoryManager,
} from "../index";
import { createCounterCommand, createDocumentSessionFixture } from "./editor-history-fixtures";
import type { CounterDocument } from "./editor-history-fixtures";

describe("generic History controller failures and cleanup", () => {
  it("publishes immutable failed-execute state before restoring idle", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((event) => {
      notifications.push(event);
      expect(manager.getHistoryState().executionState.phase).toBe("completed");
    });
    const command = createCounterCommand({
      id: "failed-execute",
      execute: () => {
        throw new Error("Command failure.");
      },
    });

    const error = captureHistoryError(() => controller.executeCommand(command));

    expect(error.code).toBe("COMMAND_EXECUTION_FAILED");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "execute",
      outcome: "failed",
      command: { id: "failed-execute" },
      state: {
        undoDepth: 0,
        redoDepth: 0,
        historyVersion: 0,
        executionCounter: 0,
        executionState: { phase: "completed", operation: "execute", outcome: "failed" },
      },
      error,
    });
    expect(Object.isFrozen(notifications[0])).toBe(true);
    expect(Object.isFrozen(error)).toBe(true);
    expect(controller.getHistoryState().executionState.phase).toBe("idle");
    expect(fixture.current.value).toBe(0);
  });

  it("publishes failed undo and redo without moving either stack", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((event) => notifications.push(event));
    controller.executeCommand(
      createCounterCommand({
        id: "failed-reversal",
        undo: () => {
          throw new Error("Undo failure.");
        },
      }),
    );
    notifications.length = 0;
    const beforeUndo = controller.getHistoryState();

    expect(captureHistoryError(() => controller.undo()).code).toBe("COMMAND_UNDO_FAILED");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ operation: "undo", outcome: "failed" });
    expect(controller.getHistoryState()).toEqual(beforeUndo);

    const redoFixture = createDocumentSessionFixture();
    const redoManager = createEditorHistoryManager({ documentSession: redoFixture.session });
    const redoController = createHistoryController({ manager: redoManager });
    const redoNotifications: HistoryNotification[] = [];
    redoController.subscribe((event) => redoNotifications.push(event));
    redoController.executeCommand(
      createCounterCommand({
        id: "failed-redo",
        redo: () => {
          throw new Error("Redo failure.");
        },
      }),
    );
    redoController.undo();
    redoNotifications.length = 0;
    const beforeRedo = redoController.getHistoryState();

    expect(captureHistoryError(() => redoController.redo()).code).toBe("COMMAND_REDO_FAILED");
    expect(redoNotifications).toHaveLength(1);
    expect(redoNotifications[0]).toMatchObject({ operation: "redo", outcome: "failed" });
    expect(redoController.getHistoryState()).toEqual(beforeRedo);
  });

  it("publishes one fallback failure for a command rejected before execution", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((event) => notifications.push(event));
    const invalid = Object.freeze({
      ...createCounterCommand(),
      id: " ",
    }) as EditorCommand<CounterDocument>;

    const error = captureHistoryError(() => controller.executeCommand(invalid));

    expect(error.code).toBe("INVALID_EDITOR_COMMAND");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "execute",
      outcome: "failed",
      command: null,
      state: { executionState: { phase: "idle" }, historyVersion: 0, executionCounter: 0 },
      error,
    });
  });

  it("rejects reentrant mutation from listeners without duplicating notifications", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    let reentrantError: HistoryError | undefined;
    controller.subscribe((event) => {
      notifications.push(event);
      reentrantError = captureHistoryError(() => controller.undo());
    });

    controller.executeCommand(createCounterCommand({ id: "reentrant-listener" }));

    expect(reentrantError?.code).toBe("HISTORY_LIFECYCLE_VIOLATION");
    expect(notifications).toHaveLength(1);
    expect(controller.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
  });

  it("enforces one active controller per manager and releases ownership on destroy", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const first = createHistoryController({ manager });

    expect(captureHistoryError(() => createHistoryController({ manager })).code).toBe(
      "HISTORY_MANAGER_ALREADY_CONTROLLED",
    );

    first.destroy();
    const replacement = createHistoryController({ manager });
    expect(() =>
      replacement.executeCommand(createCounterCommand({ id: "replacement-controller" })),
    ).not.toThrow();
  });

  it("rejects managers that were not created by the Stage 3 factory", () => {
    const unsupported = Object.freeze({}) as IHistoryManager<CounterDocument>;

    expect(captureHistoryError(() => createHistoryController({ manager: unsupported })).code).toBe(
      "INVALID_HISTORY_MANAGER",
    );
  });

  it("rejects non-function listeners", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });

    const error = captureHistoryError(() =>
      controller.subscribe(null as unknown as HistoryListener),
    );

    expect(error.code).toBe("INVALID_HISTORY_LISTENER");
  });

  it("clears listeners, releases its manager, and rejects calls after destroy", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const received: HistoryNotification[] = [];
    const unsubscribe = controller.subscribe((event) => received.push(event));

    controller.destroy();
    controller.destroy();
    unsubscribe();
    manager.executeCommand(createCounterCommand({ id: "direct-after-destroy" }));

    expect(received).toEqual([]);
    for (const operation of [
      () => controller.executeCommand(createCounterCommand()),
      () => controller.undo(),
      () => controller.redo(),
      () => controller.clearHistory(),
      () => controller.canUndo(),
      () => controller.canRedo(),
      () => controller.getHistoryState(),
      () => controller.getHistoryVersion(),
      () => controller.beginTransaction(),
      () => controller.commitTransaction(),
      () => controller.rollbackTransaction(),
      () => controller.subscribe(() => undefined),
    ]) {
      expect(captureHistoryError(operation).code).toBe("HISTORY_CONTROLLER_DESTROYED");
    }
  });

  it("allows cleanup during notification without calling later listeners", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const received: string[] = [];
    controller.subscribe(() => {
      received.push("destroying");
      controller.destroy();
    });
    controller.subscribe(() => received.push("after-destroy"));

    controller.executeCommand(createCounterCommand({ id: "destroy-during-notification" }));

    expect(received).toEqual(["destroying"]);
    expect(fixture.current.value).toBe(1);
  });
});

function captureHistoryError(action: () => unknown): HistoryError {
  try {
    action();
  } catch (error) {
    expect(isHistoryError(error)).toBe(true);
    return error as HistoryError;
  }
  throw new Error("Expected a HistoryError.");
}
