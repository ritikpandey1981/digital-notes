import type { ManipulationResult, ManipulationState } from "../model/types";
import { createRotationManipulationResult } from "./rotation-manipulation-result";
import { createScaleManipulationResult } from "./scale-manipulation-result";
import { createTranslationManipulationResult } from "./translation-manipulation-result";

/** Exhaustively constructs the immutable result for the active concrete interaction. */
export function createManipulationResult(state: ManipulationState): ManipulationResult | null {
  switch (state.kind) {
    case "translation":
      return createTranslationManipulationResult(state);
    case "rotation":
      return createRotationManipulationResult(state);
    case "scale":
      return createScaleManipulationResult(state);
    case null:
      return null;
  }
}
