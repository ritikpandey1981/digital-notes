import { describe, expect, it } from "vitest";
import { createEditorHistoryManager } from "../index";
import type { HistoryExecutionPhase } from "../index";
import {
  counter,
  createCounterCommand,
  createDocumentSessionFixture,
} from "./editor-history-fixtures";

describe("generic editor History manager", () => {
  it("starts with immutable, document-free state and the default limit", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const state = manager.getHistoryState();

    expect(state).toEqual({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      historyLimit: 100,
      historyVersion: 0,
      executionCounter: 0,
      executionState: { phase: "idle", operation: null, command: null },
      activeTransaction: null,
      lastCommand: null,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.executionState)).toBe(true);
    expect(Object.keys(state)).not.toContain("document");
    expect(Object.keys(state)).not.toContain("notebook");
    expect(manager.getHistoryVersion()).toBe(0);
  });

  it("executes, undoes, and redoes through distinct immutable successors", () => {
    const initial = counter(0);
    const fixture = createDocumentSessionFixture(initial);
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = createCounterCommand({ id: "increment" });

    const executedState = manager.executeCommand(command);
    const executed = fixture.current;
    const undoneState = manager.undo();
    const undone = fixture.current;
    const redoneState = manager.redo();
    const redone = fixture.current;

    expect([initial.value, executed.value, undone.value, redone.value]).toEqual([0, 1, 0, 1]);
    expect(new Set([initial, executed, undone, redone]).size).toBe(4);
    expect([initial, executed, undone, redone].every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(executedState)).toBe(true);
    expect(Object.isFrozen(executedState.executionState)).toBe(true);
    expect(Object.isFrozen(executedState.lastCommand)).toBe(true);
    expect(executedState).toMatchObject({
      undoDepth: 1,
      redoDepth: 0,
      historyVersion: 1,
      executionCounter: 1,
      executionState: { phase: "completed", operation: "execute", outcome: "succeeded" },
    });
    expect(undoneState).toMatchObject({
      undoDepth: 0,
      redoDepth: 1,
      historyVersion: 2,
      executionCounter: 2,
      executionState: { phase: "completed", operation: "undo", outcome: "succeeded" },
    });
    expect(redoneState).toMatchObject({
      undoDepth: 1,
      redoDepth: 0,
      historyVersion: 3,
      executionCounter: 3,
      executionState: { phase: "completed", operation: "redo", outcome: "succeeded" },
    });
    expect(manager.getHistoryState().executionState.phase).toBe("idle");
    expect(manager.canUndo()).toBe(true);
    expect(manager.canRedo()).toBe(false);
  });

  it("preserves deterministic ordering across multiple undo and redo operations", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createCounterCommand({ id: "one", delta: 1 }));
    manager.executeCommand(createCounterCommand({ id: "two", delta: 2 }));
    manager.executeCommand(createCounterCommand({ id: "three", delta: 3 }));

    expect(fixture.current.value).toBe(6);
    expect(manager.undo().lastCommand?.id).toBe("three");
    expect(fixture.current.value).toBe(3);
    expect(manager.undo().lastCommand?.id).toBe("two");
    expect(fixture.current.value).toBe(1);
    expect(manager.undo().lastCommand?.id).toBe("one");
    expect(fixture.current.value).toBe(0);
    expect(manager.redo().lastCommand?.id).toBe("one");
    expect(manager.redo().lastCommand?.id).toBe("two");
    expect(manager.redo().lastCommand?.id).toBe("three");
    expect(fixture.current.value).toBe(6);
    expect(manager.getHistoryState()).toMatchObject({
      undoDepth: 3,
      redoDepth: 0,
      historyVersion: 9,
      executionCounter: 9,
    });
  });

  it("treats empty undo and redo as stable no-ops", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const before = manager.getHistoryState();

    expect(manager.undo()).toEqual(before);
    expect(manager.redo()).toEqual(before);
    expect(manager.getHistoryState()).toEqual(before);
    expect(fixture.replacements).toHaveLength(0);
  });

  it("invalidates redo only when a new command changes the document", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createCounterCommand({ id: "first" }));
    manager.undo();

    const beforeNoOp = manager.getHistoryState();
    const noOp = createCounterCommand({
      id: "no-op",
      description: "Do nothing",
      execute: (document) => document,
    });
    const noOpState = manager.executeCommand(noOp);

    expect(noOpState).toMatchObject({
      undoDepth: 0,
      redoDepth: 1,
      historyVersion: beforeNoOp.historyVersion,
      executionCounter: beforeNoOp.executionCounter + 1,
      lastCommand: { id: "no-op" },
    });
    expect(manager.canRedo()).toBe(true);
    manager.executeCommand(createCounterCommand({ id: "replacement", delta: 2 }));
    expect(manager.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
  });

  it("enforces custom and default bounded history limits", () => {
    const customFixture = createDocumentSessionFixture();
    const custom = createEditorHistoryManager({
      documentSession: customFixture.session,
      historyLimit: 2,
    });
    custom.executeCommand(createCounterCommand({ id: "one" }));
    custom.executeCommand(createCounterCommand({ id: "two" }));
    custom.executeCommand(createCounterCommand({ id: "three" }));

    expect(custom.getHistoryState().undoDepth).toBe(2);
    custom.undo();
    custom.undo();
    custom.undo();
    expect(customFixture.current.value).toBe(1);

    const defaultFixture = createDocumentSessionFixture();
    const defaults = createEditorHistoryManager({ documentSession: defaultFixture.session });
    for (let index = 0; index < 101; index += 1) {
      defaults.executeCommand(createCounterCommand({ id: `default-${index}` }));
    }
    expect(defaults.getHistoryState()).toMatchObject({ historyLimit: 100, undoDepth: 100 });
  });

  it("reports only command identities still retained by bounded History", () => {
    const fixture = createDocumentSessionFixture();
    const retained: (readonly string[])[] = [];
    const manager = createEditorHistoryManager({
      documentSession: fixture.session,
      historyLimit: 2,
      onRetainedCommandsChange: (ids) => retained.push(ids),
    });

    manager.executeCommand(createCounterCommand({ id: "one" }));
    manager.executeCommand(createCounterCommand({ id: "two" }));
    manager.undo();
    manager.executeCommand(createCounterCommand({ id: "three" }));
    expect(retained.at(-1)).toEqual(["one", "three"]);

    manager.executeCommand(createCounterCommand({ id: "four" }));
    expect(retained.at(-1), "capacity eviction removes one").toEqual(["three", "four"]);

    manager.beginTransaction({ id: "group", description: "Grouped change" });
    manager.executeCommand(createCounterCommand({ id: "child" }));
    expect(retained.at(-1), "the retained unit is the group, not its child").toEqual([
      "three",
      "four",
      "group",
    ]);
    manager.rollbackTransaction();
    expect(retained.at(-1)).toEqual(["three", "four"]);

    manager.clearHistory();
    expect(retained.at(-1), "clear removes every retained identity").toEqual([]);
  });

  it("clears both stacks without changing the active document", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createCounterCommand({ id: "one" }));
    manager.executeCommand(createCounterCommand({ id: "two" }));
    manager.undo();
    const documentBeforeClear = fixture.current;
    const versionBeforeClear = manager.getHistoryVersion();

    const state = manager.clearHistory();

    expect(fixture.current).toBe(documentBeforeClear);
    expect(state).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      historyVersion: versionBeforeClear + 1,
      executionCounter: 3,
    });
    expect(manager.clearHistory().historyVersion).toBe(state.historyVersion);
  });

  it("keeps large histories bounded while preserving fast deterministic operations", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({
      documentSession: fixture.session,
      historyLimit: 256,
    });

    for (let index = 0; index < 2_000; index += 1) {
      manager.executeCommand(createCounterCommand({ id: `large-${index}` }));
    }
    for (let index = 0; index < 256; index += 1) manager.undo();

    expect(fixture.current.value).toBe(1_744);
    expect(manager.getHistoryState()).toMatchObject({
      undoDepth: 0,
      redoDepth: 256,
      historyVersion: 2_256,
      executionCounter: 2_256,
    });
  });

  it("exposes active lifecycle phases only while their command operation runs", () => {
    const fixture = createDocumentSessionFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const observed: HistoryExecutionPhase[] = [];
    const command = createCounterCommand({
      id: "observed",
      execute: (document) => {
        observed.push(manager.getHistoryState().executionState.phase);
        return counter(document.value + 1);
      },
      undo: (document) => {
        observed.push(manager.getHistoryState().executionState.phase);
        return counter(document.value - 1);
      },
      redo: (document) => {
        observed.push(manager.getHistoryState().executionState.phase);
        return counter(document.value + 1);
      },
    });

    manager.executeCommand(command);
    manager.undo();
    manager.redo();

    expect(observed).toEqual(["executing", "undoing", "redoing"]);
    expect(manager.getHistoryState().executionState.phase).toBe("idle");
  });
});
