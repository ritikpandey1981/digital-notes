export type PersistenceErrorCode =
  | "ATOMIC_WRITE_FAILED"
  | "CORRUPT_JSON"
  | "INVALID_DATA"
  | "INVALID_PATH"
  | "INVALID_RECOVERY"
  | "IO_ERROR"
  | "MISSING_FILE"
  | "RECOVERY_FAILED"
  | "UNSUPPORTED_VERSION";

export interface PersistenceErrorOptions {
  readonly path?: string | undefined;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly path: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: PersistenceErrorCode, message: string, options: PersistenceErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "PersistenceError";
    this.code = code;
    this.path = options.path;
    this.details = options.details;
  }
}

export function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError;
}

export function toPersistenceError(
  error: unknown,
  code: PersistenceErrorCode,
  message: string,
  path?: string,
): PersistenceError {
  if (isPersistenceError(error)) return error;
  return new PersistenceError(code, message, { path, cause: error });
}
