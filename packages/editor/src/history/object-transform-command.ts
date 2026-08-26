import {
  InkObject,
  PageDocument,
  ObjectFactory,
  isVectorObject,
  type Transform,
} from "@folio/document";

export type ScalarTransformKind = "rotation" | "scale";
export type TransformCommandOperation = "execute" | "undo" | "redo";

export interface ScalarTransformCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialValue: number;
  readonly finalValue: number;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

export interface ResolvedScalarTransformCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialValue: number;
  readonly finalValue: number;
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
}

type TransformCommandErrorCode =
  | `INVALID_${Uppercase<ScalarTransformKind>}_COMMAND`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_HIDDEN`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_LOCKED`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_NOT_FOUND`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_STALE`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_STATE_MISMATCH`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_TRANSITION_FAILED`
  | `${Uppercase<ScalarTransformKind>}_OBJECT_UNSUPPORTED`;

class TransformCommandError extends Error {
  readonly code: TransformCommandErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TransformCommandErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TransformCommandError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function resolveScalarTransformCommandInput(
  kind: ScalarTransformKind,
  input: ScalarTransformCommandInput,
): ResolvedScalarTransformCommandInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidCommand(kind, `${label(kind)}Command requires an input object.`);
  }
  const objectId = input.objectId;
  const expectedObjectModifiedAt = input.expectedObjectModifiedAt;
  const initialValue = input.initialValue;
  const finalValue = input.finalValue;
  const id = input.id ?? defaultId(kind);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const description = input.description ?? `${label(kind)} object ${objectId}`;

  if (!isNonBlankString(objectId)) {
    throw invalidCommand(kind, `${label(kind)}Command objectId must not be blank.`);
  }
  if (!isNonBlankString(id) || !isNonBlankString(description)) {
    throw invalidCommand(kind, `${label(kind)}Command metadata must not be blank.`);
  }
  if (!isIsoTimestamp(expectedObjectModifiedAt) || !isIsoTimestamp(timestamp)) {
    throw invalidCommand(
      kind,
      `${label(kind)}Command timestamps must be canonical ISO timestamps.`,
    );
  }
  if (timestamp < expectedObjectModifiedAt) {
    throw invalidCommand(
      kind,
      `${label(kind)}Command timestamp cannot precede the object revision.`,
    );
  }
  if (!validValue(kind, initialValue) || !validValue(kind, finalValue)) {
    throw invalidCommand(kind, valueRequirement(kind));
  }
  if (initialValue === finalValue) {
    throw invalidCommand(kind, `${label(kind)}Command requires distinct initial and final values.`);
  }
  return Object.freeze({
    objectId,
    expectedObjectModifiedAt,
    initialValue,
    finalValue,
    id,
    timestamp,
    description,
  });
}

export function transitionScalarTransform(
  kind: ScalarTransformKind,
  document: PageDocument,
  input: ResolvedScalarTransformCommandInput,
  operation: TransformCommandOperation,
  expectedValue: number,
  targetValue: number,
  expectedModifiedAt: string,
  targetModifiedAt: string,
): PageDocument {
  const prefix = kind.toUpperCase() as Uppercase<ScalarTransformKind>;
  if (!(document instanceof PageDocument)) {
    throw commandError(
      `${prefix}_OBJECT_UNSUPPORTED`,
      `${label(kind)}Command requires a PageDocument.`,
      { operation },
    );
  }
  const object = document.lookup(input.objectId);
  if (object === undefined) {
    throw commandError(`${prefix}_OBJECT_NOT_FOUND`, `Object '${input.objectId}' was not found.`, {
      objectId: input.objectId,
      operation,
    });
  }
  if (!(object instanceof InkObject) && !isVectorObject(object)) {
    throw commandError(
      `${prefix}_OBJECT_UNSUPPORTED`,
      `Object '${input.objectId}' is not a supported PageObject implementation.`,
      { objectId: input.objectId, operation, type: object.type },
    );
  }
  if (!object.visible) {
    throw commandError(`${prefix}_OBJECT_HIDDEN`, `Object '${input.objectId}' is hidden.`, {
      objectId: input.objectId,
      operation,
    });
  }
  if (object.locked) {
    throw commandError(`${prefix}_OBJECT_LOCKED`, `Object '${input.objectId}' is locked.`, {
      objectId: input.objectId,
      operation,
    });
  }
  if (object.modifiedAt !== expectedModifiedAt) {
    throw commandError(
      `${prefix}_OBJECT_STALE`,
      `Object '${input.objectId}' changed after this command was created.`,
      {
        objectId: input.objectId,
        operation,
        expectedModifiedAt,
        actualModifiedAt: object.modifiedAt,
      },
    );
  }
  const currentValue = readValue(kind, object.transform);
  if (currentValue !== expectedValue) {
    throw commandError(
      `${prefix}_OBJECT_STATE_MISMATCH`,
      `Object '${input.objectId}' is not at the ${kind} required for ${operation}.`,
      { objectId: input.objectId, operation, expectedValue, actualValue: currentValue },
    );
  }

  try {
    const factory = new ObjectFactory({ now: () => targetModifiedAt });
    const replacement =
      kind === "rotation"
        ? factory.rotateObject(object, targetValue)
        : factory.scaleObject(object, targetValue);
    return document.replace(replacement);
  } catch (cause) {
    throw commandError(
      `${prefix}_OBJECT_TRANSITION_FAILED`,
      `Object '${input.objectId}' could not complete ${operation}.`,
      { objectId: input.objectId, operation },
      cause,
    );
  }
}

function readValue(kind: ScalarTransformKind, transform: Transform): number {
  return kind === "rotation" ? transform.rotation : transform.scale;
}

function validValue(kind: ScalarTransformKind, value: number): boolean {
  return Number.isFinite(value) && (kind === "rotation" || value > 0);
}

function valueRequirement(kind: ScalarTransformKind): string {
  return kind === "rotation"
    ? "RotateCommand values must be finite radians."
    : "ScaleCommand values must be positive finite factors.";
}

function label(kind: ScalarTransformKind): "Rotate" | "Scale" {
  return kind === "rotation" ? "Rotate" : "Scale";
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function defaultId(kind: ScalarTransformKind): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function invalidCommand(kind: ScalarTransformKind, message: string): TransformCommandError {
  return commandError(
    `INVALID_${kind.toUpperCase() as Uppercase<ScalarTransformKind>}_COMMAND`,
    message,
  );
}

function commandError(
  code: TransformCommandErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): TransformCommandError {
  return new TransformCommandError(
    code,
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}
