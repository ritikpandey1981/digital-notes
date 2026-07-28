import type { ManipulationState, ScaleManipulationResult } from "../model/types";

/** Builds Scale's immutable result at the interaction/editor boundary. */
export function createScaleManipulationResult(
  state: ManipulationState,
): ScaleManipulationResult | null {
  if (
    state.kind !== "scale" ||
    state.phase !== "dragging" ||
    state.sessionId === null ||
    state.objectId === null ||
    state.initialObjectScale === null ||
    state.finalObjectScale === null ||
    state.sessionTimestamp === null ||
    state.initialObjectScale === state.finalObjectScale
  ) {
    return null;
  }
  return Object.freeze({
    kind: "scale",
    sessionId: state.sessionId,
    objectId: state.objectId,
    scale: state.scale,
    initialObjectScale: state.initialObjectScale,
    finalObjectScale: state.finalObjectScale,
    sessionTimestamp: state.sessionTimestamp,
  });
}
