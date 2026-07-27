import type { PageObject } from "@folio/document";
import type { PagePoint, SelectionState } from "@folio/selection";

/** Explicit phases in one deterministic manipulation session. */
export type ManipulationPhase = "idle" | "preparing" | "dragging" | "committing" | "cancelling";

/** Logical page-space vector with no viewport or rendering information. */
export interface TranslationVector {
  readonly x: number;
  readonly y: number;
}

/** Immutable translation calculated from the initial and current pointer positions. */
export interface TranslationModel {
  readonly translationX: number;
  readonly translationY: number;
  readonly totalDistance: number;
  readonly movementVector: TranslationVector;
}

/** Session-only identity and translation state. It never owns a document object. */
export interface ManipulationState {
  readonly phase: ManipulationPhase;
  readonly sessionId: string | null;
  readonly objectId: string | null;
  readonly pointerId: number | null;
  readonly dragOrigin: PagePoint | null;
  readonly currentPointerPosition: PagePoint | null;
  readonly initialObjectTranslation: TranslationVector | null;
  readonly translation: TranslationModel;
  readonly finalObjectTranslation: TranslationVector | null;
  readonly sessionTimestamp: number | null;
  readonly version: number;
}

/** Page-space data required to start one manipulation session. */
export interface BeginManipulationInput {
  readonly objectId: string;
  readonly pointerId: number;
  readonly position: PagePoint;
  readonly initialObjectTranslation: TranslationVector;
}

/** Immutable request accepted by the editor before a session commits. */
export interface ManipulationCommit {
  readonly sessionId: string;
  readonly objectId: string;
  readonly translation: TranslationModel;
  readonly initialObjectTranslation: TranslationVector;
  readonly finalObjectTranslation: TranslationVector;
  readonly sessionTimestamp: number;
}

/** Centralized page-space tuning for manipulation sessions. */
export interface ManipulationConfiguration {
  readonly dragThreshold: number;
}

/** Frozen default configuration shared by all factory-created managers. */
export const DEFAULT_MANIPULATION_CONFIGURATION: ManipulationConfiguration = Object.freeze({
  dragThreshold: 4,
});

/** Read-only access to the current Selection package state. */
export interface ManipulationSelectionSource {
  getSelection(): SelectionState;
}

/** Read-only access to canonical immutable document objects. */
export interface ManipulationObjectSource {
  getObject(objectId: string): PageObject | undefined;
}

/** Normalized pointer phases accepted without browser event dependencies. */
export type ManipulationPointerPhase = "down" | "move" | "up" | "cancel";

/** Editor-normalized pointer input expressed only in page coordinates. */
export interface ManipulationPointerInput {
  readonly phase: ManipulationPointerPhase;
  readonly pointerId: number;
  readonly button: number;
  readonly isPrimary: boolean;
  readonly position: PagePoint | null;
}
