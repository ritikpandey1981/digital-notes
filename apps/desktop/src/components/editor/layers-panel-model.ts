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

/** Outcome of one drag gesture, expressed in canonical storage terms. */
export interface LayerDragMove {
  /** Canonical bottom-to-top index the layer must end up at. */
  readonly targetStorageIndex: number;
  /** Display position the row settles into, for the insertion affordance. */
  readonly targetDisplayIndex: number;
  /** False for a gesture that would leave the order untouched. */
  readonly changed: boolean;
}

/**
 * Converts a display-order drag into a canonical storage move.
 *
 * Storage runs bottom to top and the panel runs top to bottom, so every index
 * here is mirrored exactly once. `insertDisplayIndex` is a gap, not a row: it
 * ranges from 0 (above the first row) to `layerCount` (below the last), which
 * is what a drop indicator between two rows actually means.
 */
export function resolveLayerDragMove(
  fromDisplayIndex: number,
  insertDisplayIndex: number,
  layerCount: number,
): LayerDragMove {
  const from = clampIndex(fromDisplayIndex, layerCount - 1);
  const insert = clampIndex(insertDisplayIndex, layerCount);
  // Removing the dragged row first shifts every later gap up by one.
  const targetDisplayIndex = insert > from ? insert - 1 : insert;
  return Object.freeze({
    targetStorageIndex: layerCount - 1 - targetDisplayIndex,
    targetDisplayIndex,
    changed: targetDisplayIndex !== from,
  });
}

/** Mirrors one index between the panel's display order and canonical storage. */
export function mirrorLayerIndex(index: number, layerCount: number): number {
  return layerCount - 1 - index;
}

/**
 * The gap a pointer is hovering over, given each row's live geometry.
 *
 * Rows are measured rather than assumed uniform because an expanded row's
 * options panel makes the list irregular.
 */
export function resolveLayerDropIndex(
  pointerY: number,
  rows: readonly Readonly<{ top: number; height: number }>[],
): number {
  for (const [index, row] of rows.entries()) {
    if (pointerY < row.top + row.height / 2) return index;
  }
  return rows.length;
}

/** Pixels to scroll per frame when a drag reaches the list's top or bottom edge. */
export function resolveLayerAutoScroll(
  pointerY: number,
  list: Readonly<{ top: number; height: number }>,
  edgeSize = LAYER_AUTO_SCROLL_EDGE,
  maximumStep = LAYER_AUTO_SCROLL_STEP,
): number {
  if (edgeSize <= 0 || list.height <= 0) return 0;
  const fromTop = pointerY - list.top;
  const fromBottom = list.top + list.height - pointerY;
  if (fromTop < edgeSize) {
    return -Math.round(maximumStep * clampUnit((edgeSize - fromTop) / edgeSize));
  }
  if (fromBottom < edgeSize) {
    return Math.round(maximumStep * clampUnit((edgeSize - fromBottom) / edgeSize));
  }
  return 0;
}

export const LAYER_AUTO_SCROLL_EDGE = 28;
export const LAYER_AUTO_SCROLL_STEP = 12;
/** A press only becomes a drag once it travels far enough to mean it. */
export const LAYER_DRAG_THRESHOLD = 4;

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

function clampIndex(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), Math.max(0, maximum));
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
