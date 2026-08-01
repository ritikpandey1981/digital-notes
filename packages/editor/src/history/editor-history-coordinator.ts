import {
  InkObject,
  type EditableStyleInput,
  type ObjectCollection,
  type PageObject,
  type VectorPageObject,
} from "@folio/document";
import {
  createEditorHistoryManager,
  createHistoryController,
  type HistoryListener,
  type HistoryNotification,
  type IHistoryController,
  type IHistoryState,
} from "@folio/history";
import type {
  DeleteManipulationResult,
  DuplicateManipulationResult,
  ManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import type { InkDocumentSession } from "../InkDocumentSession";
import { createAddStrokeCommand } from "./add-stroke-command";
import { createInsertObjectCommand } from "./insert-object-command";
import { createCommandForManipulation } from "./manipulation-command-adapter";
import { createUpdateVectorStyleCommand } from "./update-vector-style-command";

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
  readonly executeObjectCreation: (object: PageObject) => IHistoryState;
  readonly executeVectorStyleUpdate: (
    object: VectorPageObject,
    style: EditableStyleInput,
  ) => IHistoryState;
  readonly executeManipulation: (result: ManipulationResult) => IHistoryState;
  readonly executeManipulations: (
    results: readonly ManipulationResult[],
    transaction: Readonly<{ id: string; description: string }>,
  ) => IHistoryState;
  readonly executeDeletions: (results: readonly DeleteManipulationResult[]) => IHistoryState;
  readonly executePaste: (objects: readonly PageObject[]) => IHistoryState;
  readonly executeDuplicateWithOffset: (
    result: DuplicateManipulationResult,
    offset: Readonly<{ x: number; y: number }>,
  ) => Readonly<{ duplicateObjectId: string; state: IHistoryState }>;
  readonly executeDuplicatesWithOffset: (
    results: readonly DuplicateManipulationResult[],
    offset: Readonly<{ x: number; y: number }>,
  ) => Readonly<{ duplicateObjectIds: readonly string[]; state: IHistoryState }>;
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

  executeManipulations(
    results: readonly ManipulationResult[],
    transaction: Readonly<{ id: string; description: string }>,
  ): IHistoryState {
    if (
      !Array.isArray(results) ||
      results.length === 0 ||
      results.some((result) => !["translation", "rotation", "scale"].includes(result.kind))
    ) {
      throw new TypeError("Grouped transform execution requires transform results.");
    }
    if (transaction.id.trim().length === 0 || transaction.description.trim().length === 0) {
      throw new TypeError("Grouped transform execution requires transaction metadata.");
    }
    return this.#runTransaction(transaction.id, transaction.description, () => {
      for (const result of results) this.executeManipulation(result);
    });
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

  executeObjectCreation(object: PageObject): IHistoryState {
    return this.controller.executeCommand(
      createInsertObjectCommand({
        object,
        insertionIndex: object.zIndex,
        id: `create-${object.type}-${object.id}`,
        timestamp: object.modifiedAt,
        description: `Create ${object.type} object`,
      }),
    );
  }

  executeVectorStyleUpdate(object: VectorPageObject, style: EditableStyleInput): IHistoryState {
    const timestamp = this.#now();
    return this.controller.executeCommand(
      createUpdateVectorStyleCommand({
        objectId: object.id,
        expectedObjectModifiedAt: object.modifiedAt,
        initialStyle: object.style,
        finalStyle: style,
        timestamp,
        description: `Update ${object.type} appearance`,
      }),
    );
  }

  executeDeletions(results: readonly DeleteManipulationResult[]): IHistoryState {
    requireResults(results, "delete");
    return this.#runTransaction(
      `delete-selection-${results[0]?.sessionId ?? "unknown"}`,
      `Delete ${results.length} selected object${results.length === 1 ? "" : "s"}`,
      () => {
        for (const result of results) this.executeManipulation(result);
      },
    );
  }

  executePaste(objects: readonly PageObject[]): IHistoryState {
    if (!Array.isArray(objects) || objects.length === 0) {
      throw new TypeError("Paste requires at least one immutable document object.");
    }
    return this.#runTransaction(
      `paste-${objects[0]?.id ?? "unknown"}`,
      `Paste ${objects.length} object${objects.length === 1 ? "" : "s"}`,
      () => {
        for (const object of objects) {
          this.controller.executeCommand(
            createInsertObjectCommand({
              object,
              insertionIndex: object.zIndex,
              timestamp: object.modifiedAt,
            }),
          );
        }
      },
    );
  }

  executeDuplicateWithOffset(
    result: DuplicateManipulationResult,
    offset: Readonly<{ x: number; y: number }>,
  ): Readonly<{ duplicateObjectId: string; state: IHistoryState }> {
    const execution = this.executeDuplicatesWithOffset([result], offset);
    const duplicateObjectId = execution.duplicateObjectIds[0];
    if (duplicateObjectId === undefined) {
      throw new Error("Duplicate operation did not produce an object identity.");
    }
    return Object.freeze({ duplicateObjectId, state: execution.state });
  }

  executeDuplicatesWithOffset(
    results: readonly DuplicateManipulationResult[],
    offset: Readonly<{ x: number; y: number }>,
  ): Readonly<{ duplicateObjectIds: readonly string[]; state: IHistoryState }> {
    requireResults(results, "duplicate");
    if (
      !Number.isFinite(offset.x) ||
      !Number.isFinite(offset.y) ||
      (offset.x === 0 && offset.y === 0)
    ) {
      throw new RangeError("Duplicate offset must be a non-zero finite page-space vector.");
    }
    const duplicateObjectIds: string[] = [];
    const state = this.#runTransaction(
      `duplicate-offset-${results[0]?.sessionId ?? "unknown"}`,
      `Duplicate ${results.length} object${results.length === 1 ? "" : "s"}`,
      () => {
        for (const result of results) {
          const originalIds = new Set(this.#documentSession.collection.objects.map(({ id }) => id));
          this.executeManipulation(result);
          const duplicate = this.#documentSession.collection.objects.find(
            ({ id }) => !originalIds.has(id),
          );
          if (duplicate === undefined) {
            throw new Error("Duplicate command did not create a successor object.");
          }
          this.executeManipulation(createDuplicateOffsetResult(result, duplicate, offset));
          duplicateObjectIds.push(duplicate.id);
        }
      },
    );
    return Object.freeze({ duplicateObjectIds: Object.freeze(duplicateObjectIds), state });
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

  #runTransaction(id: string, description: string, execute: () => void): IHistoryState {
    this.controller.beginTransaction({ id, timestamp: this.#now(), description });
    try {
      execute();
      return this.controller.commitTransaction();
    } catch (cause) {
      if (this.controller.getHistoryState().activeTransaction !== null) {
        this.controller.rollbackTransaction();
      }
      throw cause;
    }
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
  duplicate: PageObject,
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

function requireResults(
  results: readonly ManipulationResult[],
  kind: "delete" | "duplicate",
): void {
  if (
    !Array.isArray(results) ||
    results.length === 0 ||
    results.some((result) => result.kind !== kind)
  ) {
    throw new TypeError(`${kind} transaction requires at least one matching result.`);
  }
}
