import { InkObject, ObjectCollection, ObjectFactory, Transform } from "@folio/document";
import type { EditorCommand } from "@folio/history";

interface TranslationVector {
  readonly x: number;
  readonly y: number;
}

/** Editor-internal logical input for one single-object translation command. */
export interface MoveCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialTranslation: TranslationVector;
  readonly finalTranslation: TranslationVector;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

type MoveCommandErrorCode =
  | "INVALID_MOVE_COMMAND"
  | "MOVE_OBJECT_HIDDEN"
  | "MOVE_OBJECT_LOCKED"
  | "MOVE_OBJECT_NOT_FOUND"
  | "MOVE_OBJECT_STALE"
  | "MOVE_OBJECT_STATE_MISMATCH"
  | "MOVE_OBJECT_TRANSITION_FAILED"
  | "MOVE_OBJECT_UNSUPPORTED";

class MoveCommandError extends Error {
  readonly code: MoveCommandErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: MoveCommandErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MoveCommandError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class MoveCommand implements EditorCommand<ObjectCollection> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #objectId: string;
  readonly #expectedObjectModifiedAt: string;
  readonly #initialTranslation: TranslationVector;
  readonly #finalTranslation: TranslationVector;

  constructor(input: MoveCommandInput) {
    const metadata = resolveInput(input);
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#objectId = metadata.objectId;
    this.#expectedObjectModifiedAt = metadata.expectedObjectModifiedAt;
    this.#initialTranslation = metadata.initialTranslation;
    this.#finalTranslation = metadata.finalTranslation;
    Object.freeze(this);
  }

  execute(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "execute",
      this.#initialTranslation,
      this.#finalTranslation,
      this.#expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  undo(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "undo",
      this.#finalTranslation,
      this.#initialTranslation,
      this.timestamp,
      this.#expectedObjectModifiedAt,
    );
  }

  redo(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "redo",
      this.#initialTranslation,
      this.#finalTranslation,
      this.#expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  #transition(
    document: ObjectCollection,
    operation: "execute" | "redo" | "undo",
    expectedTranslation: TranslationVector,
    targetTranslation: TranslationVector,
    expectedModifiedAt: string,
    targetModifiedAt: string,
  ): ObjectCollection {
    if (!(document instanceof ObjectCollection)) {
      throw moveError(
        "MOVE_OBJECT_UNSUPPORTED",
        "MoveCommand requires an ObjectCollection document.",
        { operation },
      );
    }

    const object = document.lookup(this.#objectId);
    if (object === undefined) {
      throw moveError("MOVE_OBJECT_NOT_FOUND", `Object '${this.#objectId}' was not found.`, {
        objectId: this.#objectId,
        operation,
      });
    }
    if (!(object instanceof InkObject)) {
      throw moveError(
        "MOVE_OBJECT_UNSUPPORTED",
        `Object '${this.#objectId}' is not a supported InkObject.`,
        { objectId: this.#objectId, operation, type: object.type },
      );
    }
    if (!object.visible) {
      throw moveError("MOVE_OBJECT_HIDDEN", `Object '${this.#objectId}' is hidden.`, {
        objectId: this.#objectId,
        operation,
      });
    }
    if (object.locked) {
      throw moveError("MOVE_OBJECT_LOCKED", `Object '${this.#objectId}' is locked.`, {
        objectId: this.#objectId,
        operation,
      });
    }
    if (object.modifiedAt !== expectedModifiedAt) {
      throw moveError(
        "MOVE_OBJECT_STALE",
        `Object '${this.#objectId}' changed after this move command was created.`,
        {
          objectId: this.#objectId,
          operation,
          expectedModifiedAt,
          actualModifiedAt: object.modifiedAt,
        },
      );
    }
    if (!sameTranslation(object.transform.translation, expectedTranslation)) {
      throw moveError(
        "MOVE_OBJECT_STATE_MISMATCH",
        `Object '${this.#objectId}' is not at the translation required for ${operation}.`,
        {
          objectId: this.#objectId,
          operation,
          expectedTranslation,
          actualTranslation: object.transform.translation,
        },
      );
    }

    try {
      const replacement = new ObjectFactory().createInkObject({
        id: object.id,
        stroke: object.stroke,
        createdAt: object.createdAt,
        modifiedAt: targetModifiedAt,
        visible: object.visible,
        locked: object.locked,
        metadata: object.metadata,
        zIndex: object.zIndex,
        transform: new Transform({
          translation: targetTranslation,
          rotation: object.transform.rotation,
          scale: object.transform.scale,
        }),
        renderingHints: object.renderingHints,
      });
      return document.replace(replacement);
    } catch (cause) {
      throw moveError(
        "MOVE_OBJECT_TRANSITION_FAILED",
        `Object '${this.#objectId}' could not complete ${operation}.`,
        { objectId: this.#objectId, operation },
        cause,
      );
    }
  }
}

/** Creates the private editor-owned command accepted by generic History. */
export function createMoveCommand(input: MoveCommandInput): EditorCommand<ObjectCollection> {
  return new MoveCommand(input);
}

function resolveInput(
  input: MoveCommandInput,
): Readonly<
  Required<Pick<MoveCommandInput, "description" | "id" | "timestamp">> &
    Pick<
      MoveCommandInput,
      "expectedObjectModifiedAt" | "finalTranslation" | "initialTranslation" | "objectId"
    >
> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw invalidMoveCommand("MoveCommand requires an input object.");
  }

  const objectId = input.objectId;
  const expectedObjectModifiedAt = input.expectedObjectModifiedAt;
  const initialTranslation = freezeTranslation(input.initialTranslation);
  const finalTranslation = freezeTranslation(input.finalTranslation);
  const id = input.id ?? defaultId();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const description = input.description ?? `Move object ${objectId}`;

  if (!isNonBlankString(objectId)) {
    throw invalidMoveCommand("MoveCommand objectId must not be blank.");
  }
  if (!isNonBlankString(id)) {
    throw invalidMoveCommand("MoveCommand id must not be blank.");
  }
  if (!isNonBlankString(description)) {
    throw invalidMoveCommand("MoveCommand description must not be blank.");
  }
  if (!isIsoTimestamp(expectedObjectModifiedAt) || !isIsoTimestamp(timestamp)) {
    throw invalidMoveCommand("MoveCommand timestamps must be canonical ISO timestamps.");
  }
  if (timestamp < expectedObjectModifiedAt) {
    throw invalidMoveCommand("MoveCommand timestamp cannot precede the target object revision.");
  }
  if (sameTranslation(initialTranslation, finalTranslation)) {
    throw invalidMoveCommand("MoveCommand requires distinct initial and final translations.");
  }

  return Object.freeze({
    id,
    timestamp,
    description,
    objectId,
    expectedObjectModifiedAt,
    initialTranslation,
    finalTranslation,
  });
}

function freezeTranslation(value: TranslationVector): TranslationVector {
  if (
    value === null ||
    typeof value !== "object" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y)
  ) {
    throw invalidMoveCommand("MoveCommand translations must contain finite coordinates.");
  }
  return Object.freeze({ x: value.x, y: value.y });
}

function sameTranslation(left: TranslationVector, right: TranslationVector): boolean {
  return left.x === right.x && left.y === right.y;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function defaultId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function invalidMoveCommand(message: string): MoveCommandError {
  return moveError("INVALID_MOVE_COMMAND", message);
}

function moveError(
  code: MoveCommandErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  cause?: unknown,
): MoveCommandError {
  return new MoveCommandError(code, message, details, cause === undefined ? undefined : { cause });
}
