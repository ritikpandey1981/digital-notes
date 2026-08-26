import {
  Transform,
  type ObjectBounds,
  type ObjectCollection,
  type PageObject,
} from "@folio/document";

export interface EditorSelectionGeometrySnapshot {
  readonly objectIds: readonly string[];
  readonly objects: readonly PageObject[];
  readonly primaryObject: PageObject;
  readonly bounds: ObjectBounds;
  readonly manipulationTarget: PageObject;
}

/** Caches editor-owned combined geometry until selection or document identity changes. */
export class EditorSelectionGeometry {
  #document: ObjectCollection | null = null;
  #objectIds: readonly string[] | null = null;
  #snapshot: EditorSelectionGeometrySnapshot | null = null;

  resolve(
    document: ObjectCollection,
    objectIds: readonly string[],
    isEditable: (object: PageObject) => boolean = defaultEditable,
  ): EditorSelectionGeometrySnapshot | null {
    if (this.#document === document && this.#objectIds === objectIds) return this.#snapshot;
    const selectedIds = new Set(objectIds);
    const objects = Object.freeze(
      document.objects.filter((object) => selectedIds.has(object.id) && isEditable(object)),
    );
    const primaryObject = objects.at(-1);
    this.#document = document;
    this.#objectIds = objectIds;
    if (primaryObject === undefined) {
      this.#snapshot = null;
      return null;
    }
    const bounds = unionBounds(objects);
    const selectedObjectIds = Object.freeze(objects.map(({ id }) => id));
    this.#snapshot = Object.freeze({
      objectIds: selectedObjectIds,
      objects,
      primaryObject,
      bounds,
      manipulationTarget:
        objects.length === 1 ? primaryObject : createGroupTarget(primaryObject, bounds),
    });
    return this.#snapshot;
  }

  clear(): void {
    this.#document = null;
    this.#objectIds = null;
    this.#snapshot = null;
  }
}

function unionBounds(objects: readonly PageObject[]): ObjectBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const object of objects) {
    minX = Math.min(minX, object.bounds.x);
    minY = Math.min(minY, object.bounds.y);
    maxX = Math.max(maxX, object.bounds.x + object.bounds.width);
    maxY = Math.max(maxY, object.bounds.y + object.bounds.height);
  }
  return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

function createGroupTarget(primary: PageObject, bounds: ObjectBounds): PageObject {
  return Object.freeze({
    id: primary.id,
    type: primary.type,
    version: primary.version,
    createdAt: primary.createdAt,
    modifiedAt: primary.modifiedAt,
    bounds,
    visible: true,
    locked: false,
    metadata: primary.metadata,
    zIndex: primary.zIndex,
    transform: Transform.identity(),
  });
}

function defaultEditable(object: PageObject): boolean {
  return object.visible && !object.locked;
}
