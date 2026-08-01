import {
  InkObject,
  ObjectCollection,
  assertValidObject,
  isVectorObject,
  type PageObject,
} from "@folio/document";

export type ObjectLifecycleCommandKind = "delete" | "duplicate";
export type ObjectLifecycleCommandOperation = "execute" | "undo" | "redo";

interface LifecycleMetadataInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

export function assertLifecycleCommandInput(
  kind: ObjectLifecycleCommandKind,
  input: unknown,
): asserts input is Readonly<Record<string, unknown>> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command requires an input object.`);
  }
}

export interface ResolvedLifecycleMetadata {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
}

type LifecycleCommandErrorCode =
  | `INVALID_${Uppercase<ObjectLifecycleCommandKind>}_COMMAND`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_HIDDEN`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_LOCKED`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_NOT_FOUND`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_STALE`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_STATE_MISMATCH`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_TRANSITION_FAILED`
  | `${Uppercase<ObjectLifecycleCommandKind>}_OBJECT_UNSUPPORTED`;

class ObjectLifecycleCommandError extends Error {
  readonly code: LifecycleCommandErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: LifecycleCommandErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ObjectLifecycleCommandError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function resolveLifecycleMetadata(
  kind: ObjectLifecycleCommandKind,
  input: LifecycleMetadataInput,
): ResolvedLifecycleMetadata {
  assertLifecycleCommandInput(kind, input);
  const id = input.id ?? defaultId(kind);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const description = input.description ?? `${label(kind)} object ${input.objectId}`;
  if (!isNonBlankString(input.objectId)) {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command objectId must not be blank.`);
  }
  if (!isNonBlankString(id) || !isNonBlankString(description)) {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command metadata must not be blank.`);
  }
  if (!isIsoTimestamp(input.expectedObjectModifiedAt) || !isIsoTimestamp(timestamp)) {
    throw invalidLifecycleCommand(
      kind,
      `${label(kind)}Command timestamps must be canonical ISO timestamps.`,
    );
  }
  if (timestamp < input.expectedObjectModifiedAt) {
    throw invalidLifecycleCommand(
      kind,
      `${label(kind)}Command timestamp cannot precede the object revision.`,
    );
  }
  return Object.freeze({
    objectId: input.objectId,
    expectedObjectModifiedAt: input.expectedObjectModifiedAt,
    id,
    timestamp,
    description,
  });
}

export function requireLifecycleDocument(
  kind: ObjectLifecycleCommandKind,
  document: ObjectCollection,
  operation: ObjectLifecycleCommandOperation,
): ObjectCollection {
  if (!(document instanceof ObjectCollection)) {
    throw lifecycleError(
      kind,
      "OBJECT_UNSUPPORTED",
      `${label(kind)}Command requires an ObjectCollection document.`,
      { operation },
    );
  }
  return document;
}

export function requireLifecycleObject(
  kind: ObjectLifecycleCommandKind,
  document: ObjectCollection,
  objectId: string,
  expectedModifiedAt: string,
  operation: ObjectLifecycleCommandOperation,
): PageObject {
  const object = document.lookup(objectId);
  if (object === undefined) {
    throw lifecycleError(kind, "OBJECT_NOT_FOUND", `Object '${objectId}' was not found.`, {
      objectId,
      operation,
    });
  }
  if (!(object instanceof InkObject) && !isVectorObject(object)) {
    throw lifecycleError(
      kind,
      "OBJECT_UNSUPPORTED",
      `Object '${objectId}' is not a supported PageObject implementation.`,
      { objectId, operation, type: object.type },
    );
  }
  if (!object.visible) {
    throw lifecycleError(kind, "OBJECT_HIDDEN", `Object '${objectId}' is hidden.`, {
      objectId,
      operation,
    });
  }
  if (object.locked) {
    throw lifecycleError(kind, "OBJECT_LOCKED", `Object '${objectId}' is locked.`, {
      objectId,
      operation,
    });
  }
  if (object.modifiedAt !== expectedModifiedAt) {
    throw lifecycleError(
      kind,
      "OBJECT_STALE",
      `Object '${objectId}' changed after this command was created.`,
      { objectId, operation, expectedModifiedAt, actualModifiedAt: object.modifiedAt },
    );
  }
  return object;
}

export function assertStoredLifecycleObject(
  kind: ObjectLifecycleCommandKind,
  object: PageObject,
): void {
  try {
    assertValidObject(object);
  } catch {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command requires a valid PageObject.`);
  }
  if ((!isVectorObject(object) && !(object instanceof InkObject)) || !Object.isFrozen(object)) {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command requires an immutable PageObject.`);
  }
}

export function assertLifecycleIndex(
  kind: ObjectLifecycleCommandKind,
  index: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > maximum) {
    throw invalidLifecycleCommand(kind, `${label(kind)}Command insertion index is invalid.`, {
      index,
      maximum,
    });
  }
}

export function lifecycleStateMismatch(
  kind: ObjectLifecycleCommandKind,
  message: string,
  details: Readonly<Record<string, unknown>>,
): Error {
  return lifecycleError(kind, "OBJECT_STATE_MISMATCH", message, details);
}

export function lifecycleTransitionFailed(
  kind: ObjectLifecycleCommandKind,
  operation: ObjectLifecycleCommandOperation,
  objectId: string,
  cause: unknown,
): Error {
  return lifecycleError(
    kind,
    "OBJECT_TRANSITION_FAILED",
    `Object '${objectId}' could not complete ${operation}.`,
    { objectId, operation },
    cause,
  );
}

function invalidLifecycleCommand(
  kind: ObjectLifecycleCommandKind,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): ObjectLifecycleCommandError {
  return lifecycleError(kind, `INVALID_${kind.toUpperCase()}_COMMAND`, message, details);
}

function lifecycleError(
  kind: ObjectLifecycleCommandKind,
  suffix: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): ObjectLifecycleCommandError {
  const code = (
    suffix.startsWith("INVALID_") ? suffix : `${kind.toUpperCase()}_${suffix}`
  ) as LifecycleCommandErrorCode;
  return new ObjectLifecycleCommandError(
    code,
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}

function label(kind: ObjectLifecycleCommandKind): "Delete" | "Duplicate" {
  return kind === "delete" ? "Delete" : "Duplicate";
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function defaultId(kind: ObjectLifecycleCommandKind): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
