import type { ObjectCollection, PageObject } from "@folio/document";

/** Editor-owned logical selection set layered over Selection's frozen primary-selection API. */
export class EditorSelectionSet {
  #ids: readonly string[] = Object.freeze([]);

  get ids(): readonly string[] {
    return this.#ids;
  }

  get size(): number {
    return this.#ids.length;
  }

  has(objectId: string): boolean {
    return this.#ids.includes(objectId);
  }

  replace(objectIds: readonly string[]): readonly string[] {
    const next = [...new Set(objectIds.filter((objectId) => objectId.trim().length > 0))];
    if (sameIds(this.#ids, next)) return this.#ids;
    this.#ids = Object.freeze(next);
    return this.#ids;
  }

  selectPrimary(objectId: string | null): readonly string[] {
    return this.replace(objectId === null ? [] : [objectId]);
  }

  /**
   * Adds or removes one object while preserving selection order.
   *
   * Re-adding an existing member moves it to the end so it becomes the primary
   * object, which keeps Shift+Click predictable for transforms.
   */
  toggle(objectId: string): readonly string[] {
    if (objectId.trim().length === 0) return this.#ids;
    return this.has(objectId)
      ? this.replace(this.#ids.filter((id) => id !== objectId))
      : this.replace([...this.#ids, objectId]);
  }

  /** Adds objects that are not already selected, preserving existing order. */
  add(objectIds: readonly string[]): readonly string[] {
    return this.replace([...this.#ids, ...objectIds]);
  }

  selectAllEditable(
    document: ObjectCollection,
    isEditable: (object: PageObject) => boolean = defaultEditable,
  ): readonly string[] {
    return this.replace(document.objects.filter(isEditable).map(({ id }) => id));
  }

  selectedObjects(document: ObjectCollection): readonly PageObject[] {
    const selectedIds = new Set(this.#ids);
    return Object.freeze(document.objects.filter(({ id }) => selectedIds.has(id)));
  }

  reconcile(document: ObjectCollection): readonly string[] {
    return this.replace(this.#ids.filter((objectId) => document.has(objectId)));
  }

  clear(): readonly string[] {
    return this.replace([]);
  }
}

function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
}

function defaultEditable(object: PageObject): boolean {
  return object.visible && !object.locked;
}
