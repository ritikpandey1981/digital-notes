import { DocumentObjectError } from "../errors";
import { InkObject } from "../ink-object";
import type { PageObject } from "../types";

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
  throw new DocumentObjectError(
    "UNSUPPORTED_OBJECT_TYPE",
    "Only InkObject can be reindexed in Phase 8.",
    { type: object.type },
  );
}
