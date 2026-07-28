import { InkObject, type ObjectCollection } from "@folio/document";
import {
  createEditorHistoryManager,
  createHistoryController,
  type HistoryListener,
  type HistoryNotification,
  type IHistoryController,
  type IHistoryState,
} from "@folio/history";
import type {
  DuplicateManipulationResult,
  ManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import type { InkDocumentSession } from "../InkDocumentSession";
import { createAddStrokeCommand } from "./add-stroke-command";
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
  readonly executeStroke: (object: InkObject) => IHistoryState;
  readonly executeManipulation: (result: ManipulationResult) => IHistoryState;
  readonly executeDuplicateWithOffset: (
    result: DuplicateManipulationResult,
    offset: Readonly<{ x: number; y: number }>,
  ) => Readonly<{ duplicateObjectId: string; state: IHistoryState }>;
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

  executeStroke(object: InkObject): IHistoryState {
    return this.controller.executeCommand(
      createAddStrokeCommand({
        object,
        insertionIndex: object.zIndex,
        timestamp: object.modifiedAt,
      }),
    );
  }

  executeDuplicateWithOffset(
    result: DuplicateManipulationResult,
    offset: Readonly<{ x: number; y: number }>,
  ): Readonly<{ duplicateObjectId: string; state: IHistoryState }> {
    if (
      !Number.isFinite(offset.x) ||
      !Number.isFinite(offset.y) ||
      (offset.x === 0 && offset.y === 0)
    ) {
      throw new RangeError("Duplicate offset must be a non-zero finite page-space vector.");
    }
    const originalIds = new Set(this.#documentSession.collection.objects.map(({ id }) => id));
    const transactionTimestamp = this.#now();
    this.controller.beginTransaction({
      id: `duplicate-offset-${result.sessionId}`,
      timestamp: transactionTimestamp,
      description: `Duplicate and offset object ${result.objectId}`,
    });
    try {
      this.executeManipulation(result);
      const duplicate = this.#documentSession.collection.objects.find(
        ({ id }) => !originalIds.has(id),
      );
      if (!(duplicate instanceof InkObject)) {
        throw new Error("Duplicate command did not create a successor object.");
      }
      this.executeManipulation(createDuplicateOffsetResult(result, duplicate, offset));
      return Object.freeze({
        duplicateObjectId: duplicate.id,
        state: this.controller.commitTransaction(),
      });
    } catch (cause) {
      if (this.controller.getHistoryState().activeTransaction !== null) {
        this.controller.rollbackTransaction();
      }
      throw cause;
    }
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

function createDuplicateOffsetResult(
  source: DuplicateManipulationResult,
  duplicate: InkObject,
  offset: Readonly<{ x: number; y: number }>,
): TranslationManipulationResult {
  const initialObjectTranslation = Object.freeze({
    x: duplicate.transform.translation.x,
    y: duplicate.transform.translation.y,
  });
  const finalObjectTranslation = Object.freeze({
    x: initialObjectTranslation.x + offset.x,
    y: initialObjectTranslation.y + offset.y,
  });
  return Object.freeze({
    kind: "translation",
    sessionId: `${source.sessionId}-offset`,
    objectId: duplicate.id,
    translation: Object.freeze({
      translationX: offset.x,
      translationY: offset.y,
      totalDistance: Math.hypot(offset.x, offset.y),
      movementVector: Object.freeze({ x: offset.x, y: offset.y }),
    }),
    initialObjectTranslation,
    finalObjectTranslation,
    sessionTimestamp: source.sessionTimestamp,
  });
}
