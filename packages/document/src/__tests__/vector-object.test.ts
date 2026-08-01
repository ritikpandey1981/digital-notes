import { describe, expect, it } from "vitest";
import {
  EllipseObject,
  LineObject,
  ObjectCollection,
  ObjectFactory,
  RectangleObject,
  Transform,
  deserializeVectorObject,
  isVectorObject,
  serializeVectorObject,
  validateObject,
} from "../index";

const timestamp = "2026-07-30T12:00:00.000Z";

function factory() {
  let id = 0;
  return new ObjectFactory({
    createId: () => `vector-${++id}`,
    now: () => timestamp,
  });
}

describe("vector PageObjects", () => {
  it("creates immutable Line, Rectangle, and Ellipse objects with stable local bounds", () => {
    const create = factory();
    const line = create.createLineObject({
      geometry: { start: { x: 10, y: 20 }, end: { x: 110, y: 70 } },
      style: { strokeColor: { hex: "#2563eb", opacity: 0.6 }, strokeWidth: 4 },
    });
    const rectangle = create.createRectangleObject({
      geometry: { x: 20, y: 30, width: 120, height: 80 },
    });
    const ellipse = create.createEllipseObject({
      geometry: { center: { x: 80, y: 90 }, radiusX: 40, radiusY: 25 },
    });

    expect(line).toBeInstanceOf(LineObject);
    expect(rectangle).toBeInstanceOf(RectangleObject);
    expect(ellipse).toBeInstanceOf(EllipseObject);
    expect(line.localBounds).toEqual({ x: 8, y: 18, width: 104, height: 54 });
    expect(rectangle.localBounds).toEqual({ x: 19, y: 29, width: 122, height: 82 });
    expect(ellipse.localBounds).toEqual({ x: 39, y: 64, width: 82, height: 52 });
    for (const object of [line, rectangle, ellipse]) {
      expect(isVectorObject(object)).toBe(true);
      expect(validateObject(object)).toEqual({ valid: true, issues: [] });
      expect(Object.isFrozen(object)).toBe(true);
      expect(Object.isFrozen(object.geometry)).toBe(true);
      expect(Object.isFrozen(object.style)).toBe(true);
    }
  });

  it("supports collection ordering, cloning, translation, rotation, and scale immutably", () => {
    const create = factory();
    const source = create.createRectangleObject({
      geometry: { x: 10, y: 20, width: 100, height: 50 },
    });
    const collection = new ObjectCollection([source]);
    const clone = create.cloneObject(source, { zIndex: 1 });
    const withClone = collection.add(clone);
    const moved = create.translateObject(source, { x: 15, y: -5 });
    const rotated = create.rotateObject(moved, Math.PI / 4);
    const scaled = create.scaleObject(rotated, 2);

    expect(withClone.objects).toEqual([source, clone]);
    expect(clone.id).not.toBe(source.id);
    expect(clone.geometry).toEqual(source.geometry);
    expect(moved.transform.translation).toEqual({ x: 15, y: -5 });
    expect(rotated.transform.rotation).toBe(Math.PI / 4);
    expect(scaled.transform.scale).toBe(2);
    expect(source.transform).toEqual(Transform.identity());
    expect(source.modifiedAt).toBe(timestamp);
  });

  it("round-trips every vector type through deterministic JSON-safe envelopes", () => {
    const create = factory();
    const objects = [
      create.createLineObject({
        geometry: { start: { x: 1, y: 2 }, end: { x: 30, y: 42 } },
      }),
      create.createRectangleObject({
        geometry: { x: 5, y: 8, width: 90, height: 40 },
      }),
      create.createEllipseObject({
        geometry: { center: { x: 50, y: 60 }, radiusX: 22, radiusY: 18 },
      }),
    ] as const;

    for (const object of objects) {
      const serialized = serializeVectorObject(object);
      const json = JSON.stringify(serialized);
      const restored = deserializeVectorObject(JSON.parse(json));
      expect(JSON.stringify(serializeVectorObject(restored))).toBe(json);
      expect(restored).toMatchObject({
        id: object.id,
        type: object.type,
        geometry: object.geometry,
        style: object.style,
        transform: object.transform,
      });
      expect(Object.isFrozen(restored)).toBe(true);
    }
  });

  it("rejects degenerate geometry before it can enter a document", () => {
    expect(() =>
      factory().createLineObject({
        geometry: { start: { x: 10, y: 10 }, end: { x: 10, y: 10 } },
      }),
    ).toThrow();
    expect(() =>
      factory().createRectangleObject({ geometry: { x: 0, y: 0, width: 0, height: 10 } }),
    ).toThrow();
    expect(() =>
      factory().createEllipseObject({
        geometry: { center: { x: 0, y: 0 }, radiusX: 5, radiusY: 0 },
      }),
    ).toThrow();
  });
});
