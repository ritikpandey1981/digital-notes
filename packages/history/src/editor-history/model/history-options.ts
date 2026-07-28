import type { HistoryDocumentSession } from "../interfaces/history-document-session";
import type { IHistoryManager } from "../interfaces/history-manager";

/** Immutable construction options for the generic History manager factory. */
export interface EditorHistoryManagerOptions<TDocument> {
  readonly documentSession: HistoryDocumentSession<TDocument>;
  readonly historyLimit?: number;
}

/** Immutable construction options for the editor-facing controller factory. */
export interface EditorHistoryControllerOptions<TDocument> {
  readonly manager: IHistoryManager<TDocument>;
}
