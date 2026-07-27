export type HistoryErrorCode =
  | "COMMAND_RESULT_MISMATCH"
  | "COMMAND_STATE_MISMATCH"
  | "INVALID_COMMAND"
  | "INVALID_HISTORY_LIMIT"
  | "INVALID_NOTEBOOK"
  | "TRANSACTION_ACTIVE"
  | "TRANSACTION_NOT_ACTIVE";

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
