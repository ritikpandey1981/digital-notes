import { describe, expect, it } from "vitest";
import {
  createRenameNotebookCommand,
  createUpdateNotebookMetadataCommand,
} from "../commands/notebook-commands";
import { createRenameSectionCommand } from "../commands/section-commands";
import { HistoryError } from "../errors";
import { HistoryManager } from "../history-manager";
import { buildNotebook, commandOptions } from "./helpers";

describe("history transactions", () => {
  it("groups multiple commands into one undo and redo step", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    const transaction = manager.beginTransaction({
      id: "notebook-appearance",
      timestamp: "2026-02-02T03:04:05.000Z",
      description: "Update notebook appearance",
    });
    expect(transaction).toEqual({
      id: "notebook-appearance",
      timestamp: "2026-02-02T03:04:05.000Z",
      description: "Update notebook appearance",
      commandCount: 0,
    });

    manager.execute(
      createRenameNotebookCommand(
        manager.notebook,
        "Portfolio",
        commandOptions("transaction-rename"),
      ),
    );
    manager.execute(
      createUpdateNotebookMetadataCommand(
        manager.notebook,
        { cover: { kind: "color", value: "#654321" } },
        commandOptions("transaction-cover"),
      ),
    );
    manager.execute(
      createUpdateNotebookMetadataCommand(
        manager.notebook,
        { theme: "midnight" },
        commandOptions("transaction-theme"),
      ),
    );
    expect(manager.getState().transaction?.commandCount).toBe(3);
    expect(manager.canUndo()).toBe(false);

    const committed = manager.commitTransaction().notebook;
    expect(manager.getState()).toMatchObject({ undoDepth: 1, redoDepth: 0, transaction: null });
    expect(committed).toMatchObject({ name: "Portfolio", theme: "midnight" });
    expect(manager.undo().notebook).toBe(initial);
    expect(manager.redo().notebook).toBe(committed);
  });

  it("rolls back all commands to the exact pre-transaction snapshot", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    manager.beginTransaction({ id: "rollback", timestamp: "2026-02-02T03:04:05.000Z" });
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Temporary", commandOptions("temp-rename")),
    );
    manager.execute(
      createRenameSectionCommand(
        manager.notebook,
        "section-1",
        "Temporary section",
        commandOptions("temp-section"),
      ),
    );

    expect(manager.rollbackTransaction().notebook).toBe(initial);
    expect(manager.getState()).toMatchObject({ undoDepth: 0, redoDepth: 0, transaction: null });
  });

  it("preserves a redo branch when a transaction is rolled back", () => {
    const manager = new HistoryManager(buildNotebook());
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "First", commandOptions("first")),
    );
    manager.undo();
    expect(manager.canRedo()).toBe(true);

    manager.beginTransaction({ id: "rolled-back", timestamp: "2026-02-02T03:04:05.000Z" });
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Temporary", commandOptions("temporary")),
    );
    manager.rollbackTransaction();
    expect(manager.canRedo()).toBe(true);
    expect(manager.redo().notebook.name).toBe("First");
  });

  it("commits an empty transaction without creating a history step", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    manager.beginTransaction({ id: "empty", timestamp: "2026-02-02T03:04:05.000Z" });

    expect(manager.commitTransaction().notebook).toBe(initial);
    expect(manager.canUndo()).toBe(false);
  });

  it("rejects nested transactions", () => {
    const manager = new HistoryManager(buildNotebook());
    manager.beginTransaction({ id: "outer", timestamp: "2026-02-02T03:04:05.000Z" });

    expect(() =>
      manager.beginTransaction({ id: "inner", timestamp: "2026-02-02T03:04:05.000Z" }),
    ).toThrowError(expect.objectContaining<Partial<HistoryError>>({ code: "TRANSACTION_ACTIVE" }));
  });

  it.each([
    ["commit", (manager: HistoryManager) => manager.commitTransaction()],
    ["rollback", (manager: HistoryManager) => manager.rollbackTransaction()],
  ])("rejects %s without an active transaction", (_operation, action) => {
    expect(() => action(new HistoryManager(buildNotebook()))).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "TRANSACTION_NOT_ACTIVE" }),
    );
  });

  it.each([
    ["undo", (manager: HistoryManager) => manager.undo()],
    ["redo", (manager: HistoryManager) => manager.redo()],
    ["clear", (manager: HistoryManager) => manager.clear()],
    ["save point", (manager: HistoryManager) => manager.markSavePoint()],
  ])("rejects %s while a transaction is active", (_operation, action) => {
    const manager = new HistoryManager(buildNotebook());
    manager.beginTransaction({ id: "active", timestamp: "2026-02-02T03:04:05.000Z" });

    expect(() => action(manager)).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "TRANSACTION_ACTIVE" }),
    );
  });
});
