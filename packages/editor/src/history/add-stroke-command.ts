import { InkObject, PageDocument } from "@folio/document";
import type { EditorCommand } from "@folio/history";

interface AddStrokeCommandInput {
  readonly object: InkObject;
  readonly insertionIndex: number;
  readonly layerId: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class AddStrokeCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #object: InkObject;
  readonly #insertionIndex: number;
  readonly #layerId: string;

  constructor(input: AddStrokeCommandInput) {
    if (
      input === null ||
      typeof input !== "object" ||
      !(input.object instanceof InkObject) ||
      !Object.isFrozen(input.object) ||
      !Number.isSafeInteger(input.insertionIndex) ||
      input.insertionIndex < 0 ||
      input.object.zIndex !== input.insertionIndex ||
      typeof input.layerId !== "string" ||
      input.layerId.trim().length === 0
    ) {
      throw new TypeError("AddStrokeCommand requires an immutable, correctly ordered InkObject.");
    }
    const id = input.id ?? `stroke-${input.object.id}`;
    const timestamp = input.timestamp ?? input.object.modifiedAt;
    const description = input.description ?? `Draw stroke ${input.object.id}`;
    if (id.trim().length === 0 || description.trim().length === 0 || !isIsoTimestamp(timestamp)) {
      throw new TypeError("AddStrokeCommand requires valid immutable command metadata.");
    }
    this.id = id;
    this.timestamp = timestamp;
    this.description = description;
    this.#object = input.object;
    this.#insertionIndex = input.insertionIndex;
    this.#layerId = input.layerId;
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#insert(document, "execute");
  }

  undo(document: PageDocument): PageDocument {
    const current = requirePage(document);
    const candidate = current.lookup(this.#object.id);
    if (!matchesStoredStroke(candidate, this.#object, this.#insertionIndex)) {
      throw new Error(`Stroke '${this.#object.id}' is not in the state required for undo.`);
    }
    return current.remove(this.#object.id);
  }

  redo(document: PageDocument): PageDocument {
    return this.#insert(document, "redo");
  }

  #insert(document: PageDocument, operation: "execute" | "redo"): PageDocument {
    const current = requirePage(document);
    if (current.has(this.#object.id)) {
      throw new Error(`Stroke '${this.#object.id}' already exists during ${operation}.`);
    }
    if (this.#insertionIndex > current.size) {
      throw new Error(`Stroke '${this.#object.id}' cannot be restored at its original position.`);
    }
    return current.insert(this.#object, this.#insertionIndex, this.#layerId);
  }
}

/** Creates one editor-private command for one completed immutable stroke. */
export function createAddStrokeCommand(input: AddStrokeCommandInput): EditorCommand<PageDocument> {
  return new AddStrokeCommand(input);
}

function requirePage(document: PageDocument): PageDocument {
  if (!(document instanceof PageDocument)) {
    throw new TypeError("AddStrokeCommand requires a PageDocument.");
  }
  return document;
}

function matchesStoredStroke(
  candidate: ReturnType<PageDocument["lookup"]>,
  stored: InkObject,
  insertionIndex: number,
): candidate is InkObject {
  return (
    candidate instanceof InkObject &&
    Object.isFrozen(candidate) &&
    candidate.id === stored.id &&
    candidate.createdAt === stored.createdAt &&
    candidate.modifiedAt === stored.modifiedAt &&
    candidate.visible === stored.visible &&
    candidate.locked === stored.locked &&
    candidate.zIndex === insertionIndex &&
    candidate.stroke === stored.stroke &&
    candidate.transform.translation.x === stored.transform.translation.x &&
    candidate.transform.translation.y === stored.transform.translation.y &&
    candidate.transform.rotation === stored.transform.rotation &&
    candidate.transform.scale === stored.transform.scale &&
    JSON.stringify(candidate.metadata) === JSON.stringify(stored.metadata) &&
    JSON.stringify(candidate.renderingHints) === JSON.stringify(stored.renderingHints)
  );
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
