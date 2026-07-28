import type {
  HistoryCommandMetadata,
  HistoryOperation,
  HistoryOperationOutcome,
} from "../model/history-metadata";

/** Explicit phase of the generic History execution state machine. */
export type HistoryExecutionPhase = "completed" | "executing" | "idle" | "redoing" | "undoing";

/** Idle execution state; no command lifecycle is active. */
export interface IdleHistoryExecutionState {
  readonly phase: "idle";
  readonly operation: null;
  readonly command: null;
}

/** Active execution state for a newly submitted command. */
export interface ExecutingHistoryExecutionState {
  readonly phase: "executing";
  readonly operation: "execute";
  readonly command: HistoryCommandMetadata;
}

/** Active execution state for an undo operation. */
export interface UndoingHistoryExecutionState {
  readonly phase: "undoing";
  readonly operation: "undo";
  readonly command: HistoryCommandMetadata;
}

/** Active execution state for a redo operation. */
export interface RedoingHistoryExecutionState {
  readonly phase: "redoing";
  readonly operation: "redo";
  readonly command: HistoryCommandMetadata;
}

/** Completed operation state observed before History returns to idle. */
export interface CompletedHistoryExecutionState {
  readonly phase: "completed";
  readonly operation: HistoryOperation;
  readonly outcome: HistoryOperationOutcome;
  readonly command: HistoryCommandMetadata;
}

/**
 * Discriminated execution-state contract that prevents illegal boolean-state
 * combinations.
 */
export type HistoryExecutionState =
  | CompletedHistoryExecutionState
  | ExecutingHistoryExecutionState
  | IdleHistoryExecutionState
  | RedoingHistoryExecutionState
  | UndoingHistoryExecutionState;

/** Immutable summary of the one active, non-nested transaction. */
export interface HistoryTransactionState {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly commandCount: number;
}

/**
 * Immutable, document-free view of generic History state.
 *
 * This interface exposes capabilities and lifecycle metadata only. It never
 * retains or reveals an active document or a before/after aggregate.
 */
export interface IHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly historyLimit: number;
  readonly historyVersion: number;
  readonly executionCounter: number;
  readonly executionState: HistoryExecutionState;
  readonly activeTransaction: HistoryTransactionState | null;
  readonly lastCommand: HistoryCommandMetadata | null;
}
