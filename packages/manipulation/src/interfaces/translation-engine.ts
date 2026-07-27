import type { PagePoint } from "@folio/selection";
import type { TranslationModel } from "../model/types";

/** Replaceable, deterministic page-space translation algorithm. */
export interface TranslationEngine {
  /** Calculates movement directly from origin to current position. */
  calculate(origin: PagePoint, current: PagePoint): TranslationModel;
}
