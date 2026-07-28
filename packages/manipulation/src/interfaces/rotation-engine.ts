import type { PagePoint } from "@folio/selection";
import type { RotationModel } from "../model/types";

/** Deterministic origin-relative angular calculation around an object center. */
export interface RotationEngine {
  calculate(center: PagePoint, origin: PagePoint, current: PagePoint): RotationModel;
}
