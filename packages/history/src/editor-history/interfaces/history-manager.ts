import type { EditorCommand } from "./editor-command";
import type { HistoryTransactionOptions } from "../model/history-metadata";
import type { HistoryTransactionState, IHistoryState } from "../state/history-state";

/**
 * Model-neutral owner of command execution, bounded undo/redo state, and the
 * approved non-nested transaction lifecycle.
 *
 * Implementations own all mutable History state. They validate only command
 * protocol and History lifecycle concerns; concrete commands own domain rules.
 */
export interface IHistoryManager<TDocument> {
  /** Executes a command against the active document session. */
  readonly executeCommand: (command: EditorCommand<TDocument>) => IHistoryState;
  /** Undoes the most recently committed command or command group. */
  readonly undo: () => IHistoryState;
  /** Redoes the most recently undone command or command group. */
  readonly redo: () => IHistoryState;
  /** Removes all committed undo and redo entries. */
  readonly clearHistory: () => IHistoryState;
  /** Reports whether an undo operation is currently available. */
  readonly canUndo: () => boolean;
  /** Reports whether a redo operation is currently available. */
  readonly canRedo: () => boolean;
  /** Returns an immutable, document-free view of current History state. */
  readonly getHistoryState: () => IHistoryState;
  /** Returns the monotonic History version. */
  readonly getHistoryVersion: () => number;
  /** Starts the single supported transaction scope. */
  readonly beginTransaction: (options?: HistoryTransactionOptions) => HistoryTransactionState;
  /** Commits the active transaction as one undoable History entry. */
  readonly commitTransaction: () => IHistoryState;
  /** Reverses the active transaction without committing a History entry. */
  readonly rollbackTransaction: () => IHistoryState;
}
