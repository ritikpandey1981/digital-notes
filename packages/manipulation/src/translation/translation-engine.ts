import type { PagePoint } from "@folio/selection";
import type { TranslationEngine } from "../interfaces/translation-engine";
import type { TranslationModel } from "../model/types";

class TranslationEngineImplementation implements TranslationEngine {
  calculate(origin: PagePoint, current: PagePoint): TranslationModel {
    const translationX = current.x - origin.x;
    const translationY = current.y - origin.y;
    return Object.freeze({
      translationX,
      translationY,
      totalDistance: Math.hypot(translationX, translationY),
      movementVector: Object.freeze({ x: translationX, y: translationY }),
    });
  }
}

/** Creates the deterministic origin-relative translation algorithm. */
export function createTranslationEngine(): TranslationEngine {
  return new TranslationEngineImplementation();
}
