import type { ObjectCollection } from "@folio/document";
import {
  createEditorHistoryManager,
  createHistoryController,
  type HistoryListener,
  type HistoryNotification,
  type IHistoryController,
  type IHistoryState,
} from "@folio/history";
import type { ManipulationResult } from "@folio/manipulation";
import type { InkDocumentSession } from "../InkDocumentSession";
import { createCommandForManipulation } from "./manipulation-command-adapter";

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
  readonly executeManipulation: (result: ManipulationResult) => IHistoryState;
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

  executeManipulation(result: ManipulationResult): IHistoryState {
    const command = createCommandForManipulation(result, {
      document: this.#documentSession.collection,
      timestamp: this.#now(),
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

function normalizeError(cause: unknown, message: string): Error {
  return cause instanceof Error ? cause : new Error(message, { cause });
}
