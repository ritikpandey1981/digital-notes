import type { PagePoint } from "@folio/selection";
import type { RotationEngine } from "../interfaces/rotation-engine";
import type { ScaleEngine } from "../interfaces/scale-engine";
import type { TranslationEngine } from "../interfaces/translation-engine";
import type { ManipulationSession } from "../interfaces/manipulation-session";
import type { BeginManipulationInput, ManipulationState } from "../model/types";
import {
  ZERO_TRANSLATION,
  IDENTITY_SCALE,
  ZERO_ROTATION,
  createActiveState,
  freezePagePoint,
  freezeVector,
} from "../state/manipulation-state";

interface ManipulationSessionOptions extends BeginManipulationInput {
  readonly sessionId: string;
  readonly timestamp: number;
  readonly initialVersion: number;
  readonly dragThreshold: number;
  readonly minimumScale: number;
  readonly maximumScale: number;
  readonly translationEngine: TranslationEngine;
  readonly rotationEngine: RotationEngine;
  readonly scaleEngine: ScaleEngine;
}

/** Private state machine for one continuous manipulation interaction. */
export class ManipulationSessionImplementation implements ManipulationSession {
  private stateValue: ManipulationState;
  private readonly dragThreshold: number;
  private readonly translationEngine: TranslationEngine;
  private readonly rotationEngine: RotationEngine;
  private readonly scaleEngine: ScaleEngine;
  private readonly minimumScale: number;
  private readonly maximumScale: number;

  constructor(options: ManipulationSessionOptions) {
    const origin = freezePagePoint(options.position);
    const initialObjectTranslation = freezeVector(options.initialObjectTranslation);
    this.dragThreshold = options.dragThreshold;
    this.translationEngine = options.translationEngine;
    this.rotationEngine = options.rotationEngine;
    this.scaleEngine = options.scaleEngine;
    this.minimumScale = options.minimumScale;
    this.maximumScale = options.maximumScale;
    const objectCenter = freezePagePoint(options.objectCenter ?? options.position);
    const initialObjectRotation = options.initialObjectRotation ?? 0;
    const initialObjectScale = options.initialObjectScale ?? 1;
    this.stateValue = createActiveState({
      kind: options.kind ?? "translation",
      phase: "preparing",
      sessionId: options.sessionId,
      objectId: options.objectId,
      pointerId: options.pointerId,
      dragOrigin: origin,
      currentPointerPosition: origin,
      objectCenter,
      initialObjectTranslation,
      translation: ZERO_TRANSLATION,
      initialObjectRotation,
      rotation: ZERO_ROTATION,
      initialObjectScale,
      scale: IDENTITY_SCALE,
      sessionTimestamp: options.timestamp,
      version: options.initialVersion,
    });
  }

  get state(): ManipulationState {
    return this.stateValue;
  }

  update(position: PagePoint): ManipulationState {
    if (this.stateValue.phase !== "preparing" && this.stateValue.phase !== "dragging") {
      return this.stateValue;
    }
    const current = freezePagePoint(position);
    const previousPointer = this.stateValue.currentPointerPosition;
    if (previousPointer?.x === current.x && previousPointer.y === current.y) return this.stateValue;
    const origin = this.stateValue.dragOrigin;
    const initialObjectTranslation = this.stateValue.initialObjectTranslation;
    const objectCenter = this.stateValue.objectCenter;
    const initialObjectRotation = this.stateValue.initialObjectRotation;
    const initialObjectScale = this.stateValue.initialObjectScale;
    if (
      origin === null ||
      initialObjectTranslation === null ||
      objectCenter === null ||
      initialObjectRotation === null ||
      initialObjectScale === null ||
      this.stateValue.kind === null
    ) {
      return this.stateValue;
    }
    const translation = this.translationEngine.calculate(origin, current);
    const rotation =
      this.stateValue.kind === "rotation"
        ? this.rotationEngine.calculate(objectCenter, origin, current)
        : ZERO_ROTATION;
    const rawScale =
      this.stateValue.kind === "scale"
        ? this.scaleEngine.calculate(objectCenter, origin, current)
        : IDENTITY_SCALE;
    const finalScale = Math.min(
      this.maximumScale,
      Math.max(this.minimumScale, initialObjectScale * rawScale.factor),
    );
    const scale =
      this.stateValue.kind === "scale"
        ? Object.freeze({ factor: finalScale / initialObjectScale })
        : IDENTITY_SCALE;
    const phase =
      this.stateValue.phase === "dragging" || translation.totalDistance > this.dragThreshold
        ? "dragging"
        : "preparing";
    this.stateValue = createActiveState({
      kind: this.stateValue.kind,
      phase,
      sessionId: this.stateValue.sessionId!,
      objectId: this.stateValue.objectId!,
      pointerId: this.stateValue.pointerId!,
      dragOrigin: origin,
      currentPointerPosition: current,
      objectCenter,
      initialObjectTranslation,
      translation,
      initialObjectRotation,
      rotation,
      initialObjectScale,
      scale,
      sessionTimestamp: this.stateValue.sessionTimestamp!,
      version: this.stateValue.version + 1,
    });
    return this.stateValue;
  }

  transitionTo(phase: "committing" | "cancelling"): ManipulationState {
    const current = this.stateValue;
    const allowed =
      phase === "committing"
        ? current.phase === "dragging"
        : current.phase === "preparing" || current.phase === "dragging";
    if (!allowed) return current;
    this.stateValue = createActiveState({
      kind: current.kind!,
      phase,
      sessionId: current.sessionId!,
      objectId: current.objectId!,
      pointerId: current.pointerId!,
      dragOrigin: current.dragOrigin!,
      currentPointerPosition: current.currentPointerPosition!,
      objectCenter: current.objectCenter!,
      initialObjectTranslation: current.initialObjectTranslation!,
      translation: current.translation,
      initialObjectRotation: current.initialObjectRotation!,
      rotation: current.rotation,
      initialObjectScale: current.initialObjectScale!,
      scale: current.scale,
      sessionTimestamp: current.sessionTimestamp!,
      version: current.version + 1,
    });
    return this.stateValue;
  }
}
