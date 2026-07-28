import { HistoryError } from "../../errors";
import type { EditorCommand } from "../interfaces/editor-command";

/** Validates only the model-neutral EditorCommand protocol. */
export function assertEditorCommand<TDocument>(
  command: EditorCommand<TDocument>,
): asserts command is EditorCommand<TDocument> {
  if (
    command === null ||
    typeof command !== "object" ||
    !Object.isFrozen(command) ||
    !isNonBlankString(command.id) ||
    !isIsoTimestamp(command.timestamp) ||
    !isNonBlankString(command.description) ||
    typeof command.execute !== "function" ||
    typeof command.undo !== "function" ||
    typeof command.redo !== "function"
  ) {
    throw new HistoryError(
      "INVALID_EDITOR_COMMAND",
      "Editor commands must be immutable and contain valid identity, metadata, execute, undo, and redo members.",
    );
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
