import { LayerMembershipError } from "./errors";
import { createDefaultLayer, Layer, type LayerPatch } from "./layer";
import { ObjectCollection } from "./object-collection";
import type { PageObject } from "./types";

/** Half-open flattened index range owned by one Layer. */
export interface LayerRange {
  readonly start: number;
  readonly end: number;
}

interface PageDocumentInput {
  readonly layers: readonly Layer[];
  readonly objects: ObjectCollection;
}

function assertLayers(layers: readonly Layer[]): readonly Layer[] {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new LayerMembershipError("LAYER_REQUIRED", "A page requires at least one Layer.");
  }
  const ids = new Set<string>();
  for (const layer of layers) {
    if (!(layer instanceof Layer)) {
      throw new LayerMembershipError(
        "INVALID_LAYER",
        "Page layers must be immutable Layer values.",
      );
    }
    if (ids.has(layer.id)) {
      throw new LayerMembershipError(
        "DUPLICATE_LAYER_ID",
        `Layer id '${layer.id}' appears more than once.`,
        { layerId: layer.id },
      );
    }
    ids.add(layer.id);
  }
  return Object.freeze([...layers]);
}

/**
 * One immutable page: flat bottom-to-top layers plus the canonical flattened
 * {@link ObjectCollection} consumed by rendering, selection, and History.
 *
 * The constructor rejects any state in which membership and flattened order
 * disagree, so drift between the two is unrepresentable through normal APIs.
 * Layers never store a `zIndex`; `ObjectCollection` keeps deriving it from
 * canonical array position.
 */
export class PageDocument {
  readonly layers: readonly Layer[];
  readonly objects: ObjectCollection;
  private readonly layerByObjectId: ReadonlyMap<string, string>;
  private readonly layerIndexById: ReadonlyMap<string, number>;
  private readonly rangeByLayerId: ReadonlyMap<string, LayerRange>;

  constructor(input: PageDocumentInput) {
    const layers = assertLayers(input.layers);
    if (!(input.objects instanceof ObjectCollection)) {
      throw new LayerMembershipError(
        "MEMBERSHIP_DRIFT",
        "A page requires an immutable ObjectCollection.",
      );
    }
    const canonical = input.objects.objects;
    const membership = new Map<string, string>();
    const layerIndexes = new Map<string, number>();
    const ranges = new Map<string, LayerRange>();
    let cursor = 0;
    for (const [layerIndex, layer] of layers.entries()) {
      layerIndexes.set(layer.id, layerIndex);
      ranges.set(layer.id, Object.freeze({ start: cursor, end: cursor + layer.size }));
      for (const objectId of layer.objectIds) {
        if (membership.has(objectId)) {
          throw new LayerMembershipError(
            "DUPLICATE_LAYER_MEMBERSHIP",
            `Object '${objectId}' belongs to more than one Layer.`,
            { objectId, layerId: layer.id },
          );
        }
        membership.set(objectId, layer.id);
        const canonicalObject = canonical[cursor];
        if (canonicalObject === undefined || canonicalObject.id !== objectId) {
          throw new LayerMembershipError(
            "MEMBERSHIP_DRIFT",
            "Flattened layer membership does not match the canonical object order.",
            {
              flattenedIndex: cursor,
              expectedObjectId: objectId,
              actualObjectId: canonicalObject?.id ?? null,
            },
          );
        }
        cursor += 1;
      }
    }
    if (cursor !== canonical.length) {
      throw new LayerMembershipError(
        "ORPHANED_OBJECT",
        "Every canonical object must belong to exactly one Layer.",
        { membershipCount: cursor, objectCount: canonical.length },
      );
    }
    this.layers = layers;
    this.objects = input.objects;
    this.layerByObjectId = membership;
    this.layerIndexById = layerIndexes;
    this.rangeByLayerId = ranges;
    Object.freeze(this);
  }

  /** Creates an empty page owning exactly one default Layer. */
  static empty(): PageDocument {
    return new PageDocument({ layers: [createDefaultLayer()], objects: ObjectCollection.empty() });
  }

  get size(): number {
    return this.objects.size;
  }

  get layerCount(): number {
    return this.layers.length;
  }

  /** Returns the bottom-most Layer, which always exists. */
  get bottomLayer(): Layer {
    const layer = this.layers[0];
    if (layer === undefined) {
      throw new LayerMembershipError("LAYER_REQUIRED", "A page requires at least one Layer.");
    }
    return layer;
  }

  layer(layerId: string): Layer | undefined {
    const index = this.layerIndexById.get(layerId);
    return index === undefined ? undefined : this.layers[index];
  }

  requireLayer(layerId: string): Layer {
    const layer = this.layer(layerId);
    if (layer === undefined) {
      throw new LayerMembershipError("LAYER_NOT_FOUND", `Layer '${layerId}' was not found.`, {
        layerId,
      });
    }
    return layer;
  }

  layerIndex(layerId: string): number {
    const index = this.layerIndexById.get(layerId);
    if (index === undefined) {
      throw new LayerMembershipError("LAYER_NOT_FOUND", `Layer '${layerId}' was not found.`, {
        layerId,
      });
    }
    return index;
  }

  /** Returns the half-open flattened range owned by one Layer. */
  layerRange(layerId: string): LayerRange {
    const range = this.rangeByLayerId.get(layerId);
    if (range === undefined) {
      throw new LayerMembershipError("LAYER_NOT_FOUND", `Layer '${layerId}' was not found.`, {
        layerId,
      });
    }
    return range;
  }

  /** Returns the owning layer id for one canonical object. */
  layerIdForObject(objectId: string): string | undefined {
    return this.layerByObjectId.get(objectId);
  }

  /** Resolves the active layer id, falling back to the bottom Layer. */
  resolveActiveLayerId(activeLayerId: string | null | undefined): string {
    if (activeLayerId !== null && activeLayerId !== undefined && this.layer(activeLayerId)) {
      return activeLayerId;
    }
    return this.bottomLayer.id;
  }

  /** Returns the flattened index at which new artwork enters one Layer. */
  appendIndexFor(layerId: string): number {
    return this.layerRange(layerId).end;
  }

  lookup(objectId: string): PageObject | undefined {
    return this.objects.lookup(objectId);
  }

  has(objectId: string): boolean {
    return this.objects.has(objectId);
  }

  /** Inserts one object into a Layer at a canonical flattened index. */
  insert(object: PageObject, flattenedIndex: number, layerId: string): PageDocument {
    const layer = this.requireLayer(layerId);
    const range = this.layerRange(layerId);
    if (
      !Number.isSafeInteger(flattenedIndex) ||
      flattenedIndex < range.start ||
      flattenedIndex > range.end
    ) {
      throw new LayerMembershipError(
        "INVALID_LAYER_INDEX",
        "Insertion index is outside the target Layer.",
        { layerId, flattenedIndex, range },
      );
    }
    const localIndex = flattenedIndex - range.start;
    return new PageDocument({
      layers: this.#replaceLayer(layer.withInsertedObject(object.id, localIndex)),
      objects: this.objects.insert(object, flattenedIndex),
    });
  }

  /** Appends one object to the top of a Layer. */
  add(object: PageObject, layerId: string): PageDocument {
    return this.insert(object, this.appendIndexFor(layerId), layerId);
  }

  /** Removes one object from its owning Layer and the canonical order. */
  remove(objectId: string): PageDocument {
    const layerId = this.layerByObjectId.get(objectId);
    if (layerId === undefined) {
      throw new LayerMembershipError(
        "ORPHANED_OBJECT",
        `Object '${objectId}' has no owning Layer.`,
        { objectId },
      );
    }
    return new PageDocument({
      layers: this.#replaceLayer(this.requireLayer(layerId).withoutObject(objectId)),
      objects: this.objects.remove(objectId),
    });
  }

  /** Replaces one object in place; membership and order are untouched. */
  replace(object: PageObject): PageDocument {
    const objects = this.objects.replace(object);
    if (objects === this.objects) return this;
    return new PageDocument({ layers: this.layers, objects });
  }

  /** Inserts a new Layer at a layer index without moving any artwork. */
  addLayer(layer: Layer, layerIndex: number): PageDocument {
    if (!Number.isSafeInteger(layerIndex) || layerIndex < 0 || layerIndex > this.layers.length) {
      throw new LayerMembershipError(
        "INVALID_LAYER_INDEX",
        "Layer insertion index is outside the page.",
        { layerIndex, layerCount: this.layers.length },
      );
    }
    if (layer.size > 0) {
      throw new LayerMembershipError(
        "INVALID_LAYER",
        "A newly inserted Layer must not already declare membership.",
        { layerId: layer.id },
      );
    }
    return new PageDocument({
      layers: [...this.layers.slice(0, layerIndex), layer, ...this.layers.slice(layerIndex)],
      objects: this.objects,
    });
  }

  /** Removes one Layer together with every object it contains. */
  removeLayer(layerId: string): PageDocument {
    const layer = this.requireLayer(layerId);
    if (this.layers.length === 1) {
      throw new LayerMembershipError(
        "LAYER_REQUIRED",
        "The final remaining Layer cannot be removed.",
        { layerId },
      );
    }
    const removed = new Set(layer.objectIds);
    const layers = this.layers.filter((candidate) => candidate.id !== layerId);
    const objects = this.objects.objects.filter((object) => !removed.has(object.id));
    return new PageDocument({ layers, objects: new ObjectCollection(objects) });
  }

  /** Restores one previously removed Layer together with its ordered artwork. */
  restoreLayer(layer: Layer, layerIndex: number, objects: readonly PageObject[]): PageDocument {
    if (!Number.isSafeInteger(layerIndex) || layerIndex < 0 || layerIndex > this.layers.length) {
      throw new LayerMembershipError(
        "INVALID_LAYER_INDEX",
        "Layer restore index is outside the page.",
        { layerIndex, layerCount: this.layers.length },
      );
    }
    const byId = new Map(objects.map((object) => [object.id, object]));
    if (byId.size !== objects.length || byId.size !== layer.size) {
      throw new LayerMembershipError(
        "MEMBERSHIP_DRIFT",
        "Restored Layer artwork must match its declared membership exactly.",
        { layerId: layer.id, membership: layer.size, provided: objects.length },
      );
    }
    const ordered = layer.objectIds.map((objectId) => {
      const object = byId.get(objectId);
      if (object === undefined) {
        throw new LayerMembershipError(
          "MEMBERSHIP_DRIFT",
          `Restored Layer is missing object '${objectId}'.`,
          { layerId: layer.id, objectId },
        );
      }
      return object;
    });
    const layers = [...this.layers.slice(0, layerIndex), layer, ...this.layers.slice(layerIndex)];
    const flattened = this.#flattenWithInsertedLayer(layers, layer.id, ordered);
    return new PageDocument({ layers, objects: new ObjectCollection(flattened) });
  }

  /** Applies presentation state to one Layer without touching artwork. */
  updateLayer(layerId: string, patch: LayerPatch): PageDocument {
    const layer = this.requireLayer(layerId);
    const next = layer.withPatch(patch);
    if (next === layer) return this;
    return new PageDocument({ layers: this.#replaceLayer(next), objects: this.objects });
  }

  /** Moves one Layer to a new layer index, rebuilding canonical order once. */
  reorderLayers(layerId: string, targetLayerIndex: number): PageDocument {
    const sourceIndex = this.layerIndex(layerId);
    if (
      !Number.isSafeInteger(targetLayerIndex) ||
      targetLayerIndex < 0 ||
      targetLayerIndex >= this.layers.length
    ) {
      throw new LayerMembershipError(
        "INVALID_LAYER_INDEX",
        "Layer target index is outside the page.",
        { layerId, targetLayerIndex, layerCount: this.layers.length },
      );
    }
    if (sourceIndex === targetLayerIndex) return this;
    const layers = [...this.layers];
    const [moved] = layers.splice(sourceIndex, 1);
    if (moved === undefined) {
      throw new LayerMembershipError("LAYER_NOT_FOUND", `Layer '${layerId}' was not found.`, {
        layerId,
      });
    }
    layers.splice(targetLayerIndex, 0, moved);
    return new PageDocument({ layers, objects: new ObjectCollection(this.#flatten(layers)) });
  }

  /** Moves one object into another Layer at a local position. */
  moveObjectToLayer(objectId: string, targetLayerId: string, localIndex?: number): PageDocument {
    const sourceLayerId = this.layerByObjectId.get(objectId);
    if (sourceLayerId === undefined) {
      throw new LayerMembershipError(
        "ORPHANED_OBJECT",
        `Object '${objectId}' has no owning Layer.`,
        { objectId },
      );
    }
    const target = this.requireLayer(targetLayerId);
    const resolvedIndex =
      localIndex ?? (sourceLayerId === targetLayerId ? target.size - 1 : target.size);
    if (sourceLayerId === targetLayerId && target.indexOf(objectId) === resolvedIndex) {
      return this;
    }
    const detached = this.requireLayer(sourceLayerId).withoutObject(objectId);
    const stagedLayers = this.#replaceLayer(detached);
    const stagedTarget =
      sourceLayerId === targetLayerId
        ? detached
        : (stagedLayers.find((layer) => layer.id === targetLayerId) ?? target);
    const attached = stagedTarget.withInsertedObject(
      objectId,
      Math.min(Math.max(resolvedIndex, 0), stagedTarget.size),
    );
    const layers = stagedLayers.map((layer) => (layer.id === attached.id ? attached : layer));
    return new PageDocument({ layers, objects: new ObjectCollection(this.#flatten(layers)) });
  }

  #replaceLayer(layer: Layer): readonly Layer[] {
    return this.layers.map((candidate) => (candidate.id === layer.id ? layer : candidate));
  }

  #flatten(layers: readonly Layer[]): readonly PageObject[] {
    const flattened: PageObject[] = [];
    for (const layer of layers) {
      for (const objectId of layer.objectIds) {
        const object = this.objects.lookup(objectId);
        if (object === undefined) {
          throw new LayerMembershipError(
            "ORPHANED_OBJECT",
            `Layer '${layer.id}' references unknown object '${objectId}'.`,
            { layerId: layer.id, objectId },
          );
        }
        flattened.push(object);
      }
    }
    return flattened;
  }

  #flattenWithInsertedLayer(
    layers: readonly Layer[],
    insertedLayerId: string,
    insertedObjects: readonly PageObject[],
  ): readonly PageObject[] {
    const inserted = new Map(insertedObjects.map((object) => [object.id, object]));
    const flattened: PageObject[] = [];
    for (const layer of layers) {
      for (const objectId of layer.objectIds) {
        const object =
          layer.id === insertedLayerId ? inserted.get(objectId) : this.objects.lookup(objectId);
        if (object === undefined) {
          throw new LayerMembershipError(
            "ORPHANED_OBJECT",
            `Layer '${layer.id}' references unknown object '${objectId}'.`,
            { layerId: layer.id, objectId },
          );
        }
        flattened.push(object);
      }
    }
    return flattened;
  }
}
