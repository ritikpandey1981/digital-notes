export type InkErrorCode =
  | "ACTIVE_POINTER_EXISTS"
  | "BUILDER_CANCELLED"
  | "BUILDER_FINALIZED"
  | "DUPLICATE_POINTER_UP"
  | "INVALID_COORDINATE"
  | "INVALID_POINTER_DATA"
  | "INVALID_PRESSURE"
  | "INVALID_STROKE"
  | "INVALID_STYLE"
  | "INVALID_TIMESTAMP"
  | "LOST_POINTER"
  | "NO_ACTIVE_STROKE"
  | "POINTER_CAPTURE_FAILED"
  | "RENDERER_DESTROYED"
  | "UNSUPPORTED_POINTER";

export class InkError extends Error {
  readonly code: InkErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: InkErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InkError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
