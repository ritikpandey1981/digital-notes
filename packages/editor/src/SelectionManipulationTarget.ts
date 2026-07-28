import type { ObjectBounds } from "@folio/document";
import type { ManipulationKind } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";

const OUTLINE_PADDING_PIXELS = 4;
const HANDLE_HIT_RADIUS_PIXELS = 9;
const ROTATION_HANDLE_OFFSET_PIXELS = 28;

export interface SelectionManipulationTargetInput {
  readonly bounds: ObjectBounds;
  readonly position: PagePoint;
  readonly zoom: number;
}

/** Resolves the Select tool's pointer target without owning interaction state. */
export function resolveSelectionManipulationTarget(
  input: SelectionManipulationTargetInput,
): ManipulationKind | null {
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

  if (distance(position, rotationHandle) <= hitRadius) return "rotation";
  if (
    [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ].some((handle) => distance(position, handle) <= hitRadius)
  ) {
    return "scale";
  }
  return position.x >= bounds.x &&
    position.x <= bounds.x + bounds.width &&
    position.y >= bounds.y &&
    position.y <= bounds.y + bounds.height
    ? "translation"
    : null;
}

function distance(position: PagePoint, target: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(position.x - target.x, position.y - target.y);
}
