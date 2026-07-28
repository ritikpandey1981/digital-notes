import type { PagePoint } from "@folio/selection";
import type { RotationEngine } from "./rotation-engine";
import type { ScaleEngine } from "./scale-engine";
import type { TranslationEngine } from "./translation-engine";
import type {
  BeginManipulationInput,
  ManipulationConfiguration,
  ManipulationState,
} from "../model/types";

/** Receives immutable state only when the session state logically changes. */
export type ManipulationChangeListener = (
  state: ManipulationState,
  previousState: ManipulationState,
) => void;

/** Sole owner of the active manipulation session and its explicit transitions. */
export interface ManipulationManager {
  /** Creates a Preparing session unless another session already owns interaction. */
  beginSession(input: BeginManipulationInput): ManipulationState;
  /** Recalculates translation from the immutable drag origin. */
  updateSession(position: PagePoint): ManipulationState;
  /** Performs Dragging -> Committing -> Idle. */
  commitSession(): ManipulationState;
  /** Performs Preparing/Dragging -> Cancelling -> Idle. */
  cancelSession(): ManipulationState;
  /** Returns the current immutable state reference. */
  getState(): ManipulationState;
  /** Reports whether a Preparing or Dragging session owns interaction. */
  hasActiveSession(): boolean;
  /** Subscribes to state transitions and returns an idempotent unsubscribe function. */
  subscribe(listener: ManipulationChangeListener): () => void;
}

/** Injectable construction dependencies for an isolated manager. */
export interface ManipulationManagerOptions {
  readonly configuration?: Partial<ManipulationConfiguration>;
  readonly translationEngine?: TranslationEngine;
  readonly rotationEngine?: RotationEngine;
  readonly scaleEngine?: ScaleEngine;
  readonly createSessionId?: () => string;
  readonly now?: () => number;
}
