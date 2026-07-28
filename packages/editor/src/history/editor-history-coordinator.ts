import { InkObject, type ObjectCollection } from "@folio/document";
import {
  createEditorHistoryManager,
  createHistoryController,
  type HistoryListener,
  type HistoryNotification,
  type IHistoryController,
  type IHistoryState,
} from "@folio/history";
import type { ManipulationCommit } from "@folio/manipulation";
import type { InkDocumentSession } from "../InkDocumentSession";
import { createMoveCommand } from "./move-command";

interface EditorHistoryCoordinatorOptions {
  readonly documentSession: InkDocumentSession;
  readonly historyLimit?: number;
  readonly now?: () => string;
  readonly onDocumentChange: (
    document: ObjectCollection,
    notification: HistoryNotification & { readonly outcome: "succeeded" },
  ) => void;
  readonly onHistoryChange?: HistoryListener;
  readonly onError?: (error: Error) => void;
}

/** Package-private editor boundary around one manager/controller lifetime. */
export interface EditorHistoryCoordinator {
  readonly controller: IHistoryController<ObjectCollection>;
  readonly commitMove: (commit: ManipulationCommit) => IHistoryState;
  readonly undo: () => IHistoryState;
  readonly redo: () => IHistoryState;
  readonly destroy: () => void;
}

class EditorHistoryCoordinatorImplementation implements EditorHistoryCoordinator {
  readonly controller: IHistoryController<ObjectCollection>;
  readonly #documentSession: InkDocumentSession;
  readonly #now: () => string;
  readonly #unsubscribe: () => void;
  #destroyed = false;

  constructor(options: EditorHistoryCoordinatorOptions) {
    this.#documentSession = options.documentSession;
    this.#now = options.now ?? (() => new Date().toISOString());
    const manager = createEditorHistoryManager({
      documentSession: this.#documentSession,
      ...(options.historyLimit === undefined ? {} : { historyLimit: options.historyLimit }),
    });
    this.controller = createHistoryController({ manager });
    this.#unsubscribe = this.controller.subscribe((notification) => {
      if (notification.outcome === "succeeded") {
        try {
          options.onDocumentChange(this.#documentSession.collection, notification);
        } catch (cause) {
          options.onError?.(normalizeError(cause, "Editor History synchronization failed."));
        }
      }
      try {
        options.onHistoryChange?.(notification);
      } catch {
        // Application observers cannot interrupt editor synchronization.
      }
    });
  }

  commitMove(commit: ManipulationCommit): IHistoryState {
    const object = this.#documentSession.collection.lookup(commit.objectId);
    const expectedObjectModifiedAt =
      object instanceof InkObject ? object.modifiedAt : new Date(0).toISOString();
    const command = createMoveCommand({
      objectId: commit.objectId,
      expectedObjectModifiedAt,
      initialTranslation: commit.initialObjectTranslation,
      finalTranslation: commit.finalObjectTranslation,
      id: `move-${commit.sessionId}`,
      timestamp: nextRevisionTimestamp(expectedObjectModifiedAt, this.#now()),
      description: `Move object ${commit.objectId}`,
    });
    return this.controller.executeCommand(command);
  }

  undo(): IHistoryState {
    return this.controller.undo();
  }

  redo(): IHistoryState {
    return this.controller.redo();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe();
    this.controller.destroy();
  }
}

/** Creates one package-private History coordinator per mounted editor session. */
export function createEditorHistoryCoordinator(
  options: EditorHistoryCoordinatorOptions,
): EditorHistoryCoordinator {
  return new EditorHistoryCoordinatorImplementation(options);
}

function nextRevisionTimestamp(currentRevision: string, candidate: string): string {
  const currentMilliseconds = Date.parse(currentRevision);
  const candidateMilliseconds = Date.parse(candidate);
  if (!Number.isFinite(currentMilliseconds) || !Number.isFinite(candidateMilliseconds)) {
    return candidate;
  }
  return new Date(Math.max(candidateMilliseconds, currentMilliseconds + 1)).toISOString();
}

function normalizeError(cause: unknown, message: string): Error {
  return cause instanceof Error ? cause : new Error(message, { cause });
}
