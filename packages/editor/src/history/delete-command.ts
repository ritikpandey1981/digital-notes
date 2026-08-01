import { ObjectCollection, type PageObject } from "@folio/document";
import type { EditorCommand } from "@folio/history";
import {
  assertLifecycleCommandInput,
  assertLifecycleIndex,
  assertStoredLifecycleObject,
  lifecycleStateMismatch,
  lifecycleTransitionFailed,
  requireLifecycleDocument,
  requireLifecycleObject,
  resolveLifecycleMetadata,
  type ResolvedLifecycleMetadata,
} from "./object-lifecycle-command";

export interface DeleteCommandInput {
  readonly deletedObject: PageObject;
  readonly originalInsertionIndex: number;
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
}

class DeleteCommand implements EditorCommand<ObjectCollection> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #deletedObject: PageObject;
  readonly #originalInsertionIndex: number;
  readonly #metadata: ResolvedLifecycleMetadata;

  constructor(input: DeleteCommandInput) {
    assertLifecycleCommandInput("delete", input);
    assertStoredLifecycleObject("delete", input.deletedObject);
    assertLifecycleIndex("delete", input.originalInsertionIndex, Number.MAX_SAFE_INTEGER);
    if (input.originalInsertionIndex !== input.deletedObject.zIndex) {
      throw lifecycleStateMismatch(
        "delete",
        "DeleteCommand insertion index must match the deleted object's current order.",
        {
          objectId: input.deletedObject.id,
          originalInsertionIndex: input.originalInsertionIndex,
          objectIndex: input.deletedObject.zIndex,
        },
      );
    }
    this.#metadata = resolveLifecycleMetadata("delete", {
      objectId: input.deletedObject.id,
      expectedObjectModifiedAt: input.deletedObject.modifiedAt,
      ...(input.id === undefined ? {} : { id: input.id }),
      ...(input.timestamp === undefined ? {} : { timestamp: input.timestamp }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    this.id = this.#metadata.id;
    this.timestamp = this.#metadata.timestamp;
    this.description = this.#metadata.description;
    this.#deletedObject = input.deletedObject;
    this.#originalInsertionIndex = input.originalInsertionIndex;
    Object.freeze(this);
  }

  execute(document: ObjectCollection): ObjectCollection {
    return this.#remove(document, "execute");
  }

  undo(document: ObjectCollection): ObjectCollection {
    const current = requireLifecycleDocument("delete", document, "undo");
    if (current.has(this.#deletedObject.id)) {
      throw lifecycleStateMismatch(
        "delete",
        `Object '${this.#deletedObject.id}' already exists and cannot be restored.`,
        { objectId: this.#deletedObject.id, operation: "undo" },
      );
    }
    if (this.#originalInsertionIndex > current.size) {
      throw lifecycleStateMismatch(
        "delete",
        "The deleted object's original insertion index is no longer available.",
        {
          objectId: this.#deletedObject.id,
          operation: "undo",
          index: this.#originalInsertionIndex,
          size: current.size,
        },
      );
    }
    try {
      return current.insert(this.#deletedObject, this.#originalInsertionIndex);
    } catch (cause) {
      throw lifecycleTransitionFailed("delete", "undo", this.#deletedObject.id, cause);
    }
  }

  redo(document: ObjectCollection): ObjectCollection {
    return this.#remove(document, "redo");
  }

  #remove(document: ObjectCollection, operation: "execute" | "redo"): ObjectCollection {
    const current = requireLifecycleDocument("delete", document, operation);
    const object = requireLifecycleObject(
      "delete",
      current,
      this.#metadata.objectId,
      this.#metadata.expectedObjectModifiedAt,
      operation,
    );
    if (object.zIndex !== this.#originalInsertionIndex) {
      throw lifecycleStateMismatch(
        "delete",
        `Object '${object.id}' is not at the required insertion index.`,
        {
          objectId: object.id,
          operation,
          expectedIndex: this.#originalInsertionIndex,
          actualIndex: object.zIndex,
        },
      );
    }
    try {
      return current.remove(object.id);
    } catch (cause) {
      throw lifecycleTransitionFailed("delete", operation, object.id, cause);
    }
  }
}

export function createDeleteCommand(input: DeleteCommandInput): EditorCommand<ObjectCollection> {
  return new DeleteCommand(input);
}
