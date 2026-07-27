import { describe, expect, it } from "vitest";
import { DocumentObjectError, ObjectCollection, ObjectFactory, createInkObject } from "../index";
import { FIRST_TIMESTAMP, createStroke } from "./fixtures";

function factory(): ObjectFactory {
  return new ObjectFactory({ now: () => FIRST_TIMESTAMP });
}

function object(id: string, offset = 0, locked = false) {
  return factory().createInkObject({
    id,
    stroke: createStroke(`stroke-${id}`, offset),
    zIndex: offset,
    locked,
  });
}

describe("ObjectCollection", () => {
  it("adds objects immutably, normalizes order, and provides O(1)-style lookup", () => {
    const empty = ObjectCollection.empty();
    const first = object("first", 9);
    const collection = empty.add(first).add(object("second", 4));

    expect(empty.size).toBe(0);
    expect(collection.size).toBe(2);
    expect(collection.objects.map(({ id, zIndex }) => ({ id, zIndex }))).toEqual([
      { id: "first", zIndex: 0 },
      { id: "second", zIndex: 1 },
    ]);
    expect(collection.lookup("first")?.id).toBe("first");
    expect(collection.lookup("missing")).toBeUndefined();
    expect(collection.has("second")).toBe(true);
    expect([...collection]).toEqual(collection.objects);
    expect(collection.toArray()).toBe(collection.objects);
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.objects)).toBe(true);
  });

  it("removes, replaces, and reorders without mutating prior collections", () => {
    const original = new ObjectCollection([object("a"), object("b"), object("c")]);
    const reordered = original.reorder("c", 0);
    expect(original.objects.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(reordered.objects.map(({ id, zIndex }) => `${id}:${zIndex}`)).toEqual([
      "c:0",
      "a:1",
      "b:2",
    ]);

    const replacement = createInkObject(
      {
        id: "a",
        stroke: createStroke("replacement"),
        locked: true,
        zIndex: 99,
      },
      { now: () => FIRST_TIMESTAMP },
    );
    const replaced = original.replace(replacement);
    expect(replaced.lookup("a")).toMatchObject({ locked: true, zIndex: 0 });
    expect(original.lookup("a")).toMatchObject({ locked: false, zIndex: 0 });

    const removed = replaced.remove("b");
    expect(removed.objects.map(({ id, zIndex }) => `${id}:${zIndex}`)).toEqual(["a:0", "c:1"]);
  });

  it("reports duplicate ids, missing objects, and invalid indexes structurally", () => {
    const first = object("same");
    expect(() => new ObjectCollection([first, first])).toThrowError(
      expect.objectContaining({ code: "OBJECT_VALIDATION_FAILED" }),
    );
    const collection = new ObjectCollection([first]);
    expect(() => collection.add(first)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_OBJECT_ID" }),
    );
    expect(() => collection.remove("missing")).toThrowError(
      expect.objectContaining({ code: "OBJECT_NOT_FOUND" }),
    );
    expect(() => collection.reorder("same", 1)).toThrowError(
      expect.objectContaining({ code: "INVALID_INDEX" }),
    );
    expect(() => collection.replace(object("missing"))).toThrowError(DocumentObjectError);
  });

  it("returns the same collection for no-op replacement and ordering", () => {
    const first = object("first");
    const collection = new ObjectCollection([first]);
    expect(collection.replace(collection.objects[0]!)).toBe(collection);
    expect(collection.reorder("first", 0)).toBe(collection);
  });

  it("computes immutable collection statistics and union bounds", () => {
    const collection = new ObjectCollection([object("a", 0), object("b", 100, true)]);
    expect(collection.statistics).toMatchObject({
      objectCount: 2,
      inkObjectCount: 2,
      visibleObjectCount: 2,
      lockedObjectCount: 1,
      highestZIndex: 1,
    });
    expect(collection.statistics.bounds?.width).toBeGreaterThan(100);
    expect(Object.isFrozen(collection.statistics)).toBe(true);
    expect(Object.isFrozen(collection.statistics.bounds)).toBe(true);
    expect(ObjectCollection.empty().statistics.bounds).toBeNull();
  });

  it("handles large collections with deterministic ordering and lookup", () => {
    const sharedStroke = createStroke("shared");
    const create = factory();
    const objects = Array.from({ length: 5_000 }, (_item, index) =>
      create.createInkObject({ id: `object-${index}`, stroke: sharedStroke, zIndex: index }),
    );
    const startedAt = performance.now();
    const collection = new ObjectCollection(objects);
    const duration = performance.now() - startedAt;
    expect(collection.size).toBe(5_000);
    expect(collection.lookup("object-4999")?.zIndex).toBe(4_999);
    expect(collection.statistics.objectCount).toBe(5_000);
    expect(duration).toBeLessThan(2_000);
  });
});
