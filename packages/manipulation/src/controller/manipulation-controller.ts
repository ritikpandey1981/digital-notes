import type { PagePoint } from "@folio/selection";
import type {
  ManipulationController,
  ManipulationControllerOptions,
} from "../interfaces/manipulation-controller";
import type { ManipulationChangeListener } from "../interfaces/manipulation-manager";
import type {
  ManipulationCommit,
  ManipulationPointerInput,
  ManipulationState,
} from "../model/types";

function createCommit(state: ManipulationState): ManipulationCommit | null {
  if (
    state.phase !== "dragging" ||
    state.sessionId === null ||
    state.objectId === null ||
    state.initialObjectTranslation === null ||
    state.finalObjectTranslation === null ||
    state.sessionTimestamp === null
  ) {
    return null;
  }
  return Object.freeze({
    sessionId: state.sessionId,
    objectId: state.objectId,
    translation: state.translation,
    initialObjectTranslation: state.initialObjectTranslation,
    finalObjectTranslation: state.finalObjectTranslation,
    sessionTimestamp: state.sessionTimestamp,
  });
}

class ManipulationControllerImplementation implements ManipulationController {
  private destroyed = false;

  constructor(private readonly options: ManipulationControllerOptions) {}

  handlePointer(input: ManipulationPointerInput): ManipulationCommit | null {
    if (this.destroyed) return null;
    if (input.phase === "cancel") {
      this.cancelManipulation(input.pointerId);
      return null;
    }
    if (!input.isPrimary) return null;
    if (input.phase === "down") {
      if (input.button === 0 && input.position !== null) {
        this.beginManipulation(input.pointerId, input.position);
      }
      return null;
    }
    const state = this.options.manager.getState();
    if (state.pointerId !== input.pointerId) return null;
    if (input.phase === "move") {
      if (input.position !== null) this.updateManipulation(input.pointerId, input.position);
      return null;
    }
    return this.commitManipulation(input.pointerId, input.position ?? undefined);
  }

  beginManipulation(pointerId: number, position: PagePoint): ManipulationState {
    if (this.destroyed || this.options.manager.hasActiveSession()) {
      return this.options.manager.getState();
    }
    const selection = this.options.selectionSource.getSelection();
    const objectId = selection.selectedObjectId;
    if (objectId === null) return this.options.manager.getState();
    const object = this.options.objectSource.getObject(objectId);
    if (object === undefined || !object.visible || object.locked) {
      return this.options.manager.getState();
    }
    return this.options.manager.beginSession({
      objectId,
      pointerId,
      position,
      initialObjectTranslation: object.transform.translation,
    });
  }

  updateManipulation(pointerId: number, position: PagePoint): ManipulationState {
    const state = this.options.manager.getState();
    if (this.destroyed || state.pointerId !== pointerId) return state;
    if (
      state.objectId === null ||
      this.options.objectSource.getObject(state.objectId) === undefined
    ) {
      return this.options.manager.cancelSession();
    }
    return this.options.manager.updateSession(position);
  }

  commitManipulation(pointerId: number, position?: PagePoint): ManipulationCommit | null {
    let state = this.options.manager.getState();
    if (this.destroyed || state.pointerId !== pointerId) return null;
    if (position !== undefined) state = this.updateManipulation(pointerId, position);
    if (state.phase !== "dragging" || state.objectId === null) {
      this.options.manager.cancelSession();
      return null;
    }
    const selection = this.options.selectionSource.getSelection();
    const object = this.options.objectSource.getObject(state.objectId);
    if (selection.selectedObjectId !== state.objectId || object === undefined || object.locked) {
      this.options.manager.cancelSession();
      return null;
    }
    const commit = createCommit(state);
    if (commit === null) {
      this.options.manager.cancelSession();
      return null;
    }
    try {
      if (!this.options.onCommit(commit)) {
        this.options.manager.cancelSession();
        return null;
      }
    } catch (cause) {
      this.options.manager.cancelSession();
      const error = cause instanceof Error ? cause : new Error("Manipulation commit failed.");
      this.options.onError?.(error);
      return null;
    }
    this.options.manager.commitSession();
    return commit;
  }

  cancelManipulation(pointerId?: number): ManipulationState {
    const state = this.options.manager.getState();
    if (pointerId !== undefined && state.pointerId !== pointerId) return state;
    return this.options.manager.cancelSession();
  }

  hasActiveSession(): boolean {
    return !this.destroyed && this.options.manager.hasActiveSession();
  }

  getManipulationState(): ManipulationState {
    return this.options.manager.getState();
  }

  subscribe(listener: ManipulationChangeListener): () => void {
    if (this.destroyed) return () => undefined;
    return this.options.manager.subscribe(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.options.manager.cancelSession();
    this.destroyed = true;
  }
}

/** Composes selection, document queries, session transitions, and commit decisions. */
export function createManipulationController(
  options: ManipulationControllerOptions,
): ManipulationController {
  return new ManipulationControllerImplementation(options);
}
