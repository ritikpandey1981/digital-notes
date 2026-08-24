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

  it.each([
    { rotation: Number.POSITIVE_INFINITY },
    { scale: 0 },
    { scale: -1 },
    { translation: { x: Number.NaN, y: 0 } },
  ])("rejects invalid transform values", (input) => {
    expect(() => new Transform(input)).toThrowError(
      expect.objectContaining({ code: "OBJECT_VALIDATION_FAILED" }),
    );
  });

  it("composes finite translation, rotation, and positive uniform scale immutably", () => {
    const transform = new Transform({
      translation: { x: 12, y: -8 },
      rotation: Math.PI / 4,
      scale: 2,
    });
    const moved = transform.translatedBy({ x: 3, y: 5 });
    const rotated = moved.withRotation(Math.PI / 2);
    const scaled = rotated.withScale(3);
    expect(transform.translation).toEqual({ x: 12, y: -8 });
    expect(moved).toMatchObject({
      translation: { x: 15, y: -3 },
      rotation: Math.PI / 4,
      scale: 2,
    });
    expect(rotated.rotation).toBe(Math.PI / 2);
    expect(scaled.scale).toBe(3);
    expect(moved).not.toBe(transform);
    expect(Object.isFrozen(moved.translation)).toBe(true);
  });

  it("applies and inverts center-pivot geometry and returns transformed bounds", () => {
    const transform = new Transform({
      translation: { x: 10, y: 20 },
      rotation: Math.PI / 2,
      scale: 2,
    });
    const pivot = { x: 5, y: 5 };
    const transformed = transform.applyToPoint({ x: 10, y: 5 }, pivot);
    expect(transformed.x).toBeCloseTo(15);
    expect(transformed.y).toBeCloseTo(35);
    expect(transform.invertPoint(transformed, pivot)).toEqual({ x: 10, y: 5 });
    expect(transform.transformBounds({ x: 0, y: 0, width: 10, height: 20 })).toMatchObject({
      x: -5,
      y: 20,
      width: 40,
      height: 20,
    });
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
    expect(object.bounds).toEqual({ x: 7, y: 17, width: 26, height: 26 });
    expect(object.bounds.width).toBeLessThan(stroke.inflatedBounds.width);
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

  it("creates rotated and scaled same-identity replacements around stable local bounds", () => {
    const stroke = createStroke();
    const source = createInkObject(
      { id: "transformable", stroke, createdAt: FIRST_TIMESTAMP },
      { now: () => FIRST_TIMESTAMP },
    );
    const rotated = new ObjectFactory({ now: () => SECOND_TIMESTAMP }).rotateObject(
      source,
      Math.PI / 2,
    );
    const scaled = new ObjectFactory({ now: () => SECOND_TIMESTAMP }).scaleObject(source, 2);

    expect(rotated).toMatchObject({
      id: source.id,
      modifiedAt: SECOND_TIMESTAMP,
      transform: { rotation: Math.PI / 2, scale: 1 },
    });
    expect(rotated.stroke).toBe(source.stroke);
    expect(rotated.bounds.width).toBeCloseTo(source.bounds.height);
    expect(rotated.bounds.height).toBeCloseTo(source.bounds.width);
    expect(scaled.transform.scale).toBe(2);
    expect(scaled.bounds.width).toBeCloseTo(stroke.bounds.width * 2 + 6);
    expect(scaled.bounds.height).toBeCloseTo(stroke.bounds.height * 2 + 6);
    expect(scaled.bounds.width).toBeLessThan(source.bounds.width * 2);
    expect(source.transform).toEqual(Transform.identity());
  });
});
