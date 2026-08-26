import type { DomainId } from "@folio/domain";
import { LayerMembershipError } from "./errors";

/** Immutable construction input for one flat artwork Layer. */
export interface LayerData {
  readonly id: DomainId;
  readonly name: string;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly objectIds?: readonly string[];
}

/** Mutable-shaped patch applied through {@link Layer.withPatch}. */
export interface LayerPatch {
  readonly name?: string;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
}

export const DEFAULT_LAYER_NAME = "Layer 1";

function assertName(name: string): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new LayerMembershipError("INVALID_LAYER", "Layer name must be a non-empty string.", {
      name,
    });
  }
  return name;
}

function assertOpacity(opacity: number): number {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new LayerMembershipError("INVALID_LAYER", "Layer opacity must be between zero and one.", {
      opacity,
    });
  }
  return opacity;
}

function assertObjectIds(objectIds: readonly string[], layerId: string): readonly string[] {
  if (!Array.isArray(objectIds)) {
    throw new LayerMembershipError("INVALID_LAYER", "Layer object ids must be an array.", {
      layerId,
    });
  }
  const seen = new Set<string>();
  for (const objectId of objectIds) {
    if (typeof objectId !== "string" || objectId.trim().length === 0) {
      throw new LayerMembershipError("INVALID_LAYER", "Layer object ids must be non-empty ids.", {
        layerId,
        objectId,
      });
    }
    if (seen.has(objectId)) {
      throw new LayerMembershipError(
        "DUPLICATE_LAYER_MEMBERSHIP",
        `Layer '${layerId}' lists object '${objectId}' more than once.`,
        { layerId, objectId },
      );
    }
    seen.add(objectId);
  }
  return Object.freeze([...objectIds]);
}

/**
 * One immutable flat Layer.
 *
 * A Layer owns the ordered identities of the objects it contains. It never
 * stores a `zIndex`; canonical render order is produced by flattening layers
 * bottom to top through {@link PageDocument}.
 */
export class Layer {
  readonly id: DomainId;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly objectIds: readonly string[];

  constructor(data: LayerData) {
    if (data === null || typeof data !== "object") {
      throw new LayerMembershipError("INVALID_LAYER", "Layer requires immutable layer data.");
    }
    if (typeof data.id !== "string" || data.id.trim().length === 0) {
      throw new LayerMembershipError("INVALID_LAYER", "Layer id must be a non-empty string.", {
        id: data.id,
      });
    }
    this.id = data.id;
    this.name = assertName(data.name);
    this.visible = data.visible ?? true;
    this.locked = data.locked ?? false;
    this.opacity = assertOpacity(data.opacity ?? 1);
    this.objectIds = assertObjectIds(data.objectIds ?? [], data.id);
    if (typeof this.visible !== "boolean" || typeof this.locked !== "boolean") {
      throw new LayerMembershipError("INVALID_LAYER", "Layer flags must be booleans.", {
        id: data.id,
      });
    }
    Object.freeze(this);
  }

  get size(): number {
    return this.objectIds.length;
  }

  has(objectId: string): boolean {
    return this.objectIds.includes(objectId);
  }

  indexOf(objectId: string): number {
    return this.objectIds.indexOf(objectId);
  }

  /** Returns an identical Layer with presentation state replaced. */
  withPatch(patch: LayerPatch): Layer {
    const name = patch.name ?? this.name;
    const visible = patch.visible ?? this.visible;
    const locked = patch.locked ?? this.locked;
    const opacity = patch.opacity ?? this.opacity;
    if (
      name === this.name &&
      visible === this.visible &&
      locked === this.locked &&
      opacity === this.opacity
    ) {
      return this;
    }
    return new Layer({ id: this.id, name, visible, locked, opacity, objectIds: this.objectIds });
  }

  /** Returns an identical Layer with a replacement ordered membership list. */
  withObjectIds(objectIds: readonly string[]): Layer {
    return new Layer({
      id: this.id,
      name: this.name,
      visible: this.visible,
      locked: this.locked,
      opacity: this.opacity,
      objectIds,
    });
  }

  /** Returns a Layer with one object identity inserted at a local position. */
  withInsertedObject(objectId: string, localIndex: number): Layer {
    if (!Number.isSafeInteger(localIndex) || localIndex < 0 || localIndex > this.objectIds.length) {
      throw new LayerMembershipError(
        "INVALID_LAYER_INDEX",
        "Layer insertion index is outside the layer.",
        { layerId: this.id, localIndex, size: this.objectIds.length },
      );
    }
    return this.withObjectIds([
      ...this.objectIds.slice(0, localIndex),
      objectId,
      ...this.objectIds.slice(localIndex),
    ]);
  }

  /** Returns a Layer without one object identity. */
  withoutObject(objectId: string): Layer {
    const localIndex = this.indexOf(objectId);
    if (localIndex < 0) return this;
    return this.withObjectIds([
      ...this.objectIds.slice(0, localIndex),
      ...this.objectIds.slice(localIndex + 1),
    ]);
  }
}

/** Creates the always-present default Layer used by a new page. */
export function createDefaultLayer(id: DomainId = "layer-1", name = DEFAULT_LAYER_NAME): Layer {
  return new Layer({ id, name });
}
