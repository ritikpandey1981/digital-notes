import { InkObject, PageDocument, isVectorObject, type PageObject } from "@folio/document";
import type { EditorCommand } from "@folio/history";

interface InsertObjectCommandInput {
  readonly object: PageObject;
  readonly insertionIndex: number;
  readonly layerId: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class InsertObjectCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #object: PageObject;
  readonly #insertionIndex: number;
  readonly #layerId: string;

  constructor(input: InsertObjectCommandInput) {
    if (
      input === null ||
      typeof input !== "object" ||
      !Object.isFrozen(input.object) ||
      !Number.isSafeInteger(input.insertionIndex) ||
      input.insertionIndex < 0 ||
      input.object.zIndex !== input.insertionIndex ||
      typeof input.layerId !== "string" ||
      input.layerId.trim().length === 0
    ) {
      throw new TypeError("InsertObjectCommand requires an immutable, correctly ordered object.");
    }
    const id = input.id ?? `paste-${input.object.id}`;
    const timestamp = input.timestamp ?? input.object.modifiedAt;
    const description = input.description ?? `Paste object ${input.object.id}`;
    if (id.trim().length === 0 || description.trim().length === 0 || !isIsoTimestamp(timestamp)) {
      throw new TypeError("InsertObjectCommand requires valid immutable command metadata.");
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
    if (!matchesStoredObject(candidate, this.#object, this.#insertionIndex)) {
      throw new Error(`Pasted object '${this.#object.id}' is not in the state required for undo.`);
    }
    return current.remove(this.#object.id);
  }

  redo(document: PageDocument): PageDocument {
    return this.#insert(document, "redo");
  }

  #insert(document: PageDocument, operation: "execute" | "redo"): PageDocument {
    const current = requirePage(document);
    if (current.has(this.#object.id)) {
      throw new Error(`Pasted object '${this.#object.id}' already exists during ${operation}.`);
    }
    if (this.#insertionIndex > current.size) {
      throw new Error(`Pasted object '${this.#object.id}' cannot use its stored insertion index.`);
    }
    return current.insert(this.#object, this.#insertionIndex, this.#layerId);
  }
}

export function createInsertObjectCommand(
  input: InsertObjectCommandInput,
): EditorCommand<PageDocument> {
  return new InsertObjectCommand(input);
}

function requirePage(document: PageDocument): PageDocument {
  if (!(document instanceof PageDocument)) {
    throw new TypeError("InsertObjectCommand requires a PageDocument.");
  }
  return document;
}

function matchesStoredObject(
  candidate: ReturnType<PageDocument["lookup"]>,
  stored: PageObject,
  insertionIndex: number,
): boolean {
  if (
    candidate === undefined ||
    !Object.isFrozen(candidate) ||
    candidate.id !== stored.id ||
    candidate.type !== stored.type ||
    candidate.createdAt !== stored.createdAt ||
    candidate.modifiedAt !== stored.modifiedAt ||
    candidate.visible !== stored.visible ||
    candidate.locked !== stored.locked ||
    candidate.zIndex !== insertionIndex ||
    JSON.stringify(candidate.metadata) !== JSON.stringify(stored.metadata) ||
    candidate.transform.translation.x !== stored.transform.translation.x ||
    candidate.transform.translation.y !== stored.transform.translation.y ||
    candidate.transform.rotation !== stored.transform.rotation ||
    candidate.transform.scale !== stored.transform.scale
  ) {
    return false;
  }
  return candidate instanceof InkObject && stored instanceof InkObject
    ? candidate.stroke === stored.stroke &&
        JSON.stringify(candidate.renderingHints) === JSON.stringify(stored.renderingHints)
    : isVectorObject(candidate) && isVectorObject(stored)
      ? candidate.type === stored.type &&
        JSON.stringify(candidate.geometry) === JSON.stringify(stored.geometry) &&
        JSON.stringify(candidate.style) === JSON.stringify(stored.style)
      : false;
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
