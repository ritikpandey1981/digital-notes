import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirtyTracker, loadNotebook, saveNotebook, serializeNotebook } from "@folio/persistence";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { LegacyHistoryDirtySink } from "../index";
import { createRenameNotebookCommand } from "../commands/notebook-commands";
import { createDeletePageCommand } from "../commands/page-commands";
import { createRenameSectionCommand } from "../commands/section-commands";
import { HistoryManager } from "../history-manager";
import { buildNotebook, commandOptions } from "./helpers";

describe("save points and dirty state", () => {
  it("is clean initially, dirty after execution, and clean after marking a save point", () => {
    const manager = new HistoryManager(buildNotebook());
    expect(manager.isDirty).toBe(false);

    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Changed", commandOptions("changed")),
    );
    expect(manager.isDirty).toBe(true);
    expect(manager.getState().isDirty).toBe(true);

    const savePoint = manager.markSavePoint();
    expect(savePoint.notebook).toBe(manager.notebook);
    expect(manager.isDirty).toBe(false);
  });

  it("reports dirty state correctly in both undo and redo directions", () => {
    const manager = new HistoryManager(buildNotebook());
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Saved Name", commandOptions("saved-name")),
    );
    const saved = manager.markSavePoint().notebook;

    expect(manager.undo().notebook).not.toBe(saved);
    expect(manager.isDirty).toBe(true);
    expect(manager.redo().notebook).toBe(saved);
    expect(manager.isDirty).toBe(false);
  });

  it("supports establishing a new save point on an undone state", () => {
    const initial = buildNotebook();
    const manager = new HistoryManager(initial);
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Later", commandOptions("later")),
    );
    manager.undo();
    manager.markSavePoint();

    expect(manager.notebook).toBe(initial);
    expect(manager.isDirty).toBe(false);
    manager.redo();
    expect(manager.isDirty).toBe(true);
  });

  it("can mark the snapshot actually saved while newer edits remain dirty", () => {
    const manager = new HistoryManager(buildNotebook());
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Saved Snapshot", commandOptions("saved")),
    );
    const savedSnapshot = manager.notebook;
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Newer Edit", commandOptions("newer")),
    );

    manager.markSavePoint(savedSnapshot);
    expect(manager.notebook.name).toBe("Newer Edit");
    expect(manager.isDirty).toBe(true);
    expect(manager.undo().notebook).toBe(savedSnapshot);
    expect(manager.isDirty).toBe(false);
  });
});

describe("DirtyTracker coordination", () => {
  it("accepts the persistence tracker through the History-owned compatibility contract", () => {
    const tracker = new DirtyTracker();
    const compatibleSink: LegacyHistoryDirtySink = tracker;

    expectTypeOf<DirtyTracker>().toMatchTypeOf<LegacyHistoryDirtySink>();
    expect(compatibleSink).toBe(tracker);
    expect(new HistoryManager(buildNotebook(), { dirtyTracker: tracker }).getState().isDirty).toBe(
      false,
    );
  });

  it("maps notebook, section, and page command effects to persistence targets", () => {
    const tracker = new DirtyTracker();
    const manager = new HistoryManager(buildNotebook(), { dirtyTracker: tracker });
    manager.execute(
      createDeletePageCommand(
        manager.notebook,
        "section-1",
        "page-1",
        commandOptions("delete-page"),
      ),
    );

    expect(tracker.status).toBe("dirty");
    expect(tracker.snapshot().entries.map(({ target }) => target)).toEqual([
      { kind: "page", id: "page-1" },
      { kind: "section", id: "section-1" },
      { kind: "metadata" },
    ]);
  });

  it("clears persistence dirty targets when redo returns to the save point", () => {
    const tracker = new DirtyTracker();
    const manager = new HistoryManager(buildNotebook(), { dirtyTracker: tracker });
    manager.execute(
      createRenameSectionCommand(
        manager.notebook,
        "section-1",
        "Sources",
        commandOptions("rename-section"),
      ),
    );
    manager.markSavePoint();
    expect(tracker.status).toBe("saved");

    manager.undo();
    expect(tracker.status).toBe("dirty");
    manager.redo();
    expect(tracker.status).toBe("saved");
  });

  it("defers new persistence targets until transaction commit and discards them on rollback", () => {
    const tracker = new DirtyTracker();
    const manager = new HistoryManager(buildNotebook(), { dirtyTracker: tracker });
    manager.beginTransaction({ id: "deferred", timestamp: "2026-02-02T03:04:05.000Z" });
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Deferred", commandOptions("deferred-name")),
    );
    expect(manager.isDirty).toBe(true);
    expect(tracker.status).toBe("saved");

    manager.rollbackTransaction();
    expect(manager.isDirty).toBe(false);
    expect(tracker.status).toBe("saved");

    manager.beginTransaction({ id: "committed", timestamp: "2026-02-02T03:04:05.000Z" });
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Committed", commandOptions("committed-name")),
    );
    manager.commitTransaction();
    expect(tracker.status).toBe("dirty");
  });
});

describe("persistence boundary", () => {
  it("becomes clean only after a successful notebook save is marked as the save point", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "folio-history-"));
    const notebookPath = join(temporaryRoot, "History Integration");
    const original = buildNotebook();
    const tracker = new DirtyTracker();
    try {
      await saveNotebook(notebookPath, original);
      const manager = new HistoryManager(original, { dirtyTracker: tracker });
      manager.execute(
        createRenameNotebookCommand(
          manager.notebook,
          "Persisted History State",
          commandOptions("persisted-command"),
        ),
      );

      const savedSnapshot = manager.notebook;
      await saveNotebook(notebookPath, savedSnapshot, { dirtyTracker: tracker });
      expect(manager.isDirty).toBe(true);
      manager.markSavePoint(savedSnapshot);
      expect(manager.isDirty).toBe(false);
      expect((await loadNotebook(notebookPath)).notebook).toEqual(manager.notebook);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("serializes only the current notebook and never command or stack metadata", () => {
    const manager = new HistoryManager(buildNotebook());
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Serializable State", {
        id: "history-only-command-id",
        timestamp: "2026-02-02T03:04:05.000Z",
        description: "History-only description",
      }),
    );

    const serialized = serializeNotebook(manager.notebook);
    const bytes = serialized.files.map(({ content }) => content).join("\n");
    expect(bytes).toContain("Serializable State");
    expect(bytes).not.toContain("history-only-command-id");
    expect(bytes).not.toContain("History-only description");
  });

  it("starts a fresh session-only history when a persisted notebook is reopened", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "folio-history-session-"));
    const notebookPath = join(temporaryRoot, "Session Boundary");
    try {
      const firstManager = new HistoryManager(buildNotebook());
      firstManager.execute(
        createRenameNotebookCommand(
          firstManager.notebook,
          "Saved Session",
          commandOptions("session-command"),
        ),
      );
      await saveNotebook(notebookPath, firstManager.notebook);

      const secondManager = new HistoryManager((await loadNotebook(notebookPath)).notebook);
      expect(secondManager.notebook.name).toBe("Saved Session");
      expect(secondManager.canUndo()).toBe(false);
      expect(secondManager.isDirty).toBe(false);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

describe("immutable aggregate preservation", () => {
  it("never mutates previous notebook versions", () => {
    const initial = buildNotebook();
    const initialBytes = JSON.stringify(initial);
    const manager = new HistoryManager(initial);
    manager.execute(
      createRenameNotebookCommand(manager.notebook, "Changed", commandOptions("immutable")),
    );

    expect(JSON.stringify(initial)).toBe(initialBytes);
    expect(initial.name).toBe("Project Atlas");
    expect(Object.isFrozen(manager.notebook)).toBe(true);
    expect(Object.isFrozen(manager.notebook.sections[0]?.pages[0]?.objects[0])).toBe(true);
    expect(manager.undo().notebook).toBe(initial);
  });
});
