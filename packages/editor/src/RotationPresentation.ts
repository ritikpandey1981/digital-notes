import type { ManipulationState } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";

export const ROTATION_SNAP_INCREMENT_RADIANS = Math.PI / 12;

export function normalizeRotationDegrees(radians: number): number {
  if (!Number.isFinite(radians)) throw new RangeError("Rotation must be finite.");
  const degrees = Math.round((radians * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

/**
 * The text of the live rotation chip.
 *
 * Angles are reported in the editor's canonical 0–359 range rather than signed,
 * so one rotation reads the same whichever direction the user dragged to reach
 * it. Purely presentational: nothing reads this back.
 */
export function formatRotationAngleLabel(radians: number): string {
  return `${normalizeRotationDegrees(radians)}°`;
}

export function snapRotationPointer(
  state: ManipulationState,
  current: PagePoint,
  increment = ROTATION_SNAP_INCREMENT_RADIANS,
): PagePoint {
  if (
    state.kind !== "rotation" ||
    state.dragOrigin === null ||
    state.objectCenter === null ||
    state.initialObjectRotation === null
  ) {
    return current;
  }
  if (!Number.isFinite(increment) || increment <= 0) {
    throw new RangeError("Rotation snapping requires a positive finite increment.");
  }
  const center = state.objectCenter;
  const originAngle = Math.atan2(state.dragOrigin.y - center.y, state.dragOrigin.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  const rawDelta = normalizeRadians(currentAngle - originAngle);
  const snappedFinal = Math.round((state.initialObjectRotation + rawDelta) / increment) * increment;
  const snappedDelta = normalizeRadians(snappedFinal - state.initialObjectRotation);
  const radius = Math.hypot(current.x - center.x, current.y - center.y);
  return Object.freeze({
    x: center.x + Math.cos(originAngle + snappedDelta) * radius,
    y: center.y + Math.sin(originAngle + snappedDelta) * radius,
    coordinateSpace: "page",
  });
}

function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
