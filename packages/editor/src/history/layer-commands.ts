import { Layer, PageDocument, type LayerPatch, type PageObject } from "@folio/document";
import type { EditorCommand } from "@folio/history";

interface LayerCommandMetadata {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
}

function assertMetadata(metadata: LayerCommandMetadata): LayerCommandMetadata {
  if (
    metadata.id.trim().length === 0 ||
    metadata.description.trim().length === 0 ||
    !isIsoTimestamp(metadata.timestamp)
  ) {
    throw new TypeError("Layer commands require valid immutable command metadata.");
  }
  return Object.freeze({ ...metadata });
}

function requirePage(document: PageDocument, commandName: string): PageDocument {
  if (!(document instanceof PageDocument)) {
    throw new TypeError(`${commandName} requires a PageDocument.`);
  }
  return document;
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export interface AddLayerCommandInput {
  readonly layer: Layer;
  readonly layerIndex: number;
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

class AddLayerCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #layer: Layer;
  readonly #layerIndex: number;

  constructor(input: AddLayerCommandInput) {
    if (!(input.layer instanceof Layer) || input.layer.size > 0) {
      throw new TypeError("AddLayerCommand requires one immutable empty Layer.");
    }
    const metadata = assertMetadata({
      id: input.id ?? `add-layer-${input.layer.id}`,
      timestamp: input.timestamp,
      description: input.description ?? `Add ${input.layer.name}`,
    });
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#layer = input.layer;
    this.#layerIndex = input.layerIndex;
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#add(document);
  }

  undo(document: PageDocument): PageDocument {
    const current = requirePage(document, "AddLayerCommand");
    const layer = current.layer(this.#layer.id);
    if (layer === undefined) {
      throw new Error(`Layer '${this.#layer.id}' is not present and cannot be removed.`);
    }
    if (layer.size > 0) {
      throw new Error(`Layer '${this.#layer.id}' gained artwork and cannot be undone directly.`);
    }
    return current.removeLayer(this.#layer.id);
  }

  redo(document: PageDocument): PageDocument {
    return this.#add(document);
  }

  #add(document: PageDocument): PageDocument {
    const current = requirePage(document, "AddLayerCommand");
    if (current.layer(this.#layer.id) !== undefined) {
      throw new Error(`Layer '${this.#layer.id}' already exists.`);
    }
    return current.addLayer(this.#layer, Math.min(this.#layerIndex, current.layerCount));
  }
}

export function createAddLayerCommand(input: AddLayerCommandInput): EditorCommand<PageDocument> {
  return new AddLayerCommand(input);
}

export interface UpdateLayerCommandInput {
  readonly layerId: string;
  readonly initialPatch: LayerPatch;
  readonly finalPatch: LayerPatch;
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

class UpdateLayerCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #layerId: string;
  readonly #initialPatch: LayerPatch;
  readonly #finalPatch: LayerPatch;

  constructor(input: UpdateLayerCommandInput) {
    if (typeof input.layerId !== "string" || input.layerId.trim().length === 0) {
      throw new TypeError("UpdateLayerCommand requires a Layer id.");
    }
    const metadata = assertMetadata({
      id: input.id ?? `update-layer-${input.layerId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: input.description ?? "Update layer",
    });
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#layerId = input.layerId;
    this.#initialPatch = Object.freeze({ ...input.initialPatch });
    this.#finalPatch = Object.freeze({ ...input.finalPatch });
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#apply(document, this.#finalPatch);
  }

  undo(document: PageDocument): PageDocument {
    return this.#apply(document, this.#initialPatch);
  }

  redo(document: PageDocument): PageDocument {
    return this.#apply(document, this.#finalPatch);
  }

  #apply(document: PageDocument, patch: LayerPatch): PageDocument {
    const current = requirePage(document, "UpdateLayerCommand");
    current.requireLayer(this.#layerId);
    return current.updateLayer(this.#layerId, patch);
  }
}

export function createUpdateLayerCommand(
  input: UpdateLayerCommandInput,
): EditorCommand<PageDocument> {
  return new UpdateLayerCommand(input);
}

export interface RemoveLayerCommandInput {
  readonly layer: Layer;
  readonly layerIndex: number;
  readonly objects: readonly PageObject[];
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

class RemoveLayerCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #layer: Layer;
  readonly #layerIndex: number;
  readonly #objects: readonly PageObject[];

  constructor(input: RemoveLayerCommandInput) {
    if (!(input.layer instanceof Layer)) {
      throw new TypeError("RemoveLayerCommand requires one immutable Layer.");
    }
    if (input.objects.length !== input.layer.size) {
      throw new TypeError("RemoveLayerCommand requires the Layer's exact ordered artwork.");
    }
    const metadata = assertMetadata({
      id: input.id ?? `remove-layer-${input.layer.id}`,
      timestamp: input.timestamp,
      description: input.description ?? `Delete ${input.layer.name}`,
    });
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#layer = input.layer;
    this.#layerIndex = input.layerIndex;
    this.#objects = Object.freeze([...input.objects]);
    Object.freeze(this);
  }

  get removedObjectCount(): number {
    return this.#objects.length;
  }

  execute(document: PageDocument): PageDocument {
    return this.#remove(document);
  }

  undo(document: PageDocument): PageDocument {
    const current = requirePage(document, "RemoveLayerCommand");
    if (current.layer(this.#layer.id) !== undefined) {
      throw new Error(`Layer '${this.#layer.id}' already exists and cannot be restored.`);
    }
    return current.restoreLayer(
      this.#layer,
      Math.min(this.#layerIndex, current.layerCount),
      this.#objects,
    );
  }

  redo(document: PageDocument): PageDocument {
    return this.#remove(document);
  }

  #remove(document: PageDocument): PageDocument {
    const current = requirePage(document, "RemoveLayerCommand");
    const layer = current.requireLayer(this.#layer.id);
    if (layer.objectIds.length !== this.#layer.objectIds.length) {
      throw new Error(`Layer '${this.#layer.id}' membership changed and cannot be deleted.`);
    }
    return current.removeLayer(this.#layer.id);
  }
}

export interface RemoveLayerEditorCommand extends EditorCommand<PageDocument> {
  readonly removedObjectCount: number;
}

export function createRemoveLayerCommand(input: RemoveLayerCommandInput): RemoveLayerEditorCommand {
  return new RemoveLayerCommand(input);
}

export interface ReorderLayersCommandInput {
  readonly layerId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

class ReorderLayersCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #layerId: string;
  readonly #fromIndex: number;
  readonly #toIndex: number;

  constructor(input: ReorderLayersCommandInput) {
    if (
      !Number.isSafeInteger(input.fromIndex) ||
      !Number.isSafeInteger(input.toIndex) ||
      input.fromIndex < 0 ||
      input.toIndex < 0
    ) {
      throw new TypeError("ReorderLayersCommand requires valid layer indexes.");
    }
    const metadata = assertMetadata({
      id: input.id ?? `reorder-layer-${input.layerId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: input.description ?? "Reorder layers",
    });
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#layerId = input.layerId;
    this.#fromIndex = input.fromIndex;
    this.#toIndex = input.toIndex;
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#move(document, this.#toIndex);
  }

  undo(document: PageDocument): PageDocument {
    return this.#move(document, this.#fromIndex);
  }

  redo(document: PageDocument): PageDocument {
    return this.#move(document, this.#toIndex);
  }

  #move(document: PageDocument, targetIndex: number): PageDocument {
    const current = requirePage(document, "ReorderLayersCommand");
    current.requireLayer(this.#layerId);
    return current.reorderLayers(this.#layerId, targetIndex);
  }
}

export function createReorderLayersCommand(
  input: ReorderLayersCommandInput,
): EditorCommand<PageDocument> {
  return new ReorderLayersCommand(input);
}

export interface MoveObjectToLayerCommandInput {
  readonly objectId: string;
  readonly fromLayerId: string;
  readonly fromLocalIndex: number;
  readonly toLayerId: string;
  readonly toLocalIndex: number;
  readonly timestamp: string;
  readonly id?: string;
  readonly description?: string;
}

/**
 * Phase 20 model support: moves one object between Layers.
 *
 * The command is fully implemented and tested; Phase 19 deliberately exposes no
 * user interface for it.
 */
class MoveObjectToLayerCommand implements EditorCommand<PageDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #input: MoveObjectToLayerCommandInput;

  constructor(input: MoveObjectToLayerCommandInput) {
    if (typeof input.objectId !== "string" || input.objectId.trim().length === 0) {
      throw new TypeError("MoveObjectToLayerCommand requires an object id.");
    }
    const metadata = assertMetadata({
      id: input.id ?? `move-object-layer-${input.objectId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: input.description ?? "Move object to layer",
    });
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#input = Object.freeze({ ...input });
    Object.freeze(this);
  }

  execute(document: PageDocument): PageDocument {
    return this.#move(document, this.#input.toLayerId, this.#input.toLocalIndex);
  }

  undo(document: PageDocument): PageDocument {
    return this.#move(document, this.#input.fromLayerId, this.#input.fromLocalIndex);
  }

  redo(document: PageDocument): PageDocument {
    return this.#move(document, this.#input.toLayerId, this.#input.toLocalIndex);
  }

  #move(document: PageDocument, layerId: string, localIndex: number): PageDocument {
    const current = requirePage(document, "MoveObjectToLayerCommand");
    current.requireLayer(layerId);
    if (!current.has(this.#input.objectId)) {
      throw new Error(`Object '${this.#input.objectId}' is not present in the document.`);
    }
    return current.moveObjectToLayer(this.#input.objectId, layerId, localIndex);
  }
}

export function createMoveObjectToLayerCommand(
  input: MoveObjectToLayerCommandInput,
): EditorCommand<PageDocument> {
  return new MoveObjectToLayerCommand(input);
}
