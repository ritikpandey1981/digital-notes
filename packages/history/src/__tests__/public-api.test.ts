import { describe, expect, it } from "vitest";
import * as history from "../index";
import {
  HistoryError,
  HistoryManager,
  createEditorHistoryManager,
  createHistoryController,
  createAddPageCommand,
  createAddSectionCommand,
  createDeletePageCommand,
  createDeleteSectionCommand,
  createDuplicatePageCommand,
  createRenameNotebookCommand,
  createRenameSectionCommand,
  createReorderPagesCommand,
  createReorderSectionsCommand,
  createUpdateNotebookMetadataCommand,
  isHistoryError,
} from "../index";
import { buildNotebook } from "./helpers";

describe("@folio/history public API", () => {
  it("preserves Phase 5 exports while adding only the approved generic factories", () => {
    expect(Object.keys(history).sort()).toEqual(
      [
        "HistoryError",
        "HistoryManager",
        "createAddPageCommand",
        "createAddSectionCommand",
        "createDeletePageCommand",
        "createDeleteSectionCommand",
        "createDuplicatePageCommand",
        "createEditorHistoryManager",
        "createHistoryController",
        "createRenameNotebookCommand",
        "createRenameSectionCommand",
        "createReorderPagesCommand",
        "createReorderSectionsCommand",
        "createUpdateNotebookMetadataCommand",
        "isHistoryError",
      ].sort(),
    );
  });

  it("exports the manager and every Phase 5 command factory", () => {
    expect(HistoryManager).toBeTypeOf("function");
    expect(createRenameNotebookCommand).toBeTypeOf("function");
    expect(createUpdateNotebookMetadataCommand).toBeTypeOf("function");
    expect(createAddSectionCommand).toBeTypeOf("function");
    expect(createDeleteSectionCommand).toBeTypeOf("function");
    expect(createRenameSectionCommand).toBeTypeOf("function");
    expect(createReorderSectionsCommand).toBeTypeOf("function");
    expect(createAddPageCommand).toBeTypeOf("function");
    expect(createDeletePageCommand).toBeTypeOf("function");
    expect(createDuplicatePageCommand).toBeTypeOf("function");
    expect(createReorderPagesCommand).toBeTypeOf("function");
    expect(new HistoryManager(buildNotebook())).toBeInstanceOf(HistoryManager);
  });

  it("exports only the approved generic History factories at runtime", () => {
    expect(createEditorHistoryManager).toBeTypeOf("function");
    expect(createHistoryController).toBeTypeOf("function");
    expect(Object.keys(history)).not.toContain("EditorHistoryManagerImplementation");
    expect(Object.keys(history)).not.toContain("HistoryControllerImplementation");
    expect(Object.keys(history)).not.toContain("BoundedCommandStack");
  });

  it("provides a structured public error and type guard", () => {
    const error = new HistoryError("TRANSACTION_NOT_ACTIVE", "No transaction.", {
      details: { operation: "rollback" },
    });

    expect(isHistoryError(error)).toBe(true);
    expect(isHistoryError(new Error("ordinary"))).toBe(false);
    expect(error).toMatchObject({
      name: "HistoryError",
      code: "TRANSACTION_NOT_ACTIVE",
      details: { operation: "rollback" },
    });
  });
});
