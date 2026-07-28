import { describe, expect, expectTypeOf, it } from "vitest";
import { HistoryError } from "../index";
import type {
  CompletedHistoryExecutionState,
  EditorCommand,
  EditorHistoryControllerOptions,
  EditorHistoryManagerOptions,
  ExecutingHistoryExecutionState,
  HistoryCommandMetadata,
  HistoryDocumentSession,
  HistoryErrorCode,
  HistoryExecutionPhase,
  HistoryExecutionState,
  HistoryFailureNotification,
  HistoryListener,
  HistoryNotification,
  HistoryOperation,
  HistoryOperationOutcome,
  HistorySuccessNotification,
  HistoryTransactionOptions,
  HistoryTransactionState,
  IdleHistoryExecutionState,
  IHistoryController,
  IHistoryManager,
  IHistoryState,
  RedoingHistoryExecutionState,
  UndoingHistoryExecutionState,
} from "../index";

interface CounterDocument {
  readonly value: number;
}

const metadata: HistoryCommandMetadata = Object.freeze({
  id: "command-1",
  timestamp: "2026-07-28T00:00:00.000Z",
  description: "Increment counter",
});

const idleExecutionState: IdleHistoryExecutionState = Object.freeze({
  phase: "idle",
  operation: null,
  command: null,
});

const transactionState: HistoryTransactionState = Object.freeze({
  id: "transaction-1",
  timestamp: "2026-07-28T00:00:00.000Z",
  description: "Counter changes",
  commandCount: 1,
});

const historyState: IHistoryState = Object.freeze({
  canUndo: true,
  canRedo: false,
  undoDepth: 1,
  redoDepth: 0,
  historyLimit: 100,
  historyVersion: 1,
  executionCounter: 1,
  executionState: idleExecutionState,
  activeTransaction: transactionState,
  lastCommand: metadata,
});

function createCommand(): EditorCommand<CounterDocument> {
  return Object.freeze({
    ...metadata,
    execute: (document: CounterDocument) => Object.freeze({ value: document.value + 1 }),
    undo: (document: CounterDocument) => Object.freeze({ value: document.value - 1 }),
    redo: (document: CounterDocument) => Object.freeze({ value: document.value + 1 }),
  });
}

function createManagerFixture(): IHistoryManager<CounterDocument> {
  return Object.freeze({
    executeCommand: () => historyState,
    undo: () => historyState,
    redo: () => historyState,
    clearHistory: () => historyState,
    canUndo: () => true,
    canRedo: () => false,
    getHistoryState: () => historyState,
    getHistoryVersion: () => historyState.historyVersion,
    beginTransaction: () => transactionState,
    commitTransaction: () => historyState,
    rollbackTransaction: () => historyState,
  });
}

describe("Phase 11 generic History contracts", () => {
  it("supports arbitrary immutable document successors", () => {
    const initial = Object.freeze({ value: 0 });
    const command = createCommand();
    const executed = command.execute(initial);
    const undone = command.undo(executed);
    const redone = command.redo(undone);

    expect(executed).toEqual({ value: 1 });
    expect(undone).toEqual({ value: 0 });
    expect(redone).toEqual({ value: 1 });
    expect(initial).toEqual({ value: 0 });
    expect([command, executed, undone, redone].every(Object.isFrozen)).toBe(true);
    expectTypeOf(command).toMatchTypeOf<EditorCommand<CounterDocument>>();
  });

  it("defines a model-neutral document-session replacement boundary", () => {
    let current: CounterDocument = Object.freeze({ value: 1 });
    const session: HistoryDocumentSession<CounterDocument> = Object.freeze({
      getDocument: () => current,
      replaceDocument: (document: CounterDocument) => {
        current = document;
      },
    });
    const successor = Object.freeze({ value: 2 });

    session.replaceDocument(successor);

    expect(session.getDocument()).toBe(successor);
    expectTypeOf(session.getDocument()).toEqualTypeOf<CounterDocument>();
  });

  it("exposes document-free immutable state and lifecycle records", () => {
    type ForbiddenStateKey = Extract<keyof IHistoryState, "document" | "notebook" | "snapshot">;
    const phases = [
      "idle",
      "executing",
      "undoing",
      "redoing",
      "completed",
    ] as const satisfies readonly HistoryExecutionPhase[];
    const operations = ["execute", "undo", "redo"] as const satisfies readonly HistoryOperation[];
    const outcomes = ["succeeded", "failed"] as const satisfies readonly HistoryOperationOutcome[];

    expectTypeOf<ForbiddenStateKey>().toEqualTypeOf<never>();
    expect(phases).toHaveLength(5);
    expect(operations).toHaveLength(3);
    expect(outcomes).toHaveLength(2);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(transactionState)).toBe(true);
    expect(Object.isFrozen(historyState)).toBe(true);
    expect(Object.isFrozen(historyState.executionState)).toBe(true);
  });

  it("represents every legal execution lifecycle with discriminated states", () => {
    const executing: ExecutingHistoryExecutionState = Object.freeze({
      phase: "executing",
      operation: "execute",
      command: metadata,
    });
    const undoing: UndoingHistoryExecutionState = Object.freeze({
      phase: "undoing",
      operation: "undo",
      command: metadata,
    });
    const redoing: RedoingHistoryExecutionState = Object.freeze({
      phase: "redoing",
      operation: "redo",
      command: metadata,
    });
    const completed: CompletedHistoryExecutionState = Object.freeze({
      phase: "completed",
      operation: "execute",
      outcome: "succeeded",
      command: metadata,
    });
    const states: readonly HistoryExecutionState[] = Object.freeze([
      idleExecutionState,
      executing,
      undoing,
      redoing,
      completed,
    ]);

    expect(states.map(({ phase }) => phase)).toEqual([
      "idle",
      "executing",
      "undoing",
      "redoing",
      "completed",
    ]);
  });

  it("defines generic manager and controller configuration boundaries", () => {
    const documentSession: HistoryDocumentSession<CounterDocument> = Object.freeze({
      getDocument: () => Object.freeze({ value: 0 }),
      replaceDocument: () => undefined,
    });
    const managerOptions: EditorHistoryManagerOptions<CounterDocument> = Object.freeze({
      documentSession,
      historyLimit: 25,
    });
    const manager = createManagerFixture();
    const controllerOptions: EditorHistoryControllerOptions<CounterDocument> = Object.freeze({
      manager,
    });
    const transactionOptions: HistoryTransactionOptions = Object.freeze({
      description: "Counter changes",
    });

    expect(managerOptions.documentSession).toBe(documentSession);
    expect(controllerOptions.manager).toBe(manager);
    expect(transactionOptions.description).toBe("Counter changes");
    expectTypeOf(manager).toMatchTypeOf<IHistoryManager<CounterDocument>>();
    expectTypeOf<IHistoryController<CounterDocument>["executeCommand"]>()
      .parameter(0)
      .toEqualTypeOf<EditorCommand<CounterDocument>>();
  });

  it("defines immutable success and failure notifications", () => {
    const error = new HistoryError("COMMAND_EXECUTION_FAILED", "Command failed.");
    const success: HistorySuccessNotification = Object.freeze({
      operation: "execute",
      outcome: "succeeded",
      command: metadata,
      state: historyState,
    });
    const failure: HistoryFailureNotification = Object.freeze({
      operation: "execute",
      outcome: "failed",
      command: metadata,
      state: historyState,
      error,
    });
    const received: HistoryNotification[] = [];
    const listener: HistoryListener = (notification) => received.push(notification);

    listener(success);
    listener(failure);

    expect(received).toEqual([success, failure]);
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it("adds only the approved generic History error categories", () => {
    const codes = [
      "COMMAND_EXECUTION_FAILED",
      "COMMAND_REDO_FAILED",
      "COMMAND_UNDO_FAILED",
      "HISTORY_CONTROLLER_DESTROYED",
      "HISTORY_LIFECYCLE_VIOLATION",
      "INVALID_EDITOR_COMMAND",
      "TRANSACTION_COMMIT_FAILED",
      "TRANSACTION_ROLLBACK_FAILED",
    ] as const satisfies readonly HistoryErrorCode[];

    expect(codes.map((code) => new HistoryError(code, code).code)).toEqual(codes);
  });
});

function assertReadonlyContracts(
  command: EditorCommand<CounterDocument>,
  commandMetadata: HistoryCommandMetadata,
  state: IHistoryState,
  notification: HistoryNotification,
  transaction: HistoryTransactionState,
): void {
  // @ts-expect-error Phase 11 commands are immutable after creation.
  command.id = "replacement";
  // @ts-expect-error Public command metadata is immutable.
  commandMetadata.description = "replacement";
  // @ts-expect-error Public History state is immutable.
  state.canUndo = false;
  // @ts-expect-error Notification records are immutable.
  notification.outcome = "failed";
  // @ts-expect-error Transaction summaries are immutable.
  transaction.commandCount = 2;
}

void assertReadonlyContracts;
