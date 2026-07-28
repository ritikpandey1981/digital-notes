import { InkObject, type ObjectCollection } from "@folio/document";
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
import { useEffect, useRef } from "react";
import { createEditorSelectionHitTestEngine } from "./EditorSelectionHitTestEngine";
import {
  createEditorHistoryCoordinator,
  type EditorHistoryCoordinator,
} from "./history/editor-history-coordinator";
import { installEditorHistoryShortcuts } from "./history/editor-history-shortcuts";
import { InkDocumentSession } from "./InkDocumentSession";
import { PageManipulationCoordinateMapper } from "./PageManipulationCoordinateMapper";
import { PageSelectionCoordinateMapper } from "./PageSelectionCoordinateMapper";
import { resolveSelectionManipulationTarget } from "./SelectionManipulationTarget";

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
  const interactionModeRef = useRef(interactionMode);
  const manipulationControllerRef = useRef<ManipulationController<ManipulationResult> | null>(null);
  const selectionControllerRef = useRef<SelectionController | null>(null);
  const releaseManipulationPointerCaptureRef = useRef<(() => void) | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const manipulationChangeRef = useRef(onManipulationChange);
  const historyChangeRef = useRef(onHistoryChange);
  const objectLifecycleActionsReadyRef = useRef(onObjectLifecycleActionsReady);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    const kind = manipulationKindForMode(interactionMode);
    const activeKind = manipulationControllerRef.current?.getManipulationState().kind ?? null;
    if (kind === null || (activeKind !== null && activeKind !== kind)) {
      manipulationControllerRef.current?.cancelManipulation();
      releaseManipulationPointerCaptureRef.current?.();
    }
    if (interactionMode === "ink") selectionControllerRef.current?.clearSelection();
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
    let manipulationPointerCapture: Readonly<{
      canvas: HTMLCanvasElement;
      pointerId: number;
    }> | null = null;
    const selectPointerRoutes = new Map<number, "selection" | ManipulationKind>();
    const editorPointerListeners: Array<readonly [keyof HTMLElementEventMap, EventListener]> = [];
    const documentSession = new InkDocumentSession();
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
      const updateSelection = (state: SelectionState, notify: boolean): void => {
        const selectedObject =
          state.selectedObjectId === null
            ? undefined
            : documentSession.collection.lookup(state.selectedObjectId);
        activeSelectionOverlayRenderer.setSelection(
          selectedObject === undefined
            ? null
            : { objectId: selectedObject.id, bounds: selectedObject.bounds },
        );
        const selectionState = selectedObject === undefined ? "empty" : "selected";
        const selectedObjectId = selectedObject?.id ?? "";
        const selectedObjectType = selectedObject?.type ?? "";
        host.dataset.selectionState = selectionState;
        host.dataset.selectedObjectId = selectedObjectId;
        host.dataset.selectedObjectType = selectedObjectType;
        host.dataset.selectionVersion = String(state.selectionVersion);
        host.dataset.selectedObjectBoundsX = String(selectedObject?.bounds.x ?? 0);
        host.dataset.selectedObjectBoundsY = String(selectedObject?.bounds.y ?? 0);
        host.dataset.selectedObjectBoundsWidth = String(selectedObject?.bounds.width ?? 0);
        host.dataset.selectedObjectBoundsHeight = String(selectedObject?.bounds.height ?? 0);
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
        if (notify) selectionChangeRef.current?.(state);
      };
      unsubscribeSelection = activeSelectionController.subscribe((state) => {
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
        const selection = activeSelectionController.getSelection();
        if (
          selection.selectedObjectId !== null &&
          !documentSession.collection.has(selection.selectedObjectId)
        ) {
          activeSelectionController.clearSelection();
        } else {
          updateSelection(selection, false);
        }
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
        objectSource,
        onResult: (result) => {
          try {
            activeHistoryCoordinator.executeManipulation(result);
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
      const objectLifecycleActions: ObjectLifecycleActions = Object.freeze({
        deleteSelection: () => {
          const objectId = activeSelectionController.getSelection().selectedObjectId;
          if (objectId === null || !documentSession.collection.has(objectId)) return false;
          try {
            activeHistoryCoordinator.executeManipulation(
              createDeleteManipulationResult({ objectId }),
            );
            return true;
          } catch (cause) {
            const error =
              cause instanceof Error
                ? cause
                : new Error("History deletion execution failed.", { cause });
            onError?.(error);
            return false;
          }
        },
        duplicateSelection: () => {
          const objectId = activeSelectionController.getSelection().selectedObjectId;
          if (objectId === null || !documentSession.collection.has(objectId)) return false;
          try {
            const { duplicateObjectId, state } =
              activeHistoryCoordinator.executeDuplicateWithOffset(
                createDuplicateManipulationResult({ objectId }),
                DUPLICATE_OFFSET,
              );
            updateHistoryDiagnostics(state);
            activeSelectionController.selectObject(duplicateObjectId);
            return true;
          } catch (cause) {
            const error =
              cause instanceof Error
                ? cause
                : new Error("History duplication execution failed.", { cause });
            onError?.(error);
            return false;
          }
        },
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
        if (
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

      const bridgeEditorPointer = (
        phase: SelectionPointerInput["phase"],
        event: PointerEvent,
      ): void => {
        const mode = interactionModeRef.current;
        if (mode === "ink") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const position: ScreenPoint = Object.freeze({
          x: event.clientX,
          y: event.clientY,
          coordinateSpace: "screen",
        });
        if (mode === "select") {
          let route = selectPointerRoutes.get(event.pointerId);
          if (phase === "down") {
            const selectedObjectId = activeSelectionController.getSelection().selectedObjectId;
            const selectedObject =
              selectedObjectId === null
                ? undefined
                : documentSession.collection.lookup(selectedObjectId);
            const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
            const target =
              selectedObject === undefined || pagePosition === null
                ? null
                : resolveSelectionManipulationTarget({
                    bounds: selectedObject.bounds,
                    position: pagePosition,
                    zoom: viewport.camera.zoom,
                  });
            route = target ?? "selection";
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
      onError?.(error);
    }

    return () => {
      themeObserver?.disconnect();
      for (const [type, listener] of editorPointerListeners) {
        inkLayer?.canvas.removeEventListener(type, listener, true);
      }
      unsubscribeSelection?.();
      unsubscribeManipulation?.();
      manipulationController?.destroy();
      releaseManipulationPointerCapture();
      manipulationControllerRef.current = null;
      selectionControllerRef.current = null;
      releaseManipulationPointerCaptureRef.current = null;
      uninstallHistoryShortcuts?.();
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

  return (
    <div
      ref={hostRef}
      className={className}
      data-testid="canvas-surface"
      data-renderer-state="initializing"
      data-selection-capability="initializing"
      data-manipulation-capability="initializing"
      data-history-capability="initializing"
    />
  );
}
