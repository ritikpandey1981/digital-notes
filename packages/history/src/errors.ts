export type HistoryErrorCode =
  | "COMMAND_EXECUTION_FAILED"
  | "COMMAND_REDO_FAILED"
  | "COMMAND_RESULT_MISMATCH"
  | "COMMAND_STATE_MISMATCH"
  | "COMMAND_UNDO_FAILED"
  | "HISTORY_CONTROLLER_DESTROYED"
  | "HISTORY_LIFECYCLE_VIOLATION"
  | "HISTORY_MANAGER_ALREADY_CONTROLLED"
  | "INVALID_COMMAND"
  | "INVALID_DOCUMENT_SESSION"
  | "INVALID_EDITOR_COMMAND"
  | "INVALID_HISTORY_LIMIT"
  | "INVALID_HISTORY_LISTENER"
  | "INVALID_HISTORY_MANAGER"
  | "INVALID_NOTEBOOK"
  | "TRANSACTION_ACTIVE"
  | "TRANSACTION_COMMIT_FAILED"
  | "TRANSACTION_NOT_ACTIVE"
  | "TRANSACTION_ROLLBACK_FAILED";

export interface HistoryErrorOptions {
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export class HistoryError extends Error {
  readonly code: HistoryErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: HistoryErrorCode, message: string, options: HistoryErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "HistoryError";
    this.code = code;
    this.details = options.details;
  }
}

export function isHistoryError(error: unknown): error is HistoryError {
  return error instanceof HistoryError;
}
