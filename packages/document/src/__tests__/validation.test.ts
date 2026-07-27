import { describe, expect, it } from "vitest";
import {
  ObjectValidationError,
  assertValidObject,
  assertValidObjectCollection,
  createInkObject,
  isObjectBounds,
  isObjectMetadata,
  isPageObject,
  validateObject,
  validateObjectCollection,
} from "../index";
import { FIRST_TIMESTAMP, createStroke } from "./fixtures";

function validObject() {
  return createInkObject(
    { stroke: createStroke(), id: "object", createdAt: FIRST_TIMESTAMP },
    { now: () => FIRST_TIMESTAMP },
  );
}

describe("document object validation", () => {
  it("accepts valid InkObjects through validation, assertion, and type guards", () => {
    const object: unknown = validObject();
    expect(validateObject(object)).toEqual({ valid: true, issues: [] });
    expect(isPageObject(object)).toBe(true);
    expect(() => assertValidObject(object)).not.toThrow();
    expect(isObjectBounds(validObject().bounds)).toBe(true);
    expect(isObjectMetadata({ nested: [1, true, null] })).toBe(true);
  });

  it.each([
    ["unknown type", { type: "shape" }, "unknown_type"],
    ["invalid bounds", { bounds: { x: 0, y: 0, width: -1, height: 1 } }, "invalid_bounds"],
    [
      "invalid transform",
      { transform: { translation: { x: 1, y: 0 }, rotation: 0, scale: 1 } },
      "invalid_transform",
    ],
    ["invalid version", { version: 2 }, "invalid_version"],
    ["invalid z-index", { zIndex: -1 }, "invalid_value"],
    ["invalid visibility", { visible: "yes" }, "invalid_type"],
    ["invalid lock", { locked: 1 }, "invalid_type"],
    ["invalid created timestamp", { createdAt: "yesterday" }, "invalid_timestamp"],
    ["invalid modified timestamp", { modifiedAt: "yesterday" }, "invalid_timestamp"],
    ["invalid stroke", { stroke: { id: "fake", points: [] } }, "invalid_stroke"],
  ])("reports structured issues for %s", (_label, patch, code) => {
    const result = validateObject({ ...validObject(), ...patch });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code }));
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it("rejects modified timestamps before creation", () => {
    const object = {
      ...validObject(),
      createdAt: "2026-07-27T08:01:00.000Z",
      modifiedAt: "2026-07-27T08:00:00.000Z",
    };
    expect(validateObject(object).issues).toContainEqual(
      expect.objectContaining({ path: "$.modifiedAt", code: "invalid_timestamp" }),
    );
  });

  it("rejects arrays, functions, dates, non-finite values, and cycles in metadata", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const metadata of [
      [],
      { callback: () => undefined },
      new Date(),
      { n: Infinity },
      cyclic,
    ]) {
      const result = validateObject({ ...validObject(), metadata });
      expect(result.issues).toContainEqual(
        expect.objectContaining({ path: "$.metadata", code: "invalid_metadata" }),
      );
    }
  });

  it("reports rendering-hint validation at its own boundary", () => {
    expect(() =>
      createInkObject({
        stroke: createStroke(),
        renderingHints: { invalid: Number.NaN },
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: "$.renderingHints" })],
      }),
    );
  });

  it("detects duplicate ids and preserves indexed issue paths", () => {
    const object = validObject();
    const result = validateObjectCollection([object, object]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "$[1].id", code: "duplicate_id" }),
    );
    expect(() => assertValidObjectCollection([object, object])).toThrowError(ObjectValidationError);
  });

  it("returns structured validation for non-object values", () => {
    expect(validateObject(null)).toEqual({
      valid: false,
      issues: [expect.objectContaining({ path: "$", code: "invalid_type" })],
    });
    expect(isObjectBounds({ x: 0, y: 0, width: Number.NaN, height: 1 })).toBe(false);
  });
});
