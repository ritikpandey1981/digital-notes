import type { ObjectBounds } from "@folio/document";
import type { ManipulationKind } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";

const OUTLINE_PADDING_PIXELS = 4;
const HANDLE_HIT_RADIUS_PIXELS = 12;
const ROTATION_HANDLE_OFFSET_PIXELS = 28;
const ROTATION_CURSOR_CSS =
  'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M18.5 7.5A7 7 0 1 0 19 15%27 fill=%27none%27 stroke=%27white%27 stroke-width=%274%27 stroke-linecap=%27round%27/%3E%3Cpath d=%27M18 3v5.5h5.5%27 fill=%27none%27 stroke=%27white%27 stroke-width=%274%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3Cpath d=%27M18.5 7.5A7 7 0 1 0 19 15%27 fill=%27none%27 stroke=%27%23111827%27 stroke-width=%272%27 stroke-linecap=%27round%27/%3E%3Cpath d=%27M18 3v5.5h5.5%27 fill=%27none%27 stroke=%27%23111827%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E") 12 12, crosshair';

export interface SelectionManipulationTargetInput {
  readonly bounds: ObjectBounds;
  readonly position: PagePoint;
  readonly zoom: number;
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
  const { bounds, position, zoom } = input;
  if (
    position.coordinateSpace !== "page" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return null;
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

function distance(position: PagePoint, target: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(position.x - target.x, position.y - target.y);
}
