import type { LayerSnapshot, LayersSnapshot } from "@folio/editor";

/** One panel row. Rows are presented top layer first while storage stays bottom to top. */
export interface LayerRow extends LayerSnapshot {
  /** Canonical bottom-to-top storage index. */
  readonly storageIndex: number;
  readonly active: boolean;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export const LAYER_PANEL_WIDTH = 248;
export const LAYER_ROW_HEIGHT = 36;

/** Projects the canonical bottom-to-top snapshot into top-first display rows. */
export function layerRows(snapshot: LayersSnapshot): readonly LayerRow[] {
  const total = snapshot.layers.length;
  return Object.freeze(
    snapshot.layers
      .map((layer, storageIndex) =>
        Object.freeze({
          ...layer,
          storageIndex,
          active: layer.id === snapshot.activeLayerId,
          canMoveUp: storageIndex < total - 1,
          canMoveDown: storageIndex > 0,
        }),
      )
      .reverse(),
  );
}

/** Resolves the canonical storage index for a display-order move. */
export function moveTargetIndex(
  row: Pick<LayerRow, "storageIndex">,
  direction: "up" | "down",
  layerCount: number,
): number | null {
  const target = direction === "up" ? row.storageIndex + 1 : row.storageIndex - 1;
  if (target < 0 || target > layerCount - 1) return null;
  return target;
}

/** True when deleting this layer is permitted. The final layer can never be removed. */
export function canDeleteLayer(layerCount: number): boolean {
  return layerCount > 1;
}

/** Moves row focus within the displayed list, clamped at both ends. */
export function nextFocusIndex(
  currentIndex: number,
  direction: "up" | "down",
  rowCount: number,
): number {
  if (rowCount === 0) return 0;
  const next = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  return Math.min(Math.max(next, 0), rowCount - 1);
}

/** Formats the restrained delete notification body. */
export function describeDeletedLayer(name: string, objectCount: number): string {
  if (objectCount === 0) return `${name} deleted`;
  return `${name} deleted with ${objectCount} object${objectCount === 1 ? "" : "s"}`;
}

/** Normalizes a rename draft, returning null when it should be discarded. */
export function normalizeLayerName(draft: string, current: string): string | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0 || trimmed === current) return null;
  return trimmed;
}
