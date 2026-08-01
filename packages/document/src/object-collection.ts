import { DocumentObjectError, ObjectValidationError } from "./errors";
import { copyObjectWithZIndex } from "./internal/copy-object";
import type { ObjectBounds, ObjectCollectionStatistics, PageObject } from "./types";
import { assertValidObject, validateObjectCollection } from "./validation";

function unionBounds(objects: readonly PageObject[]): ObjectBounds | null {
  if (objects.length === 0) return null;
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

function createStatistics(objects: readonly PageObject[]): ObjectCollectionStatistics {
  return Object.freeze({
    objectCount: objects.length,
    inkObjectCount: objects.reduce((count, object) => count + (object.type === "ink" ? 1 : 0), 0),
    vectorObjectCount: objects.reduce(
      (count, object) => count + (object.type === "ink" ? 0 : 1),
      0,
    ),
    visibleObjectCount: objects.reduce((count, object) => count + (object.visible ? 1 : 0), 0),
    lockedObjectCount: objects.reduce((count, object) => count + (object.locked ? 1 : 0), 0),
    highestZIndex: objects.length === 0 ? null : objects.length - 1,
    bounds: unionBounds(objects),
  });
}

export class ObjectCollection implements Iterable<PageObject> {
  private readonly objectsValue: readonly PageObject[];
  private readonly lookupValue: ReadonlyMap<string, PageObject>;
  readonly statistics: ObjectCollectionStatistics;

  constructor(objects: readonly PageObject[] = []) {
    const validation = validateObjectCollection(objects);
    if (!validation.valid) throw new ObjectValidationError(validation.issues);
    this.objectsValue = Object.freeze(
      objects.map((object, index) => copyObjectWithZIndex(object, index)),
    );
    this.lookupValue = new Map(this.objectsValue.map((object) => [object.id, object]));
    this.statistics = createStatistics(this.objectsValue);
    Object.freeze(this);
  }

  static empty(): ObjectCollection {
    return new ObjectCollection();
  }

  get size(): number {
    return this.objectsValue.length;
  }

  get objects(): readonly PageObject[] {
    return this.objectsValue;
  }

  lookup(id: string): PageObject | undefined {
    return this.lookupValue.get(id);
  }

  has(id: string): boolean {
    return this.lookupValue.has(id);
  }

  add(object: PageObject): ObjectCollection {
    return this.insert(object, this.size);
  }

  insert(object: PageObject, index: number): ObjectCollection {
    assertValidObject(object);
    if (this.has(object.id)) {
      throw new DocumentObjectError(
        "DUPLICATE_OBJECT_ID",
        `An object with id ${object.id} already exists.`,
        { id: object.id },
      );
    }
    if (!Number.isSafeInteger(index) || index < 0 || index > this.size) {
      throw new DocumentObjectError(
        "INVALID_INDEX",
        "Object insertion index is outside the collection.",
        { index, size: this.size },
      );
    }
    return new ObjectCollection([
      ...this.objectsValue.slice(0, index),
      copyObjectWithZIndex(object, index),
      ...this.objectsValue.slice(index),
    ]);
  }

  remove(id: string): ObjectCollection {
    const index = this.indexOf(id);
    return new ObjectCollection(
      this.objectsValue.filter((_object, itemIndex) => itemIndex !== index),
    );
  }

  replace(object: PageObject): ObjectCollection {
    assertValidObject(object);
    const index = this.indexOf(object.id);
    const current = this.objectsValue[index];
    if (current === object) return this;
    return new ObjectCollection(
      this.objectsValue.map((item, itemIndex) =>
        itemIndex === index ? copyObjectWithZIndex(object, index) : item,
      ),
    );
  }

  reorder(id: string, targetIndex: number): ObjectCollection {
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex >= this.size) {
      throw new DocumentObjectError(
        "INVALID_INDEX",
        "Object target index is outside the collection.",
        { targetIndex, size: this.size },
      );
    }
    const sourceIndex = this.indexOf(id);
    if (sourceIndex === targetIndex) return this;
    const reordered = [...this.objectsValue];
    const [object] = reordered.splice(sourceIndex, 1);
    if (object === undefined) {
      throw new DocumentObjectError("INVALID_COLLECTION", "Object reordering failed.", { id });
    }
    reordered.splice(targetIndex, 0, object);
    return new ObjectCollection(reordered);
  }

  toArray(): readonly PageObject[] {
    return this.objectsValue;
  }

  [Symbol.iterator](): Iterator<PageObject> {
    return this.objectsValue[Symbol.iterator]();
  }

  private indexOf(id: string): number {
    const object = this.lookup(id);
    if (object === undefined) {
      throw new DocumentObjectError("OBJECT_NOT_FOUND", `Object ${id} was not found.`, { id });
    }
    return object.zIndex;
  }
}
