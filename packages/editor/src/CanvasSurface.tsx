import {
  InkObject,
  isVectorObject,
  type EllipseGeometry,
  type LineGeometry,
  type ObjectBounds,
  type ObjectCollection,
  type PageObject,
  type RectangleGeometry,
  type Transform,
  type VectorPageObject,
} from "@folio/document";
import type { HistoryNotification, IHistoryController, IHistoryState } from "@folio/history";
import {
  createResolvedBrushSnapshot,
  createStrokeVisual,
  PointerInputController,
  StrokeRenderer,
  type ResolvedBrushSnapshot,
  type StrokeStyle,
} from "@folio/ink";
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
  type Point,
  type RenderTheme,
  type Viewport,
} from "@folio/rendering";
import {
  createSelectionController,
  createSelectionManager,
  type ScreenPoint,
  type PagePoint,
  type SelectionController,
  type SelectionPointerInput,
  type SelectionState,
} from "@folio/selection";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorClipboard } from "./EditorClipboard";
import {
  editorViewportWheelZoom,
  nextEditorViewportZoom,
  type EditorViewportSnapshot,
  type ViewportActions,
} from "./EditorViewport";
import {
  EditorContextMenu,
  type EditorContextMenuAction,
  type EditorContextMenuState,
} from "./EditorContextMenu";
import { createEditorGroupManipulationPlan, transformGroupBounds } from "./EditorGroupManipulation";
import { EditorSelectionGeometry } from "./EditorSelectionGeometry";
import { EditorSelectionSet } from "./EditorSelectionSet";
import { firstErasableInkCandidate } from "./EraserEligibility";
import {
  createEditorSelectionHitTestEngine,
  queryEditorSelectionCandidates,
} from "./EditorSelectionHitTestEngine";
import { createEditorToolRegistry, type EditorToolRegistry } from "./tools/editor-tool-registry";
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
import {
  createLineEndpointManipulationResults,
  lineWorldGeometry,
  resolveLineHandleHit,
  transformLineEndpoint,
  type LineEndpoint,
} from "./LineEndpointInteraction";
import { OverlapSelectionCycle } from "./OverlapSelectionCycle";
import { PageManipulationCoordinateMapper } from "./PageManipulationCoordinateMapper";
import { PageSelectionCoordinateMapper } from "./PageSelectionCoordinateMapper";
import {
  resolveSelectionManipulationHit,
  selectionManipulationCursorCss,
  type SelectionManipulationCursor,
} from "./SelectionManipulationTarget";
import {
  createVectorShapeDraft,
  type ShapeCreationKind,
  type VectorShapeDraft,
} from "./VectorShapeCreation";
import {
  createPageObjectRenderHook,
  createVectorShapeVisual,
  type VectorShapeVisual,
} from "./VectorShapeRendering";
import { VectorInteractionOverlayRenderer } from "./VectorInteractionOverlayRenderer";
import { formatVectorShapeMeasurement } from "./VectorShapeMeasurement";

/** Interaction capabilities currently routed by the editor adapter. */
export type CanvasInteractionMode =
  | "select"
  | "move"
  | "rotate"
  | "scale"
  | "ink"
  | "highlighter"
  | "eraser"
  | "line"
  | "rectangle"
  | "ellipse"
  | "disabled";

/** Optional appearance for future strokes; an active stroke always retains its creation style. */
export interface CanvasDrawingStyle {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
  readonly pressureEnabled?: boolean;
  readonly brush?: ResolvedBrushSnapshot;
}

/** Session-scoped object lifecycle actions exposed to the desktop composition layer. */
export interface ObjectLifecycleActions {
  readonly deleteSelection: () => boolean;
  readonly duplicateSelection: () => boolean;
}

export interface ShapeStylePatch {
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
}

export interface ShapeEditingActions {
  readonly updateStyle: (patch: ShapeStylePatch) => boolean;
}

export interface ShapeEditingSnapshot {
  readonly objectId: string;
  readonly objectType: "line" | "rectangle" | "ellipse";
  readonly strokeColor: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly viewportBounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  readonly viewportSize: Readonly<{ width: number; height: number }>;
}

/** Public composition and lifecycle callbacks accepted by {@link CanvasSurface}. */
export interface CanvasSurfaceProps {
  /** Optional host class name supplied by the desktop shell. */
  readonly className?: string;
  /** Active pointer-input mode without remounting the canvas lifecycle. */
  readonly interactionMode?: CanvasInteractionMode;
  /** Optional style consumed only when a new pen or highlighter stroke begins. */
  readonly drawingStyle?: CanvasDrawingStyle;
  /** Receives the mounted rendering controller. */
  readonly onControllerReady?: (controller: CanvasController) => void;
  /** Receives the interface-oriented selection controller. */
  readonly onSelectionControllerReady?: (controller: SelectionController) => void;
  /** Receives the interface-oriented manipulation controller. */
  readonly onManipulationControllerReady?: (
    controller: ManipulationController<ManipulationResult>,
  ) => void;
  /** Receives the extensible mounted tool registry and null during cleanup. */
  readonly onToolRegistryReady?: (registry: EditorToolRegistry | null) => void;
  /** Receives the interface-oriented History controller for programmatic operations. */
  readonly onHistoryControllerReady?: (controller: IHistoryController<ObjectCollection>) => void;
  /** Receives session-bound delete/duplicate actions and null during cleanup. */
  readonly onObjectLifecycleActionsReady?: (actions: ObjectLifecycleActions | null) => void;
  /** Receives session-bound vector appearance actions and null during cleanup. */
  readonly onShapeEditingActionsReady?: (actions: ShapeEditingActions | null) => void;
  /** Receives presentation data for one selected vector object, or null. */
  readonly onShapeEditingChange?: (snapshot: ShapeEditingSnapshot | null) => void;
  /** Receives immutable selection state only after logical changes. */
  readonly onSelectionChange?: (state: SelectionState) => void;
  /** Receives immutable manipulation state only after logical transitions. */
  readonly onManipulationChange?: (state: ManipulationState) => void;
  /** Receives immutable post-operation History notifications. */
  readonly onHistoryChange?: (notification: HistoryNotification) => void;
  /** Receives immutable rendering diagnostics at lifecycle checkpoints. */
  readonly onDiagnostics?: (snapshot: CanvasControllerSnapshot) => void;
  /** Receives session-bound viewport actions and null during cleanup. */
  readonly onViewportActionsReady?: (actions: ViewportActions | null) => void;
  /** Receives a small immutable presentation snapshot after viewport changes. */
  readonly onViewportChange?: (snapshot: EditorViewportSnapshot) => void;
  /** Reports the first successful Space + Drag canvas movement in this editor session. */
  readonly onViewportNavigationLearned?: () => void;
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

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
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
    case "highlighter":
    case "eraser":
    case "line":
    case "rectangle":
    case "ellipse":
    case "disabled":
      return null;
  }
}

const DUPLICATE_OFFSET = Object.freeze({ x: 10, y: 10 });

function isLineObject(
  object: PageObject | undefined,
): object is Extract<VectorPageObject, { readonly type: "line" }> {
  return object !== undefined && isVectorObject(object) && object.type === "line";
}

type SelectPointerRoute = "selection" | ManipulationKind | "overlap-selection" | "line-endpoint";

interface ActiveLineEndpointInteraction {
  readonly pointerId: number;
  readonly object: Extract<VectorPageObject, { readonly type: "line" }>;
  readonly endpoint: LineEndpoint;
  readonly sessionId: string;
  readonly sessionTimestamp: number;
  readonly origin: ScreenPoint;
  readonly initialTransform: Transform;
  finalTransform: Transform;
  moved: boolean;
}

function createShapeEditingSnapshot(
  object: VectorPageObject,
  bounds: ObjectBounds,
  viewport: Viewport,
): ShapeEditingSnapshot {
  const topLeft = viewport.worldToViewport({
    x: viewport.pageRect.x + bounds.x,
    y: viewport.pageRect.y + bounds.y,
  });
  return Object.freeze({
    objectId: object.id,
    objectType: object.type,
    strokeColor: object.style.strokeColor.hex,
    strokeWidth: object.style.strokeWidth,
    opacity: object.style.strokeColor.opacity,
    viewportBounds: Object.freeze({
      x: topLeft.x,
      y: topLeft.y,
      width: bounds.width * viewport.camera.zoom,
      height: bounds.height * viewport.camera.zoom,
    }),
    viewportSize: Object.freeze({ ...viewport.size }),
  });
}

/** Mounts and owns one editor canvas stack for the lifetime of the React host. */
export function CanvasSurface({
  className,
  interactionMode = "ink",
  drawingStyle,
  onControllerReady,
  onSelectionControllerReady,
  onManipulationControllerReady,
  onToolRegistryReady,
  onHistoryControllerReady,
  onObjectLifecycleActionsReady,
  onShapeEditingActionsReady,
  onShapeEditingChange,
  onSelectionChange,
  onManipulationChange,
  onHistoryChange,
  onDiagnostics,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
  onError,
}: CanvasSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);
  const interactionModeRef = useRef(interactionMode);
  const drawingStyleRef = useRef(drawingStyle);
  const toolRegistryRef = useRef<EditorToolRegistry | null>(null);
  const updateToolDiagnosticsRef = useRef<(() => void) | null>(null);
  const manipulationControllerRef = useRef<ManipulationController<ManipulationResult> | null>(null);
  const selectionControllerRef = useRef<SelectionController | null>(null);
  const releaseManipulationPointerCaptureRef = useRef<(() => void) | null>(null);
  const resetManipulationCursorRef = useRef<(() => void) | null>(null);
  const resetVectorHoverRef = useRef<(() => void) | null>(null);
  const selectionChangeRef = useRef(onSelectionChange);
  const manipulationChangeRef = useRef(onManipulationChange);
  const historyChangeRef = useRef(onHistoryChange);
  const objectLifecycleActionsReadyRef = useRef(onObjectLifecycleActionsReady);
  const shapeEditingActionsReadyRef = useRef(onShapeEditingActionsReady);
  const shapeEditingChangeRef = useRef(onShapeEditingChange);
  const viewportActionsReadyRef = useRef(onViewportActionsReady);
  const viewportChangeRef = useRef(onViewportChange);
  const viewportNavigationLearnedRef = useRef(onViewportNavigationLearned);
  const editingActionsRef = useRef<EditorEditingShortcutActions | null>(null);

  useLayoutEffect(() => {
    interactionModeRef.current = interactionMode;
    const kind = manipulationKindForMode(interactionMode);
    const activeKind = manipulationControllerRef.current?.getManipulationState().kind ?? null;
    if (kind === null || (activeKind !== null && activeKind !== kind)) {
      manipulationControllerRef.current?.cancelManipulation();
      releaseManipulationPointerCaptureRef.current?.();
    }
    if (interactionMode === "ink" || interactionMode === "highlighter") {
      selectionControllerRef.current?.clearSelection();
    }
    resetManipulationCursorRef.current?.();
    resetVectorHoverRef.current?.();
    toolRegistryRef.current?.activate(interactionMode);
    updateToolDiagnosticsRef.current?.();
  }, [interactionMode]);

  useEffect(() => {
    drawingStyleRef.current = drawingStyle;
    updateToolDiagnosticsRef.current?.();
  }, [drawingStyle]);

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
    shapeEditingActionsReadyRef.current = onShapeEditingActionsReady;
  }, [onShapeEditingActionsReady]);

  useEffect(() => {
    shapeEditingChangeRef.current = onShapeEditingChange;
  }, [onShapeEditingChange]);

  useEffect(() => {
    viewportActionsReadyRef.current = onViewportActionsReady;
  }, [onViewportActionsReady]);

  useEffect(() => {
    viewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    viewportNavigationLearnedRef.current = onViewportNavigationLearned;
  }, [onViewportNavigationLearned]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const documentSession = new InkDocumentSession();
    const editorClipboard = new EditorClipboard();
    const editorSelection = new EditorSelectionSet();
    const selectionGeometry = new EditorSelectionGeometry();
    let synchronizeViewportLayers: (snapshot: CanvasControllerSnapshot) => void = () => undefined;
    const controller = new CanvasController({
      theme: readTheme(),
      overlayHooks: [
        createPageObjectRenderHook(
          () => documentSession.collection.objects,
          (objectIds) => {
            host.dataset.renderedObjectOrder = JSON.stringify(objectIds);
          },
        ),
      ],
      onViewportChange: (snapshot) => synchronizeViewportLayers(snapshot),
      onError: (error) => onError?.(error),
    });
    let themeObserver: MutationObserver | null = null;
    let pointerInput: PointerInputController | null = null;
    let strokeRenderer: StrokeRenderer | null = null;
    let inkLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let selectionLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let selectionOverlayRenderer: SelectionOverlayRenderer | null = null;
    let vectorInteractionLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let vectorInteractionRenderer: VectorInteractionOverlayRenderer | null = null;
    let selectionController: SelectionController | null = null;
    let unsubscribeSelection: (() => void) | null = null;
    let manipulationLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let transformPreviewRenderer: TransformPreviewRenderer | null = null;
    let shapePreviewLayer: ReturnType<CanvasController["createOverlayLayer"]> | null = null;
    let shapePreviewRenderer: TransformPreviewRenderer | null = null;
    let measurementElement: HTMLDivElement | null = null;
    let manipulationController: ManipulationController<ManipulationResult> | null = null;
    let unsubscribeManipulation: (() => void) | null = null;
    let historyCoordinator: EditorHistoryCoordinator | null = null;
    let toolRegistry: EditorToolRegistry | null = null;
    let uninstallHistoryShortcuts: (() => void) | null = null;
    let uninstallEditingShortcuts: (() => void) | null = null;
    let toolKeyboardDownListener: ((event: KeyboardEvent) => void) | null = null;
    let toolKeyboardUpListener: ((event: KeyboardEvent) => void) | null = null;
    let viewportBlurListener: (() => void) | null = null;
    let contextMenuListener: ((event: MouseEvent) => void) | null = null;
    let viewportPresentationFrame: number | null = null;
    let latestViewportPresentation: EditorViewportSnapshot | null = null;
    let manipulationPointerCapture: Readonly<{
      canvas: HTMLCanvasElement;
      pointerId: number;
    }> | null = null;
    let shapePointerCapture: Readonly<{
      canvas: HTMLCanvasElement;
      pointerId: number;
    }> | null = null;
    const selectPointerRoutes = new Map<number, SelectPointerRoute>();
    const overlapSelectionCycle = new OverlapSelectionCycle();
    let altSelectionActive = false;
    let lastPointerPosition: ScreenPoint | null = null;
    let overlapPointerOrigin: ScreenPoint | null = null;
    let overlapPointerMoved = false;
    let activeLineEndpointInteraction: ActiveLineEndpointInteraction | null = null;
    const editorPointerListeners: Array<readonly [keyof HTMLElementEventMap, EventListener]> = [];
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
    const releaseShapePointerCapture = (): void => {
      const capture = shapePointerCapture;
      shapePointerCapture = null;
      if (capture === null) return;
      try {
        capture.canvas.releasePointerCapture(capture.pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
    };

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
        const cursorCss = selectionManipulationCursorCss(cursor);
        if ((inkLayer.canvas.dataset.viewportPanState ?? "idle") === "idle") {
          inkLayer.canvas.style.cursor = cursorCss;
        } else {
          inkLayer.canvas.dataset.viewportRestoreCursor = cursorCss;
        }
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
        finalizedPresentation: "external",
      });
      const activeStrokeRenderer = strokeRenderer;
      const objectSource = {
        getObjects: () => documentSession.collection.objects,
        getObject: (objectId: string) => documentSession.collection.lookup(objectId),
      };
      const selectionManager = createSelectionManager();
      const hitTestEngine = createEditorSelectionHitTestEngine(
        objectSource,
        () => viewport.camera.zoom,
      );
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
        style: {
          outlineColor: "#7183ce",
          highlightColor: "rgba(113, 131, 206, 0.065)",
          outlineWidth: 1.5,
        },
      });
      selectionLayer.canvas.dataset.selectionPresentation = "soft";
      const activeSelectionOverlayRenderer = selectionOverlayRenderer;
      vectorInteractionLayer = controller.createOverlayLayer({
        name: "vector-interaction",
        ariaLabel: "Vector hover and selection feedback",
      });
      vectorInteractionRenderer = new VectorInteractionOverlayRenderer({
        context: vectorInteractionLayer.context,
        canvas: vectorInteractionLayer.canvas,
        viewport,
      });
      const activeVectorInteractionRenderer = vectorInteractionRenderer;
      inkLayer.canvas.style.zIndex = "1";
      vectorInteractionLayer.canvas.style.zIndex = "3";
      selectionLayer.canvas.style.zIndex = "4";
      const updateViewportDiagnostics = (): void => {
        const pageRect = viewport.pageViewportRect;
        host.dataset.viewportZoom = String(viewport.camera.zoom);
        host.dataset.viewportMode = controller.viewportMode;
        host.dataset.viewportCameraX = String(viewport.camera.position.x);
        host.dataset.viewportCameraY = String(viewport.camera.position.y);
        host.dataset.viewportPageX = String(pageRect.x);
        host.dataset.viewportPageY = String(pageRect.y);
        host.dataset.viewportPageWidth = String(pageRect.width);
        host.dataset.viewportPageHeight = String(pageRect.height);
        host.dataset.viewportWidth = String(viewport.size.width);
        host.dataset.viewportHeight = String(viewport.size.height);
      };
      const updateDocumentDiagnostics = (): void => {
        const snapshot = documentSession.snapshot();
        const strokeStyles = documentSession.collection.objects
          .filter((object): object is InkObject => object instanceof InkObject)
          .map((object) => ({
            id: object.id,
            color: object.style.color,
            width: object.style.width,
            opacity: object.style.opacity,
            pressureEnabled: object.style.pressureEnabled,
          }));
        const strokeBrushes = documentSession.collection.objects
          .filter((object): object is InkObject => object instanceof InkObject)
          .map((object) => ({
            id: object.id,
            presetId: object.stroke.brush.presetId,
            presetVersion: object.stroke.brush.presetVersion,
            family: object.stroke.brush.family,
            rendererKind: object.stroke.brush.renderer.kind,
            size: object.stroke.brush.size,
            opacity: object.stroke.brush.opacity,
          }));
        const vectorStyles = documentSession.collection.objects
          .filter(isVectorObject)
          .map((object) => ({
            id: object.id,
            type: object.type,
            color: object.style.strokeColor.hex,
            width: object.style.strokeWidth,
            opacity: object.style.strokeColor.opacity,
          }));
        if (inkLayer !== null) {
          inkLayer.canvas.dataset.documentObjectCount = String(snapshot.objectCount);
          inkLayer.canvas.dataset.documentInkObjectCount = String(snapshot.inkObjectCount);
          inkLayer.canvas.dataset.inkStrokeCount = String(snapshot.inkObjectCount);
          inkLayer.canvas.dataset.documentVectorObjectCount = String(
            documentSession.collection.statistics.vectorObjectCount,
          );
          inkLayer.canvas.dataset.documentObjectsImmutable = String(snapshot.allObjectsImmutable);
          inkLayer.canvas.dataset.documentStrokeStyles = JSON.stringify(strokeStyles);
          inkLayer.canvas.dataset.documentStrokeBrushes = JSON.stringify(strokeBrushes);
          inkLayer.canvas.dataset.documentVectorStyles = JSON.stringify(vectorStyles);
        }
        host.dataset.documentObjectCount = String(snapshot.objectCount);
        host.dataset.documentVectorObjectCount = String(
          documentSession.collection.statistics.vectorObjectCount,
        );
        host.dataset.documentVectorObjectTypes = JSON.stringify(
          documentSession.collection.objects.filter(isVectorObject).map(({ type }) => type),
        );
        host.dataset.documentStrokeStyles = JSON.stringify(strokeStyles);
        host.dataset.documentStrokeBrushes = JSON.stringify(strokeBrushes);
        host.dataset.documentVectorStyles = JSON.stringify(vectorStyles);
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
        const selectedVector =
          selectedGeometry?.objects.length === 1 && isVectorObject(selectedObject)
            ? selectedObject
            : null;
        activeSelectionOverlayRenderer.setSelection(
          selectedObject === undefined ||
            selectionBounds === undefined ||
            selectedVector?.type === "line"
            ? null
            : { objectId: selectedObject.id, bounds: selectionBounds },
        );
        activeVectorInteractionRenderer.setSelection(selectedVector);
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
        shapeEditingChangeRef.current?.(
          selectedVector === null || selectionBounds === undefined
            ? null
            : createShapeEditingSnapshot(selectedVector, selectionBounds, viewport),
        );
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
      shapePreviewLayer = controller.createOverlayLayer({
        name: "shape-preview",
        ariaLabel: "Shape creation preview",
      });
      shapePreviewRenderer = new TransformPreviewRenderer({
        context: shapePreviewLayer.context,
        canvas: shapePreviewLayer.canvas,
        viewport,
        style: { opacity: 1, clearPadding: 4 },
      });
      const activeShapePreviewRenderer = shapePreviewRenderer;
      shapePreviewLayer.canvas.style.zIndex = "2";
      measurementElement = document.createElement("div");
      const activeMeasurementElement = measurementElement;
      activeMeasurementElement.dataset.shapeMeasurement = "hidden";
      activeMeasurementElement.setAttribute("aria-hidden", "true");
      Object.assign(activeMeasurementElement.style, {
        position: "absolute",
        zIndex: "4",
        display: "none",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        border: "1px solid var(--folio-border, rgba(37, 37, 34, 0.12))",
        borderRadius: "9px",
        background: "color-mix(in srgb, var(--folio-surface, #ffffff) 92%, transparent)",
        color: "var(--folio-ink, #252522)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.13)",
        backdropFilter: "blur(12px)",
        padding: "5px 8px",
        font: "600 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif",
        letterSpacing: "0.01em",
        fontVariantNumeric: "tabular-nums",
      });
      host.appendChild(activeMeasurementElement);
      const manipulationCoordinateMapper = new PageManipulationCoordinateMapper({
        coordinateConverter,
        viewport,
        getCanvasBounds: getInkCanvasBounds,
      });
      const manipulationManager = createManipulationManager();
      const strokeVisuals = new Map<
        string,
        Readonly<{
          object: InkObject;
          scale: number;
          visual: ReturnType<typeof createStrokeVisual>;
        }>
      >();
      const vectorVisuals = new Map<
        string,
        Readonly<{ object: VectorPageObject; scale: number; visual: VectorShapeVisual }>
      >();
      let renderedDocumentObjects: readonly PageObject[] = documentSession.collection.objects;
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
        for (const objectId of vectorVisuals.keys()) {
          if (!documentSession.collection.has(objectId)) vectorVisuals.delete(objectId);
        }
        activeVectorInteractionRenderer.setHover(null);
        const nextDocumentObjects = documentSession.collection.objects;
        const documentChanged =
          nextDocumentObjects.length !== renderedDocumentObjects.length ||
          nextDocumentObjects.some((object, index) => object !== renderedDocumentObjects[index]);
        renderedDocumentObjects = nextDocumentObjects;
        if (documentChanged) controller.requestRender({ kind: "page" });
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
      const shapeEditingActions: ShapeEditingActions = Object.freeze({
        updateStyle: (patch: ShapeStylePatch): boolean => {
          const selected = selectedEditableObjects();
          const object = selected.length === 1 ? selected[0] : undefined;
          if (!isVectorObject(object)) return false;
          const strokeColor = patch.strokeColor ?? object.style.strokeColor.hex;
          const opacity = patch.opacity ?? object.style.strokeColor.opacity;
          const strokeWidth = patch.strokeWidth ?? object.style.strokeWidth;
          if (
            strokeColor === object.style.strokeColor.hex &&
            opacity === object.style.strokeColor.opacity &&
            strokeWidth === object.style.strokeWidth
          ) {
            return false;
          }
          try {
            const state = activeHistoryCoordinator.executeVectorStyleUpdate(object, {
              strokeColor: Object.freeze({ hex: strokeColor, opacity }),
              strokeWidth,
              ...(object.style.fillColor === undefined
                ? {}
                : { fillColor: object.style.fillColor }),
            });
            updateHistoryDiagnostics(state);
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "Shape appearance update failed.");
          }
        },
      });
      shapeEditingActionsReadyRef.current?.(shapeEditingActions);
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
          const cached = strokeVisuals.get(object.id);
          const visual =
            cached?.object === object && cached.scale === state.finalObjectScale
              ? cached.visual
              : createStrokeVisual(object.stroke, state.finalObjectScale);
          if (cached?.visual !== visual) {
            strokeVisuals.set(
              object.id,
              Object.freeze({ object, scale: state.finalObjectScale, visual }),
            );
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
        } else if (
          state.phase === "dragging" &&
          isVectorObject(object) &&
          state.finalObjectTranslation !== null &&
          state.finalObjectRotation !== null &&
          state.finalObjectScale !== null
        ) {
          const cached = vectorVisuals.get(object.id);
          const visual =
            cached?.object === object && cached.scale === state.finalObjectScale
              ? cached.visual
              : createVectorShapeVisual(object, state.finalObjectScale);
          if (cached?.visual !== visual) {
            vectorVisuals.set(
              object.id,
              Object.freeze({ object, scale: state.finalObjectScale, visual }),
            );
          }
          activeTransformPreviewRenderer.setPreview({
            objectId: object.id,
            bounds: object.localBounds,
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
      const publishViewportPresentation = (snapshot: CanvasControllerSnapshot): void => {
        if (snapshot.viewport === null) return;
        latestViewportPresentation = Object.freeze({
          zoom: snapshot.viewport.camera.zoom,
          mode: snapshot.viewportMode,
          minZoom: viewport.camera.minZoom,
          maxZoom: viewport.camera.maxZoom,
        });
        if (viewportPresentationFrame !== null) return;
        viewportPresentationFrame = requestAnimationFrame(() => {
          viewportPresentationFrame = null;
          const presentation = latestViewportPresentation;
          latestViewportPresentation = null;
          if (presentation !== null) viewportChangeRef.current?.(presentation);
        });
      };
      synchronizeViewportLayers = (snapshot): void => {
        activeStrokeRenderer.redraw();
        activeTransformPreviewRenderer.redraw();
        activeShapePreviewRenderer.redraw();
        activeSelectionOverlayRenderer.redraw();
        activeVectorInteractionRenderer.redraw();
        updateSelection(activeSelectionController.getSelection(), false);
        updateManipulation(activeManipulationController.getManipulationState(), false);
        updateDocumentDiagnostics();
        publishViewportPresentation(snapshot);
        onDiagnostics?.(snapshot);
      };
      const viewportActions: ViewportActions = Object.freeze({
        zoomIn: () =>
          controller.setZoom(
            nextEditorViewportZoom(
              viewport.camera.zoom,
              "in",
              viewport.camera.minZoom,
              viewport.camera.maxZoom,
            ),
          ),
        zoomOut: () =>
          controller.setZoom(
            nextEditorViewportZoom(
              viewport.camera.zoom,
              "out",
              viewport.camera.minZoom,
              viewport.camera.maxZoom,
            ),
          ),
        setZoom: (zoom: number) => controller.setZoom(zoom),
        resetZoom: () => controller.resetZoom(),
        zoomAt: (zoom: number, viewportAnchor: Point) => controller.zoomAt(zoom, viewportAnchor),
        panBy: (viewportDelta: Point) => controller.panBy(viewportDelta),
        fitPage: () => controller.fitPage(),
        fitWidth: () => controller.fitWidth(),
      });
      viewportActionsReadyRef.current?.(viewportActions);
      synchronizeViewportLayers(controller.snapshot());

      const editorPointerIds = new Set<number>();
      const viewportPanPointerIds = new Set<number>();
      let spacePanHeld = false;
      let pointerOverCanvas = false;
      let navigationTeachingReported = false;
      let activeViewportPan: {
        pointerId: number;
        lastViewportPoint: Point;
        source: "space" | "middle";
      } | null = null;
      const setViewportPanCursor = (state: "idle" | "grab" | "grabbing"): void => {
        const canvas = inkLayer?.canvas;
        if (canvas === undefined) return;
        const previousState = canvas.dataset.viewportPanState ?? "idle";
        if (state !== "idle" && previousState === "idle") {
          canvas.dataset.viewportRestoreCursor = canvas.style.cursor || "default";
        }
        canvas.dataset.viewportPanState = state;
        host.dataset.viewportPanState = state;
        if (state === "idle") {
          canvas.style.cursor =
            canvas.dataset.viewportRestoreCursor ??
            canvas.dataset.desktopCursorCss ??
            canvas.dataset.editorCursor ??
            "default";
          delete canvas.dataset.viewportRestoreCursor;
        } else {
          canvas.style.cursor = state;
        }
      };
      setViewportPanCursor("idle");
      const pointerViewportPoint = (event: PointerEvent): Point | null => {
        const bounds = getInkCanvasBounds();
        if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return null;
        return coordinateConverter.screenToCanvas({ x: event.clientX, y: event.clientY }, bounds);
      };
      const finishViewportPan = (pointerId: number, releaseCapture: boolean): void => {
        if (activeViewportPan?.pointerId !== pointerId) return;
        activeViewportPan = null;
        if (releaseCapture) {
          try {
            inkLayer?.canvas.releasePointerCapture(pointerId);
          } catch {
            // Capture may already have been released by the browser.
          }
        }
        setViewportPanCursor(spacePanHeld ? "grab" : "idle");
      };
      const cancelViewportPan = (): void => {
        const pointerId = activeViewportPan?.pointerId;
        if (pointerId !== undefined) finishViewportPan(pointerId, true);
        viewportPanPointerIds.clear();
        spacePanHeld = false;
        setViewportPanCursor("idle");
      };
      const handleViewportPointer = (
        phase: SelectionPointerInput["phase"],
        event: PointerEvent,
      ): boolean => {
        const active = activeViewportPan;
        if (phase === "down") {
          viewportPanPointerIds.delete(event.pointerId);
          const startsViewportPan =
            active === null &&
            editorPointerIds.size === 0 &&
            (event.button === 1 || (spacePanHeld && event.button === 0));
          if (!startsViewportPan) return false;
          const point = pointerViewportPoint(event);
          if (point === null) return false;
          event.preventDefault();
          event.stopImmediatePropagation();
          activeViewportPan = {
            pointerId: event.pointerId,
            lastViewportPoint: point,
            source: event.button === 1 ? "middle" : "space",
          };
          viewportPanPointerIds.add(event.pointerId);
          try {
            inkLayer?.canvas.setPointerCapture(event.pointerId);
          } catch {
            // Panning remains available while the pointer stays over the canvas.
          }
          setViewportPanCursor("grabbing");
          return true;
        }
        if (active?.pointerId === event.pointerId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (phase === "move") {
            const point = pointerViewportPoint(event);
            if (point !== null) {
              const delta = {
                x: point.x - active.lastViewportPoint.x,
                y: point.y - active.lastViewportPoint.y,
              };
              const cameraBeforePan = viewport.camera.position;
              viewportActions.panBy(delta);
              const cameraMoved =
                viewport.camera.position.x !== cameraBeforePan.x ||
                viewport.camera.position.y !== cameraBeforePan.y;
              if (active.source === "space" && !navigationTeachingReported && cameraMoved) {
                navigationTeachingReported = true;
                host.dataset.navigationTeachingLearned = "true";
                viewportNavigationLearnedRef.current?.();
              }
              active.lastViewportPoint = point;
            }
          } else {
            finishViewportPan(event.pointerId, phase !== "cancel");
          }
          return true;
        }
        if (viewportPanPointerIds.has(event.pointerId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (phase === "up" || phase === "cancel") viewportPanPointerIds.delete(event.pointerId);
          return true;
        }
        if (spacePanHeld && editorPointerIds.size === 0 && phase === "move") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setViewportPanCursor("grab");
          return true;
        }
        return false;
      };
      const handleViewportKeyboard = (phase: "down" | "up", event: KeyboardEvent): boolean => {
        if (
          event.code !== "Space" ||
          isEditableKeyboardTarget(event.target) ||
          (phase === "down" && event.target instanceof HTMLButtonElement && !pointerOverCanvas)
        ) {
          return false;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (phase === "down") {
          spacePanHeld = true;
          if (activeViewportPan === null && editorPointerIds.size === 0) {
            setViewportPanCursor("grab");
          }
        } else {
          spacePanHeld = false;
          if (activeViewportPan === null) setViewportPanCursor("idle");
        }
        return true;
      };

      const selectionCandidatesAt = (position: ScreenPoint): readonly PageObject[] => {
        const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
        if (pagePosition === null) return Object.freeze([]);
        return Object.freeze(
          queryEditorSelectionCandidates(hitTestEngine, pagePosition)
            .map(({ objectId }) => documentSession.collection.lookup(objectId))
            .filter((object): object is PageObject => object !== undefined),
        );
      };
      const updateOverlapPreview = (position: ScreenPoint | null): PageObject | null => {
        if (!altSelectionActive || position === null || interactionModeRef.current !== "select") {
          host.dataset.overlapCandidateId = "";
          return null;
        }
        const candidates = selectionCandidatesAt(position);
        const candidateId = overlapSelectionCycle.preview(
          candidates.map(({ id }) => id),
          activeSelectionController.getSelection().selectedObjectId,
        );
        const candidate =
          candidateId === null ? undefined : documentSession.collection.lookup(candidateId);
        host.dataset.overlapCandidateId = candidate?.id ?? "";
        host.dataset.overlapCandidateCount = String(candidates.length);
        activeVectorInteractionRenderer.setHover(candidate ?? null, "candidate");
        return candidate ?? null;
      };
      const updateManipulationCursor = (position: ScreenPoint): void => {
        if (
          interactionModeRef.current !== "select" ||
          activeManipulationController.hasActiveSession() ||
          activeLineEndpointInteraction !== null
        ) {
          return;
        }
        const selection = selectionGeometry.resolve(
          documentSession.collection,
          editorSelection.ids,
        );
        const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
        if (selection === null || pagePosition === null) {
          activeVectorInteractionRenderer.setLineHandleHover(null);
          resetManipulationCursor();
          return;
        }
        const selectedObject =
          editorSelection.size === 1
            ? documentSession.collection.lookup(editorSelection.ids[0] ?? "")
            : undefined;
        if (isLineObject(selectedObject)) {
          const lineHit = resolveLineHandleHit(selectedObject, pagePosition, viewport.camera.zoom);
          activeVectorInteractionRenderer.setLineHandleHover(lineHit?.handle ?? null);
          setManipulationCursor(lineHit?.cursor ?? "default");
          return;
        }
        activeVectorInteractionRenderer.setLineHandleHover(null);
        const hit = resolveSelectionManipulationHit({
          bounds: selection.bounds,
          position: pagePosition,
          zoom: viewport.camera.zoom,
        });
        setManipulationCursor(hit?.cursor ?? "default");
      };
      const updateVectorHover = (
        position: ScreenPoint | null,
        mode: CanvasInteractionMode,
      ): void => {
        if (
          position === null ||
          mode !== "select" ||
          activeManipulationController.hasActiveSession() ||
          activeLineEndpointInteraction !== null
        ) {
          activeVectorInteractionRenderer.setHover(null);
          return;
        }
        if (altSelectionActive) {
          updateOverlapPreview(position);
          return;
        }
        activeVectorInteractionRenderer.setHover(selectionCandidatesAt(position)[0] ?? null);
      };
      resetVectorHoverRef.current = () => activeVectorInteractionRenderer.setHover(null);

      const finishLineEndpointInteraction = (commit: boolean): void => {
        const interaction = activeLineEndpointInteraction;
        if (interaction === null) return;
        try {
          if (commit && interaction.moved) {
            const results = createLineEndpointManipulationResults({
              objectId: interaction.object.id,
              sessionId: interaction.sessionId,
              sessionTimestamp: interaction.sessionTimestamp,
              initialTransform: interaction.initialTransform,
              finalTransform: interaction.finalTransform,
            });
            if (results.length > 0) {
              const state = activeHistoryCoordinator.executeManipulations(results, {
                id: interaction.sessionId,
                description: "Adjust line endpoint",
              });
              updateHistoryDiagnostics(state);
            }
          }
        } catch (cause) {
          reportEditingFailure(cause, "Line endpoint update failed.");
        } finally {
          activeLineEndpointInteraction = null;
          activeTransformPreviewRenderer.setPreview(null);
          activeVectorInteractionRenderer.setLineEndpointPreview(null);
          hideShapeMeasurement();
          host.dataset.lineEndpointInteraction = "idle";
        }
      };
      const updateLineEndpointInteraction = (
        interaction: ActiveLineEndpointInteraction,
        position: ScreenPoint,
      ): void => {
        const pagePosition = manipulationCoordinateMapper.screenToPage(position, true);
        if (pagePosition === null) return;
        const transform = transformLineEndpoint(
          interaction.object,
          interaction.endpoint,
          pagePosition,
        );
        if (transform === null) return;
        interaction.finalTransform = transform;
        interaction.moved ||=
          Math.hypot(position.x - interaction.origin.x, position.y - interaction.origin.y) >= 3;
        const geometry = lineWorldGeometry(interaction.object, transform);
        activeTransformPreviewRenderer.setPreview({
          objectId: interaction.object.id,
          bounds: interaction.object.localBounds,
          transform,
          visual: createVectorShapeVisual(interaction.object, transform.scale),
        });
        activeVectorInteractionRenderer.setLineEndpointPreview({
          object: interaction.object,
          transform,
          activeEndpoint: interaction.endpoint,
        });
        showShapeMeasurement(
          formatVectorShapeMeasurement("line", geometry),
          position.x,
          position.y,
        );
        host.dataset.lineEndpointInteraction = "dragging";
      };

      const bridgeEditorPointer = (
        phase: SelectionPointerInput["phase"],
        event: PointerEvent,
        mode: CanvasInteractionMode = interactionModeRef.current,
      ): void => {
        const position: ScreenPoint = Object.freeze({
          x: event.clientX,
          y: event.clientY,
          coordinateSpace: "screen",
        });
        lastPointerPosition = position;
        if (phase === "move") {
          updateManipulationCursor(position);
          updateVectorHover(position, mode);
        }
        if (mode === "ink") {
          resetManipulationCursor();
          return;
        }
        event.preventDefault();
        if (phase !== "down") event.stopImmediatePropagation();
        if (mode === "select") {
          let route = selectPointerRoutes.get(event.pointerId);
          if (phase === "down") {
            if (altSelectionActive && event.isPrimary && event.button === 0) {
              route = "overlap-selection";
              overlapPointerOrigin = position;
              overlapPointerMoved = false;
              selectPointerRoutes.set(event.pointerId, route);
            }
            const selectedGeometry = selectionGeometry.resolve(
              documentSession.collection,
              editorSelection.ids,
            );
            const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
            const selectedLine =
              editorSelection.size === 1
                ? documentSession.collection.lookup(editorSelection.ids[0] ?? "")
                : undefined;
            const lineHit =
              route === undefined && isLineObject(selectedLine) && pagePosition !== null
                ? resolveLineHandleHit(selectedLine, pagePosition, viewport.camera.zoom)
                : null;
            if (
              isLineObject(selectedLine) &&
              (lineHit?.handle === "start" || lineHit?.handle === "end")
            ) {
              route = "line-endpoint";
              activeLineEndpointInteraction = {
                pointerId: event.pointerId,
                object: selectedLine,
                endpoint: lineHit.handle,
                sessionId: `line-endpoint-${selectedLine.id}-${Date.now().toString(36)}`,
                sessionTimestamp: Date.now(),
                origin: position,
                initialTransform: selectedLine.transform,
                finalTransform: selectedLine.transform,
                moved: false,
              };
              activeVectorInteractionRenderer.setLineEndpointPreview({
                object: selectedLine,
                transform: selectedLine.transform,
                activeEndpoint: lineHit.handle,
              });
              setManipulationCursor("crosshair");
              host.dataset.lineEndpointInteraction = "armed";
            } else if (lineHit?.handle === "midpoint") {
              route = "translation";
              setManipulationCursor("grab");
            }
            const hit =
              selectedGeometry === null || pagePosition === null
                ? null
                : resolveSelectionManipulationHit({
                    bounds: selectedGeometry.bounds,
                    position: pagePosition,
                    zoom: viewport.camera.zoom,
                  });
            if (route === undefined) {
              route = isLineObject(selectedLine) ? "selection" : (hit?.kind ?? "selection");
              if (hit !== null && !isLineObject(selectedLine)) setManipulationCursor(hit.cursor);
            }
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
          } else if (route === "overlap-selection") {
            if (phase === "move" && overlapPointerOrigin !== null) {
              overlapPointerMoved ||=
                Math.hypot(
                  position.x - overlapPointerOrigin.x,
                  position.y - overlapPointerOrigin.y,
                ) >= 3;
            } else if (phase === "up" && !overlapPointerMoved) {
              const candidates = selectionCandidatesAt(position);
              const candidateId = overlapSelectionCycle.commit(
                candidates.map(({ id }) => id),
                activeSelectionController.getSelection().selectedObjectId,
              );
              if (candidateId !== null) selectEditorObjects([candidateId]);
              updateOverlapPreview(position);
            }
            if (phase === "up" || phase === "cancel") {
              overlapPointerOrigin = null;
              overlapPointerMoved = false;
            }
          } else if (route === "line-endpoint") {
            const interaction = activeLineEndpointInteraction;
            if (interaction?.pointerId === event.pointerId) {
              if (phase === "move" || phase === "up") {
                updateLineEndpointInteraction(interaction, position);
              }
              if (phase === "up" || phase === "cancel") {
                finishLineEndpointInteraction(phase === "up");
              }
            }
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
        const ownsManipulation =
          activeManipulationController.hasActiveSession() || activeLineEndpointInteraction !== null;
        const shouldCaptureManipulation =
          (manipulationKindForMode(mode) !== null ||
            (mode === "select" &&
              !["selection", "overlap-selection"].includes(
                selectPointerRoutes.get(event.pointerId) ?? "selection",
              ))) &&
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
        const listener: EventListener = (nativeEvent) => {
          const event = nativeEvent as PointerEvent;
          pointerOverCanvas = true;
          if (handleViewportPointer(phase, event)) return;
          if (phase === "down") editorPointerIds.add(event.pointerId);
          toolRegistry?.handlePointer(phase, event);
          if (phase === "up" || phase === "cancel") {
            editorPointerIds.delete(event.pointerId);
            if (spacePanHeld && editorPointerIds.size === 0 && activeViewportPan === null) {
              setViewportPanCursor("grab");
            }
          }
        };
        inkLayer?.canvas.addEventListener(type, listener, true);
        editorPointerListeners.push([type, listener]);
      };
      addEditorPointerListener("pointerdown", "down");
      addEditorPointerListener("pointermove", "move");
      addEditorPointerListener("pointerup", "up");
      addEditorPointerListener("pointercancel", "cancel");
      addEditorPointerListener("lostpointercapture", "cancel");
      const wheelListener: EventListener = (nativeEvent) => {
        const event = nativeEvent as WheelEvent;
        const bounds = getInkCanvasBounds();
        if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const deltaScale =
          event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? Math.max(viewport.size.height, 1)
              : 1;
        if (event.ctrlKey) {
          const anchor = coordinateConverter.screenToCanvas(
            { x: event.clientX, y: event.clientY },
            bounds,
          );
          viewportActions.zoomAt(
            editorViewportWheelZoom(
              viewport.camera.zoom,
              event.deltaY,
              event.deltaMode,
              viewport.size.height,
            ),
            anchor,
          );
        } else {
          viewportActions.panBy({
            x: -event.deltaX * deltaScale,
            y: -event.deltaY * deltaScale,
          });
        }
      };
      inkLayer.canvas.addEventListener("wheel", wheelListener, { capture: true, passive: false });
      editorPointerListeners.push(["wheel", wheelListener]);
      host.dataset.viewportWheelPolicy = "ctrl-zoom-wheel-pan";
      const cursorLeaveListener: EventListener = () => {
        pointerOverCanvas = false;
        if (
          !activeManipulationController.hasActiveSession() &&
          activeViewportPan === null &&
          !spacePanHeld
        ) {
          resetManipulationCursor();
        }
        activeVectorInteractionRenderer.setHover(null);
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
      const resolveDrawingStyle = (): Readonly<{
        color: string;
        width: number;
        opacity: number;
        pressureEnabled: boolean;
        brush?: ResolvedBrushSnapshot;
      }> => {
        const highlighter = interactionModeRef.current === "highlighter";
        return {
          color: drawingStyleRef.current?.color ?? (highlighter ? "#facc15" : "#111111"),
          width: drawingStyleRef.current?.width ?? (highlighter ? 12 : 2),
          opacity: drawingStyleRef.current?.opacity ?? (highlighter ? 0.34 : 1),
          pressureEnabled: drawingStyleRef.current?.pressureEnabled ?? !highlighter,
          ...(drawingStyleRef.current?.brush === undefined
            ? {}
            : { brush: drawingStyleRef.current.brush }),
        };
      };
      const dynamicStrokeStyle: Partial<StrokeStyle> = {
        get color() {
          return resolveDrawingStyle().color;
        },
        get width() {
          return resolveDrawingStyle().width;
        },
        get opacity() {
          return resolveDrawingStyle().opacity;
        },
        get pressureEnabled() {
          return resolveDrawingStyle().pressureEnabled;
        },
      };
      pointerInput = new PointerInputController({
        coordinateConverter,
        getCanvasBounds: () => {
          const bounds = getInkCanvasBounds();
          if (bounds === null) {
            throw new Error("Ink canvas bounds are unavailable.");
          }
          return bounds;
        },
        style: dynamicStrokeStyle,
        resolveBrush: () => {
          const style = resolveDrawingStyle();
          if (style.brush !== undefined) return style.brush;
          const family = interactionModeRef.current === "highlighter" ? "highlighter" : "pen";
          return createResolvedBrushSnapshot({
            schemaVersion: 1,
            presetId: `editor-default-${family}`,
            presetVersion: 1,
            family,
            color: style.color,
            size: style.width,
            opacity: style.opacity,
            smoothing: Object.freeze({ mode: "none", amount: 0 }),
            dynamics: Object.freeze({
              pressureSize: Object.freeze({
                enabled: style.pressureEnabled,
                minimumFactor: style.pressureEnabled ? 0.5 : 1,
                maximumFactor: style.pressureEnabled ? 1.5 : 1,
                curve: Object.freeze({ kind: "linear", exponent: 1 }),
              }),
              pressureOpacity: Object.freeze({
                enabled: false,
                minimumFactor: 1,
                maximumFactor: 1,
                curve: Object.freeze({ kind: "linear", exponent: 1 }),
              }),
            }),
            renderer: Object.freeze({ version: 1, kind: "centerline" }),
          });
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
      const activePointerInput = pointerInput;
      const activeInkCanvas = inkLayer.canvas;
      let activeShapeCreation: Readonly<{
        kind: ShapeCreationKind;
        pointerId: number;
        start: PagePoint;
        rawCurrent: PagePoint;
        clientX: number;
        clientY: number;
        draft: VectorShapeDraft;
      }> | null = null;
      let shapeConstraintActive = false;
      let eraserPointerId: number | null = null;
      let eraserDeletedObject = false;
      let eraserObjectIds = new Set<string>();
      const releaseEraserCapture = (): void => {
        if (eraserPointerId === null) return;
        try {
          activeInkCanvas.releasePointerCapture(eraserPointerId);
        } catch {
          // Capture can already be released after a platform pointer cancellation.
        }
      };
      const finishEraserGesture = (commit: boolean): void => {
        if (eraserPointerId === null) return;
        const controllerState = activeHistoryCoordinator.controller.getHistoryState();
        try {
          if (controllerState.activeTransaction !== null) {
            const state =
              commit && eraserDeletedObject
                ? activeHistoryCoordinator.controller.commitTransaction()
                : activeHistoryCoordinator.controller.rollbackTransaction();
            updateHistoryDiagnostics(state);
          }
        } catch (cause) {
          reportEditingFailure(cause, "Eraser transaction cleanup failed.");
        } finally {
          releaseEraserCapture();
          eraserPointerId = null;
          eraserDeletedObject = false;
          eraserObjectIds = new Set<string>();
          host.dataset.eraserState = "idle";
        }
      };
      const eraseAtPointer = (event: PointerEvent): void => {
        const object = firstErasableInkCandidate(
          selectionCandidatesAt(
            Object.freeze({
              x: event.clientX,
              y: event.clientY,
              coordinateSpace: "screen",
            }),
          ),
          eraserObjectIds,
        );
        if (object === null) return;
        try {
          const state = activeHistoryCoordinator.executeManipulation(
            createDeleteManipulationResult({ objectId: object.id }),
          );
          eraserObjectIds.add(object.id);
          eraserDeletedObject = true;
          updateHistoryDiagnostics(state);
          host.dataset.eraserDeletedCount = String(eraserObjectIds.size);
        } catch (cause) {
          reportEditingFailure(cause, "Whole-stroke eraser execution failed.");
          finishEraserGesture(false);
        }
      };
      const hideShapeMeasurement = (): void => {
        activeMeasurementElement.style.display = "none";
        activeMeasurementElement.dataset.shapeMeasurement = "hidden";
        activeMeasurementElement.textContent = "";
        host.dataset.shapeMeasurement = "";
      };
      const showShapeMeasurement = (
        measurement: string,
        clientX: number,
        clientY: number,
      ): void => {
        const hostBounds = host.getBoundingClientRect();
        activeMeasurementElement.textContent = measurement;
        activeMeasurementElement.style.display = "block";
        activeMeasurementElement.style.left = `${Math.max(
          8,
          Math.min(host.clientWidth - 230, clientX - hostBounds.left + 14),
        )}px`;
        activeMeasurementElement.style.top = `${Math.max(
          8,
          Math.min(host.clientHeight - 32, clientY - hostBounds.top + 14),
        )}px`;
        activeMeasurementElement.dataset.shapeMeasurement = "visible";
        host.dataset.shapeMeasurement = measurement;
      };
      const clearShapeCreation = (): void => {
        activeShapeCreation = null;
        shapeConstraintActive = false;
        activeShapePreviewRenderer.setPreview(null);
        hideShapeMeasurement();
        releaseShapePointerCapture();
        host.dataset.shapeCreationState = "idle";
        host.dataset.shapeCreationType = "";
        host.dataset.shapeMeasurement = "";
      };
      const shapeDrawingStyle = () => {
        const style = resolveDrawingStyle();
        return Object.freeze({
          strokeColor: Object.freeze({ hex: style.color, opacity: style.opacity }),
          strokeWidth: style.width,
        });
      };
      const clampToPage = (point: PagePoint): PagePoint =>
        Object.freeze({
          x: Math.max(0, Math.min(viewport.pageRect.width, point.x)),
          y: Math.max(0, Math.min(viewport.pageRect.height, point.y)),
          coordinateSpace: "page",
        });
      const renderShapeCreation = (
        rawCurrent: PagePoint,
        constrain: boolean,
        clientX: number,
        clientY: number,
      ): void => {
        const creation = activeShapeCreation;
        if (creation === null) return;
        const draft = createVectorShapeDraft(
          creation.kind,
          creation.start,
          rawCurrent,
          constrain,
          creation.draft.style,
        );
        activeShapeCreation = Object.freeze({
          ...creation,
          rawCurrent,
          clientX,
          clientY,
          draft,
        });
        activeShapePreviewRenderer.setPreview({
          objectId: `preview-${creation.kind}`,
          bounds: draft.localBounds,
          transform: Object.freeze({
            translation: Object.freeze({ x: 0, y: 0 }),
            rotation: 0,
            scale: 1,
          }),
          visual: createVectorShapeVisual(draft),
        });
        showShapeMeasurement(draft.measurement, clientX, clientY);
        host.dataset.shapePreviewValid = String(draft.valid);
      };
      const createShapeObject = (draft: VectorShapeDraft): PageObject => {
        switch (draft.type) {
          case "line":
            return documentSession.createLineObject(draft.geometry as LineGeometry, draft.style);
          case "rectangle":
            return documentSession.createRectangleObject(
              draft.geometry as RectangleGeometry,
              draft.style,
            );
          case "ellipse":
            return documentSession.createEllipseObject(
              draft.geometry as EllipseGeometry,
              draft.style,
            );
        }
      };
      const commitShapeCreation = (): void => {
        const creation = activeShapeCreation;
        if (creation === null) return;
        if (!creation.draft.valid) {
          clearShapeCreation();
          return;
        }
        try {
          const object = createShapeObject(creation.draft);
          const state = activeHistoryCoordinator.executeObjectCreation(object);
          updateHistoryDiagnostics(state);
          selectEditorObjects([object.id]);
          host.dataset.lastCreatedShapeType = object.type;
          host.dataset.lastCreatedShapeId = object.id;
        } catch (cause) {
          reportEditingFailure(cause, "Shape creation History execution failed.");
        } finally {
          clearShapeCreation();
        }
      };
      const createShapeTool = (kind: ShapeCreationKind) => ({
        id: kind,
        cursor: "crosshair",
        deactivate: clearShapeCreation,
        pointerDown: (event: PointerEvent) => {
          if (!event.isPrimary || event.button !== 0 || activeShapeCreation !== null) return;
          const position = manipulationCoordinateMapper.screenToPage(
            Object.freeze({
              x: event.clientX,
              y: event.clientY,
              coordinateSpace: "screen" as const,
            }),
            false,
          );
          if (position === null) return;
          event.preventDefault();
          const start = clampToPage(position);
          const draft = createVectorShapeDraft(
            kind,
            start,
            start,
            event.shiftKey,
            shapeDrawingStyle(),
          );
          activeShapeCreation = Object.freeze({
            kind,
            pointerId: event.pointerId,
            start,
            rawCurrent: start,
            clientX: event.clientX,
            clientY: event.clientY,
            draft,
          });
          shapeConstraintActive = event.shiftKey;
          selectEditorObjects([]);
          activeInkCanvas.setPointerCapture(event.pointerId);
          shapePointerCapture = Object.freeze({
            canvas: activeInkCanvas,
            pointerId: event.pointerId,
          });
          host.dataset.shapeCreationState = "dragging";
          host.dataset.shapeCreationType = kind;
          renderShapeCreation(start, event.shiftKey, event.clientX, event.clientY);
        },
        pointerMove: (event: PointerEvent) => {
          if (event.pointerId !== activeShapeCreation?.pointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const position = manipulationCoordinateMapper.screenToPage(
            Object.freeze({
              x: event.clientX,
              y: event.clientY,
              coordinateSpace: "screen" as const,
            }),
            true,
          );
          if (position !== null) {
            renderShapeCreation(
              clampToPage(position),
              shapeConstraintActive || event.shiftKey,
              event.clientX,
              event.clientY,
            );
          }
        },
        pointerUp: (event: PointerEvent) => {
          if (event.pointerId !== activeShapeCreation?.pointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const position = manipulationCoordinateMapper.screenToPage(
            Object.freeze({
              x: event.clientX,
              y: event.clientY,
              coordinateSpace: "screen" as const,
            }),
            true,
          );
          if (position !== null) {
            renderShapeCreation(
              clampToPage(position),
              shapeConstraintActive || event.shiftKey,
              event.clientX,
              event.clientY,
            );
          }
          commitShapeCreation();
        },
        pointerCancel: (event: PointerEvent) => {
          if (event.pointerId !== activeShapeCreation?.pointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          clearShapeCreation();
        },
        keyboardDown: (event: KeyboardEvent) => {
          const creation = activeShapeCreation;
          if (creation === null) return;
          if (event.key === "Escape") {
            event.preventDefault();
            clearShapeCreation();
          } else if (event.key === "Shift") {
            event.preventDefault();
            if (shapeConstraintActive) return;
            shapeConstraintActive = true;
            renderShapeCreation(creation.rawCurrent, true, creation.clientX, creation.clientY);
          }
        },
        keyboardUp: (event: KeyboardEvent) => {
          const creation = activeShapeCreation;
          if (creation !== null && event.key === "Shift") {
            event.preventDefault();
            shapeConstraintActive = false;
            renderShapeCreation(creation.rawCurrent, false, creation.clientX, creation.clientY);
          }
        },
      });
      const createDelegatingTool = (
        id: CanvasInteractionMode,
        mode: CanvasInteractionMode,
        cursor: string,
      ) => ({
        id,
        cursor,
        pointerDown: (event: PointerEvent) => bridgeEditorPointer("down", event, mode),
        pointerMove: (event: PointerEvent) => bridgeEditorPointer("move", event, mode),
        pointerUp: (event: PointerEvent) => bridgeEditorPointer("up", event, mode),
        pointerCancel: (event: PointerEvent) => bridgeEditorPointer("cancel", event, mode),
      });
      toolRegistry = createEditorToolRegistry({
        setCursor: (cursor) => {
          activeInkCanvas.dataset.editorCursor = cursor;
          if ((activeInkCanvas.dataset.viewportPanState ?? "idle") === "idle") {
            activeInkCanvas.style.cursor = cursor;
          } else {
            activeInkCanvas.dataset.viewportRestoreCursor = cursor;
          }
        },
        requestTemporaryRender: () => {
          activeTransformPreviewRenderer.redraw();
          activeShapePreviewRenderer.redraw();
          activeSelectionOverlayRenderer.redraw();
          activeVectorInteractionRenderer.redraw();
        },
      });
      const activeToolRegistry = toolRegistry;
      const clearOverlapSelectionPreview = (): void => {
        altSelectionActive = false;
        overlapSelectionCycle.reset();
        host.dataset.overlapCandidateId = "";
        host.dataset.overlapCandidateCount = "0";
        updateVectorHover(lastPointerPosition, "select");
      };
      activeToolRegistry.register({
        ...createDelegatingTool("select", "select", "default"),
        deactivate: clearOverlapSelectionPreview,
        keyboardDown: (event: KeyboardEvent) => {
          if (event.key !== "Alt" || altSelectionActive) return;
          altSelectionActive = true;
          event.preventDefault();
          updateOverlapPreview(lastPointerPosition);
        },
        keyboardUp: (event: KeyboardEvent) => {
          if (event.key !== "Alt") return;
          event.preventDefault();
          clearOverlapSelectionPreview();
        },
      });
      activeToolRegistry.register(createDelegatingTool("move", "move", "grab"));
      activeToolRegistry.register(createDelegatingTool("rotate", "rotate", "crosshair"));
      activeToolRegistry.register(createDelegatingTool("scale", "scale", "nwse-resize"));
      for (const id of ["ink", "highlighter"] as const) {
        activeToolRegistry.register({
          id,
          cursor: "crosshair",
          activate: () => activePointerInput.attach(activeInkCanvas),
          deactivate: () => activePointerInput.detach(),
        });
      }
      activeToolRegistry.register(createShapeTool("line"));
      activeToolRegistry.register(createShapeTool("rectangle"));
      activeToolRegistry.register(createShapeTool("ellipse"));
      activeToolRegistry.register({
        id: "eraser",
        cursor: "cell",
        activate: () => {
          host.dataset.eraserState = "idle";
        },
        deactivate: () => finishEraserGesture(false),
        pointerDown: (event) => {
          if (!event.isPrimary || event.button !== 0 || eraserPointerId !== null) return;
          event.preventDefault();
          eraserPointerId = event.pointerId;
          eraserDeletedObject = false;
          eraserObjectIds = new Set<string>();
          try {
            activeHistoryCoordinator.controller.beginTransaction({
              id: "erase-strokes-" + Date.now().toString(36) + "-" + event.pointerId,
              timestamp: new Date().toISOString(),
              description: "Erase strokes",
            });
            activeInkCanvas.setPointerCapture(event.pointerId);
            host.dataset.eraserState = "erasing";
            eraseAtPointer(event);
          } catch (cause) {
            reportEditingFailure(cause, "Whole-stroke eraser could not start.");
            finishEraserGesture(false);
          }
        },
        pointerMove: (event) => {
          if (event.pointerId !== eraserPointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          eraseAtPointer(event);
        },
        pointerUp: (event) => {
          if (event.pointerId !== eraserPointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          finishEraserGesture(true);
        },
        pointerCancel: (event) => {
          if (event.pointerId !== eraserPointerId) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          finishEraserGesture(false);
        },
      });
      activeToolRegistry.register({ id: "disabled", cursor: "not-allowed" });
      const updateToolDiagnostics = (): void => {
        const style = resolveDrawingStyle();
        const snapshot = activeToolRegistry.snapshot();
        host.dataset.activeEditorTool = snapshot.activeToolId ?? "";
        host.dataset.toolRegistrySize = String(snapshot.registeredToolIds.length);
        host.dataset.drawingColor = style.color;
        host.dataset.drawingWidth = String(style.width);
        host.dataset.drawingOpacity = String(style.opacity);
        host.dataset.drawingPressure = String(style.pressureEnabled);
      };
      toolRegistryRef.current = activeToolRegistry;
      updateToolDiagnosticsRef.current = updateToolDiagnostics;
      activeToolRegistry.activate(interactionModeRef.current);
      updateToolDiagnostics();
      onToolRegistryReady?.(activeToolRegistry);
      toolKeyboardDownListener = (event) => {
        if (!handleViewportKeyboard("down", event)) {
          activeToolRegistry.handleKeyboard("down", event);
        }
      };
      toolKeyboardUpListener = (event) => {
        if (!handleViewportKeyboard("up", event)) {
          activeToolRegistry.handleKeyboard("up", event);
        }
      };
      viewportBlurListener = cancelViewportPan;
      window.addEventListener("keydown", toolKeyboardDownListener, true);
      window.addEventListener("keyup", toolKeyboardUpListener, true);
      window.addEventListener("blur", viewportBlurListener);
      host.dataset.rendererState = "ready";
      host.dataset.inkState = "ready";
      host.dataset.documentState = "ready";
      host.dataset.selectionCapability = "ready";
      host.dataset.manipulationCapability = "ready";
      host.dataset.historyCapability = "ready";
      host.dataset.objectLifecycleCapability = "ready";
      host.dataset.clipboardCapability = "ready";
      host.dataset.contextMenuCapability = "ready";
      host.dataset.shapeCreationCapability = "ready";
      host.dataset.shapeCreationState = "idle";
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
      if (toolKeyboardDownListener !== null) {
        window.removeEventListener("keydown", toolKeyboardDownListener, true);
      }
      if (toolKeyboardUpListener !== null) {
        window.removeEventListener("keyup", toolKeyboardUpListener, true);
      }
      if (viewportBlurListener !== null) {
        window.removeEventListener("blur", viewportBlurListener);
      }
      if (viewportPresentationFrame !== null) {
        cancelAnimationFrame(viewportPresentationFrame);
        viewportPresentationFrame = null;
      }
      viewportActionsReadyRef.current?.(null);
      unsubscribeSelection?.();
      unsubscribeManipulation?.();
      manipulationController?.destroy();
      releaseManipulationPointerCapture();
      manipulationControllerRef.current = null;
      selectionControllerRef.current = null;
      releaseManipulationPointerCaptureRef.current = null;
      resetManipulationCursorRef.current = null;
      resetVectorHoverRef.current = null;
      toolRegistry?.destroy();
      releaseShapePointerCapture();
      toolRegistryRef.current = null;
      updateToolDiagnosticsRef.current = null;
      onToolRegistryReady?.(null);
      uninstallHistoryShortcuts?.();
      uninstallEditingShortcuts?.();
      editingActionsRef.current = null;
      editorClipboard.clear();
      editorSelection.clear();
      selectionGeometry.clear();
      historyCoordinator?.destroy();
      objectLifecycleActionsReadyRef.current?.(null);
      shapeEditingActionsReadyRef.current?.(null);
      shapeEditingChangeRef.current?.(null);
      selectionController?.destroy();
      pointerInput?.destroy();
      documentSession.clear();
      selectionOverlayRenderer?.destroy();
      vectorInteractionRenderer?.destroy();
      transformPreviewRenderer?.destroy();
      shapePreviewRenderer?.destroy();
      strokeRenderer?.destroy();
      selectionLayer?.destroy();
      vectorInteractionLayer?.destroy();
      manipulationLayer?.destroy();
      shapePreviewLayer?.destroy();
      inkLayer?.destroy();
      measurementElement?.remove();
      controller.destroy();
    };
  }, [
    onControllerReady,
    onDiagnostics,
    onError,
    onHistoryControllerReady,
    onManipulationControllerReady,
    onSelectionControllerReady,
    onToolRegistryReady,
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
