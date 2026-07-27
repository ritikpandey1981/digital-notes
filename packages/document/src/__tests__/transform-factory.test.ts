import { describe, expect, it } from "vitest";
import { InkObject, ObjectFactory, Transform, cloneObject, createInkObject } from "../index";
import { FIRST_TIMESTAMP, SECOND_TIMESTAMP, createStroke } from "./fixtures";

describe("Transform", () => {
  it("creates a deeply immutable identity transform", () => {
    const transform = Transform.identity();
    expect(transform).toMatchObject({
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: 1,
      isIdentity: true,
    });
    expect(Object.isFrozen(transform)).toBe(true);
    expect(Object.isFrozen(transform.translation)).toBe(true);
  });

  it.each([{ rotation: 1 }, { scale: 2 }, { translation: { x: Number.NaN, y: 0 } }])(
    "rejects unsupported or invalid Phase 10 transforms",
    (input) => {
      expect(() => new Transform(input)).toThrowError(
        expect.objectContaining({ code: "OBJECT_VALIDATION_FAILED" }),
      );
    },
  );

  it("supports finite immutable translation while retaining rotation and scale guards", () => {
    const transform = new Transform({ translation: { x: 12, y: -8 } });
    const moved = transform.translatedBy({ x: 3, y: 5 });
    expect(transform.translation).toEqual({ x: 12, y: -8 });
    expect(moved.translation).toEqual({ x: 15, y: -3 });
    expect(moved).not.toBe(transform);
    expect(Object.isFrozen(moved.translation)).toBe(true);
  });
});

describe("ObjectFactory", () => {
  it("creates an immutable InkObject that forwards one Stroke without duplication", () => {
    const stroke = createStroke();
    const object = new ObjectFactory({
      createId: () => "object-1",
      now: () => FIRST_TIMESTAMP,
    }).createInkObject({
      stroke,
      metadata: { source: "pointer", nested: { accepted: true } },
      renderingHints: { brush: "pen" },
    });

    expect(object).toBeInstanceOf(InkObject);
    expect(object).toMatchObject({
      id: "object-1",
      type: "ink",
      createdAt: FIRST_TIMESTAMP,
      modifiedAt: FIRST_TIMESTAMP,
      visible: true,
      locked: false,
      zIndex: 0,
      version: 1,
    });
    expect(object.stroke).toBe(stroke);
    expect(object.bounds).toBe(stroke.inflatedBounds);
    expect(object.metrics).toBe(stroke.metrics);
    expect(object.statistics).toBe(stroke.statistics);
    expect(object.style).toBe(stroke.style);
    expect(Object.isFrozen(object)).toBe(true);
    expect(Object.isFrozen(object.metadata)).toBe(true);
    expect(Object.isFrozen(object.metadata.nested)).toBe(true);
    expect(Object.isFrozen(object.renderingHints)).toBe(true);
  });

  it("supports explicit lifecycle values and standalone creation", () => {
    const object = createInkObject(
      {
        stroke: createStroke(),
        id: "explicit-object",
        createdAt: FIRST_TIMESTAMP,
        modifiedAt: SECOND_TIMESTAMP,
        visible: false,
        locked: true,
        zIndex: 7,
      },
      { createId: () => "unused", now: () => SECOND_TIMESTAMP },
    );
    expect(object).toMatchObject({
      id: "explicit-object",
      createdAt: FIRST_TIMESTAMP,
      modifiedAt: SECOND_TIMESTAMP,
      visible: false,
      locked: true,
      zIndex: 7,
    });
  });

  it("clones object identity and metadata while reusing immutable stroke data", () => {
    const source = createInkObject(
      { stroke: createStroke(), id: "source", createdAt: FIRST_TIMESTAMP },
      { now: () => FIRST_TIMESTAMP },
    );
    const clone = cloneObject(
      source,
      { metadata: { cloned: true }, zIndex: 3 },
      { createId: () => "clone", now: () => SECOND_TIMESTAMP },
    );
    expect(clone).not.toBe(source);
    expect(clone).toMatchObject({
      id: "clone",
      createdAt: SECOND_TIMESTAMP,
      modifiedAt: SECOND_TIMESTAMP,
      zIndex: 3,
    });
    expect(clone.stroke).toBe(source.stroke);
    expect(clone.metadata).toEqual({ cloned: true });
    expect(Object.isFrozen(clone)).toBe(true);
  });

  it("provides validation through the factory facade", () => {
    const factory = new ObjectFactory({ createId: () => "object", now: () => FIRST_TIMESTAMP });
    const object = factory.createInkObject({ stroke: createStroke() });
    expect(factory.validateObject(object)).toEqual({ valid: true, issues: [] });
  });

  it("creates a translated same-identity replacement without copying stroke geometry", () => {
    const stroke = createStroke();
    const factory = new ObjectFactory({ now: () => SECOND_TIMESTAMP });
    const source = createInkObject(
      { id: "movable", stroke, createdAt: FIRST_TIMESTAMP },
      { now: () => FIRST_TIMESTAMP },
    );
    const replacement = factory.translateObject(source, { x: 20, y: -10 });
    expect(replacement).not.toBe(source);
    expect(replacement).toMatchObject({
      id: source.id,
      createdAt: FIRST_TIMESTAMP,
      modifiedAt: SECOND_TIMESTAMP,
      transform: { translation: { x: 20, y: -10 } },
    });
    expect(replacement.stroke).toBe(source.stroke);
    expect(replacement.bounds).toEqual({
      x: source.bounds.x + 20,
      y: source.bounds.y - 10,
      width: source.bounds.width,
      height: source.bounds.height,
    });
    expect(source.transform.translation).toEqual({ x: 0, y: 0 });
  });
});
