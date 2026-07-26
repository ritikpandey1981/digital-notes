import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  addPage,
  addSection,
  createPage,
  createSection,
  deletePage,
  deleteSection,
  duplicatePageInSection,
  renameNotebook,
  renameSection,
  reorderPages,
  reorderSections,
  updateNotebookMetadata,
} from "../index";
import { buildNotebook, deterministicContext, NEXT_TIMESTAMP, TEST_TIMESTAMP } from "./fixtures";

const updateContext = {
  createId: deterministicContext("update").createId,
  now: () => NEXT_TIMESTAMP,
};

describe("notebook aggregate operations", () => {
  it("renames a notebook immutably and updates metadata time", () => {
    const original = buildNotebook();
    const renamed = renameNotebook(original, "Renamed", updateContext);

    expect(renamed.name).toBe("Renamed");
    expect(renamed.updatedAt).toBe(NEXT_TIMESTAMP);
    expect(original.name).toBe("Studio Notes");
    expect(original.updatedAt).toBe(TEST_TIMESTAMP);
  });

  it("updates cover, theme, and settings as one metadata operation", () => {
    const updated = updateNotebookMetadata(
      buildNotebook(),
      { cover: { kind: "color", value: "#1e1e1e" }, theme: "midnight", settings: { grid: true } },
      updateContext,
    );

    expect(updated.cover).toEqual({ kind: "color", value: "#1e1e1e" });
    expect(updated.theme).toBe("midnight");
    expect(updated.settings).toEqual({ grid: true });
    expect(updated.updatedAt).toBe(NEXT_TIMESTAMP);
  });

  it("adds and deletes sections", () => {
    const original = buildNotebook();
    const section = createSection({ id: "section-2", title: "Ideas" });
    const added = addSection(original, section, updateContext);
    const removed = deleteSection(added, section.id, updateContext);

    expect(added.sections.map(({ id }) => id)).toEqual(["section-1", "section-2"]);
    expect(removed.sections.map(({ id }) => id)).toEqual(["section-1"]);
    expect(original.sections).toHaveLength(1);
  });

  it("renames a section without mutating the original", () => {
    const original = buildNotebook();
    const updated = renameSection(original, "section-1", "Archive", updateContext);

    expect(updated.sections[0]?.title).toBe("Archive");
    expect(original.sections[0]?.title).toBe("Notes");
  });

  it("reorders sections while preserving their values", () => {
    const second = createSection({ id: "section-2", title: "Second" });
    const withSecond = addSection(buildNotebook(), second, updateContext);
    const reordered = reorderSections(withSecond, 1, 0, updateContext);

    expect(reordered.sections.map(({ id }) => id)).toEqual(["section-2", "section-1"]);
  });

  it("returns the same notebook for a no-op section reorder", () => {
    const notebook = buildNotebook();
    expect(reorderSections(notebook, 0, 0, updateContext)).toBe(notebook);
  });

  it("adds and deletes pages in a named section", () => {
    const page = createPage({ id: "page-2", width: 210, height: 297 });
    const added = addPage(buildNotebook(), "section-1", page, updateContext);
    const removed = deletePage(added, "section-1", page.id, updateContext);

    expect(added.sections[0]?.pages.map(({ id }) => id)).toEqual(["page-1", "page-2"]);
    expect(removed.sections[0]?.pages.map(({ id }) => id)).toEqual(["page-1"]);
  });

  it("duplicates a page immediately after its source", () => {
    const result = duplicatePageInSection(
      buildNotebook(),
      "section-1",
      "page-1",
      deterministicContext("duplicate"),
    );

    expect(result.notebook.sections[0]?.pages.map(({ id }) => id)).toEqual([
      "page-1",
      "duplicate-2",
    ]);
    expect(result.page.id).toBe("duplicate-2");
    expect(result.page.objects[0]?.id).toBe("duplicate-1");
  });

  it("reorders pages", () => {
    const page = createPage({ id: "page-2", width: 210, height: 297 });
    const withPage = addPage(buildNotebook(), "section-1", page, updateContext);
    const reordered = reorderPages(withPage, "section-1", 1, 0, updateContext);

    expect(reordered.sections[0]?.pages.map(({ id }) => id)).toEqual(["page-2", "page-1"]);
  });

  it("rejects duplicate identifiers when adding aggregate members", () => {
    const duplicate = createSection({ id: "section-1", title: "Duplicate" });
    expect(() => addSection(buildNotebook(), duplicate, updateContext)).toThrowError(
      DomainValidationError,
    );
  });

  it.each([
    ["missing section", () => deleteSection(buildNotebook(), "missing", updateContext)],
    ["missing page", () => deletePage(buildNotebook(), "section-1", "missing", updateContext)],
    ["bad section index", () => reorderSections(buildNotebook(), 0, 2, updateContext)],
    ["bad page index", () => reorderPages(buildNotebook(), "section-1", -1, 0, updateContext)],
  ])("reports %s as a domain validation error", (_label, operation) => {
    expect(operation).toThrowError(DomainValidationError);
  });

  it("rejects metadata that references an unknown cover asset", () => {
    expect(() =>
      updateNotebookMetadata(
        buildNotebook(),
        { cover: { kind: "asset", assetId: "missing" } },
        updateContext,
      ),
    ).toThrowError(DomainValidationError);
  });
});
