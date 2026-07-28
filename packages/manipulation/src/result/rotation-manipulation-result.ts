import type { ManipulationState, RotationManipulationResult } from "../model/types";

/** Builds Rotation's immutable result at the interaction/editor boundary. */
export function createRotationManipulationResult(
  state: ManipulationState,
): RotationManipulationResult | null {
  if (
    state.kind !== "rotation" ||
    state.phase !== "dragging" ||
    state.sessionId === null ||
    state.objectId === null ||
    state.initialObjectRotation === null ||
    state.finalObjectRotation === null ||
    state.sessionTimestamp === null ||
    state.initialObjectRotation === state.finalObjectRotation
  ) {
    return null;
  }
  return Object.freeze({
    kind: "rotation",
    sessionId: state.sessionId,
    objectId: state.objectId,
    rotation: state.rotation,
    initialObjectRotation: state.initialObjectRotation,
    finalObjectRotation: state.finalObjectRotation,
    sessionTimestamp: state.sessionTimestamp,
  });
}
