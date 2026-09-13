import {
  InkObject,
  type EditableStyleInput,
  Layer,
  PageDocument,
  SketchbookDocument,
  type PageGeometry,
  type PagePaperInput,
  type PageObject,
  type VectorPageObject,
} from "@folio/document";
import {
  createEditorHistoryManager,
  createHistoryController,
  type HistoryListener,
  type HistoryNotification,
  type EditorCommand,
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
import type { SelectionStyleCommit } from "../ContinuousSelectionStyleEdit";
import { createAddStrokeCommand } from "./add-stroke-command";
import { createInsertObjectCommand } from "./insert-object-command";
import {
  createAddLayerCommand,
  createMoveObjectToLayerCommand,
  createRemoveLayerCommand,
  createReorderLayersCommand,
  createUpdateLayerCommand,
} from "./layer-commands";
import {
  createAddPageCommand,
  createPageGeometryCommand,
  createPagePaperCommand,
  createPageRenameCommand,
  createRemovePageCommand,
  createReorderPagesCommand,
  liftPageCommand,
} from "./page-commands";
import { createCommandForManipulation } from "./manipulation-command-adapter";
import { createUpdateInkStyleCommand } from "./update-ink-style-command";
import { createUpdateVectorStyleCommand } from "./update-vector-style-command";

interface EditorHistoryCoordinatorOptions {
  readonly documentSession: InkDocumentSession;
  readonly historyLimit?: number;
  readonly now?: () => string;
  readonly onDocumentChange: (
    document: PageDocument,
    notification: HistoryNotification & { readonly outcome: "succeeded" },
  ) => void;
  readonly onHistoryChange?: HistoryListener;
  readonly onError?: (error: Error) => void;
}

/** Minimal editor context retained beside one History command identity. */
export interface HistoryPageContext {
  readonly pageId: string;
  /** Existing page to show when the command's primary page no longer exists. */
  readonly fallbackPageId: string | null;
}

/** Resolves the page that can actually be shown after a command lifecycle step. */
export function resolveHistoryPageContext(
  context: HistoryPageContext | null,
  sketchbook: SketchbookDocument,
): string | null {
  if (context === null) return null;
  if (sketchbook.page(context.pageId) !== undefined) return context.pageId;
  if (context.fallbackPageId !== null && sketchbook.page(context.fallbackPageId) !== undefined) {
    return context.fallbackPageId;
  }
  return null;
}

/** Package-private editor boundary around one manager/controller lifetime. */
export interface EditorHistoryCoordinator {
  readonly controller: IHistoryController<SketchbookDocument>;
  /**
   * The page one recorded command belongs to, or null when it is not page-scoped.
   *
   * Undo and Redo use this to restore the page context the change happened on,
   * so a restored change is always visible rather than applied to a page the
   * user cannot see.
   */
  readonly pageForCommand: (commandId: string) => string | null;
  readonly pageContextForCommand: (commandId: string) => HistoryPageContext | null;
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
  readonly executeAddLayer: (name?: string) => Readonly<{ layerId: string; state: IHistoryState }>;
  readonly executeLayerPatch: (
    layerId: string,
    patch: Readonly<{ name?: string; visible?: boolean; locked?: boolean; opacity?: number }>,
    description?: string,
  ) => IHistoryState | null;
  readonly executeSelectionStyleUpdate: (edits: SelectionStyleCommit) => IHistoryState | null;
  readonly executeMoveObjectsToLayer: (
    objectIds: readonly string[],
    targetLayerId: string,
  ) => IHistoryState | null;
  readonly executeRemoveLayer: (
    layerId: string,
  ) => Readonly<{ removedObjectCount: number; state: IHistoryState }>;
  readonly executeReorderLayer: (layerId: string, targetIndex: number) => IHistoryState | null;
  readonly executeMoveObjectToLayer: (
    objectId: string,
    targetLayerId: string,
    targetLocalIndex?: number,
  ) => IHistoryState | null;
  readonly executePageGeometry: (
    pageId: string,
    geometry: PageGeometry,
    description?: string,
  ) => IHistoryState | null;
  readonly executePagePaper: (
    pageId: string,
    paper: PagePaperInput,
    description?: string,
  ) => IHistoryState | null;
  readonly executePageRename: (pageId: string, name: string) => IHistoryState | null;
  readonly executeAddPage: () => Readonly<{ pageId: string; state: IHistoryState }>;
  readonly executeDuplicatePage: (
    pageId: string,
  ) => Readonly<{ pageId: string; state: IHistoryState }>;
  readonly executeRemovePage: (
    pageId: string,
  ) => Readonly<{ nextActivePageId: string; objectCount: number; state: IHistoryState }>;
  readonly executeReorderPage: (pageId: string, targetIndex: number) => IHistoryState | null;
  readonly undo: () => IHistoryState;
  readonly redo: () => IHistoryState;
  readonly destroy: () => void;
}

class EditorHistoryCoordinatorImplementation implements EditorHistoryCoordinator {
  readonly controller: IHistoryController<SketchbookDocument>;
  readonly #documentSession: InkDocumentSession;
  readonly #now: () => string;
  readonly #unsubscribe: () => void;
  /**
   * Command identity to its minimal page context.
   *
   * The generic History manager reports the identities it still retains, so
   * this companion map has exactly the same bounded lifecycle as its commands.
   */
  readonly #commandPages = new Map<string, HistoryPageContext>();
  #destroyed = false;

  constructor(options: EditorHistoryCoordinatorOptions) {
    this.#documentSession = options.documentSession;
    this.#now = options.now ?? (() => new Date().toISOString());
    const manager = createEditorHistoryManager({
      documentSession: this.#documentSession,
      ...(options.historyLimit === undefined ? {} : { historyLimit: options.historyLimit }),
      onRetainedCommandsChange: (commandIds) => this.#pruneCommandPages(commandIds),
    });
    this.controller = createHistoryController({ manager });
    this.#unsubscribe = this.controller.subscribe((notification) => {
      if (notification.outcome === "succeeded") {
        try {
          options.onDocumentChange(this.#documentSession.page, notification);
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
      document: this.#documentSession.page,
      timestamp: this.#now(),
      activeLayerId: this.#documentSession.activeLayerId,
    });
    return this.#executePageCommand(command);
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
    return this.#executePageCommand(
      createAddStrokeCommand({
        object,
        insertionIndex: object.zIndex,
        layerId: this.#documentSession.activeLayerId,
        timestamp: object.modifiedAt,
      }),
    );
  }

  executeObjectCreation(object: PageObject): IHistoryState {
    return this.#executePageCommand(
      createInsertObjectCommand({
        object,
        insertionIndex: object.zIndex,
        layerId: this.#documentSession.activeLayerId,
        id: `create-${object.type}-${object.id}`,
        timestamp: object.modifiedAt,
        description: `Create ${object.type} object`,
      }),
    );
  }

  executeVectorStyleUpdate(object: VectorPageObject, style: EditableStyleInput): IHistoryState {
    const timestamp = this.#now();
    return this.#executePageCommand(
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
          this.#executePageCommand(
            createInsertObjectCommand({
              object,
              insertionIndex: object.zIndex,
              layerId: this.#documentSession.activeLayerId,
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
          const originalIds = new Set(
            this.#documentSession.page.objects.objects.map(({ id }) => id),
          );
          this.executeManipulation(result);
          const duplicate = this.#documentSession.page.objects.objects.find(
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

  executeAddLayer(name?: string): Readonly<{ layerId: string; state: IHistoryState }> {
    const page = this.#documentSession.page;
    // Identity is the project's, not the page's. A name may repeat from page to
    // page -- every sketchbook has more than one "Layer 2" -- but a Layer id
    // names one Layer in the whole document, which is what the project file
    // requires and what a page-local ordinal could not give it.
    const layerId = this.#documentSession.createLayerId();
    const layerIndex =
      page.layerIndex(page.resolveActiveLayerId(this.#documentSession.activeLayerId)) + 1;
    const layer = new Layer({ id: layerId, name: name ?? this.#nextLayerName() });
    const state = this.#executePageCommand(
      createAddLayerCommand({ layer, layerIndex, timestamp: this.#now() }),
    );
    return Object.freeze({ layerId, state });
  }

  executeLayerPatch(
    layerId: string,
    patch: Readonly<{ name?: string; visible?: boolean; locked?: boolean; opacity?: number }>,
    description?: string,
  ): IHistoryState | null {
    const layer = this.#documentSession.page.layer(layerId);
    if (layer === undefined) return null;
    const initialPatch: Record<string, unknown> = {};
    const finalPatch: Record<string, unknown> = {};
    for (const key of ["name", "visible", "locked", "opacity"] as const) {
      const next = patch[key];
      if (next === undefined || next === layer[key]) continue;
      initialPatch[key] = layer[key];
      finalPatch[key] = next;
    }
    if (Object.keys(finalPatch).length === 0) return null;
    return this.#executePageCommand(
      createUpdateLayerCommand({
        layerId,
        initialPatch,
        finalPatch,
        timestamp: this.#now(),
        ...(description === undefined ? {} : { description }),
      }),
    );
  }

  executeRemoveLayer(
    layerId: string,
  ): Readonly<{ removedObjectCount: number; state: IHistoryState }> {
    const page = this.#documentSession.page;
    const layer = page.requireLayer(layerId);
    if (page.layerCount === 1) {
      throw new Error("The final remaining Layer cannot be removed.");
    }
    const layerIndex = page.layerIndex(layerId);
    const objects = layer.objectIds.map((objectId) => {
      const object = page.lookup(objectId);
      if (object === undefined) {
        throw new Error(`Layer '${layerId}' references unknown object '${objectId}'.`);
      }
      return object;
    });
    const command = createRemoveLayerCommand({
      layer,
      layerIndex,
      objects,
      timestamp: this.#now(),
    });
    const state = this.#executePageCommand(command);
    return Object.freeze({ removedObjectCount: command.removedObjectCount, state });
  }

  executeReorderLayer(layerId: string, targetIndex: number): IHistoryState | null {
    const page = this.#documentSession.page;
    const fromIndex = page.layerIndex(layerId);
    const toIndex = Math.min(Math.max(targetIndex, 0), page.layerCount - 1);
    if (fromIndex === toIndex) return null;
    return this.#executePageCommand(
      createReorderLayersCommand({ layerId, fromIndex, toIndex, timestamp: this.#now() }),
    );
  }

  /** Commits one appearance gesture over a mixed selection as a single History action. */
  executeSelectionStyleUpdate(edits: SelectionStyleCommit): IHistoryState | null {
    const total = edits.inkEdits.length + edits.vectorEdits.length;
    if (total === 0) return null;
    const run = (): void => {
      for (const edit of edits.inkEdits) {
        this.#executePageCommand(createUpdateInkStyleCommand({ ...edit, timestamp: this.#now() }));
      }
      for (const edit of edits.vectorEdits) {
        this.#executePageCommand(
          createUpdateVectorStyleCommand({
            objectId: edit.original.id,
            expectedObjectModifiedAt: edit.original.modifiedAt,
            initialStyle: edit.original.style,
            finalStyle: edit.finalStyle,
            timestamp: this.#now(),
            description: `Update ${edit.original.type} appearance`,
          }),
        );
      }
    };
    if (total === 1) {
      let state: IHistoryState | null = null;
      const single = (): void => {
        run();
        state = this.controller.getHistoryState();
      };
      single();
      return state;
    }
    return this.#runTransaction(
      `selection-style-${this.#now()}`,
      `Update ${total} selected object${total === 1 ? "" : "s"}`,
      run,
    );
  }

  /** Moves the given objects into one Layer as a single History action. */
  executeMoveObjectsToLayer(
    objectIds: readonly string[],
    targetLayerId: string,
  ): IHistoryState | null {
    const page = this.#documentSession.page;
    const movable = objectIds.filter(
      (objectId) =>
        page.has(objectId) &&
        page.layerIdForObject(objectId) !== targetLayerId &&
        page.layer(targetLayerId) !== undefined,
    );
    if (movable.length === 0) return null;
    if (movable.length === 1) {
      return this.executeMoveObjectToLayer(movable[0]!, targetLayerId);
    }
    return this.#runTransaction(
      `move-objects-layer-${targetLayerId}-${this.#now()}`,
      `Move ${movable.length} objects to layer`,
      () => {
        // Canonical order is preserved by moving bottom-most first: each append
        // lands above the previously moved object.
        for (const objectId of movable) this.executeMoveObjectToLayer(objectId, targetLayerId);
      },
    );
  }

  executeMoveObjectToLayer(
    objectId: string,
    targetLayerId: string,
    targetLocalIndex?: number,
  ): IHistoryState | null {
    const page = this.#documentSession.page;
    const fromLayerId = page.layerIdForObject(objectId);
    if (fromLayerId === undefined || page.layer(targetLayerId) === undefined) return null;
    const fromLocalIndex = page.requireLayer(fromLayerId).indexOf(objectId);
    const target = page.requireLayer(targetLayerId);
    const toLocalIndex =
      targetLocalIndex ?? (fromLayerId === targetLayerId ? target.size - 1 : target.size);
    if (fromLayerId === targetLayerId && fromLocalIndex === toLocalIndex) return null;
    return this.#executePageCommand(
      createMoveObjectToLayerCommand({
        objectId,
        fromLayerId,
        fromLocalIndex,
        toLayerId: targetLayerId,
        toLocalIndex,
        timestamp: this.#now(),
      }),
    );
  }

  /** The next unused "Layer N" on this page. Display only; never an identity. */
  #nextLayerName(): string {
    const taken = new Set(this.#documentSession.page.layers.map((layer) => layer.name));
    let ordinal = this.#documentSession.page.layerCount + 1;
    while (taken.has(`Layer ${ordinal}`)) ordinal += 1;
    return `Layer ${ordinal}`;
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
    this.#commandPages.clear();
    this.controller.destroy();
  }

  executePageGeometry(
    pageId: string,
    geometry: PageGeometry,
    description?: string,
  ): IHistoryState | null {
    const page = this.#documentSession.sketchbook.requirePage(pageId);
    const next = page.withGeometry(geometry);
    if (next === page) return null;
    return this.#executeCommandForPage(
      createPageGeometryCommand({
        pageId,
        initialGeometry: page.geometry,
        finalGeometry: next.geometry,
        timestamp: this.#now(),
        ...(description === undefined ? {} : { description }),
      }),
      pageId,
    );
  }

  executePagePaper(
    pageId: string,
    paper: PagePaperInput,
    description?: string,
  ): IHistoryState | null {
    const page = this.#documentSession.sketchbook.requirePage(pageId);
    const next = page.withPaper(paper);
    if (next === page) return null;
    return this.#executeCommandForPage(
      createPagePaperCommand({
        pageId,
        initialPaper: page.paper,
        finalPaper: next.paper,
        timestamp: this.#now(),
        ...(description === undefined ? {} : { description }),
      }),
      pageId,
    );
  }

  executePageRename(pageId: string, name: string): IHistoryState | null {
    const page = this.#documentSession.sketchbook.requirePage(pageId);
    const trimmed = name.trim();
    if (trimmed === page.name) return null;
    return this.#executeCommandForPage(
      createPageRenameCommand({
        pageId,
        initialName: page.name,
        finalName: trimmed,
        timestamp: this.#now(),
      }),
      pageId,
    );
  }

  executeAddPage(): Readonly<{ pageId: string; state: IHistoryState }> {
    const sketchbook = this.#documentSession.sketchbook;
    const page = this.#documentSession.createInheritedPage();
    const index = sketchbook.pageIndex(this.#documentSession.activePageId) + 1;
    const command = createAddPageCommand({ page, index, timestamp: this.#now() });
    const state = this.#executeCommandForPage(command, page.id, this.#documentSession.activePageId);
    return Object.freeze({ pageId: page.id, state });
  }

  executeDuplicatePage(pageId: string): Readonly<{ pageId: string; state: IHistoryState }> {
    const sketchbook = this.#documentSession.sketchbook;
    const duplicate = this.#documentSession.duplicatePageById(pageId);
    const state = this.#executeCommandForPage(
      createAddPageCommand({
        page: duplicate,
        index: sketchbook.pageIndex(pageId) + 1,
        timestamp: this.#now(),
        description: "Duplicate page",
      }),
      duplicate.id,
      pageId,
    );
    return Object.freeze({ pageId: duplicate.id, state });
  }

  executeRemovePage(
    pageId: string,
  ): Readonly<{ nextActivePageId: string; objectCount: number; state: IHistoryState }> {
    const sketchbook = this.#documentSession.sketchbook;
    const page = sketchbook.requirePage(pageId);
    if (sketchbook.pageCount === 1) {
      throw new Error("The final remaining page cannot be removed.");
    }
    const neighbor = sketchbook.neighborPageId(pageId);
    if (neighbor === null) throw new Error("No neighboring page is available.");
    const state = this.#executeCommandForPage(
      createRemovePageCommand({
        page,
        index: sketchbook.pageIndex(pageId),
        timestamp: this.#now(),
      }),
      pageId,
      neighbor,
    );
    return Object.freeze({
      nextActivePageId: neighbor,
      objectCount: page.objectCount,
      state,
    });
  }

  executeReorderPage(pageId: string, targetIndex: number): IHistoryState | null {
    const sketchbook = this.#documentSession.sketchbook;
    const fromIndex = sketchbook.pageIndex(pageId);
    const toIndex = Math.min(Math.max(targetIndex, 0), sketchbook.pageCount - 1);
    if (fromIndex === toIndex) return null;
    return this.#executeCommandForPage(
      createReorderPagesCommand({ pageId, fromIndex, toIndex, timestamp: this.#now() }),
      pageId,
    );
  }

  pageForCommand(commandId: string): string | null {
    return this.pageContextForCommand(commandId)?.pageId ?? null;
  }

  pageContextForCommand(commandId: string): HistoryPageContext | null {
    return this.#commandPages.get(commandId) ?? null;
  }

  /** Records which page a command changed so Undo and Redo can return there. */
  #rememberCommandPage(commandId: string, pageId: string, fallbackPageId?: string): void {
    this.#commandPages.set(
      commandId,
      Object.freeze({ pageId, fallbackPageId: fallbackPageId ?? null }),
    );
  }

  /** Removes every companion entry whose command has left bounded History. */
  #pruneCommandPages(commandIds: readonly string[]): void {
    const retained = new Set(commandIds);
    for (const commandId of this.#commandPages.keys()) {
      if (!retained.has(commandId)) this.#commandPages.delete(commandId);
    }
  }

  /** Associates a sketchbook command with its visible page context before execution. */
  #executeCommandForPage(
    command: EditorCommand<SketchbookDocument>,
    pageId: string,
    fallbackPageId?: string,
  ): IHistoryState {
    this.#rememberCommandPage(command.id, pageId, fallbackPageId);
    return this.controller.executeCommand(command);
  }

  /** Executes one page-scoped command against the active page. */
  #executePageCommand(command: EditorCommand<PageDocument>): IHistoryState {
    const pageId = this.#documentSession.activePageId;
    return this.#executeCommandForPage(liftPageCommand(command, pageId), pageId);
  }

  #runTransaction(id: string, description: string, execute: () => void): IHistoryState {
    this.controller.beginTransaction({ id, timestamp: this.#now(), description });
    this.#rememberCommandPage(id, this.#documentSession.activePageId);
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
