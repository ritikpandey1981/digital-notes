import {
  ObjectCollection,
  ObjectFactory,
  type ObjectFactoryOptions,
  type PageObject,
} from "@folio/document";

const PASTE_OFFSET_STEP = 20;

export interface EditorClipboardSnapshot {
  readonly objectCount: number;
  readonly pasteCount: number;
  readonly canPaste: boolean;
}

export interface EditorPasteBatch {
  readonly objects: readonly PageObject[];
  readonly offset: Readonly<{ x: number; y: number }>;
  readonly ordinal: number;
}

/** Session-scoped immutable-object clipboard owned exclusively by the editor. */
export class EditorClipboard {
  readonly #factory: ObjectFactory;
  #objects: readonly PageObject[] = Object.freeze([]);
  #pasteCount = 0;

  constructor(factoryOptions: ObjectFactoryOptions = {}) {
    this.#factory = new ObjectFactory(factoryOptions);
  }

  copy(objects: readonly PageObject[]): boolean {
    if (!Array.isArray(objects) || objects.length === 0) return false;
    const ids = new Set<string>();
    for (const object of objects) {
      if (
        object === null ||
        typeof object !== "object" ||
        !Object.isFrozen(object) ||
        ids.has(object.id)
      ) {
        throw new TypeError("Clipboard contents must be unique immutable document objects.");
      }
      ids.add(object.id);
    }
    this.#objects = Object.freeze([...objects]);
    this.#pasteCount = 0;
    return true;
  }

  /**
   * Prepares one paste batch.
   *
   * `insertionIndex` is the canonical flattened position at which the batch
   * enters the document, which the editor resolves from the active Layer.
   */
  preparePaste(document: ObjectCollection, insertionIndex?: number): EditorPasteBatch | null {
    if (!(document instanceof ObjectCollection)) {
      throw new TypeError("Clipboard paste requires an ObjectCollection document.");
    }
    if (this.#objects.length === 0) return null;
    const baseIndex = insertionIndex ?? document.size;
    if (!Number.isSafeInteger(baseIndex) || baseIndex < 0 || baseIndex > document.size) {
      throw new RangeError("Clipboard paste insertion index is outside the document.");
    }
    const ordinal = this.#pasteCount + 1;
    const distance = PASTE_OFFSET_STEP * ordinal;
    const offset = Object.freeze({ x: distance, y: distance });
    const identities = new Set(document.objects.map(({ id }) => id));
    const objects = this.#objects.map((source, index) => {
      const clone = this.#factory.cloneObject(source, {
        zIndex: baseIndex + index,
        transform: source.transform.translatedBy(offset),
      });
      if (identities.has(clone.id)) {
        throw new Error("Pasted objects must receive fresh unique document identities.");
      }
      identities.add(clone.id);
      return clone;
    });
    return Object.freeze({ objects: Object.freeze(objects), offset, ordinal });
  }

  confirmPaste(batch: EditorPasteBatch): void {
    if (batch.ordinal !== this.#pasteCount + 1 || batch.objects.length !== this.#objects.length) {
      throw new Error("Clipboard paste confirmation does not match the prepared operation.");
    }
    this.#pasteCount = batch.ordinal;
  }

  snapshot(): EditorClipboardSnapshot {
    return Object.freeze({
      objectCount: this.#objects.length,
      pasteCount: this.#pasteCount,
      canPaste: this.#objects.length > 0,
    });
  }

  clear(): void {
    this.#objects = Object.freeze([]);
    this.#pasteCount = 0;
  }
}
