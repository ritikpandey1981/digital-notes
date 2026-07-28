import type { PagePoint } from "@folio/selection";
import type { ScaleEngine } from "../interfaces/scale-engine";
import type { ScaleModel } from "../model/types";

const MINIMUM_ORIGIN_RADIUS = 1e-6;

function assertPoint(point: PagePoint): void {
  if (point.coordinateSpace !== "page" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Scale requires finite page-space points.");
  }
}

class ScaleEngineImplementation implements ScaleEngine {
  calculate(center: PagePoint, origin: PagePoint, current: PagePoint): ScaleModel {
    assertPoint(center);
    assertPoint(origin);
    assertPoint(current);
    const originRadius = Math.hypot(origin.x - center.x, origin.y - center.y);
    if (originRadius <= MINIMUM_ORIGIN_RADIUS) {
      throw new RangeError("Scale origin must be separated from the object center.");
    }
    const currentRadius = Math.hypot(current.x - center.x, current.y - center.y);
    return Object.freeze({ factor: currentRadius / originRadius });
  }
}

/** Creates the deterministic center-pivot uniform-scale algorithm. */
export function createScaleEngine(): ScaleEngine {
  return new ScaleEngineImplementation();
}
