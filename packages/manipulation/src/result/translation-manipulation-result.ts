import type {
  ManipulationCommit,
  ManipulationState,
  TranslationManipulationResult,
} from "../model/types";

/** Builds Translation's immutable result at the interaction/editor boundary. */
export function createTranslationManipulationResult(
  state: ManipulationState,
): TranslationManipulationResult | null {
  if (
    state.kind !== "translation" ||
    state.phase !== "dragging" ||
    state.sessionId === null ||
    state.objectId === null ||
    state.initialObjectTranslation === null ||
    state.finalObjectTranslation === null ||
    state.sessionTimestamp === null
  ) {
    return null;
  }
  return Object.freeze({
    kind: "translation",
    sessionId: state.sessionId,
    objectId: state.objectId,
    translation: state.translation,
    initialObjectTranslation: state.initialObjectTranslation,
    finalObjectTranslation: state.finalObjectTranslation,
    sessionTimestamp: state.sessionTimestamp,
  });
}

/** Preserves the pre-Phase-12 callback and return-value shape. */
export function createLegacyManipulationCommit(
  result: TranslationManipulationResult,
): ManipulationCommit {
  return Object.freeze({
    sessionId: result.sessionId,
    objectId: result.objectId,
    translation: result.translation,
    initialObjectTranslation: result.initialObjectTranslation,
    finalObjectTranslation: result.finalObjectTranslation,
    sessionTimestamp: result.sessionTimestamp,
  });
}
