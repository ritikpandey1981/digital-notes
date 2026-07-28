import type { EditorCommand } from "../interfaces/editor-command";
import type { HistoryCommandMetadata } from "./history-metadata";

/** Internal command-only stack entry. It never retains a document aggregate. */
export interface HistoryEntry<TDocument> {
  readonly command: EditorCommand<TDocument>;
  readonly metadata: HistoryCommandMetadata;
}

export function createHistoryEntry<TDocument>(
  command: EditorCommand<TDocument>,
): HistoryEntry<TDocument> {
  return Object.freeze({
    command,
    metadata: createHistoryCommandMetadata(command),
  });
}

export function createHistoryCommandMetadata<TDocument>(
  command: EditorCommand<TDocument>,
): HistoryCommandMetadata {
  return Object.freeze({
    id: command.id,
    timestamp: command.timestamp,
    description: command.description,
  });
}
