import { createPage, createSection } from "@folio/domain";
import { describe, expect, it } from "vitest";
import {
  createRenameNotebookCommand,
  createUpdateNotebookMetadataCommand,
} from "../commands/notebook-commands";
import {
  createAddPageCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createReorderPagesCommand,
} from "../commands/page-commands";
import {
  createAddSectionCommand,
  createDeleteSectionCommand,
  createRenameSectionCommand,
  createReorderSectionsCommand,
} from "../commands/section-commands";
import { HistoryError } from "../errors";
import {
  COMMAND_TIMESTAMP,
  INITIAL_TIMESTAMP,
  buildNotebook,
  commandOptions,
  createFixturePage,
} from "./helpers";

describe("notebook commands", () => {
  it("renames a notebook and restores the exact original snapshot", () => {
    const before = buildNotebook();
    const command = createRenameNotebookCommand(
      before,
      "Renamed Atlas",
      commandOptions("rename-notebook"),
    );
    const after = command.execute(before);

    expect(command).toMatchObject({
      id: "rename-notebook",
      timestamp: COMMAND_TIMESTAMP,
      description: 'Rename notebook to "Renamed Atlas"',
      category: "notebook",
      affectedTargets: [{ kind: "metadata" }],
    });
    expect(after.name).toBe("Renamed Atlas");
    expect(after.updatedAt).toBe(COMMAND_TIMESTAMP);
    expect(command.undo(after)).toBe(before);
    expect(command.redo(before)).toBe(after);
  });

  it("updates cover, theme, and settings as one immutable metadata command", () => {
    const before = buildNotebook();
    const command = createUpdateNotebookMetadataCommand(
      before,
      {
        cover: { kind: "color", value: "#123456" },
        theme: "midnight",
        settings: { snapToGrid: false, pageGap: 32 },
      },
      commandOptions("update-metadata"),
    );
    const after = command.execute(before);

    expect(after).not.toBe(before);
    expect(after.cover).toEqual({ kind: "color", value: "#123456" });
    expect(after.theme).toBe("midnight");
    expect(after.settings).toEqual({ snapToGrid: false, pageGap: 32 });
    expect(command.undo(after)).toBe(before);
  });

  it("freezes commands and their persistence change targets", () => {
    const command = createRenameNotebookCommand(
      buildNotebook(),
      "Frozen",
      commandOptions("immutable-command"),
    );

    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.affectedTargets)).toBe(true);
    expect(command.affectedTargets.every(Object.isFrozen)).toBe(true);
  });

  it("rejects execution against a stale notebook reference", () => {
    const before = buildNotebook();
    const command = createRenameNotebookCommand(before, "Next", commandOptions("stale"));

    expect(() => command.execute(buildNotebook())).toThrowError(
      expect.objectContaining<Partial<HistoryError>>({ code: "COMMAND_STATE_MISMATCH" }),
    );
  });
});

describe("section commands", () => {
  it("adds and removes a section with its pages as one reversible command", () => {
    const before = buildNotebook();
    const section = createSection({
      id: "section-4",
      title: "Sources",
      pages: [createFixturePage("page-4")],
    });
    const command = createAddSectionCommand(before, section, commandOptions("add-section"));
    const after = command.execute(before);

    expect(after.sections.at(-1)).toEqual(section);
    expect(command.affectedTargets).toEqual([
      { kind: "section", sectionId: "section-4" },
      { kind: "page", pageId: "page-4", sectionId: "section-4" },
    ]);
    expect(command.undo(after)).toBe(before);
  });

  it("deletes a section and restores its exact aggregate on undo", () => {
    const before = buildNotebook();
    const command = createDeleteSectionCommand(
      before,
      "section-1",
      commandOptions("delete-section"),
    );
    const after = command.execute(before);

    expect(after.sections.map(({ id }) => id)).toEqual(["section-2", "section-3"]);
    expect(command.undo(after)).toBe(before);
    expect(command.affectedTargets).toHaveLength(3);
  });

  it("renames a section through the domain operation", () => {
    const before = buildNotebook();
    const command = createRenameSectionCommand(
      before,
      "section-2",
      "Ideas",
      commandOptions("rename-section"),
    );
    const after = command.execute(before);

    expect(after.sections[1]?.title).toBe("Ideas");
    expect(command.undo(after)).toBe(before);
  });

  it("reorders sections and reverses to the original ordered references", () => {
    const before = buildNotebook();
    const command = createReorderSectionsCommand(before, 0, 2, commandOptions("reorder-sections"));
    const after = command.execute(before);

    expect(after.sections.map(({ id }) => id)).toEqual(["section-2", "section-3", "section-1"]);
    expect(command.undo(after)).toBe(before);
  });
});

describe("page commands", () => {
  it("adds a page and returns the prior notebook on undo", () => {
    const before = buildNotebook();
    const page = createPage({
      id: "page-4",
      width: 800,
      height: 600,
      createdAt: INITIAL_TIMESTAMP,
      updatedAt: INITIAL_TIMESTAMP,
    });
    const command = createAddPageCommand(before, "section-2", page, commandOptions("add-page"));
    const after = command.execute(before);

    expect(after.sections[1]?.pages.at(-1)?.id).toBe("page-4");
    expect(command.undo(after)).toBe(before);
  });

  it("deletes and restores a page", () => {
    const before = buildNotebook();
    const command = createDeletePageCommand(
      before,
      "section-1",
      "page-1",
      commandOptions("delete-page"),
    );
    const after = command.execute(before);

    expect(after.sections[0]?.pages.map(({ id }) => id)).toEqual(["page-2"]);
    expect(command.undo(after)).toBe(before);
  });

  it("duplicates a page deterministically and exposes the created page", () => {
    const before = buildNotebook();
    const generatedIds = ["duplicated-object", "duplicated-page"];
    const command = createDuplicatePageCommand(before, "section-1", "page-1", {
      id: "duplicate-page",
      timestamp: COMMAND_TIMESTAMP,
      context: { createId: () => generatedIds.shift() ?? "unexpected" },
    });
    const after = command.execute(before);

    expect(command.duplicatedPage.id).toBe("duplicated-page");
    expect(command.duplicatedPage.objects[0]?.id).toBe("duplicated-object");
    expect(after.sections[0]?.pages.map(({ id }) => id)).toEqual([
      "page-1",
      "duplicated-page",
      "page-2",
    ]);
    expect(command.undo(after)).toBe(before);
    expect(command.redo(before)).toBe(after);
  });

  it("reorders pages as a reversible section change", () => {
    const before = buildNotebook();
    const command = createReorderPagesCommand(
      before,
      "section-1",
      0,
      1,
      commandOptions("reorder-pages"),
    );
    const after = command.execute(before);

    expect(after.sections[0]?.pages.map(({ id }) => id)).toEqual(["page-2", "page-1"]);
    expect(command.affectedTargets).toEqual([{ kind: "section", sectionId: "section-1" }]);
    expect(command.undo(after)).toBe(before);
  });
});
