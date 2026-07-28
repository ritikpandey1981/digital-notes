import { describe, expect, it } from "vitest";
import {
  HistoryError,
  createEditorHistoryManager,
  createHistoryController,
  isHistoryError,
} from "../index";
import type { IHistoryManager } from "../index";
import type { HistoryNotification } from "../index";
import {
  counter,
  createCounterCommand,
  createDocumentSessionFixture,
} from "./editor-history-fixtures";
import type { CounterDocument } from "./editor-history-fixtures";

type CounterHistoryManager = IHistoryManager<CounterDocument>;

const transactionOptions = Object.freeze({
  id: "failure-transaction",
  timestamp: "2026-07-28T01:02:03.000Z",
  description: "Failure transaction",
});

describe("generic editor History transaction failures", () => {
  it("rejects nested transactions without changing the active transaction", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const active = manager.beginTransaction(transactionOptions);

    const error = captureHistoryError(() =>
      manager.beginTransaction({ ...transactionOptions, id: "nested" }),
    );

    expect(error.code).toBe("TRANSACTION_ACTIVE");
    expect(manager.getHistoryState().activeTransaction).toEqual(active);
  });

  it.each([
    ["undo", (manager: CounterHistoryManager) => manager.undo()],
    ["redo", (manager: CounterHistoryManager) => manager.redo()],
    ["clear", (manager: CounterHistoryManager) => manager.clearHistory()],
  ])("rejects %s while a transaction is active", (_name, operation) => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);

    expect(captureHistoryError(() => operation(manager)).code).toBe("TRANSACTION_ACTIVE");
    expect(manager.getHistoryState().activeTransaction).toMatchObject(transactionOptions);
  });

  it.each([
    ["commit", (manager: CounterHistoryManager) => manager.commitTransaction()],
    ["rollback", (manager: CounterHistoryManager) => manager.rollbackTransaction()],
  ])("rejects %s without an active transaction without changing History", (_name, operation) => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const before = manager.getHistoryState();

    expect(captureHistoryError(() => operation(manager)).code).toBe("TRANSACTION_NOT_ACTIVE");
    expect(manager.getHistoryState()).toEqual(before);
  });

  it.each([
    { id: " ", timestamp: transactionOptions.timestamp, description: "Description" },
    { id: "transaction", timestamp: "not-a-date", description: "Description" },
    { id: "transaction", timestamp: transactionOptions.timestamp, description: " " },
  ])("rejects invalid transaction metadata without opening a transaction", (options) => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });

    expect(captureHistoryError(() => manager.beginTransaction(options)).code).toBe(
      "INVALID_COMMAND",
    );
    expect(manager.getHistoryState().activeTransaction).toBeNull();
  });

  it("rejects a non-object transaction options value with a structured error", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });

    expect(
      captureHistoryError(() =>
        manager.beginTransaction(null as unknown as typeof transactionOptions),
      ).code,
    ).toBe("INVALID_COMMAND");
    expect(manager.getHistoryState().activeTransaction).toBeNull();
  });

  it("keeps an active transaction consistent after a child execution failure", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(createCounterCommand({ id: "successful" }));
    const before = manager.getHistoryState();

    const error = captureHistoryError(() =>
      manager.executeCommand(
        createCounterCommand({
          id: "failed-child",
          execute: () => {
            throw new Error("Child execution failed.");
          },
        }),
      ),
    );

    expect(error.code).toBe("COMMAND_EXECUTION_FAILED");
    expect(fixture.current.value).toBe(1);
    expect(manager.getHistoryState()).toMatchObject({
      undoDepth: before.undoDepth,
      redoDepth: before.redoDepth,
      historyVersion: before.historyVersion,
      executionCounter: before.executionCounter,
      activeTransaction: before.activeTransaction,
      executionState: { phase: "idle" },
    });
  });

  it("keeps the document and transaction intact when rollback calculation fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(
      createCounterCommand({
        id: "failed-rollback-child",
        undo: () => {
          throw new Error("Rollback failed.");
        },
      }),
    );
    manager.executeCommand(createCounterCommand({ id: "later-child", delta: 2 }));
    const documentBefore = fixture.current;
    const stateBefore = manager.getHistoryState();

    const error = captureHistoryError(() => manager.rollbackTransaction());

    expect(error.code).toBe("TRANSACTION_ROLLBACK_FAILED");
    expect(fixture.current).toBe(documentBefore);
    expect(manager.getHistoryState()).toEqual(stateBefore);
  });

  it("rejects reentrant operations while rollback is calculating", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    let reentrantError: HistoryError | undefined;
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(
      createCounterCommand({
        id: "reentrant-rollback",
        undo: (document) => {
          reentrantError = captureHistoryError(() => manager.commitTransaction());
          return counter(document.value - 1);
        },
      }),
    );

    manager.rollbackTransaction();

    expect(reentrantError?.code).toBe("HISTORY_LIFECYCLE_VIOLATION");
    expect(fixture.current.value).toBe(0);
    expect(manager.getHistoryState().activeTransaction).toBeNull();
  });

  it("keeps the transaction active when rollback document replacement fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(createCounterCommand({ id: "rollback-replacement" }));
    const documentBefore = fixture.current;
    const stateBefore = manager.getHistoryState();
    fixture.failNextReplacement("before");

    expect(captureHistoryError(() => manager.rollbackTransaction()).code).toBe(
      "TRANSACTION_ROLLBACK_FAILED",
    );
    expect(fixture.current).toBe(documentBefore);
    expect(manager.getHistoryState()).toEqual(stateBefore);

    expect(manager.rollbackTransaction().activeTransaction).toBeNull();
    expect(fixture.current.value).toBe(0);
  });

  it("keeps a committed transaction atomic when grouped undo fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(
      createCounterCommand({
        id: "first",
        undo: () => {
          throw new Error("Grouped undo failed.");
        },
      }),
    );
    manager.executeCommand(createCounterCommand({ id: "second", delta: 2 }));
    manager.commitTransaction();
    const documentBefore = fixture.current;
    const stateBefore = manager.getHistoryState();

    expect(captureHistoryError(() => manager.undo()).code).toBe("COMMAND_UNDO_FAILED");
    expect(fixture.current).toBe(documentBefore);
    expect(manager.getHistoryState()).toEqual(stateBefore);
  });

  it("publishes one immutable failure notification for grouped undo failure", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((notification) => notifications.push(notification));
    controller.beginTransaction(transactionOptions);
    controller.executeCommand(
      createCounterCommand({
        id: "failing-group-child",
        undo: () => {
          throw new Error("Grouped undo failed.");
        },
      }),
    );
    controller.commitTransaction();
    notifications.length = 0;

    const error = captureHistoryError(() => controller.undo());

    expect(error.code).toBe("COMMAND_UNDO_FAILED");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "undo",
      outcome: "failed",
      command: { id: transactionOptions.id },
      state: { undoDepth: 1, redoDepth: 0, activeTransaction: null },
      error,
    });
    expect(Object.isFrozen(notifications[0])).toBe(true);
    expect(Object.isFrozen(error)).toBe(true);
  });

  it("keeps a committed transaction atomic when grouped redo fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(createCounterCommand({ id: "first" }));
    manager.executeCommand(
      createCounterCommand({
        id: "second",
        delta: 2,
        redo: () => {
          throw new Error("Grouped redo failed.");
        },
      }),
    );
    manager.commitTransaction();
    manager.undo();
    const documentBefore = fixture.current;
    const stateBefore = manager.getHistoryState();

    expect(captureHistoryError(() => manager.redo()).code).toBe("COMMAND_REDO_FAILED");
    expect(fixture.current).toBe(documentBefore);
    expect(manager.getHistoryState()).toEqual(stateBefore);
  });

  it("isolates listener failures during transactional command and grouped undo notifications", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const received: string[] = [];
    controller.subscribe(() => {
      throw new Error("Listener failure.");
    });
    controller.subscribe(({ operation }) => received.push(operation));

    controller.beginTransaction(transactionOptions);
    controller.executeCommand(createCounterCommand({ id: "transaction-command" }));
    controller.commitTransaction();
    controller.undo();

    expect(received).toEqual(["execute", "undo"]);
    expect(fixture.current.value).toBe(0);
    expect(controller.getHistoryState()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
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
