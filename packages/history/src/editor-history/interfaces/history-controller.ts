import type { EditorCommand } from "./editor-command";
import type { HistoryTransactionOptions } from "../model/history-metadata";
import type { HistoryListener } from "../model/history-notification";
import type { HistoryTransactionState, IHistoryState } from "../state/history-state";

/**
 * The sole History boundary exposed to an editor coordinator.
 *
 * A controller delegates execution to its manager and publishes immutable
 * post-operation notifications. It contains no document, rendering, or UI
 * semantics.
 */
export interface IHistoryController<TDocument> {
  /** Submits one immutable command for execution. */
  readonly executeCommand: (command: EditorCommand<TDocument>) => IHistoryState;
  /** Requests one undo operation. */
  readonly undo: () => IHistoryState;
  /** Requests one redo operation. */
  readonly redo: () => IHistoryState;
  /** Clears committed undo and redo entries. */
  readonly clearHistory: () => IHistoryState;
  /** Reports whether an undo operation is currently available. */
  readonly canUndo: () => boolean;
  /** Reports whether a redo operation is currently available. */
  readonly canRedo: () => boolean;
  /** Returns the current immutable, document-free History state. */
  readonly getHistoryState: () => IHistoryState;
  /** Returns the monotonic History version. */
  readonly getHistoryVersion: () => number;
  /** Starts the single supported transaction scope. */
  readonly beginTransaction: (options?: HistoryTransactionOptions) => HistoryTransactionState;
  /** Commits the active transaction as one undoable History entry. */
  readonly commitTransaction: () => IHistoryState;
  /** Reverses the active transaction without committing a History entry. */
  readonly rollbackTransaction: () => IHistoryState;
  /** Registers a listener and returns an idempotent unsubscribe callback. */
  readonly subscribe: (listener: HistoryListener) => () => void;
  /** Releases controller-owned subscriptions and rejects future operations. */
  readonly destroy: () => void;
}
