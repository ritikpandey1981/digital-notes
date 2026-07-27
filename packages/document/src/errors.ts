import type { ObjectValidationIssue } from "./types";

export type DocumentObjectErrorCode =
  | "DUPLICATE_OBJECT_ID"
  | "INVALID_COLLECTION"
  | "INVALID_INDEX"
  | "INVALID_OBJECT"
  | "OBJECT_NOT_FOUND"
  | "UNSUPPORTED_OBJECT_TYPE";

export class DocumentObjectError extends Error {
  readonly code: DocumentObjectErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DocumentObjectErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentObjectError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export class ObjectValidationError extends Error {
  readonly code = "OBJECT_VALIDATION_FAILED" as const;
  readonly issues: readonly ObjectValidationIssue[];

  constructor(issues: readonly ObjectValidationIssue[]) {
    super(`Document object validation failed with ${issues.length} issue(s).`);
    this.name = "ObjectValidationError";
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}
