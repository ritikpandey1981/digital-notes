import type { PagePoint } from "@folio/selection";
import type { RotationEngine } from "../interfaces/rotation-engine";
import type { RotationModel } from "../model/types";

function assertPoint(point: PagePoint): void {
  if (point.coordinateSpace !== "page" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Rotation requires finite page-space points.");
  }
}

function normalizeRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

class RotationEngineImplementation implements RotationEngine {
  calculate(center: PagePoint, origin: PagePoint, current: PagePoint): RotationModel {
    assertPoint(center);
    assertPoint(origin);
    assertPoint(current);
    const originAngle = Math.atan2(origin.y - center.y, origin.x - center.x);
    const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
    return Object.freeze({ deltaRadians: normalizeRadians(currentAngle - originAngle) });
  }
}

/** Creates the deterministic center-pivot rotation algorithm. */
export function createRotationEngine(): RotationEngine {
  return new RotationEngineImplementation();
}
