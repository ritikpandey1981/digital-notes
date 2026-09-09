import { describe, expect, it } from "vitest";
import * as document from "../index";
import type { ObjectSerializationContract, PageObject, SerializedPageObject } from "../index";

describe("@folio/document public API", () => {
  it("exposes only document models, factories, collections, validation, and errors", () => {
    expect(Object.keys(document).sort()).toEqual([
      "DEFAULT_LAYER_NAME",
      "DEFAULT_PAGE_GEOMETRY",
      "DEFAULT_PAGE_PAPER",
      "DEFAULT_PAPER_COLOR",
      "DocumentObjectError",
      "EllipseObject",
      "InkObject",
      "Layer",
      "LayerMembershipError",
      "LineObject",
      "MAXIMUM_PAGE_EXTENT",
      "MAXIMUM_PAPER_SPACING",
      "MINIMUM_PAGE_EXTENT",
      "MINIMUM_PAPER_SPACING",
      "ObjectCollection",
      "ObjectFactory",
      "ObjectValidationError",
      "PAGE_PRESETS",
      "PAPER_COLOR_PRESETS",
      "PAPER_TYPES",
      "Page",
      "PageDocument",
      "RectangleObject",
      "SketchbookDocument",
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
      "createPageGeometry",
      "createPageLike",
      "createPagePaper",
      "createRectangleObject",
      "deserializeVectorObject",
      "duplicatePage",
      "isObjectBounds",
      "isObjectMetadata",
      "isPageObject",
      "isVectorObject",
      "matchPagePreset",
      "normalizeHexColor",
      "orientPageGeometry",
      "pageOrientation",
      "pagePreset",
      "paperTypeDefinition",
      "positionObject",
      "rotateObject",
      "samePagePaper",
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
