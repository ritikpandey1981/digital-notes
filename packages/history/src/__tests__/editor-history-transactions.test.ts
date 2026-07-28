import { describe, expect, it } from "vitest";
import { createEditorHistoryManager, createHistoryController } from "../index";
import type { HistoryNotification } from "../index";
import {
  counter,
  createCounterCommand,
  createDocumentSessionFixture,
} from "./editor-history-fixtures";

const transactionOptions = Object.freeze({
  id: "counter-transaction",
  timestamp: "2026-07-28T01:02:03.000Z",
  description: "Change the counter",
});

describe("generic editor History transactions", () => {
  it("begins one immutable transaction owned by the manager", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });

    const transaction = manager.beginTransaction(transactionOptions);

    expect(transaction).toEqual({ ...transactionOptions, commandCount: 0 });
    expect(manager.getHistoryState()).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      activeTransaction: transaction,
    });
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(manager.getHistoryState().activeTransaction).not.toBe(transaction);
    expect(Object.isFrozen(manager.getHistoryState().activeTransaction)).toBe(true);
  });

  it("creates valid default metadata without sharing transaction state between managers", () => {
    const firstFixture = createDocumentSessionFixture();
    const secondFixture = createDocumentSessionFixture();
    const first = createEditorHistoryManager({ documentSession: firstFixture.session });
    const second = createEditorHistoryManager({ documentSession: secondFixture.session });

    const transaction = first.beginTransaction();

    expect(transaction.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Number.isFinite(Date.parse(transaction.timestamp))).toBe(true);
    expect(transaction.description).toBe("Transaction");
    expect(first.getHistoryState().activeTransaction).toEqual(transaction);
    expect(second.getHistoryState().activeTransaction).toBeNull();
  });

  it("commits multiple child commands as one undo and redo step", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);

    manager.executeCommand(createCounterCommand({ id: "one", delta: 1 }));
    manager.executeCommand(createCounterCommand({ id: "two", delta: 2 }));
    manager.executeCommand(createCounterCommand({ id: "three", delta: 3 }));

    expect(fixture.current.value).toBe(6);
    expect(manager.getHistoryState()).toMatchObject({
      canUndo: false,
      undoDepth: 0,
      redoDepth: 0,
      historyVersion: 3,
      executionCounter: 3,
      activeTransaction: { ...transactionOptions, commandCount: 3 },
    });

    const committed = manager.commitTransaction();
    expect(committed).toMatchObject({
      canUndo: true,
      undoDepth: 1,
      redoDepth: 0,
      historyVersion: 3,
      executionCounter: 3,
      activeTransaction: null,
    });

    const replacementsBeforeUndo = fixture.replacements.length;
    expect(manager.undo()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
    expect(fixture.current.value).toBe(0);
    expect(fixture.replacements).toHaveLength(replacementsBeforeUndo + 1);
    expect(manager.redo()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(fixture.current.value).toBe(6);
    expect(fixture.replacements).toHaveLength(replacementsBeforeUndo + 2);
  });

  it("uses reverse undo order and forward redo order", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const operations: string[] = [];
    const command = (id: string, delta: number) =>
      createCounterCommand({
        id,
        delta,
        execute: (document) => {
          operations.push(`execute:${id}`);
          return counter(document.value + delta);
        },
        undo: (document) => {
          operations.push(`undo:${id}`);
          return counter(document.value - delta);
        },
        redo: (document) => {
          operations.push(`redo:${id}`);
          return counter(document.value + delta);
        },
      });

    manager.beginTransaction(transactionOptions);
    manager.executeCommand(command("first", 1));
    manager.executeCommand(command("second", 2));
    manager.commitTransaction();
    manager.undo();
    manager.redo();

    expect(operations).toEqual([
      "execute:first",
      "execute:second",
      "undo:second",
      "undo:first",
      "redo:first",
      "redo:second",
    ]);
  });

  it("rolls back in reverse order with one atomic document replacement", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const order: string[] = [];
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(
      createCounterCommand({
        id: "first",
        delta: 1,
        undo: (document) => {
          order.push("first");
          return counter(document.value - 1);
        },
      }),
    );
    manager.executeCommand(
      createCounterCommand({
        id: "second",
        delta: 2,
        undo: (document) => {
          order.push("second");
          return counter(document.value - 2);
        },
      }),
    );
    const replacementsBeforeRollback = fixture.replacements.length;

    const state = manager.rollbackTransaction();

    expect(order).toEqual(["second", "first"]);
    expect(fixture.current.value).toBe(0);
    expect(fixture.replacements).toHaveLength(replacementsBeforeRollback + 1);
    expect(state).toMatchObject({
      undoDepth: 0,
      redoDepth: 0,
      historyVersion: 3,
      executionCounter: 2,
      activeTransaction: null,
    });
  });

  it("preserves an existing redo branch when rolling back", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createCounterCommand({ id: "existing", delta: 5 }));
    manager.undo();
    manager.beginTransaction(transactionOptions);
    manager.executeCommand(createCounterCommand({ id: "rolled-back", delta: 2 }));

    manager.rollbackTransaction();

    expect(fixture.current.value).toBe(0);
    expect(manager.getHistoryState()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
    manager.redo();
    expect(fixture.current.value).toBe(5);
  });

  it("commits an empty transaction without changing stacks or a redo branch", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createCounterCommand({ id: "existing" }));
    manager.undo();
    const before = manager.getHistoryState();
    manager.beginTransaction(transactionOptions);

    const committed = manager.commitTransaction();

    expect(committed).toMatchObject({
      undoDepth: before.undoDepth,
      redoDepth: before.redoDepth,
      historyVersion: before.historyVersion,
      executionCounter: before.executionCounter,
      activeTransaction: null,
    });
    expect(manager.canRedo()).toBe(true);
  });

  it("does not collect no-op child commands", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction(transactionOptions);

    const state = manager.executeCommand(
      createCounterCommand({ id: "no-op", execute: (document) => document }),
    );

    expect(state).toMatchObject({
      historyVersion: 0,
      executionCounter: 1,
      activeTransaction: { commandCount: 0 },
    });
    expect(manager.commitTransaction()).toMatchObject({ undoDepth: 0, redoDepth: 0 });
  });

  it("counts each committed transaction as one bounded history entry", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({
      documentSession: fixture.session,
      historyLimit: 2,
    });

    for (let index = 1; index <= 3; index += 1) {
      manager.beginTransaction({ ...transactionOptions, id: `transaction-${index}` });
      manager.executeCommand(createCounterCommand({ id: `command-${index}` }));
      manager.commitTransaction();
    }

    expect(manager.getHistoryState().undoDepth).toBe(2);
    manager.undo();
    manager.undo();
    manager.undo();
    expect(fixture.current.value).toBe(1);
  });

  it("publishes only the approved immutable command lifecycle notifications", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    const observedPhases: string[] = [];
    controller.subscribe((notification) => {
      notifications.push(notification);
      observedPhases.push(manager.getHistoryState().executionState.phase);
    });

    controller.beginTransaction(transactionOptions);
    expect(notifications).toEqual([]);
    controller.executeCommand(createCounterCommand({ id: "transaction-child" }));
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "execute",
      outcome: "succeeded",
      command: { id: "transaction-child" },
      state: { activeTransaction: { ...transactionOptions, commandCount: 1 } },
    });
    controller.commitTransaction();
    expect(notifications).toHaveLength(1);
    controller.undo();
    controller.redo();

    expect(notifications.slice(1)).toMatchObject([
      { operation: "undo", outcome: "succeeded", command: { id: transactionOptions.id } },
      { operation: "redo", outcome: "succeeded", command: { id: transactionOptions.id } },
    ]);
    expect(observedPhases).toEqual(["completed", "completed", "completed"]);
    expect(
      notifications.every(
        (notification) =>
          Object.isFrozen(notification) &&
          Object.isFrozen(notification.state) &&
          (notification.state.activeTransaction === null ||
            Object.isFrozen(notification.state.activeTransaction)),
      ),
    ).toBe(true);
  });

  it("coordinates rollback through the controller without inventing a new notification kind", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((notification) => notifications.push(notification));
    controller.beginTransaction(transactionOptions);
    controller.executeCommand(createCounterCommand({ id: "rolled-back" }));
    notifications.length = 0;

    const state = controller.rollbackTransaction();

    expect(fixture.current.value).toBe(0);
    expect(state.activeTransaction).toBeNull();
    expect(notifications).toEqual([]);
  });
});
