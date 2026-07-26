export type ValidationCode =
  | "duplicate_id"
  | "invalid_reference"
  | "invalid_type"
  | "invalid_value"
  | "not_found"
  | "not_serializable"
  | "out_of_range"
  | "required";

export interface ValidationIssue {
  readonly path: string;
  readonly code: ValidationCode;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export class DomainValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const detail = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    super(`Domain validation failed${detail ? `: ${detail}` : "."}`);
    this.name = "DomainValidationError";
    this.issues = Object.freeze([...issues]);
  }
}
