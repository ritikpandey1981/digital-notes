import type { PagePoint } from "@folio/selection";
import type {
  ManipulationPhase,
  ManipulationState,
  TranslationModel,
  TranslationVector,
} from "../model/types";

export const ZERO_TRANSLATION: TranslationModel = Object.freeze({
  translationX: 0,
  translationY: 0,
  totalDistance: 0,
  movementVector: Object.freeze({ x: 0, y: 0 }),
});

export function freezePagePoint(point: PagePoint): PagePoint {
  if (point.coordinateSpace !== "page" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Manipulation positions must be finite page-space points.");
  }
  return Object.freeze({ x: point.x, y: point.y, coordinateSpace: "page" });
}

export function freezeVector(vector: TranslationVector): TranslationVector {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new RangeError("Manipulation translations must contain finite coordinates.");
  }
  return Object.freeze({ x: vector.x, y: vector.y });
}

export function createIdleState(version: number): ManipulationState {
  return Object.freeze({
    phase: "idle",
    sessionId: null,
    objectId: null,
    pointerId: null,
    dragOrigin: null,
    currentPointerPosition: null,
    initialObjectTranslation: null,
    translation: ZERO_TRANSLATION,
    finalObjectTranslation: null,
    sessionTimestamp: null,
    version,
  });
}

export function createActiveState(input: {
  readonly phase: Exclude<ManipulationPhase, "idle">;
  readonly sessionId: string;
  readonly objectId: string;
  readonly pointerId: number;
  readonly dragOrigin: PagePoint;
  readonly currentPointerPosition: PagePoint;
  readonly initialObjectTranslation: TranslationVector;
  readonly translation: TranslationModel;
  readonly sessionTimestamp: number;
  readonly version: number;
}): ManipulationState {
  return Object.freeze({
    ...input,
    finalObjectTranslation: Object.freeze({
      x: input.initialObjectTranslation.x + input.translation.translationX,
      y: input.initialObjectTranslation.y + input.translation.translationY,
    }),
  });
}
