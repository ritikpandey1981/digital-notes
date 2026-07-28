import type { PagePoint } from "@folio/selection";
import type {
  ManipulationKind,
  ManipulationPhase,
  ManipulationState,
  RotationModel,
  ScaleModel,
  TranslationModel,
  TranslationVector,
} from "../model/types";

export const ZERO_TRANSLATION: TranslationModel = Object.freeze({
  translationX: 0,
  translationY: 0,
  totalDistance: 0,
  movementVector: Object.freeze({ x: 0, y: 0 }),
});

export const ZERO_ROTATION: RotationModel = Object.freeze({ deltaRadians: 0 });
export const IDENTITY_SCALE: ScaleModel = Object.freeze({ factor: 1 });

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
    kind: null,
    phase: "idle",
    sessionId: null,
    objectId: null,
    pointerId: null,
    dragOrigin: null,
    currentPointerPosition: null,
    objectCenter: null,
    initialObjectTranslation: null,
    translation: ZERO_TRANSLATION,
    finalObjectTranslation: null,
    initialObjectRotation: null,
    rotation: ZERO_ROTATION,
    finalObjectRotation: null,
    initialObjectScale: null,
    scale: IDENTITY_SCALE,
    finalObjectScale: null,
    sessionTimestamp: null,
    version,
  });
}

export function createActiveState(input: {
  readonly kind: ManipulationKind;
  readonly phase: Exclude<ManipulationPhase, "idle">;
  readonly sessionId: string;
  readonly objectId: string;
  readonly pointerId: number;
  readonly dragOrigin: PagePoint;
  readonly currentPointerPosition: PagePoint;
  readonly objectCenter: PagePoint;
  readonly initialObjectTranslation: TranslationVector;
  readonly translation: TranslationModel;
  readonly initialObjectRotation: number;
  readonly rotation: RotationModel;
  readonly initialObjectScale: number;
  readonly scale: ScaleModel;
  readonly sessionTimestamp: number;
  readonly version: number;
}): ManipulationState {
  const finalObjectTranslation =
    input.kind === "translation"
      ? Object.freeze({
          x: input.initialObjectTranslation.x + input.translation.translationX,
          y: input.initialObjectTranslation.y + input.translation.translationY,
        })
      : input.initialObjectTranslation;
  return Object.freeze({
    ...input,
    finalObjectTranslation,
    finalObjectRotation:
      input.kind === "rotation"
        ? input.initialObjectRotation + input.rotation.deltaRadians
        : input.initialObjectRotation,
    finalObjectScale:
      input.kind === "scale"
        ? input.initialObjectScale * input.scale.factor
        : input.initialObjectScale,
  });
}
