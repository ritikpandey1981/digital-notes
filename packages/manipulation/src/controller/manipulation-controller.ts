import type { PagePoint } from "@folio/selection";
import type { PageObject } from "@folio/document";
import type {
  ManipulationController,
  ManipulationControllerOptions,
  ManipulationResultControllerOptions,
} from "../interfaces/manipulation-controller";
import type { ManipulationChangeListener } from "../interfaces/manipulation-manager";
import type {
  ManipulationCommit,
  ManipulationKind,
  ManipulationPointerInput,
  ManipulationResult,
  ManipulationState,
} from "../model/types";
import { createManipulationResult } from "../result/manipulation-result";
import { createLegacyManipulationCommit } from "../result/translation-manipulation-result";

type ManipulationControllerConstructionOptions =
  ManipulationControllerOptions | ManipulationResultControllerOptions;

type ManipulationCompletion = ManipulationCommit | ManipulationResult;

class ManipulationControllerImplementation implements ManipulationController<ManipulationCompletion> {
  private destroyed = false;

  constructor(private readonly options: ManipulationControllerConstructionOptions) {}

  handlePointer(input: ManipulationPointerInput): ManipulationCompletion | null {
    if (this.destroyed) return null;
    if (input.phase === "cancel") {
      this.cancelManipulation(input.pointerId);
      return null;
    }
    if (!input.isPrimary) return null;
    if (input.phase === "down") {
      if (input.button === 0 && input.position !== null) {
        this.beginManipulation(input.pointerId, input.position, input.kind);
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

  beginManipulation(
    pointerId: number,
    position: PagePoint,
    kind: ManipulationKind = "translation",
  ): ManipulationState {
    if (this.destroyed || this.options.manager.hasActiveSession()) {
      return this.options.manager.getState();
    }
    const selection = this.options.selectionSource.getSelection();
    const objectId = selection.selectedObjectId;
    if (objectId === null) return this.options.manager.getState();
    const object = this.resolveManipulableObject(objectId);
    if (object === undefined) return this.options.manager.getState();
    const objectCenter: PagePoint = Object.freeze({
      x: object.bounds.x + object.bounds.width / 2,
      y: object.bounds.y + object.bounds.height / 2,
      coordinateSpace: "page",
    });
    if (
      kind !== "translation" &&
      Math.hypot(position.x - objectCenter.x, position.y - objectCenter.y) <= 1e-6
    ) {
      return this.options.manager.getState();
    }
    return this.options.manager.beginSession({
      kind,
      objectId,
      pointerId,
      position,
      initialObjectTranslation: object.transform.translation,
      initialObjectRotation: object.transform.rotation,
      initialObjectScale: object.transform.scale,
      objectCenter,
    });
  }

  updateManipulation(pointerId: number, position: PagePoint): ManipulationState {
    const state = this.options.manager.getState();
    if (this.destroyed || state.pointerId !== pointerId) return state;
    if (state.objectId === null || this.resolveManipulableObject(state.objectId) === undefined) {
      return this.options.manager.cancelSession();
    }
    return this.options.manager.updateSession(position);
  }

  commitManipulation(pointerId: number, position?: PagePoint): ManipulationCompletion | null {
    let state = this.options.manager.getState();
    if (this.destroyed || state.pointerId !== pointerId) return null;
    if (position !== undefined) state = this.updateManipulation(pointerId, position);
    if (state.phase !== "dragging" || state.objectId === null) {
      this.options.manager.cancelSession();
      return null;
    }
    if (this.resolveManipulableObject(state.objectId) === undefined) {
      this.options.manager.cancelSession();
      return null;
    }
    const result = createManipulationResult(state);
    if (result === null) {
      this.options.manager.cancelSession();
      return null;
    }
    let submittedCommit: ManipulationCompletion;
    try {
      const submission = this.submitResult(result);
      if (!submission.accepted) {
        this.options.manager.cancelSession();
        return null;
      }
      submittedCommit = submission.commit;
    } catch (cause) {
      this.options.manager.cancelSession();
      const error = cause instanceof Error ? cause : new Error("Manipulation commit failed.");
      this.options.onError?.(error);
      return null;
    }
    this.options.manager.commitSession();
    return submittedCommit;
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

  private resolveManipulableObject(objectId: string): PageObject | undefined {
    if (this.options.selectionSource.getSelection().selectedObjectId !== objectId) return undefined;
    const object = this.options.objectSource.getObject(objectId);
    return object !== undefined && object.visible && !object.locked ? object : undefined;
  }

  private submitResult(
    result: ManipulationResult,
  ): Readonly<{ accepted: boolean; commit: ManipulationCompletion }> {
    if ("onResult" in this.options) {
      return Object.freeze({ accepted: this.options.onResult(result), commit: result });
    }
    if (result.kind !== "translation") {
      throw new TypeError("Rotation and scale require the generalized onResult boundary.");
    }
    const commit = createLegacyManipulationCommit(result);
    return Object.freeze({ accepted: this.options.onCommit(commit), commit });
  }
}

/** Composes selection, document queries, session transitions, and commit decisions. */
export function createManipulationController(
  options: ManipulationControllerOptions,
): ManipulationController;
export function createManipulationController(
  options: ManipulationResultControllerOptions,
): ManipulationController<ManipulationResult>;
export function createManipulationController(
  options: ManipulationControllerConstructionOptions,
): ManipulationController<ManipulationCompletion> {
  return new ManipulationControllerImplementation(options);
}
