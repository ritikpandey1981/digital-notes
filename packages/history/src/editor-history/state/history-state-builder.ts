import type {
  HistoryCommandMetadata,
  HistoryOperation,
  HistoryOperationOutcome,
} from "../model/history-metadata";
import type {
  HistoryExecutionState,
  HistoryTransactionState,
  IHistoryState,
  IdleHistoryExecutionState,
} from "./history-state";

export const IDLE_HISTORY_EXECUTION_STATE: IdleHistoryExecutionState = Object.freeze({
  phase: "idle",
  operation: null,
  command: null,
});

export interface HistoryStateBuilderInput {
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly historyLimit: number;
  readonly historyVersion: number;
  readonly executionCounter: number;
  readonly executionState: HistoryExecutionState;
  readonly activeTransaction: HistoryTransactionState | null;
  readonly lastCommand: HistoryCommandMetadata | null;
}

export function createActiveExecutionState(
  operation: HistoryOperation,
  command: HistoryCommandMetadata,
): HistoryExecutionState {
  if (operation === "execute") {
    return Object.freeze({ phase: "executing", operation, command });
  }
  if (operation === "undo") {
    return Object.freeze({ phase: "undoing", operation, command });
  }
  return Object.freeze({ phase: "redoing", operation, command });
}

export function createCompletedExecutionState(
  operation: HistoryOperation,
  outcome: HistoryOperationOutcome,
  command: HistoryCommandMetadata,
): HistoryExecutionState {
  return Object.freeze({ phase: "completed", operation, outcome, command });
}

export function createHistoryState(input: HistoryStateBuilderInput): IHistoryState {
  const operationsAvailable =
    input.activeTransaction === null && ["completed", "idle"].includes(input.executionState.phase);
  return Object.freeze({
    canUndo: operationsAvailable && input.undoDepth > 0,
    canRedo: operationsAvailable && input.redoDepth > 0,
    undoDepth: input.undoDepth,
    redoDepth: input.redoDepth,
    historyLimit: input.historyLimit,
    historyVersion: input.historyVersion,
    executionCounter: input.executionCounter,
    executionState: input.executionState,
    activeTransaction: input.activeTransaction,
    lastCommand: input.lastCommand,
  });
}
