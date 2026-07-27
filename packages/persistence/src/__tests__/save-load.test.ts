import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createNotebook, createPage } from "@folio/domain";
import type { Notebook } from "@folio/domain";
import { describe, expect, it } from "vitest";
import { DirtyTracker } from "../dirty-tracker";
import { loadNotebook } from "../load-pipeline";
import { pageRelativePath } from "../paths";
import { saveNotebook } from "../save-pipeline";
import {
  buildNotebook,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  updateFirstPage,
} from "./helpers";

describe("folder-based notebook persistence", () => {
  it("creates exactly the architecture-defined top-level notebook structure", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Atlas Notebook");
    try {
      const result = await saveNotebook(notebookPath, buildNotebook());
      const entries = await readdir(notebookPath, { withFileTypes: true });
      expect(entries.map(({ name }) => name).sort()).toEqual([
        ".folio",
        "assets",
        "metadata.json",
        "pages",
        "sections",
        "thumbnails",
      ]);
      expect(
        entries
          .filter((entry) => entry.isDirectory())
          .map(({ name }) => name)
          .sort(),
      ).toEqual([".folio", "assets", "pages", "sections", "thumbnails"]);
      expect(await readdir(join(notebookPath, ".folio"))).toEqual([]);
      expect(result.writtenFiles).toHaveLength(7);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("saves and loads a notebook with an exact domain-model round trip", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Round Trip");
    const notebook = buildNotebook({ unicode: true });
    try {
      await saveNotebook(notebookPath, notebook);
      const loaded = await loadNotebook(notebookPath);

      expect(loaded.notebook).toEqual(notebook);
      expect(loaded.notebookPath).toBe(notebookPath);
      expect(Object.isFrozen(loaded.notebook)).toBe(true);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("does not rewrite deterministic documents whose bytes have not changed", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "No Rewrites");
    const notebook = buildNotebook();
    try {
      await saveNotebook(notebookPath, notebook);
      const result = await saveNotebook(notebookPath, notebook);

      expect(result.writtenFiles).toEqual([]);
      expect(result.skippedFiles).toHaveLength(7);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("uses dirty targets to save only a changed page while skipping unchanged metadata", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Incremental Save");
    const original = buildNotebook();
    const originalPage = original.sections[0]?.pages[0];
    if (!originalPage) throw new Error("Expected a page fixture.");
    const changedPage = createPage({
      ...originalPage,
      width: originalPage.width + 1,
      updatedAt: "2026-01-04T03:04:05.000Z",
    });
    const changed = updateFirstPage(original, changedPage);
    const tracker = new DirtyTracker();
    tracker.markPage(changedPage.id);
    try {
      await saveNotebook(notebookPath, original);
      const result = await saveNotebook(notebookPath, changed, { dirtyTracker: tracker });

      expect(result.writtenFiles).toEqual([pageRelativePath(changedPage.id)]);
      expect(result.skippedFiles).toEqual(["metadata.json"]);
      expect(tracker.status).toBe("saved");
      expect((await loadNotebook(notebookPath)).notebook).toEqual(changed);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("handles a 500-page notebook without changing its model", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Large Notebook");
    const notebook = buildNotebook({ sections: 10, pagesPerSection: 50 });
    try {
      const result = await saveNotebook(notebookPath, notebook);
      const loaded = await loadNotebook(notebookPath);

      expect(result.writtenFiles).toHaveLength(511);
      expect(loaded.notebook.sections.flatMap(({ pages }) => pages)).toHaveLength(500);
      expect(loaded.notebook).toEqual(notebook);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  }, 30_000);

  it("can force a complete save while still avoiding identical rewrites", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Forced Save");
    const notebook = createNotebook({ ...buildNotebook(), name: "Forced" });
    try {
      await saveNotebook(notebookPath, notebook);
      const result = await saveNotebook(notebookPath, notebook, { force: true });
      expect(result.writtenFiles).toEqual([]);
      expect(result.skippedFiles).toHaveLength(7);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("reports invalid save input through a structured persistence error", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Invalid Save");
    const invalid = { ...buildNotebook(), name: "" } as Notebook;
    try {
      await expect(saveNotebook(notebookPath, invalid)).rejects.toMatchObject({
        code: "INVALID_DATA",
        path: notebookPath,
        details: { issues: expect.any(Array) },
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });
});
