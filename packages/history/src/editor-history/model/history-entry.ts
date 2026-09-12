import type { DocumentContentStateId } from "../interfaces/history-document-session";
import type { EditorCommand } from "../interfaces/editor-command";
import type { HistoryCommandMetadata } from "./history-metadata";

/** Internal command-only stack entry. It never retains a document aggregate. */
export interface HistoryEntry<TDocument> {
  readonly command: EditorCommand<TDocument>;
  readonly metadata: HistoryCommandMetadata;
  /**
   * The content identities this entry moves between, or null when the owning
   * session has no persistence identity.
   *
   * Undo restores `beforeStateId` and Redo restores `afterStateId`, which is
   * what makes a save checkpoint reachable again from either direction.
   */
  readonly beforeStateId: DocumentContentStateId | null;
  readonly afterStateId: DocumentContentStateId | null;
}

export function createHistoryEntry<TDocument>(
  command: EditorCommand<TDocument>,
): HistoryEntry<TDocument> {
  return Object.freeze({
    command,
    metadata: createHistoryCommandMetadata(command),
    beforeStateId: null,
    afterStateId: null,
  });
}

/** Records the identities an entry actually moved between, once its change is installed. */
export function withContentStateIdentity<TDocument>(
  entry: HistoryEntry<TDocument>,
  beforeStateId: DocumentContentStateId | null,
  afterStateId: DocumentContentStateId | null,
): HistoryEntry<TDocument> {
  return Object.freeze({ ...entry, beforeStateId, afterStateId });
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
