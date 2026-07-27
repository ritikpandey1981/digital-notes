export type RenderingErrorCode =
  | "CANVAS_ALREADY_MOUNTED"
  | "CANVAS_CONTEXT_UNAVAILABLE"
  | "CONTEXT_LOST"
  | "CONTEXT_RESTORATION_FAILED"
  | "CONTROLLER_DESTROYED"
  | "CONTROLLER_NOT_MOUNTED"
  | "INVALID_DPR"
  | "INVALID_GEOMETRY"
  | "INVALID_VIEWPORT"
  | "INVALID_ZOOM"
  | "RENDERER_DESTROYED"
  | "RESIZE_FAILED"
  | "SCHEDULER_DESTROYED";

export class RenderingError extends Error {
  readonly code: RenderingErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: RenderingErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RenderingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
