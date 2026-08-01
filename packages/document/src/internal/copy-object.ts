import { DocumentObjectError } from "../errors";
import { InkObject } from "../ink-object";
import type { PageObject, VectorPageObject } from "../types";
import { EllipseObject, LineObject, RectangleObject } from "../vector-object";

export function copyObjectWithZIndex(object: PageObject, zIndex: number): PageObject {
  if (object.zIndex === zIndex) return object;
  if (object.type === "ink") {
    const source = object as InkObject;
    return new InkObject({
      id: source.id,
      createdAt: source.createdAt,
      modifiedAt: source.modifiedAt,
      visible: source.visible,
      locked: source.locked,
      metadata: source.metadata,
      zIndex,
      transform: source.transform,
      stroke: source.stroke,
      renderingHints: source.renderingHints,
    });
  }
  const common = {
    id: object.id,
    createdAt: object.createdAt,
    modifiedAt: object.modifiedAt,
    visible: object.visible,
    locked: object.locked,
    metadata: object.metadata,
    zIndex,
    transform: object.transform,
  };
  const vector = object as VectorPageObject;
  switch (vector.type) {
    case "line":
      return new LineObject({ ...common, geometry: vector.geometry, style: vector.style });
    case "rectangle":
      return new RectangleObject({ ...common, geometry: vector.geometry, style: vector.style });
    case "ellipse":
      return new EllipseObject({ ...common, geometry: vector.geometry, style: vector.style });
  }
  throw new DocumentObjectError(
    "UNSUPPORTED_OBJECT_TYPE",
    "Only InkObject can be reindexed in Phase 8.",
    { type: object.type },
  );
}
