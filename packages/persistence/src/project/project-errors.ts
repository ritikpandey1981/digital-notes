export type FolioProjectCodecErrorCode =
  | "INVALID_PROJECT"
  | "UNSUPPORTED_VERSION"
  | "INVALID_METADATA"
  | "INVALID_PAGE"
  | "INVALID_LAYER"
  | "INVALID_OBJECT"
  | "INVALID_INK"
  | "RESOURCE_LIMIT";

export interface FolioProjectCodecErrorOptions {
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** One structured error boundary for malformed, unsupported, or excessive project input. */
export class FolioProjectCodecError extends Error {
  readonly code: FolioProjectCodecErrorCode;
  readonly path: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: FolioProjectCodecErrorCode,
    message: string,
    options: FolioProjectCodecErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "FolioProjectCodecError";
    this.code = code;
    this.path = options.path ?? "$";
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }
}
