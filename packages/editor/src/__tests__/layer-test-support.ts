import {
  createDefaultLayer,
  ObjectCollection,
  PageDocument,
  type PageObject,
} from "@folio/document";

export const TEST_LAYER_ID = createDefaultLayer().id;

/** Builds a single-layer page whose membership matches canonical order exactly. */
export function pageOf(objects: readonly PageObject[] = []): PageDocument {
  return new PageDocument({
    layers: [createDefaultLayer().withObjectIds(objects.map((object) => object.id))],
    objects: new ObjectCollection(objects),
  });
}

/** Builds a page from ordered per-layer object groups, bottom layer first. */
export function pageOfLayers(groups: readonly (readonly PageObject[])[]): PageDocument {
  const layers = groups.map((objects, index) =>
    createDefaultLayer(`layer-${index + 1}`, `Layer ${index + 1}`).withObjectIds(
      objects.map((object) => object.id),
    ),
  );
  return new PageDocument({ layers, objects: new ObjectCollection(groups.flat()) });
}
