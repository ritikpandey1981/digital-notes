import type { PagePoint } from "@folio/selection";
import type { ManipulationManager, ManipulationChangeListener } from "./manipulation-manager";
import type {
  ManipulationCommit,
  ManipulationObjectSource,
  ManipulationPointerInput,
  ManipulationResult,
  ManipulationSelectionSource,
  ManipulationState,
} from "../model/types";

/** Editor-facing coordinator for normalized pointer manipulation. */
export interface ManipulationController<
  TCompletion extends ManipulationCommit | ManipulationResult = ManipulationCommit,
> {
  /** Interprets one normalized pointer event without browser dependencies. */
  handlePointer(input: ManipulationPointerInput): TCompletion | null;
  /** Starts a session for the currently selected valid object. */
  beginManipulation(
    pointerId: number,
    position: PagePoint,
    kind?: import("../model/types").ManipulationKind,
  ): ManipulationState;
  /** Updates the active session using an absolute page-space pointer position. */
  updateManipulation(pointerId: number, position: PagePoint): ManipulationState;
  /** Commits a valid Dragging session through the injected editor callback. */
  commitManipulation(pointerId: number, position?: PagePoint): TCompletion | null;
  /** Cancels the owned session, optionally validating pointer ownership. */
  cancelManipulation(pointerId?: number): ManipulationState;
  /** Reports whether this controller currently owns a session. */
  hasActiveSession(): boolean;
  /** Returns the manager's current immutable state. */
  getManipulationState(): ManipulationState;
  /** Subscribes to logical preview/session changes. */
  subscribe(listener: ManipulationChangeListener): () => void;
  /** Cancels interaction and permanently releases the controller. */
  destroy(): void;
}

/** Construction dependencies retained for source-compatible Phase 10 callers. */
export interface ManipulationControllerOptions {
  readonly manager: ManipulationManager;
  readonly selectionSource: ManipulationSelectionSource;
  readonly objectSource: ManipulationObjectSource;
  readonly onCommit: (commit: ManipulationCommit) => boolean;
  readonly onError?: (error: Error) => void;
}

/**
 * Generalized construction boundary used by new editor composition.
 * Existing callers keep using `ManipulationControllerOptions` unchanged.
 */
export interface ManipulationResultControllerOptions {
  readonly manager: ManipulationManager;
  readonly selectionSource: ManipulationSelectionSource;
  readonly objectSource: ManipulationObjectSource;
  readonly onResult: (result: ManipulationResult) => boolean;
  readonly onError?: (error: Error) => void;
}
