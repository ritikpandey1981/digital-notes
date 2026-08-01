import {
  ObjectCollection,
  ObjectFactory,
  createEditableStyle,
  isVectorObject,
  type EditableStyle,
  type EditableStyleInput,
  type VectorPageObject,
} from "@folio/document";
import type { EditorCommand } from "@folio/history";

export interface UpdateVectorStyleCommandInput {
  readonly objectId: string;
  readonly expectedObjectModifiedAt: string;
  readonly initialStyle: EditableStyle;
  readonly finalStyle: EditableStyleInput;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class UpdateVectorStyleCommand implements EditorCommand<ObjectCollection> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #objectId: string;
  readonly #expectedObjectModifiedAt: string;
  readonly #initialStyle: EditableStyle;
  readonly #finalStyle: EditableStyle;

  constructor(input: UpdateVectorStyleCommandInput) {
    const timestamp = input.timestamp ?? new Date().toISOString();
    const id = input.id ?? defaultId();
    const description = input.description ?? `Update ${input.objectId} appearance`;
    if (
      input.objectId.trim().length === 0 ||
      id.trim().length === 0 ||
      description.trim().length === 0 ||
      !isIsoTimestamp(input.expectedObjectModifiedAt) ||
      !isIsoTimestamp(timestamp) ||
      timestamp < input.expectedObjectModifiedAt
    ) {
      throw new TypeError("Vector style commands require valid immutable metadata.");
    }
    const initialStyle = createEditableStyle(input.initialStyle);
    const finalStyle = createEditableStyle(input.finalStyle);
    if (sameStyle(initialStyle, finalStyle)) {
      throw new TypeError("Vector style commands require a visible style change.");
    }
    this.id = id;
    this.timestamp = timestamp;
    this.description = description;
    this.#objectId = input.objectId;
    this.#expectedObjectModifiedAt = input.expectedObjectModifiedAt;
    this.#initialStyle = initialStyle;
    this.#finalStyle = finalStyle;
    Object.freeze(this);
  }

  execute(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "execute",
      this.#initialStyle,
      this.#finalStyle,
      this.#expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  undo(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "undo",
      this.#finalStyle,
      this.#initialStyle,
      this.timestamp,
      this.#expectedObjectModifiedAt,
    );
  }

  redo(document: ObjectCollection): ObjectCollection {
    return this.#transition(
      document,
      "redo",
      this.#initialStyle,
      this.#finalStyle,
      this.#expectedObjectModifiedAt,
      this.timestamp,
    );
  }

  #transition(
    document: ObjectCollection,
    operation: "execute" | "undo" | "redo",
    expectedStyle: EditableStyle,
    targetStyle: EditableStyle,
    expectedModifiedAt: string,
    targetModifiedAt: string,
  ): ObjectCollection {
    if (!(document instanceof ObjectCollection)) {
      throw new TypeError("Vector style commands require an ObjectCollection document.");
    }
    const object = document.lookup(this.#objectId);
    if (!isVectorObject(object)) {
      throw new Error(`Vector object '${this.#objectId}' was not found during ${operation}.`);
    }
    if (!object.visible || object.locked) {
      throw new Error(`Vector object '${this.#objectId}' cannot be styled during ${operation}.`);
    }
    if (object.modifiedAt !== expectedModifiedAt || !sameStyle(object.style, expectedStyle)) {
      throw new Error(`Vector object '${this.#objectId}' is stale during ${operation}.`);
    }
    return document.replace(createReplacement(object, targetStyle, targetModifiedAt));
  }
}

export function createUpdateVectorStyleCommand(
  input: UpdateVectorStyleCommandInput,
): EditorCommand<ObjectCollection> {
  return new UpdateVectorStyleCommand(input);
}

function createReplacement(
  object: VectorPageObject,
  style: EditableStyle,
  modifiedAt: string,
): VectorPageObject {
  const factory = new ObjectFactory();
  const lifecycle = {
    id: object.id,
    createdAt: object.createdAt,
    modifiedAt,
    visible: object.visible,
    locked: object.locked,
    metadata: object.metadata,
    zIndex: object.zIndex,
    transform: object.transform,
    style,
  } as const;
  switch (object.type) {
    case "line":
      return factory.createLineObject({ ...lifecycle, geometry: object.geometry });
    case "rectangle":
      return factory.createRectangleObject({ ...lifecycle, geometry: object.geometry });
    case "ellipse":
      return factory.createEllipseObject({ ...lifecycle, geometry: object.geometry });
  }
}

function sameStyle(first: EditableStyle, second: EditableStyle): boolean {
  return (
    first.strokeColor.hex === second.strokeColor.hex &&
    first.strokeColor.opacity === second.strokeColor.opacity &&
    first.strokeWidth === second.strokeWidth &&
    first.fillColor?.hex === second.fillColor?.hex &&
    first.fillColor?.opacity === second.fillColor?.opacity
  );
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function defaultId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}
