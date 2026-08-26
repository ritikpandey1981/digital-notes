import { describe, expect, it } from "vitest";
import * as document from "../index";
import type { ObjectSerializationContract, PageObject, SerializedPageObject } from "../index";

describe("@folio/document public API", () => {
  it("exposes only document models, factories, collections, validation, and errors", () => {
    expect(Object.keys(document).sort()).toEqual([
      "DEFAULT_LAYER_NAME",
      "DocumentObjectError",
      "EllipseObject",
      "InkObject",
      "Layer",
      "LayerMembershipError",
      "LineObject",
      "ObjectCollection",
      "ObjectFactory",
      "ObjectValidationError",
      "PageDocument",
      "RectangleObject",
      "Transform",
      "assertValidObject",
      "assertValidObjectCollection",
      "cloneObject",
      "createDefaultLayer",
      "createEditableColor",
      "createEditableStyle",
      "createEllipseObject",
      "createInkObject",
      "createLineObject",
      "createRectangleObject",
      "deserializeVectorObject",
      "isObjectBounds",
      "isObjectMetadata",
      "isPageObject",
      "isVectorObject",
      "normalizeHexColor",
      "rotateObject",
      "scaleObject",
      "serializeVectorObject",
      "translateObject",
      "validateObject",
      "validateObjectCollection",
      "vectorGeometryBounds",
    ]);
  });

  it("preserves the generic serialization contract alongside vector serialization", () => {
    const contract: ObjectSerializationContract = {
      serialize: (): SerializedPageObject => {
        throw new Error("Contract-only test");
      },
      deserialize: (): PageObject => {
        throw new Error("Contract-only test");
      },
    };
    expect(typeof contract.serialize).toBe("function");
    expect(typeof contract.deserialize).toBe("function");
  });

  it("produces immutable structured collection errors", () => {
    const error = new document.DocumentObjectError("OBJECT_NOT_FOUND", "Missing", {
      id: "object",
    });
    expect(error).toMatchObject({ code: "OBJECT_NOT_FOUND", details: { id: "object" } });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
