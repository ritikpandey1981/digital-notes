import type { PagePoint } from "@folio/selection";
import type { ScaleModel } from "../model/types";

/** Deterministic origin-relative radial scale calculation around an object center. */
export interface ScaleEngine {
  calculate(center: PagePoint, origin: PagePoint, current: PagePoint): ScaleModel;
}
