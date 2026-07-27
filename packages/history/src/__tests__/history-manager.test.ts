import { createNotebook } from "@folio/domain";
import type { Command } from "../command";
import { createRenameNotebookCommand } from "../commands/notebook-commands";
import { createReorderSectionsCommand } from "../commands/section-commands";
import { HistoryError } from "../errors";
import { HistoryManager } from "../history-manager";
import { describe, expect, it } from "vitest";
import { buildNotebook, commandOptions } from "./helpers";

function executeRenames(manager: HistoryManager, count: number, offset = 0): void {
  for (let index = 0; index < count; index += 1) {
    const ordinal = index + offset;
    manager.execute(
      createRenameNotebookCommand(
        manager.notebook,
        `Notebook ${ordinal}`,
        commandOptions(`rename-${ordinal}`),
      ),
    );
  }
}

describe("HistoryManager execution", () => {
  it("executes a command and exposes an immutable lightweight snapshot", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    const result = manager.execute(
      createRenameNotebookCommand(initial, "Executed", commandOptions("execute")),
    );

    expect(result.notebook).toBe(manager.notebook);
    expect(result.notebook.name).toBe("Executed");
    expect(result.revision).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(manager.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      isDirty: true,
      undoDepth: 1,
      redoDepth: 0,
      historyLimit: 100,
      transaction: null,
    });
  });

  it("supports multiple undo and redo operations in sequence", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    executeRenames(manager, 3, 1);
    const final = manager.notebook;

    expect(manager.undo().notebook.name).toBe("Notebook 2");
    expect(manager.undo().notebook.name).toBe("Notebook 1");
    expect(manager.undo().notebook).toBe(initial);
    expect(manager.canUndo()).toBe(false);
    expect(manager.redo().notebook.name).toBe("Notebook 1");
    expect(manager.redo().notebook.name).toBe("Notebook 2");
    expect(manager.redo().notebook).toBe(final);
    expect(manager.canRedo()).toBe(false);
  });

  it("returns the current snapshot when undo or redo has nothing to do", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);

    expect(manager.undo()).toEqual({ notebook: initial, revision: 0 });
    expect(manager.redo()).toEqual({ notebook: initial, revision: 0 });
    expect(manager.canUndo()).toBe(false);
    expect(manager.canRedo()).toBe(false);
  });

  it("invalidates redo after a new command on an undone branch", () => {
    const manager = new HistoryManager(buildNotebook());
    executeRenames(manager, 2, 1);
    manager.undo();
    expect(manager.canRedo()).toBe(true);

    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Branched", commandOptions("branch-command")),
    );
    expect(manager.canRedo()).toBe(false);
    expect(manager.redo().notebook.name).toBe("Branched");
  });

  it("does not record a no-op or invalidate an existing redo branch", () => {
    const manager = new HistoryManager(buildNotebook());
    executeRenames(manager, 1);
    manager.undo();
    const revision = manager.snapshot().revision;
    manager.execute(
      createReorderSectionsCommand(manager.notebook, 1, 1, commandOptions("no-op-reorder")),
    );

    expect(manager.snapshot().revision).toBe(revision);
    expect(manager.canRedo()).toBe(true);
  });

  it("enforces the configured history limit by dropping oldest steps", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial, { historyLimit: 3 });
    executeRenames(manager, 5, 1);

    expect(manager.getState().undoDepth).toBe(3);
    manager.undo();
    manager.undo();
    manager.undo();
    expect(manager.notebook.name).toBe("Notebook 2");
    expect(manager.undo().notebook.name).toBe("Notebook 2");
  });

  it("clears undo and redo without changing the notebook or its dirty state", () => {
    const manager = new HistoryManager(buildNotebook());
    executeRenames(manager, 2);
    manager.undo();
    const current = manager.notebook;
    expect(manager.isDirty).toBe(true);

    const snapshot = manager.clear();
    expect(snapshot.notebook).toBe(current);
    expect(manager.getState()).toMatchObject({
      canUndo: false,
      canRedo: false,
      isDirty: true,
      undoDepth: 0,
      redoDepth: 0,
    });
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid history limit %s",
    (historyLimit) => {
      expect(() => new HistoryManager(buildNotebook(), { historyLimit })).toThrowError(
        expect.objectContaining<Partial<HistoryError>>({ code: "INVALID_HISTORY_LIMIT" }),
      );
    },
  );

  it("rejects mutable commands", () => {
    const notebook = buildNotebook();
    const mutable = {
      id: "mutable",
      timestamp: "2026-02-02T03:04:05.000Z",
      description: "Mutable command",
      category: "notebook" as const,
      affectedTargets: Object.freeze([{ kind: "metadata" as const }]),
      execute: () => notebook,
      undo: () => notebook,
      redo: () => notebook,
    } satisfies Command;

    expect(() => new HistoryManager(notebook).execute(mutable)).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "INVALID_COMMAND" }),
    );
  });

  it("rejects invalid or mutable notebook results without changing current state", () => {
    const initial = buildNotebook();
    const invalid = Object.freeze({ ...initial, name: "" });
    const command = Object.freeze({
      id: "invalid-result",
      timestamp: "2026-02-02T03:04:05.000Z",
      description: "Return invalid state",
      category: "notebook" as const,
      affectedTargets: Object.freeze([Object.freeze({ kind: "metadata" as const })]),
      execute: () => invalid,
      undo: () => initial,
      redo: () => invalid,
    }) satisfies Command;
    const manager = new HistoryManager(initial);

    expect(() => manager.execute(command)).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "INVALID_NOTEBOOK" }),
    );
    expect(manager.notebook).toBe(initial);
    expect(manager.canUndo()).toBe(false);
  });

  it("requires undo and redo to return the snapshots captured at execution", () => {
    const initial = buildNotebook();
    const after = createNotebook({ ...initial, name: "After" });
    const differentAfter = createNotebook({ ...initial, name: "After" });
    const command = Object.freeze({
      id: "unstable-redo",
      timestamp: "2026-02-02T03:04:05.000Z",
      description: "Unstable redo",
      category: "notebook" as const,
      affectedTargets: Object.freeze([Object.freeze({ kind: "metadata" as const })]),
      execute: () => after,
      undo: () => initial,
      redo: () => differentAfter,
    }) satisfies Command;
    const manager = new HistoryManager(initial);
    manager.execute(command);
    manager.undo();

    expect(() => manager.redo()).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "COMMAND_RESULT_MISMATCH" }),
    );
    expect(manager.notebook).toBe(initial);
    expect(manager.canRedo()).toBe(true);
  });
});

describe("large histories", () => {
  it("executes, undoes, and redoes thousands of commands", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial, { historyLimit: 2_000 });
    executeRenames(manager, 2_000);
    const final = manager.notebook;

    for (let index = 0; index < 2_000; index += 1) manager.undo();
    expect(manager.notebook).toBe(initial);
    for (let index = 0; index < 2_000; index += 1) manager.redo();
    expect(manager.notebook).toBe(final);
    expect(manager.getState()).toMatchObject({ undoDepth: 2_000, redoDepth: 0 });
  }, 30_000);
});
