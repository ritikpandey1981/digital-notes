import {
  InkObject,
  PageDocument,
  ObjectFactory,
  isVectorObject,
  type PageObject,
} from "@folio/document";
import type { EditorCommand } from "@folio/history";
import {
  assertLifecycleCommandInput,
  requireLayerId,
  assertLifecycleIndex,
  assertStoredLifecycleObject,
  lifecycleStateMismatch,
  lifecycleTransitionFailed,
  requireLifecycleDocument,
  requireLifecycleObject,
  resolveLifecycleMetadata,
  type ResolvedLifecycleMetadata,
} from "./object-lifecycle-command";

export interface DuplicateCommandInput {
  readonly sourceObject: PageObject;
  readonly insertionIndex: number;
  readonly layerId: string;
  readonly duplicateObjectId?: string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class DuplicateCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly duplicateObjectId: string;
  readonly #duplicateObject: PageObject;
  readonly #insertionIndex: number;
  readonly #layerId: string;
  readonly #metadata: ResolvedLifecycleMetadata;

  constructor(input: DuplicateCommandInput) {
    assertLifecycleCommandInput("duplicate", input);
    assertStoredLifecycleObject("duplicate", input.sourceObject);
    assertLifecycleIndex("duplicate", input.insertionIndex, Number.MAX_SAFE_INTEGER);
    const metadata = resolveLifecycleMetadata("duplicate", {
      objectId: input.sourceObject.id,
      expectedObjectModifiedAt: input.sourceObject.modifiedAt,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    const duplicate = new ObjectFactory({ now: () => metadata.timestamp }).cloneObject(
      input.sourceObject,
      {
        ...(input.duplicateObjectId === undefined ? {} : { id: input.duplicateObjectId }),
        zIndex: input.insertionIndex,
      },
    );
    assertStoredLifecycleObject("duplicate", duplicate);
    if (duplicate.id === input.sourceObject.id) {
      throw lifecycleStateMismatch(
        "duplicate",
        "DuplicateCommand requires a unique duplicate object identity.",
        { objectId: input.sourceObject.id, duplicateObjectId: duplicate.id },
      );
    }
    this.#metadata = metadata;
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#duplicateObject = duplicate;
    this.duplicateObjectId = duplicate.id;
    this.#insertionIndex = input.insertionIndex;
    this.#layerId = requireLayerId(input.layerId);
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#insert(document, "execute");
  }

  undo(document: PageDocument): PageDocument {
    const current = requireLifecycleDocument("duplicate", document, "undo");
    const duplicate = current.lookup(this.#duplicateObject.id);
    if (!matchesStoredDuplicate(duplicate, this.#duplicateObject, this.#insertionIndex)) {
      throw lifecycleStateMismatch(
        "duplicate",
        `Duplicate '${this.#duplicateObject.id}' is not in the state required for undo.`,
        {
          objectId: this.#duplicateObject.id,
          operation: "undo",
          expectedIndex: this.#insertionIndex,
        },
      );
    }
    try {
      return current.remove(this.#duplicateObject.id);
    } catch (cause) {
      throw lifecycleTransitionFailed("duplicate", "undo", this.#duplicateObject.id, cause);
    }
  }

  redo(document: PageDocument): PageDocument {
    return this.#insert(document, "redo");
  }

  #insert(document: PageDocument, operation: "execute" | "redo"): PageDocument {
    const current = requireLifecycleDocument("duplicate", document, operation);
    requireLifecycleObject(
      "duplicate",
      current,
      this.#metadata.objectId,
      this.#metadata.expectedObjectModifiedAt,
      operation,
    );
    if (current.has(this.#duplicateObject.id)) {
      throw lifecycleStateMismatch(
        "duplicate",
        `Duplicate '${this.#duplicateObject.id}' already exists.`,
        { objectId: this.#duplicateObject.id, operation },
      );
    }
    if (this.#insertionIndex > current.size) {
      throw lifecycleStateMismatch(
        "duplicate",
        "The duplicate insertion index is no longer available.",
        {
          objectId: this.#duplicateObject.id,
          operation,
          index: this.#insertionIndex,
          size: current.size,
        },
      );
    }
    try {
      return current.insert(this.#duplicateObject, this.#insertionIndex, this.#layerId);
    } catch (cause) {
      throw lifecycleTransitionFailed("duplicate", operation, this.#duplicateObject.id, cause);
    }
  }
}

export interface DuplicateEditorCommand extends EditorCommand<PageDocument> {
  readonly duplicateObjectId: string;
}

export function createDuplicateCommand(input: DuplicateCommandInput): DuplicateEditorCommand {
  return new DuplicateCommand(input);
}

function matchesStoredDuplicate(
  candidate: ReturnType<PageDocument["lookup"]>,
  stored: PageObject,
  insertionIndex: number,
): candidate is PageObject {
  return (
    candidate !== undefined &&
    Object.isFrozen(candidate) &&
    candidate.id === stored.id &&
    candidate.createdAt === stored.createdAt &&
    candidate.modifiedAt === stored.modifiedAt &&
    candidate.visible === stored.visible &&
    candidate.locked === stored.locked &&
    sameJsonObject(candidate.metadata, stored.metadata) &&
    candidate.zIndex === insertionIndex &&
    candidate.transform.translation.x === stored.transform.translation.x &&
    candidate.transform.translation.y === stored.transform.translation.y &&
    candidate.transform.rotation === stored.transform.rotation &&
    candidate.transform.scale === stored.transform.scale &&
    (candidate instanceof InkObject && stored instanceof InkObject
      ? candidate.stroke === stored.stroke &&
        sameJsonObject(candidate.renderingHints, stored.renderingHints)
      : isVectorObject(candidate) &&
        isVectorObject(stored) &&
        candidate.type === stored.type &&
        JSON.stringify(candidate.geometry) === JSON.stringify(stored.geometry) &&
        JSON.stringify(candidate.style) === JSON.stringify(stored.style))
  );
}

function sameJsonObject(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
