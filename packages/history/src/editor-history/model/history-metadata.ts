/** Immutable public description of a command without its executable behavior. */
export interface HistoryCommandMetadata {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
}

/** Operation whose lifecycle is tracked by generic editor History. */
export type HistoryOperation = "execute" | "redo" | "undo";

/** Observable outcome of a completed History operation. */
export type HistoryOperationOutcome = "failed" | "succeeded";

/** Optional immutable metadata for one non-nested transaction. */
export interface HistoryTransactionOptions {
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}
