import type { PagePoint } from "@folio/selection";
import type { ManipulationManager, ManipulationChangeListener } from "./manipulation-manager";
import type {
  ManipulationCommit,
  ManipulationObjectSource,
  ManipulationPointerInput,
  ManipulationSelectionSource,
  ManipulationState,
} from "../model/types";

/** Editor-facing coordinator for normalized pointer manipulation. */
export interface ManipulationController {
  /** Interprets one normalized pointer event without browser dependencies. */
  handlePointer(input: ManipulationPointerInput): ManipulationCommit | null;
  /** Starts a session for the currently selected valid object. */
  beginManipulation(pointerId: number, position: PagePoint): ManipulationState;
  /** Updates the active session using an absolute page-space pointer position. */
  updateManipulation(pointerId: number, position: PagePoint): ManipulationState;
  /** Commits a valid Dragging session through the injected editor callback. */
  commitManipulation(pointerId: number, position?: PagePoint): ManipulationCommit | null;
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

/** Construction dependencies supplied by the Editor composition boundary. */
export interface ManipulationControllerOptions {
  readonly manager: ManipulationManager;
  readonly selectionSource: ManipulationSelectionSource;
  readonly objectSource: ManipulationObjectSource;
  readonly onCommit: (commit: ManipulationCommit) => boolean;
  readonly onError?: (error: Error) => void;
}
