import type { ObjectBounds, Transform } from "@folio/document";
import type { ManipulationKind } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";

const OUTLINE_PADDING_PIXELS = 4;
const HANDLE_HIT_RADIUS_PIXELS = 12;
const ROTATION_HANDLE_OFFSET_PIXELS = 28;
export const ROTATION_CURSOR_CSS = createRotationCursorCss();

export interface SelectionManipulationTargetInput {
  readonly bounds: ObjectBounds;
  readonly position: PagePoint;
  readonly zoom: number;
  readonly localBounds?: ObjectBounds;
  readonly transform?: Transform;
}

export interface OrientedSelectionFrame {
  readonly center: Readonly<{ x: number; y: number }>;
  readonly topMidpoint: Readonly<{ x: number; y: number }>;
  readonly rotationHandle: Readonly<{ x: number; y: number }>;
  readonly corners: readonly Readonly<{ x: number; y: number }>[];
  readonly rotation: number;
}

export type SelectionManipulationCursor =
  "default" | "crosshair" | "grab" | "grabbing" | "nwse-resize" | "nesw-resize" | "rotation";

export interface SelectionManipulationHit {
  readonly kind: ManipulationKind;
  readonly cursor: Exclude<SelectionManipulationCursor, "default">;
}

/** Resolves the editor's semantic cursor state to its Canvas-compatible CSS value. */
export function selectionManipulationCursorCss(cursor: SelectionManipulationCursor): string {
  return cursor === "rotation" ? ROTATION_CURSOR_CSS : cursor;
}

/** Resolves the Select tool's pointer target without owning interaction state. */
export function resolveSelectionManipulationTarget(
  input: SelectionManipulationTargetInput,
): ManipulationKind | null {
  return resolveSelectionManipulationHit(input)?.kind ?? null;
}

/** Resolves lightweight hover feedback and the matching manipulation target together. */
export function resolveSelectionManipulationHit(
  input: SelectionManipulationTargetInput,
): SelectionManipulationHit | null {
  const { bounds, position, zoom, localBounds, transform } = input;
  if (
    position.coordinateSpace !== "page" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return null;
  }

  if (localBounds !== undefined && transform !== undefined) {
    const frame = resolveOrientedSelectionFrame(localBounds, transform, zoom);
    const hitRadius = HANDLE_HIT_RADIUS_PIXELS / zoom;
    if (distance(position, frame.rotationHandle) <= hitRadius) {
      return Object.freeze({ kind: "rotation", cursor: "rotation" });
    }
    const cursors = ["nwse-resize", "nesw-resize", "nwse-resize", "nesw-resize"] as const;
    const cornerIndex = frame.corners.findIndex(
      (handle) => distance(position, handle) <= hitRadius,
    );
    if (cornerIndex >= 0) {
      return Object.freeze({ kind: "scale", cursor: cursors[cornerIndex] ?? "nwse-resize" });
    }
    const pivot = {
      x: localBounds.x + localBounds.width / 2,
      y: localBounds.y + localBounds.height / 2,
    };
    const localPosition = transform.invertPoint(position, pivot);
    return localPosition.x >= localBounds.x &&
      localPosition.x <= localBounds.x + localBounds.width &&
      localPosition.y >= localBounds.y &&
      localPosition.y <= localBounds.y + localBounds.height
      ? Object.freeze({ kind: "translation", cursor: "grab" })
      : null;
  }

  const padding = OUTLINE_PADDING_PIXELS / zoom;
  const hitRadius = HANDLE_HIT_RADIUS_PIXELS / zoom;
  const left = bounds.x - padding;
  const right = bounds.x + bounds.width + padding;
  const top = bounds.y - padding;
  const bottom = bounds.y + bounds.height + padding;
  const rotationHandle = {
    x: bounds.x + bounds.width / 2,
    y: top - ROTATION_HANDLE_OFFSET_PIXELS / zoom,
  };

  if (distance(position, rotationHandle) <= hitRadius) {
    return Object.freeze({ kind: "rotation", cursor: "rotation" });
  }
  const corners = [
    { x: left, y: top, cursor: "nwse-resize" },
    { x: right, y: top, cursor: "nesw-resize" },
    { x: right, y: bottom, cursor: "nwse-resize" },
    { x: left, y: bottom, cursor: "nesw-resize" },
  ] as const;
  const corner = corners.find((handle) => distance(position, handle) <= hitRadius);
  if (corner !== undefined) {
    return Object.freeze({ kind: "scale", cursor: corner.cursor });
  }
  return position.x >= bounds.x &&
    position.x <= bounds.x + bounds.width &&
    position.y >= bounds.y &&
    position.y <= bounds.y + bounds.height
    ? Object.freeze({ kind: "translation", cursor: "grab" })
    : null;
}

/**
 * Corners of the oriented frame for one transformed object.
 *
 * `pivot` exists for Ink. A vector's local bounds are centred on the point it
 * rotates about, so the pivot can be derived; a stroke's *visual* bounds are
 * tight around the ink and need not be centred on the stroke's pivot, so the
 * caller supplies the real one instead of the frame inventing a wrong centre.
 */
export function resolveOrientedSelectionFrame(
  localBounds: ObjectBounds,
  transform: Transform,
  zoom: number,
  explicitPivot?: Readonly<{ x: number; y: number }>,
): OrientedSelectionFrame {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("Oriented selection geometry requires a positive finite zoom.");
  }
  const pivot = Object.freeze(
    explicitPivot ?? {
      x: localBounds.x + localBounds.width / 2,
      y: localBounds.y + localBounds.height / 2,
    },
  );
  const padding = OUTLINE_PADDING_PIXELS / zoom / transform.scale;
  const rotationOffset = ROTATION_HANDLE_OFFSET_PIXELS / zoom / transform.scale;
  const left = localBounds.x - padding;
  const right = localBounds.x + localBounds.width + padding;
  const top = localBounds.y - padding;
  const bottom = localBounds.y + localBounds.height + padding;
  // The frame is centred on the artwork; only rotation happens about the pivot.
  const frameCenterX = (left + right) / 2;
  const frameCenterY = (top + bottom) / 2;
  const transformPoint = (point: Readonly<{ x: number; y: number }>) =>
    transform.applyToPoint(point, pivot);
  return Object.freeze({
    center: transformPoint({ x: frameCenterX, y: frameCenterY }),
    topMidpoint: transformPoint({ x: frameCenterX, y: top }),
    rotationHandle: transformPoint({ x: frameCenterX, y: top - rotationOffset }),
    corners: Object.freeze([
      transformPoint({ x: left, y: top }),
      transformPoint({ x: right, y: top }),
      transformPoint({ x: right, y: bottom }),
      transformPoint({ x: left, y: bottom }),
    ]),
    rotation: transform.rotation,
  });
}

function distance(position: PagePoint, target: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(position.x - target.x, position.y - target.y);
}

function createRotationCursorCss(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M25 14a10 10 0 1 0-2.9 8" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M24.5 7.5V14H18" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 14a10 10 0 1 0-2.9 8" fill="none" stroke="#111827" stroke-width="2.25" stroke-linecap="round"/><path d="M24.5 7.5V14H18" fill="none" stroke="#111827" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`;
}
