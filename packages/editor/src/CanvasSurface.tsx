import { InkObject, type ObjectCollection, type PageObject } from "@folio/document";
import type { HistoryNotification, IHistoryController, IHistoryState } from "@folio/history";
import { createStrokeVisual, PointerInputController, StrokeRenderer } from "@folio/ink";
import {
  createDeleteManipulationResult,
  createDuplicateManipulationResult,
  createManipulationController,
  createManipulationManager,
  type ManipulationController,
  type ManipulationKind,
  type ManipulationPointerInput,
  type ManipulationResult,
  type ManipulationState,
} from "@folio/manipulation";
import {
  CanvasController,
  SelectionOverlayRenderer,
  TransformPreviewRenderer,
  type CanvasBounds,
  type CanvasControllerSnapshot,
  type RenderTheme,
} from "@folio/rendering";
import {
  createSelectionController,
  createSelectionManager,
  type ScreenPoint,
  type SelectionController,
  type SelectionPointerInput,
  type SelectionState,
} from "@folio/selection";
import { useEffect, useRef, useState } from "react";
import { EditorClipboard } from "./EditorClipboard";
import {
  EditorContextMenu,
  type EditorContextMenuAction,
  type EditorContextMenuState,
} from "./EditorContextMenu";
import { createEditorGroupManipulationPlan, transformGroupBounds } from "./EditorGroupManipulation";
import { EditorSelectionGeometry } from "./EditorSelectionGeometry";
import { EditorSelectionSet } from "./EditorSelectionSet";
import { createEditorSelectionHitTestEngine } from "./EditorSelectionHitTestEngine";
import {
  createEditorHistoryCoordinator,
  type EditorHistoryCoordinator,
} from "./history/editor-history-coordinator";
import {
  installEditorEditingShortcuts,
  type EditorEditingShortcutActions,
} from "./history/editor-editing-shortcuts";
import { installEditorHistoryShortcuts } from "./history/editor-history-shortcuts";
import { InkDocumentSession } from "./InkDocumentSession";
import { PageManipulationCoordinateMapper } from "./PageManipulationCoordinateMapper";
import { PageSelectionCoordinateMapper } from "./PageSelectionCoordinateMapper";
import {
  resolveSelectionManipulationHit,
  selectionManipulationCursorCss,
  type SelectionManipulationCursor,
} from "./SelectionManipulationTarget";

/** Interaction capabilities currently routed by the editor adapter. */
export type CanvasInteractionMode = "select" | "move" | "rotate" | "scale" | "ink" | "disabled";

/** Session-scoped object lifecycle actions exposed to the desktop composition layer. */
export interface ObjectLifecycleActions {
  readonly deleteSelection: () => boolean;
  readonly duplicateSelection: () => boolean;
}

/** Public composition and lifecycle callbacks accepted by {@link CanvasSurface}. */
export interface CanvasSurfaceProps {
  /** Optional host class name supplied by the desktop shell. */
  readonly className?: string;
  /** Active pointer-input mode without remounting the canvas lifecycle. */
  readonly interactionMode?: CanvasInteractionMode;
  /** Receives the mounted rendering controller. */
  readonly onControllerReady?: (controller: CanvasController) => void;
  /** Receives the interface-oriented selection controller. */
  readonly onSelectionControllerReady?: (controller: SelectionController) => void;
  /** Receives the interface-oriented manipulation controller. */
  readonly onManipulationControllerReady?: (
    controller: ManipulationController<ManipulationResult>,
  ) => void;
  /** Receives the interface-oriented History controller for programmatic operations. */
  readonly onHistoryControllerReady?: (controller: IHistoryController<ObjectCollection>) => void;
  /** Receives session-bound delete/duplicate actions and null during cleanup. */
  readonly onObjectLifecycleActionsReady?: (actions: ObjectLifecycleActions | null) => void;
  /** Receives immutable selection state only after logical changes. */
  readonly onSelectionChange?: (state: SelectionState) => void;
  /** Receives immutable manipulation state only after logical transitions. */
  readonly onManipulationChange?: (state: ManipulationState) => void;
  /** Receives immutable post-operation History notifications. */
  readonly onHistoryChange?: (notification: HistoryNotification) => void;
  /** Receives immutable rendering diagnostics at lifecycle checkpoints. */
  readonly onDiagnostics?: (snapshot: CanvasControllerSnapshot) => void;
  /** Receives initialization or rendering adapter failures. */
  readonly onError?: (error: Error) => void;
}

function readTheme(): RenderTheme {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;

  return Object.freeze({
    workspaceColor: value("--folio-workspace", "#f1f1ef"),
    pageColor: value("--folio-page", "#fffdf8"),
    pageBorderColor: value("--folio-border", "rgba(37, 37, 34, 0.11)"),
    pageShadowColor:
      document.documentElement.dataset.theme === "dark"
        ? "rgba(0, 0, 0, 0.34)"
        : "rgba(0, 0, 0, 0.16)",
    pageLineColor: value("--folio-page-rule", "rgba(102, 118, 151, 0.16)"),
  });
}

function manipulationKindForMode(mode: CanvasInteractionMode): ManipulationKind | null {
  switch (mode) {
    case "move":
      return "translation";
    case "rotate":
      return "rotation";
    case "scale":
      return "scale";
    case "select":
    case "ink":
    case "disabled":
      return null;
  }
}

const DUPLICATE_OFFSET = Object.freeze({ x: 10, y: 10 });

/** Mounts and owns one editor canvas stack for the lifetime of the React host. */
export function CanvasSurface({
  className,
  interactionMode = "ink",
  onControllerReady,
  onSelectionControllerReady,
  onManipulationControllerReady,
  onHistoryControllerReady,
  onObjectLifecycleActionsReady,
  onSelectionChange,
  onManipulationChange,
  onHistoryChange,
  onDiagnostics,
  onError,
}: CanvasSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);
  const interactionModeRef = useRef(interactionMode);
  const manipulationControllerRef = useRef<ManipulationController<ManipulationResult> | null>(null);
  const selectionControllerRef = useRef<SelectionController | null>(null);
  const releaseManipulationPointerCaptureRef = useRef<(() => void) | null>(null);
  const resetManipulationCursorRef = useRef<(() => void) | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const manipulationChangeRef = useRef(onManipulationChange);
  const historyChangeRef = useRef(onHistoryChange);
  const objectLifecycleActionsReadyRef = useRef(onObjectLifecycleActionsReady);
  const editingActionsRef = useRef<EditorEditingShortcutActions | null>(null);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    const kind = manipulationKindForMode(interactionMode);
    const activeKind = manipulationControllerRef.current?.getManipulationState().kind ?? null;
    if (kind === null || (activeKind !== null && activeKind !== kind)) {
      manipulationControllerRef.current?.cancelManipulation();
      releaseManipulationPointerCaptureRef.current?.();
    }
    if (interactionMode === "ink") selectionControllerRef.current?.clearSelection();
    resetManipulationCursorRef.current?.();
  }, [interactionMode]);

  useEffect(() => {
    selectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    manipulationChangeRef.current = onManipulationChange;
  }, [onManipulationChange]);

  useEffect(() => {
    historyChangeRef.current = onHistoryChange;
  }, [onHistoryChange]);

  useEffect(() => {
    objectLifecycleActionsReadyRef.current = onObjectLifecycleActionsReady;
  }, [onObjectLifecycleActionsReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const controller = new CanvasController({
      theme: readTheme(),
      onError: (error) => onError?.(error),
    });
    let themeObserver: MutationObserver | null = null;
    let pointerInput: PointerInputController | null = null;
    let strokeRenderer: StrokeRenderer | null = null;
    let inkLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let selectionLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let selectionOverlayRenderer: SelectionOverlayRenderer | null = null;
    let selectionController: SelectionController | null = null;
    let unsubscribeSelection: (() => void) | null = null;
    let manipulationLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let transformPreviewRenderer: TransformPreviewRenderer | null = null;
    let manipulationController: ManipulationController<ManipulationResult> | null = null;
    let unsubscribeManipulation: (() => void) | null = null;
    let historyCoordinator: EditorHistoryCoordinator | null = null;
    let uninstallHistoryShortcuts: (() => void) | null = null;
    let uninstallEditingShortcuts: (() => void) | null = null;
    let contextMenuListener: ((event: MouseEvent) => void) | null = null;
    let manipulationPointerCapture: Readonly<{
      canvas: HTMLCanvasElement;
      pointerId: number;
    }> | null = null;
    const selectPointerRoutes = new Map<number, "selection" | ManipulationKind>();
    const editorPointerListeners: Array<readonly [keyof HTMLElementEventMap, EventListener]> = [];
    const documentSession = new InkDocumentSession();
    const editorClipboard = new EditorClipboard();
    const editorSelection = new EditorSelectionSet();
    const selectionGeometry = new EditorSelectionGeometry();
    const releaseManipulationPointerCapture = (): void => {
      const capture = manipulationPointerCapture;
      manipulationPointerCapture = null;
      if (capture === null) return;
      selectPointerRoutes.delete(capture.pointerId);
      try {
        capture.canvas.releasePointerCapture(capture.pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
      host.dataset.manipulationPointerCapture = "released";
    };
    releaseManipulationPointerCaptureRef.current = releaseManipulationPointerCapture;

    try {
      controller.mount(host);
      const viewport = controller.viewport;
      const coordinateConverter = controller.coordinateConverter;
      if (viewport === null || coordinateConverter === null) {
        throw new Error("Canvas viewport initialization failed.");
      }
      inkLayer = controller.createOverlayLayer({
        name: "ink",
        interactive: true,
        ariaLabel: "Ink input surface",
      });
      const setManipulationCursor = (cursor: SelectionManipulationCursor): void => {
        if (inkLayer === null || inkLayer.canvas.dataset.manipulationCursor === cursor) return;
        inkLayer.canvas.style.cursor = selectionManipulationCursorCss(cursor);
        inkLayer.canvas.dataset.manipulationCursor = cursor;
        host.dataset.manipulationCursor = cursor;
      };
      const resetManipulationCursor = (): void => setManipulationCursor("default");
      resetManipulationCursorRef.current = resetManipulationCursor;
      resetManipulationCursor();
      const getInkCanvasBounds = (): CanvasBounds | null => {
        const bounds = inkLayer?.canvas.getBoundingClientRect();
        return bounds === undefined
          ? null
          : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      strokeRenderer = new StrokeRenderer({
        context: inkLayer.context,
        canvas: inkLayer.canvas,
        viewport,
      });
      const activeStrokeRenderer = strokeRenderer;
      const objectSource = {
        getObjects: () => documentSession.collection.objects,
        getObject: (objectId: string) => documentSession.collection.lookup(objectId),
      };
      const selectionManager = createSelectionManager();
      const hitTestEngine = createEditorSelectionHitTestEngine(objectSource);
      const selectionCoordinateMapper = new PageSelectionCoordinateMapper({
        coordinateConverter,
        viewport,
        getCanvasBounds: getInkCanvasBounds,
      });
      selectionController = createSelectionController({
        manager: selectionManager,
        hitTestEngine,
        objectSource,
        coordinateMapper: selectionCoordinateMapper,
      });
      const activeSelectionController = selectionController;
      selectionControllerRef.current = activeSelectionController;
      selectionLayer = controller.createOverlayLayer({
        name: "selection",
        ariaLabel: "Selection overlay",
      });
      selectionOverlayRenderer = new SelectionOverlayRenderer({
        context: selectionLayer.context,
        canvas: selectionLayer.canvas,
        viewport,
      });
      const activeSelectionOverlayRenderer = selectionOverlayRenderer;
      inkLayer.canvas.style.zIndex = "1";
      selectionLayer.canvas.style.zIndex = "3";
      const updateViewportDiagnostics = (): void => {
        host.dataset.viewportZoom = String(viewport.camera.zoom);
      };
      const updateDocumentDiagnostics = (): void => {
        const snapshot = documentSession.snapshot();
        if (inkLayer !== null) {
          inkLayer.canvas.dataset.documentObjectCount = String(snapshot.objectCount);
          inkLayer.canvas.dataset.documentInkObjectCount = String(snapshot.inkObjectCount);
          inkLayer.canvas.dataset.documentObjectsImmutable = String(snapshot.allObjectsImmutable);
        }
        host.dataset.documentObjectCount = String(snapshot.objectCount);
        updateViewportDiagnostics();
      };
      const updateEditorSelectionDiagnostics = (): void => {
        const selectedObjectIds = JSON.stringify(editorSelection.ids);
        const selectedObjects = editorSelection.selectedObjects(documentSession.collection);
        host.dataset.selectedObjectCount = String(editorSelection.size);
        host.dataset.selectedObjectIds = selectedObjectIds;
        host.dataset.selectedObjectTransforms = JSON.stringify(
          selectedObjects.map((object) => ({
            id: object.id,
            bounds: object.bounds,
            translation: object.transform.translation,
            rotation: object.transform.rotation,
            scale: object.transform.scale,
            strokeWidth: object instanceof InkObject ? object.stroke.style.width : null,
          })),
        );
        inkLayer?.canvas.setAttribute("data-selected-object-count", String(editorSelection.size));
        inkLayer?.canvas.setAttribute("data-selected-object-ids", selectedObjectIds);
      };
      const updateClipboardDiagnostics = (): void => {
        const snapshot = editorClipboard.snapshot();
        host.dataset.clipboardObjectCount = String(snapshot.objectCount);
        host.dataset.clipboardPasteCount = String(snapshot.pasteCount);
        host.dataset.clipboardCanPaste = String(snapshot.canPaste);
      };
      const updateSelection = (state: SelectionState, notify: boolean): void => {
        const selectedObject =
          state.selectedObjectId === null
            ? undefined
            : documentSession.collection.lookup(state.selectedObjectId);
        const selectedGeometry = selectionGeometry.resolve(
          documentSession.collection,
          editorSelection.ids,
        );
        const selectionBounds = selectedGeometry?.bounds;
        activeSelectionOverlayRenderer.setSelection(
          selectedObject === undefined || selectionBounds === undefined
            ? null
            : { objectId: selectedObject.id, bounds: selectionBounds },
        );
        const selectionState =
          selectedObject === undefined || selectedGeometry === null ? "empty" : "selected";
        const selectedObjectId = selectedObject?.id ?? "";
        const selectedObjectType = selectedObject?.type ?? "";
        host.dataset.selectionState = selectionState;
        host.dataset.selectedObjectId = selectedObjectId;
        host.dataset.selectedObjectType = selectedObjectType;
        host.dataset.selectionVersion = String(state.selectionVersion);
        host.dataset.selectedObjectBoundsX = String(selectionBounds?.x ?? 0);
        host.dataset.selectedObjectBoundsY = String(selectionBounds?.y ?? 0);
        host.dataset.selectedObjectBoundsWidth = String(selectionBounds?.width ?? 0);
        host.dataset.selectedObjectBoundsHeight = String(selectionBounds?.height ?? 0);
        host.dataset.selectionGroupState =
          selectedGeometry === null
            ? "empty"
            : selectedGeometry.objects.length > 1
              ? "group"
              : "single";
        host.dataset.selectedObjectTranslationX = String(
          selectedObject?.transform.translation.x ?? 0,
        );
        host.dataset.selectedObjectTranslationY = String(
          selectedObject?.transform.translation.y ?? 0,
        );
        host.dataset.selectedObjectRotation = String(selectedObject?.transform.rotation ?? 0);
        host.dataset.selectedObjectScale = String(selectedObject?.transform.scale ?? 1);
        inkLayer?.canvas.setAttribute("data-selection-state", selectionState);
        inkLayer?.canvas.setAttribute("data-selected-object-id", selectedObjectId);
        selectionLayer?.canvas.setAttribute("data-selected-object-type", selectedObjectType);
        selectionLayer?.canvas.setAttribute(
          "data-selection-version",
          String(state.selectionVersion),
        );
        updateEditorSelectionDiagnostics();
        if (selectionState === "empty") resetManipulationCursor();
        if (notify) selectionChangeRef.current?.(state);
      };
      let synchronizePrimaryIntoEditorSelection = true;
      unsubscribeSelection = activeSelectionController.subscribe((state) => {
        if (synchronizePrimaryIntoEditorSelection) {
          editorSelection.selectPrimary(state.selectedObjectId);
        }
        updateSelection(state, true);
        const manipulationState = manipulationController?.getManipulationState();
        if (
          manipulationState?.objectId !== null &&
          manipulationState?.objectId !== state.selectedObjectId
        ) {
          manipulationController?.cancelManipulation();
          releaseManipulationPointerCapture();
        }
      });
      const selectEditorObjects = (objectIds: readonly string[]): void => {
        const requestedIds = new Set(objectIds);
        const validIds = documentSession.collection.objects
          .filter((object) => requestedIds.has(object.id) && object.visible && !object.locked)
          .map(({ id }) => id);
        synchronizePrimaryIntoEditorSelection = false;
        try {
          const primaryId = validIds.at(-1);
          if (primaryId === undefined) activeSelectionController.clearSelection();
          else activeSelectionController.selectObject(primaryId);
        } finally {
          synchronizePrimaryIntoEditorSelection = true;
        }
        editorSelection.replace(validIds);
        updateSelection(activeSelectionController.getSelection(), false);
      };
      const selectedEditableObjects = (): readonly PageObject[] =>
        Object.freeze(
          editorSelection
            .selectedObjects(documentSession.collection)
            .filter((object) => object.visible && !object.locked),
        );
      const manipulationObjectSource = {
        getObject: (objectId: string): PageObject | undefined => {
          const geometry = selectionGeometry.resolve(
            documentSession.collection,
            editorSelection.ids,
          );
          return geometry?.primaryObject.id === objectId
            ? geometry.manipulationTarget
            : documentSession.collection.lookup(objectId);
        },
      };
      manipulationLayer = controller.createOverlayLayer({
        name: "manipulation-preview",
        ariaLabel: "Object transform preview",
      });
      transformPreviewRenderer = new TransformPreviewRenderer({
        context: manipulationLayer.context,
        canvas: manipulationLayer.canvas,
        viewport,
      });
      const activeTransformPreviewRenderer = transformPreviewRenderer;
      manipulationLayer.canvas.style.zIndex = "2";
      const manipulationCoordinateMapper = new PageManipulationCoordinateMapper({
        coordinateConverter,
        viewport,
        getCanvasBounds: getInkCanvasBounds,
      });
      const manipulationManager = createManipulationManager();
      const strokeVisuals = new Map<string, ReturnType<typeof createStrokeVisual>>();
      const updateHistoryDiagnostics = (state: IHistoryState): void => {
        host.dataset.historyCanUndo = String(state.canUndo);
        host.dataset.historyCanRedo = String(state.canRedo);
        host.dataset.historyUndoDepth = String(state.undoDepth);
        host.dataset.historyRedoDepth = String(state.redoDepth);
        host.dataset.historyVersion = String(state.historyVersion);
        host.dataset.historyExecutionCount = String(state.executionCounter);
        host.dataset.historyLastCommandId = state.lastCommand?.id ?? "";
      };
      const synchronizeDocumentFromHistory = (): void => {
        const inkObjects = documentSession.collection.objects.filter(
          (object): object is InkObject => object instanceof InkObject,
        );
        activeStrokeRenderer.replaceFinalizedStrokes(
          Object.freeze(
            inkObjects.map((object) =>
              Object.freeze({ id: object.id, stroke: object.stroke, transform: object.transform }),
            ),
          ),
        );
        for (const objectId of strokeVisuals.keys()) {
          if (!documentSession.collection.has(objectId)) strokeVisuals.delete(objectId);
        }
        updateDocumentDiagnostics();
        editorSelection.reconcile(documentSession.collection);
        let selection = activeSelectionController.getSelection();
        if (
          selection.selectedObjectId !== null &&
          !documentSession.collection.has(selection.selectedObjectId)
        ) {
          synchronizePrimaryIntoEditorSelection = false;
          try {
            const primaryId = editorSelection.ids.at(-1);
            selection =
              primaryId === undefined
                ? activeSelectionController.clearSelection()
                : activeSelectionController.selectObject(primaryId);
          } finally {
            synchronizePrimaryIntoEditorSelection = true;
          }
        }
        updateSelection(selection, false);
      };
      historyCoordinator = createEditorHistoryCoordinator({
        documentSession,
        onDocumentChange: () => synchronizeDocumentFromHistory(),
        onHistoryChange: (notification) => {
          updateHistoryDiagnostics(notification.state);
          historyChangeRef.current?.(notification);
        },
        onError: (error) => onError?.(error),
      });
      const activeHistoryCoordinator = historyCoordinator;
      uninstallHistoryShortcuts = installEditorHistoryShortcuts({
        controller: activeHistoryCoordinator.controller,
        onError: (error) => onError?.(error),
      });
      updateHistoryDiagnostics(activeHistoryCoordinator.controller.getHistoryState());
      manipulationController = createManipulationController({
        manager: manipulationManager,
        selectionSource: activeSelectionController,
        objectSource: manipulationObjectSource,
        onResult: (result) => {
          try {
            const selection = selectionGeometry.resolve(
              documentSession.collection,
              editorSelection.ids,
            );
            if (
              selection !== null &&
              selection.objects.length > 1 &&
              result.objectId === selection.primaryObject.id
            ) {
              const plan = createEditorGroupManipulationPlan(result, selection);
              const state = activeHistoryCoordinator.executeManipulations(plan.results, {
                id: plan.id,
                description: plan.description,
              });
              updateHistoryDiagnostics(state);
            } else {
              activeHistoryCoordinator.executeManipulation(result);
            }
            return true;
          } catch (cause) {
            const error =
              cause instanceof Error
                ? cause
                : new Error("History transform execution failed.", { cause });
            onError?.(error);
            return false;
          }
        },
        onError: (error) => onError?.(error),
      });
      const activeManipulationController = manipulationController;
      manipulationControllerRef.current = activeManipulationController;
      const reportEditingFailure = (cause: unknown, message: string): false => {
        onError?.(cause instanceof Error ? cause : new Error(message, { cause }));
        return false;
      };
      const deleteSelectedObjects = (): boolean => {
        const objects = selectedEditableObjects();
        if (objects.length === 0) return false;
        try {
          const state = activeHistoryCoordinator.executeDeletions(
            objects.map(({ id }) => createDeleteManipulationResult({ objectId: id })),
          );
          updateHistoryDiagnostics(state);
          selectEditorObjects([]);
          return true;
        } catch (cause) {
          return reportEditingFailure(cause, "History deletion execution failed.");
        }
      };
      const duplicateSelectedObjects = (): boolean => {
        const objects = selectedEditableObjects();
        if (objects.length === 0) return false;
        try {
          const { duplicateObjectIds, state } =
            activeHistoryCoordinator.executeDuplicatesWithOffset(
              objects.map(({ id }) => createDuplicateManipulationResult({ objectId: id })),
              DUPLICATE_OFFSET,
            );
          updateHistoryDiagnostics(state);
          selectEditorObjects(duplicateObjectIds);
          return true;
        } catch (cause) {
          return reportEditingFailure(cause, "History duplication execution failed.");
        }
      };
      const editingActions: EditorEditingShortcutActions = Object.freeze({
        copy: () => {
          const copied = editorClipboard.copy(selectedEditableObjects());
          if (copied) updateClipboardDiagnostics();
          return copied;
        },
        cut: () => {
          const objects = selectedEditableObjects();
          if (!editorClipboard.copy(objects)) return false;
          updateClipboardDiagnostics();
          try {
            const state = activeHistoryCoordinator.executeDeletions(
              objects.map(({ id }) => createDeleteManipulationResult({ objectId: id })),
            );
            updateHistoryDiagnostics(state);
            selectEditorObjects([]);
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "History cut execution failed.");
          }
        },
        paste: () => {
          try {
            const batch = editorClipboard.preparePaste(documentSession.collection);
            if (batch === null) return false;
            const state = activeHistoryCoordinator.executePaste(batch.objects);
            editorClipboard.confirmPaste(batch);
            updateHistoryDiagnostics(state);
            updateClipboardDiagnostics();
            selectEditorObjects(batch.objects.map(({ id }) => id));
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "History paste execution failed.");
          }
        },
        duplicate: duplicateSelectedObjects,
        selectAll: () => {
          const selectedIds = editorSelection.selectAllEditable(documentSession.collection);
          if (selectedIds.length === 0) return false;
          selectEditorObjects(selectedIds);
          return true;
        },
        deleteSelection: deleteSelectedObjects,
      });
      editingActionsRef.current = editingActions;
      uninstallEditingShortcuts = installEditorEditingShortcuts({
        actions: editingActions,
        onError: (error) => onError?.(error),
      });
      updateClipboardDiagnostics();
      const objectLifecycleActions: ObjectLifecycleActions = Object.freeze({
        deleteSelection: editingActions.deleteSelection,
        duplicateSelection: editingActions.duplicate,
      });
      objectLifecycleActionsReadyRef.current?.(objectLifecycleActions);
      const updateManipulation = (state: ManipulationState, notify: boolean): void => {
        host.dataset.manipulationPhase = state.phase;
        host.dataset.manipulationKind = state.kind ?? "";
        host.dataset.manipulationVersion = String(state.version);
        host.dataset.manipulationObjectId = state.objectId ?? "";
        host.dataset.manipulationTranslationX = String(state.translation.translationX);
        host.dataset.manipulationTranslationY = String(state.translation.translationY);
        host.dataset.manipulationRotation = String(state.finalObjectRotation ?? 0);
        host.dataset.manipulationScale = String(state.finalObjectScale ?? 1);
        const object =
          state.objectId === null ? undefined : documentSession.collection.lookup(state.objectId);
        const selectedGeometry = selectionGeometry.resolve(
          documentSession.collection,
          editorSelection.ids,
        );
        const isGroupManipulation =
          selectedGeometry !== null &&
          selectedGeometry.objects.length > 1 &&
          state.objectId === selectedGeometry.primaryObject.id;
        if (state.phase === "dragging" && isGroupManipulation && selectedGeometry !== null) {
          const previewBounds = transformGroupBounds(selectedGeometry.bounds, state);
          activeTransformPreviewRenderer.setPreview(null);
          activeSelectionOverlayRenderer.setSelection({
            objectId: selectedGeometry.primaryObject.id,
            bounds: previewBounds,
          });
          host.dataset.groupPreviewBoundsX = String(previewBounds.x);
          host.dataset.groupPreviewBoundsY = String(previewBounds.y);
          host.dataset.groupPreviewBoundsWidth = String(previewBounds.width);
          host.dataset.groupPreviewBoundsHeight = String(previewBounds.height);
        } else if (
          state.phase === "dragging" &&
          object instanceof InkObject &&
          state.finalObjectTranslation !== null &&
          state.finalObjectRotation !== null &&
          state.finalObjectScale !== null
        ) {
          let visual = strokeVisuals.get(object.id);
          if (visual === undefined) {
            visual = createStrokeVisual(object.stroke);
            strokeVisuals.set(object.id, visual);
          }
          activeTransformPreviewRenderer.setPreview({
            objectId: object.id,
            bounds: visual.bounds,
            transform: Object.freeze({
              translation: state.finalObjectTranslation,
              rotation: state.finalObjectRotation,
              scale: state.finalObjectScale,
            }),
            visual,
          });
        } else {
          activeTransformPreviewRenderer.setPreview(null);
          if (isGroupManipulation) {
            updateSelection(activeSelectionController.getSelection(), false);
          }
        }
        if (state.phase === "committing" || state.phase === "cancelling") {
          releaseManipulationPointerCapture();
        }
        if (notify) manipulationChangeRef.current?.(state);
      };
      unsubscribeManipulation = activeManipulationController.subscribe((state) =>
        updateManipulation(state, true),
      );
      inkLayer.setResizeHandler(() => {
        updateViewportDiagnostics();
        activeStrokeRenderer.redraw();
      });
      manipulationLayer.setResizeHandler(() => activeTransformPreviewRenderer.redraw());
      selectionLayer.setResizeHandler(() => activeSelectionOverlayRenderer.redraw());
      activeStrokeRenderer.redraw();
      activeTransformPreviewRenderer.redraw();
      activeSelectionOverlayRenderer.redraw();
      updateDocumentDiagnostics();
      updateSelection(activeSelectionController.getSelection(), false);
      updateManipulation(activeManipulationController.getManipulationState(), false);

      const updateManipulationCursor = (position: ScreenPoint): void => {
        if (
          interactionModeRef.current !== "select" ||
          activeManipulationController.hasActiveSession()
        ) {
          return;
        }
        const selection = selectionGeometry.resolve(
          documentSession.collection,
          editorSelection.ids,
        );
        const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
        if (selection === null || pagePosition === null) {
          resetManipulationCursor();
          return;
        }
        const hit = resolveSelectionManipulationHit({
          bounds: selection.bounds,
          position: pagePosition,
          zoom: viewport.camera.zoom,
        });
        setManipulationCursor(hit?.cursor ?? "default");
      };

      const bridgeEditorPointer = (
        phase: SelectionPointerInput["phase"],
        event: PointerEvent,
      ): void => {
        const mode = interactionModeRef.current;
        const position: ScreenPoint = Object.freeze({
          x: event.clientX,
          y: event.clientY,
          coordinateSpace: "screen",
        });
        if (phase === "move") updateManipulationCursor(position);
        if (mode === "ink") {
          resetManipulationCursor();
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (mode === "select") {
          let route = selectPointerRoutes.get(event.pointerId);
          if (phase === "down") {
            const selectedGeometry = selectionGeometry.resolve(
              documentSession.collection,
              editorSelection.ids,
            );
            const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
            const hit =
              selectedGeometry === null || pagePosition === null
                ? null
                : resolveSelectionManipulationHit({
                    bounds: selectedGeometry.bounds,
                    position: pagePosition,
                    zoom: viewport.camera.zoom,
                  });
            route = hit?.kind ?? "selection";
            if (hit !== null) setManipulationCursor(hit.cursor);
            selectPointerRoutes.set(event.pointerId, route);
          }
          if (route === undefined) return;
          if (route === "selection") {
            activeSelectionController.handlePointer({
              phase,
              pointerId: event.pointerId,
              button: event.button,
              isPrimary: event.isPrimary,
              position,
            });
          } else {
            const pagePosition = manipulationCoordinateMapper.screenToPage(
              position,
              activeManipulationController.hasActiveSession(),
            );
            activeManipulationController.handlePointer({
              phase,
              pointerId: event.pointerId,
              button: event.button,
              isPrimary: event.isPrimary,
              position: pagePosition,
              kind: route,
            });
          }
        } else if (manipulationKindForMode(mode) !== null) {
          const manipulationKind = manipulationKindForMode(mode);
          if (manipulationKind === null) return;
          const pagePosition = manipulationCoordinateMapper.screenToPage(
            position,
            activeManipulationController.hasActiveSession(),
          );
          const input: ManipulationPointerInput = {
            phase,
            pointerId: event.pointerId,
            button: event.button,
            isPrimary: event.isPrimary,
            position: pagePosition,
            kind: manipulationKind,
          };
          activeManipulationController.handlePointer(input);
        } else {
          return;
        }
        const ownsManipulation = activeManipulationController.hasActiveSession();
        const shouldCaptureManipulation =
          (manipulationKindForMode(mode) !== null ||
            (mode === "select" && selectPointerRoutes.get(event.pointerId) !== "selection")) &&
          ownsManipulation;
        const activePointerManipulation =
          mode === "select"
            ? selectPointerRoutes.get(event.pointerId)
            : manipulationKindForMode(mode);
        if (activePointerManipulation === "translation" && ownsManipulation) {
          setManipulationCursor("grabbing");
        }
        if (
          phase === "down" &&
          event.isPrimary &&
          event.button === 0 &&
          (mode === "select" || shouldCaptureManipulation)
        ) {
          try {
            const canvas = inkLayer?.canvas;
            canvas?.setPointerCapture(event.pointerId);
            if (shouldCaptureManipulation && canvas !== undefined) {
              manipulationPointerCapture = Object.freeze({
                canvas,
                pointerId: event.pointerId,
              });
              host.dataset.manipulationPointerCapture = "captured";
            }
          } catch {
            // A click can still resolve while the pointer remains over the canvas.
          }
        }
        if (phase === "up" || phase === "cancel") {
          if (manipulationPointerCapture?.pointerId === event.pointerId) {
            releaseManipulationPointerCapture();
          } else {
            try {
              inkLayer?.canvas.releasePointerCapture(event.pointerId);
            } catch {
              // Selection capture may already have been released by the browser.
            }
          }
          selectPointerRoutes.delete(event.pointerId);
          updateManipulationCursor(position);
        }
      };
      const addEditorPointerListener = (
        type: keyof HTMLElementEventMap,
        phase: SelectionPointerInput["phase"],
      ): void => {
        const listener: EventListener = (event) =>
          bridgeEditorPointer(phase, event as PointerEvent);
        inkLayer?.canvas.addEventListener(type, listener, true);
        editorPointerListeners.push([type, listener]);
      };
      addEditorPointerListener("pointerdown", "down");
      addEditorPointerListener("pointermove", "move");
      addEditorPointerListener("pointerup", "up");
      addEditorPointerListener("pointercancel", "cancel");
      addEditorPointerListener("lostpointercapture", "cancel");
      const cursorLeaveListener: EventListener = () => {
        if (!activeManipulationController.hasActiveSession()) resetManipulationCursor();
      };
      inkLayer.canvas.addEventListener("pointerleave", cursorLeaveListener, true);
      editorPointerListeners.push(["pointerleave", cursorLeaveListener]);
      contextMenuListener = (event): void => {
        event.preventDefault();
        const hit = activeSelectionController.hitTest(
          Object.freeze({
            x: event.clientX,
            y: event.clientY,
            coordinateSpace: "screen",
          }),
        );
        if (hit === null) {
          selectEditorObjects([]);
        } else if (!editorSelection.has(hit.objectId)) {
          selectEditorObjects([hit.objectId]);
        }
        const hasEditableSelection = selectedEditableObjects().length > 0;
        const hasEditableObjects = documentSession.collection.objects.some(
          (object) => object.visible && !object.locked,
        );
        setContextMenu(
          Object.freeze({
            x: event.clientX,
            y: event.clientY,
            canCopy: hasEditableSelection,
            canCut: hasEditableSelection,
            canPaste: editorClipboard.snapshot().canPaste,
            canDuplicate: hasEditableSelection,
            canDelete: hasEditableSelection,
            canSelectAll: hasEditableObjects,
          }),
        );
      };
      inkLayer.canvas.addEventListener("contextmenu", contextMenuListener);
      pointerInput = new PointerInputController({
        coordinateConverter,
        getCanvasBounds: () => {
          const bounds = getInkCanvasBounds();
          if (bounds === null) {
            throw new Error("Ink canvas bounds are unavailable.");
          }
          return bounds;
        },
        onStrokeStart: (update) => activeStrokeRenderer.beginStroke(update),
        onStrokeUpdate: (update) => activeStrokeRenderer.updateStroke(update),
        onStrokeFinalized: (stroke) => {
          const object = documentSession.createStrokeObject(stroke);
          activeStrokeRenderer.finalizeStroke(
            object.stroke,
            object.transform.translation,
            object.id,
          );
          try {
            activeHistoryCoordinator.executeStroke(object);
          } catch (cause) {
            synchronizeDocumentFromHistory();
            const error =
              cause instanceof Error
                ? cause
                : new Error("History stroke execution failed.", { cause });
            onError?.(error);
          }
        },
        onStrokeCancelled: ({ dirtyRect }) => activeStrokeRenderer.cancelStroke(dirtyRect),
        onError: (error) => onError?.(error),
      });
      pointerInput.attach(inkLayer.canvas);
      host.dataset.rendererState = "ready";
      host.dataset.inkState = "ready";
      host.dataset.documentState = "ready";
      host.dataset.selectionCapability = "ready";
      host.dataset.manipulationCapability = "ready";
      host.dataset.historyCapability = "ready";
      host.dataset.objectLifecycleCapability = "ready";
      host.dataset.clipboardCapability = "ready";
      host.dataset.contextMenuCapability = "ready";
      host.dataset.manipulationPointerCapture = "released";
      onControllerReady?.(controller);
      onSelectionControllerReady?.(activeSelectionController);
      onManipulationControllerReady?.(activeManipulationController);
      onHistoryControllerReady?.(activeHistoryCoordinator.controller);
      onDiagnostics?.(controller.snapshot());
      themeObserver = new MutationObserver(() => {
        if (controller.status === "mounted") {
          controller.setTheme(readTheme());
          onDiagnostics?.(controller.snapshot());
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "style", "class"],
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Canvas initialization failed.");
      host.dataset.rendererState = "error";
      host.dataset.documentState = "error";
      host.dataset.selectionCapability = "error";
      host.dataset.manipulationCapability = "error";
      host.dataset.historyCapability = "error";
      host.dataset.objectLifecycleCapability = "error";
      host.dataset.clipboardCapability = "error";
      host.dataset.contextMenuCapability = "error";
      onError?.(error);
    }

    return () => {
      themeObserver?.disconnect();
      for (const [type, listener] of editorPointerListeners) {
        inkLayer?.canvas.removeEventListener(type, listener, true);
      }
      if (contextMenuListener !== null) {
        inkLayer?.canvas.removeEventListener("contextmenu", contextMenuListener);
      }
      unsubscribeSelection?.();
      unsubscribeManipulation?.();
      manipulationController?.destroy();
      releaseManipulationPointerCapture();
      manipulationControllerRef.current = null;
      selectionControllerRef.current = null;
      releaseManipulationPointerCaptureRef.current = null;
      resetManipulationCursorRef.current = null;
      uninstallHistoryShortcuts?.();
      uninstallEditingShortcuts?.();
      editingActionsRef.current = null;
      editorClipboard.clear();
      editorSelection.clear();
      selectionGeometry.clear();
      historyCoordinator?.destroy();
      objectLifecycleActionsReadyRef.current?.(null);
      selectionController?.destroy();
      pointerInput?.destroy();
      documentSession.clear();
      selectionOverlayRenderer?.destroy();
      transformPreviewRenderer?.destroy();
      strokeRenderer?.destroy();
      selectionLayer?.destroy();
      manipulationLayer?.destroy();
      inkLayer?.destroy();
      controller.destroy();
    };
  }, [
    onControllerReady,
    onDiagnostics,
    onError,
    onHistoryControllerReady,
    onManipulationControllerReady,
    onSelectionControllerReady,
  ]);

  const performContextMenuAction = (action: EditorContextMenuAction): void => {
    const actions = editingActionsRef.current;
    setContextMenu(null);
    if (actions === null) return;
    switch (action) {
      case "copy":
        actions.copy();
        return;
      case "cut":
        actions.cut();
        return;
      case "paste":
        actions.paste();
        return;
      case "duplicate":
        actions.duplicate();
        return;
      case "delete":
        actions.deleteSelection();
        return;
      case "selectAll":
        actions.selectAll();
    }
  };

  return (
    <>
      <div
        ref={hostRef}
        className={className}
        data-testid="canvas-surface"
        data-renderer-state="initializing"
        data-selection-capability="initializing"
        data-manipulation-capability="initializing"
        data-history-capability="initializing"
        data-clipboard-capability="initializing"
        data-context-menu-capability="initializing"
      />
      {contextMenu === null ? null : (
        <EditorContextMenu
          state={contextMenu}
          onAction={performContextMenuAction}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
