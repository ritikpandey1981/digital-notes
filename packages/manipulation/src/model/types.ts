import type { PageObject } from "@folio/document";
import type { PagePoint, SelectionState } from "@folio/selection";

/** Explicit phases in one deterministic manipulation session. */
export type ManipulationPhase = "idle" | "preparing" | "dragging" | "committing" | "cancelling";

/** Discriminator for an immutable result emitted by a concrete manipulation. */
export type ManipulationKind = "translation" | "rotation" | "scale";

/** Discriminator for every transform or object-lifecycle result. */
export type ManipulationResultKind = ManipulationKind | "delete" | "duplicate";

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

/** Origin-relative angular change expressed in radians. */
export interface RotationModel {
  readonly deltaRadians: number;
}

/** Origin-relative uniform scale multiplier. */
export interface ScaleModel {
  readonly factor: number;
}

/** Session-only identity and translation state. It never owns a document object. */
export interface ManipulationState {
  readonly kind: ManipulationKind | null;
  readonly phase: ManipulationPhase;
  readonly sessionId: string | null;
  readonly objectId: string | null;
  readonly pointerId: number | null;
  readonly dragOrigin: PagePoint | null;
  readonly currentPointerPosition: PagePoint | null;
  readonly objectCenter: PagePoint | null;
  readonly initialObjectTranslation: TranslationVector | null;
  readonly translation: TranslationModel;
  readonly finalObjectTranslation: TranslationVector | null;
  readonly initialObjectRotation: number | null;
  readonly rotation: RotationModel;
  readonly finalObjectRotation: number | null;
  readonly initialObjectScale: number | null;
  readonly scale: ScaleModel;
  readonly finalObjectScale: number | null;
  readonly sessionTimestamp: number | null;
  readonly version: number;
}

/** Page-space data required to start one manipulation session. */
export interface BeginManipulationInput {
  readonly kind?: ManipulationKind;
  readonly objectId: string;
  readonly pointerId: number;
  readonly position: PagePoint;
  readonly initialObjectTranslation: TranslationVector;
  readonly initialObjectRotation?: number;
  readonly initialObjectScale?: number;
  readonly objectCenter?: PagePoint;
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

/** Common identity carried by every immutable manipulation result. */
export interface ManipulationResultBase<
  TKind extends ManipulationResultKind = ManipulationResultKind,
> {
  readonly kind: TKind;
  readonly sessionId: string;
  readonly objectId: string;
  readonly sessionTimestamp: number;
}

/** Translation's concrete result; it preserves the Phase 10 commit payload. */
export interface TranslationManipulationResult
  extends ManipulationCommit, ManipulationResultBase<"translation"> {}

/** Immutable logical result of one completed rotation interaction. */
export interface RotationManipulationResult extends ManipulationResultBase<"rotation"> {
  readonly rotation: RotationModel;
  readonly initialObjectRotation: number;
  readonly finalObjectRotation: number;
}

/** Immutable logical result of one completed uniform-scale interaction. */
export interface ScaleManipulationResult extends ManipulationResultBase<"scale"> {
  readonly scale: ScaleModel;
  readonly initialObjectScale: number;
  readonly finalObjectScale: number;
}

/** Immutable logical request to delete one selected object. */
export type DeleteManipulationResult = ManipulationResultBase<"delete">;

/** Immutable logical request to duplicate one selected object. */
export type DuplicateManipulationResult = ManipulationResultBase<"duplicate">;

/**
 * Editor-facing result union for completed manipulations.
 *
 * Future manipulation phases extend this union with another discriminated,
 * immutable result. They do not add History or editor concerns here.
 */
export type ManipulationResult =
  | TranslationManipulationResult
  | RotationManipulationResult
  | ScaleManipulationResult
  | DeleteManipulationResult
  | DuplicateManipulationResult;

/** Centralized page-space tuning for manipulation sessions. */
export interface ManipulationConfiguration {
  readonly dragThreshold: number;
  readonly minimumScale: number;
  readonly maximumScale: number;
}

/** Frozen default configuration shared by all factory-created managers. */
export const DEFAULT_MANIPULATION_CONFIGURATION: ManipulationConfiguration = Object.freeze({
  dragThreshold: 4,
  minimumScale: 0.05,
  maximumScale: 20,
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
  readonly kind?: ManipulationKind;
  readonly phase: ManipulationPointerPhase;
  readonly pointerId: number;
  readonly button: number;
  readonly isPrimary: boolean;
  readonly position: PagePoint | null;
}
