import { InkObject } from "@folio/document";
import { createStrokeVisual, PointerInputController, StrokeRenderer } from "@folio/ink";
import {
  createManipulationController,
  createManipulationManager,
  type ManipulationController,
  type ManipulationPointerInput,
  type ManipulationState,
} from "@folio/manipulation";
import {
  CanvasController,
  SelectionOverlayRenderer,
  TranslationPreviewRenderer,
  type CanvasBounds,
  type CanvasControllerSnapshot,
  type RenderTheme,
} from "@folio/rendering";
import {
  createHitTestEngine,
  createSelectionController,
  createSelectionManager,
  type ScreenPoint,
  type SelectionController,
  type SelectionPointerInput,
  type SelectionState,
} from "@folio/selection";
import { useEffect, useRef } from "react";
import { InkDocumentSession } from "./InkDocumentSession";
import { PageManipulationCoordinateMapper } from "./PageManipulationCoordinateMapper";
import { PageSelectionCoordinateMapper } from "./PageSelectionCoordinateMapper";

/** Interaction capabilities currently routed by the editor adapter. */
export type CanvasInteractionMode = "select" | "move" | "ink" | "disabled";

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
  readonly onManipulationControllerReady?: (controller: ManipulationController) => void;
  /** Receives immutable selection state only after logical changes. */
  readonly onSelectionChange?: (state: SelectionState) => void;
  /** Receives immutable manipulation state only after logical transitions. */
  readonly onManipulationChange?: (state: ManipulationState) => void;
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

/** Mounts and owns one editor canvas stack for the lifetime of the React host. */
export function CanvasSurface({
  className,
  interactionMode = "ink",
  onControllerReady,
  onSelectionControllerReady,
  onManipulationControllerReady,
  onSelectionChange,
  onManipulationChange,
  onDiagnostics,
  onError,
}: CanvasSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const interactionModeRef = useRef(interactionMode);
  const manipulationControllerRef = useRef<ManipulationController | null>(null);
  const releaseManipulationPointerCaptureRef = useRef<(() => void) | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const manipulationChangeRef = useRef(onManipulationChange);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
    if (interactionMode !== "move") {
      manipulationControllerRef.current?.cancelManipulation();
      releaseManipulationPointerCaptureRef.current?.();
    }
  }, [interactionMode]);

  useEffect(() => {
    selectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    manipulationChangeRef.current = onManipulationChange;
  }, [onManipulationChange]);

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
    let translationPreviewRenderer: TranslationPreviewRenderer | null = null;
    let manipulationController: ManipulationController | null = null;
    let unsubscribeManipulation: (() => void) | null = null;
    let manipulationPointerCapture: Readonly<{
      canvas: HTMLCanvasElement;
      pointerId: number;
    }> | null = null;
    const editorPointerListeners: Array<readonly [keyof HTMLElementEventMap, EventListener]> = [];
    const documentSession = new InkDocumentSession();
    const releaseManipulationPointerCapture = (): void => {
      const capture = manipulationPointerCapture;
      manipulationPointerCapture = null;
      if (capture === null) return;
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
      const hitTestEngine = createHitTestEngine({ objectSource });
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
      const updateDocumentDiagnostics = (): void => {
        const snapshot = documentSession.snapshot();
        if (inkLayer !== null) {
          inkLayer.canvas.dataset.documentObjectCount = String(snapshot.objectCount);
          inkLayer.canvas.dataset.documentInkObjectCount = String(snapshot.inkObjectCount);
          inkLayer.canvas.dataset.documentObjectsImmutable = String(snapshot.allObjectsImmutable);
        }
        host.dataset.documentObjectCount = String(snapshot.objectCount);
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
        host.dataset.selectedObjectTranslationX = String(
          selectedObject?.transform.translation.x ?? 0,
        );
        host.dataset.selectedObjectTranslationY = String(
          selectedObject?.transform.translation.y ?? 0,
        );
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
        ariaLabel: "Object movement preview",
      });
      translationPreviewRenderer = new TranslationPreviewRenderer({
        context: manipulationLayer.context,
        canvas: manipulationLayer.canvas,
        viewport,
      });
      const activeTranslationPreviewRenderer = translationPreviewRenderer;
      manipulationLayer.canvas.style.zIndex = "2";
      const manipulationCoordinateMapper = new PageManipulationCoordinateMapper({
        coordinateConverter,
        viewport,
        getCanvasBounds: getInkCanvasBounds,
      });
      const manipulationManager = createManipulationManager();
      const strokeVisuals = new Map<string, ReturnType<typeof createStrokeVisual>>();
      manipulationController = createManipulationController({
        manager: manipulationManager,
        selectionSource: activeSelectionController,
        objectSource,
        onCommit: (commit) => {
          const translated = documentSession.translateObject(
            commit.objectId,
            commit.translation.movementVector,
          );
          if (translated === null) return false;
          activeStrokeRenderer.setStrokeTranslation(
            translated.stroke.id,
            translated.transform.translation,
          );
          updateDocumentDiagnostics();
          updateSelection(activeSelectionController.getSelection(), false);
          return true;
        },
        onError: (error) => onError?.(error),
      });
      const activeManipulationController = manipulationController;
      manipulationControllerRef.current = activeManipulationController;
      const updateManipulation = (state: ManipulationState, notify: boolean): void => {
        host.dataset.manipulationPhase = state.phase;
        host.dataset.manipulationVersion = String(state.version);
        host.dataset.manipulationObjectId = state.objectId ?? "";
        host.dataset.manipulationTranslationX = String(state.translation.translationX);
        host.dataset.manipulationTranslationY = String(state.translation.translationY);
        const object =
          state.objectId === null ? undefined : documentSession.collection.lookup(state.objectId);
        if (
          state.phase === "dragging" &&
          object instanceof InkObject &&
          state.finalObjectTranslation !== null
        ) {
          let visual = strokeVisuals.get(object.id);
          if (visual === undefined) {
            visual = createStrokeVisual(object.stroke);
            strokeVisuals.set(object.id, visual);
          }
          activeTranslationPreviewRenderer.setPreview({
            objectId: object.id,
            bounds: visual.bounds,
            translation: state.finalObjectTranslation,
            visual,
          });
        } else {
          activeTranslationPreviewRenderer.setPreview(null);
        }
        if (state.phase === "committing" || state.phase === "cancelling") {
          releaseManipulationPointerCapture();
        }
        if (notify) manipulationChangeRef.current?.(state);
      };
      unsubscribeManipulation = activeManipulationController.subscribe((state) =>
        updateManipulation(state, true),
      );
      inkLayer.setResizeHandler(() => activeStrokeRenderer.redraw());
      manipulationLayer.setResizeHandler(() => activeTranslationPreviewRenderer.redraw());
      selectionLayer.setResizeHandler(() => activeSelectionOverlayRenderer.redraw());
      activeStrokeRenderer.redraw();
      activeTranslationPreviewRenderer.redraw();
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
          activeSelectionController.handlePointer({
            phase,
            pointerId: event.pointerId,
            button: event.button,
            isPrimary: event.isPrimary,
            position,
          });
        } else if (mode === "move") {
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
          };
          activeManipulationController.handlePointer(input);
        } else {
          return;
        }
        const ownsManipulation = activeManipulationController.hasActiveSession();
        const shouldCaptureManipulation = mode === "move" && ownsManipulation;
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
          const object = documentSession.completeStroke(stroke);
          activeStrokeRenderer.finalizeStroke(object.stroke);
          updateDocumentDiagnostics();
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
      host.dataset.manipulationPointerCapture = "released";
      onControllerReady?.(controller);
      onSelectionControllerReady?.(activeSelectionController);
      onManipulationControllerReady?.(activeManipulationController);
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
      releaseManipulationPointerCaptureRef.current = null;
      selectionController?.destroy();
      pointerInput?.destroy();
      documentSession.clear();
      selectionOverlayRenderer?.destroy();
      translationPreviewRenderer?.destroy();
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
    />
  );
}
