import { describe, expect, it } from "vitest";
import { HistoryError, createEditorHistoryManager, isHistoryError } from "../index";
import type { EditorCommand, HistoryDocumentSession } from "../index";
import {
  counter,
  createCounterCommand,
  createDocumentSessionFixture,
} from "./editor-history-fixtures";
import type { CounterDocument } from "./editor-history-fixtures";

describe("generic editor History manager failures", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects the invalid history limit %s",
    (historyLimit) => {
      const fixture = createDocumentSessionFixture();

      const error = captureHistoryError(() =>
        createEditorHistoryManager({ documentSession: fixture.session, historyLimit }),
      );

      expect(error.code).toBe("INVALID_HISTORY_LIMIT");
    },
  );

  it("rejects an invalid document session", () => {
    const error = captureHistoryError(() =>
      createEditorHistoryManager({
        documentSession: Object.freeze({}) as HistoryDocumentSession<CounterDocument>,
      }),
    );

    expect(error.code).toBe("INVALID_DOCUMENT_SESSION");
  });

  it.each([
    ["mutable", createCounterCommand(), "unfreeze"],
    ["blank identity", { ...createCounterCommand(), id: " " }, "freeze"],
    ["invalid timestamp", { ...createCounterCommand(), timestamp: "not-a-date" }, "freeze"],
    ["blank description", { ...createCounterCommand(), description: " " }, "freeze"],
    ["missing execute", { ...createCounterCommand(), execute: undefined }, "freeze"],
  ] as const)("rejects a command with %s", (_case, value, freeze) => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = (freeze === "freeze"
      ? Object.freeze(value)
      : { ...value }) as unknown as EditorCommand<CounterDocument>;

    const error = captureHistoryError(() => manager.executeCommand(command));

    expect(error.code).toBe("INVALID_EDITOR_COMMAND");
    expect(manager.getHistoryState()).toMatchObject({
      undoDepth: 0,
      redoDepth: 0,
      historyVersion: 0,
      executionCounter: 0,
      executionState: { phase: "idle" },
      lastCommand: null,
    });
    expect(fixture.current.value).toBe(0);
  });

  it("rejects reentrant operations without corrupting the outer execution", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    let reentrantError: HistoryError | undefined;
    const command = createCounterCommand({
      id: "outer",
      execute: (document) => {
        reentrantError = captureHistoryError(() => manager.clearHistory());
        expect(manager.canUndo()).toBe(false);
        expect(manager.canRedo()).toBe(false);
        return counter(document.value + 1);
      },
    });

    manager.executeCommand(command);

    expect(reentrantError?.code).toBe("HISTORY_LIFECYCLE_VIOLATION");
    expect(fixture.current.value).toBe(1);
    expect(manager.getHistoryState()).toMatchObject({ undoDepth: 1, historyVersion: 1 });
  });

  it("leaves document, stacks, version, counter, and metadata unchanged after execute fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const before = manager.getHistoryState();
    const command = createCounterCommand({
      id: "failing-execute",
      execute: () => {
        throw new Error("Execution rejected by the command.");
      },
    });

    const error = captureHistoryError(() => manager.executeCommand(command));

    expect(error.code).toBe("COMMAND_EXECUTION_FAILED");
    expect(error.cause).toBeInstanceOf(Error);
    expect(manager.getHistoryState()).toEqual(before);
    expect(fixture.current.value).toBe(0);
    expect(fixture.replacements).toHaveLength(0);
  });

  it("leaves a command undoable when undo fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = createCounterCommand({
      id: "failing-undo",
      undo: () => {
        throw new Error("Undo rejected by the command.");
      },
    });
    manager.executeCommand(command);
    const documentBeforeFailure = fixture.current;
    const stateBeforeFailure = manager.getHistoryState();

    const error = captureHistoryError(() => manager.undo());

    expect(error.code).toBe("COMMAND_UNDO_FAILED");
    expect(fixture.current).toBe(documentBeforeFailure);
    expect(manager.getHistoryState()).toEqual(stateBeforeFailure);
    expect(manager.canUndo()).toBe(true);
  });

  it("leaves a command redoable when redo fails", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = createCounterCommand({
      id: "failing-redo",
      redo: () => {
        throw new Error("Redo rejected by the command.");
      },
    });
    manager.executeCommand(command);
    manager.undo();
    const documentBeforeFailure = fixture.current;
    const stateBeforeFailure = manager.getHistoryState();

    const error = captureHistoryError(() => manager.redo());

    expect(error.code).toBe("COMMAND_REDO_FAILED");
    expect(fixture.current).toBe(documentBeforeFailure);
    expect(manager.getHistoryState()).toEqual(stateBeforeFailure);
    expect(manager.canRedo()).toBe(true);
  });

  it("rejects same-reference undo and redo successors without moving stacks", () => {
    const undoFixture = createDocumentSessionFixture();
    const undoManager = createEditorHistoryManager({ documentSession: undoFixture.session });
    undoManager.executeCommand(
      createCounterCommand({ id: "same-undo", undo: (document) => document }),
    );
    const undoState = undoManager.getHistoryState();

    expect(captureHistoryError(() => undoManager.undo()).code).toBe("COMMAND_UNDO_FAILED");
    expect(undoManager.getHistoryState()).toEqual(undoState);

    const redoFixture = createDocumentSessionFixture();
    const redoManager = createEditorHistoryManager({ documentSession: redoFixture.session });
    redoManager.executeCommand(
      createCounterCommand({ id: "same-redo", redo: (document) => document }),
    );
    redoManager.undo();
    const redoState = redoManager.getHistoryState();

    expect(captureHistoryError(() => redoManager.redo()).code).toBe("COMMAND_REDO_FAILED");
    expect(redoManager.getHistoryState()).toEqual(redoState);
  });

  it("restores the predecessor if the document session throws after replacement", () => {
    const initial = counter(0);
    const fixture = createDocumentSessionFixture(initial);
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    fixture.failNextReplacement("after");

    const error = captureHistoryError(() =>
      manager.executeCommand(createCounterCommand({ id: "replacement-failure" })),
    );

    expect(error.code).toBe("COMMAND_EXECUTION_FAILED");
    expect(fixture.current).toBe(initial);
    expect(manager.getHistoryState()).toMatchObject({
      undoDepth: 0,
      redoDepth: 0,
      historyVersion: 0,
      executionCounter: 0,
      executionState: { phase: "idle" },
    });
  });

  it("creates independent manager state without hidden singleton storage", () => {
    const firstFixture = createDocumentSessionFixture();
    const secondFixture = createDocumentSessionFixture(counter(10));
    const first = createEditorHistoryManager({ documentSession: firstFixture.session });
    const second = createEditorHistoryManager({ documentSession: secondFixture.session });

    first.executeCommand(createCounterCommand({ id: "first-only" }));

    expect(firstFixture.current.value).toBe(1);
    expect(secondFixture.current.value).toBe(10);
    expect(first.getHistoryState().undoDepth).toBe(1);
    expect(second.getHistoryState().undoDepth).toBe(0);
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
