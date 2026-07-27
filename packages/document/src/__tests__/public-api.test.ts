import { describe, expect, it } from "vitest";
import * as document from "../index";
import type { ObjectSerializationContract, PageObject, SerializedPageObject } from "../index";

describe("@folio/document public API", () => {
  it("exposes only document models, factories, collections, validation, and errors", () => {
    expect(Object.keys(document).sort()).toEqual([
      "DocumentObjectError",
      "InkObject",
      "ObjectCollection",
      "ObjectFactory",
      "ObjectValidationError",
      "Transform",
      "assertValidObject",
      "assertValidObjectCollection",
      "cloneObject",
      "createInkObject",
      "isObjectBounds",
      "isObjectMetadata",
      "isPageObject",
      "validateObject",
      "validateObjectCollection",
    ]);
  });

  it("keeps serialization as a compile-time contract without an implementation", () => {
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
