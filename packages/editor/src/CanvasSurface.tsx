import {
  InkObject,
  Transform,
  isVectorObject,
  type EllipseGeometry,
  type LineGeometry,
  type ObjectBounds,
  orientPageGeometry,
  Page,
  PageDocument,
  paperTypeDefinition,
  SketchbookDocument,
  type PageOrientation,
  type PaperType,
  type PageObject,
  type RectangleGeometry,
  type VectorPageObject,
} from "@folio/document";
import type { HistoryNotification, IHistoryController, IHistoryState } from "@folio/history";
import {
  createResolvedBrushSnapshot,
  createStrokeVisual,
  getStrokeRenderedBounds,
  getStrokeTransformPivot,
  getStrokeVisualLocalBounds,
  createPencilMaterialRuntime,
  materialTileRect,
  pencilGeometryDiagnostics,
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
  orientedFrameGeometry,
  SelectionOverlayRenderer,
  TransformPreviewRenderer,
  type SelectionOverlayOrientation,
  type CanvasBounds,
  type CanvasControllerSnapshot,
  type Point,
  type Rect,
  type RenderPage,
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
import { RuntimeActivation, runtimeCallback } from "./runtime-activation";
import type { ProjectRuntime, ProjectRuntimeHost } from "./project-runtime-host";
import {
  createCanvasArtworkColorSampler,
  type ArtworkColorSampleResult,
} from "./ArtworkColorSampler";
import { ContinuousVectorStyleEdit } from "./ContinuousVectorStyleEdit";
import { SELECTION_HIGHLIGHT_COLOR, SELECTION_OUTLINE_COLOR } from "./selection-presentation";
import { committedArtworkColor, committedVectorRecolor } from "./artwork-color-usage";
import { hexToRgb } from "./foundation/color-conversion";
import {
  isEditableKeyboardTarget,
  isInteractiveKeyboardTarget,
} from "./foundation/interactive-keyboard-target";
import { EditorClipboard } from "./EditorClipboard";
import {
  LOUPE_DIAMETER,
  resolveLoupeCenterIndicator,
  resolveLoupePlacement,
  resolveLoupeSourceRect,
} from "./EyedropperLoupe";
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
import { ContinuousLayerOpacityEdit } from "./ContinuousLayerOpacityEdit";
import { ContinuousPaperColorEdit } from "./ContinuousPaperColorEdit";
import { ContinuousSelectionStyleEdit } from "./ContinuousSelectionStyleEdit";
import {
  marqueeActivated,
  marqueeRectFromPoints,
  marqueeSelectedObjects,
} from "./MarqueeSelection";
import { createEffectiveObjectState, type EffectiveObjectState } from "./EffectiveObjectState";
import { resolveSelectionEditingStyle, selectionUnionBounds } from "./SelectionEditingSnapshot";
import { firstErasableInkCandidate } from "./EraserEligibility";
import {
  createEditorSelectionHitTestEngine,
  queryEditorSelectionCandidates,
} from "./EditorSelectionHitTestEngine";
import { createEditorToolRegistry, type EditorToolRegistry } from "./tools/editor-tool-registry";
import {
  createEditorHistoryCoordinator,
  resolveHistoryPageContext,
  type EditorHistoryCoordinator,
} from "./history/editor-history-coordinator";
import {
  installEditorEditingShortcuts,
  type EditorEditingShortcutActions,
} from "./history/editor-editing-shortcuts";
import { installEditorHistoryShortcuts } from "./history/editor-history-shortcuts";
import { patchVectorStyle } from "./vector-style-patch";
import type { InkDocumentSession } from "./InkDocumentSession";
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
  resolveOrientedSelectionFrame,
  resolveSelectionManipulationHit,
  selectionManipulationCursorCss,
  type SelectionManipulationCursor,
} from "./SelectionManipulationTarget";
import {
  formatRotationAngleLabel,
  normalizeRotationDegrees,
  snapRotationPointer,
} from "./RotationPresentation";
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

/** Canvas-level Escape handling beneath every floating workspace surface. */
export interface EditorEscapeActions {
  /**
   * Cancels the most local canvas interaction and reports whether one was
   * consumed. Ordering is exact-cancel first, then selection clearing, so an
   * idle canvas leaves Escape untouched. Never produces document History.
   */
  readonly escape: () => boolean;
}

export interface ShapeStylePatch {
  readonly strokeColor?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
}

/** Immutable presentation row for one Layer, ordered bottom to top. */
export interface LayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly objectCount: number;
}

/** Immutable Layer presentation state for the workspace panel. */
export interface LayersSnapshot {
  readonly layers: readonly LayerSnapshot[];
  readonly activeLayerId: string;
}

/** Session-bound Layer operations exposed to the desktop workspace. */
export interface LayerActions {
  /** Selects the active Layer. Never produces document History. */
  readonly setActiveLayer: (layerId: string) => boolean;
  readonly addLayer: () => string | null;
  readonly renameLayer: (layerId: string, name: string) => boolean;
  readonly setLayerVisible: (layerId: string, visible: boolean) => boolean;
  readonly setLayerLocked: (layerId: string, locked: boolean) => boolean;
  readonly beginLayerOpacityEdit: (layerId: string) => boolean;
  readonly previewLayerOpacity: (opacity: number) => boolean;
  readonly commitLayerOpacityEdit: () => boolean;
  readonly cancelLayerOpacityEdit: () => boolean;
  readonly moveLayer: (layerId: string, targetIndex: number) => boolean;
  readonly deleteLayer: (layerId: string) => number | null;
}

/** Immutable presentation row for one sketchbook page, first page first. */
export interface PageSnapshot {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly orientation: PageOrientation;
  readonly paperType: PaperType;
  readonly paperColor: string;
  readonly paperSpacing: number | null;
  readonly objectCount: number;
  readonly layerCount: number;
}

/** Immutable sketchbook presentation state for the page navigator. */
export interface PagesSnapshot {
  readonly pages: readonly PageSnapshot[];
  readonly activePageId: string;
}

/** Session-bound sketchbook page operations exposed to the desktop workspace. */
export interface PageActions {
  /** Selects the active page. Never produces document History. */
  readonly setActivePage: (pageId: string) => boolean;
  readonly addPage: () => string | null;
  readonly duplicatePage: (pageId: string) => string | null;
  readonly deletePage: (pageId: string) => number | null;
  readonly movePage: (pageId: string, targetIndex: number) => boolean;
  readonly renamePage: (pageId: string, name: string) => boolean;
  readonly setPageGeometry: (pageId: string, width: number, height: number) => boolean;
  readonly setPageOrientation: (pageId: string, orientation: "portrait" | "landscape") => boolean;
  readonly setPaperType: (pageId: string, type: PaperType) => boolean;
  readonly beginPaperColorEdit: (pageId: string) => boolean;
  readonly previewPaperColor: (color: string) => boolean;
  readonly commitPaperColorEdit: () => boolean;
  readonly cancelPaperColorEdit: () => boolean;
  /** True when any artwork on the page lies outside its current boundary. */
  readonly hasArtworkOutsideBounds: (pageId: string) => boolean;
  /** Immutable page value used for navigator thumbnails. */
  readonly getPage: (pageId: string) => Page | null;
}

export interface ShapeEditingActions {
  readonly updateStyle: (patch: ShapeStylePatch) => boolean;
  /** Moves the whole current selection into one Layer as a single History action. */
  readonly moveSelectionToLayer: (layerId: string) => boolean;
  readonly beginContinuousStyleEdit: () => boolean;
  readonly updateContinuousStylePreview: (patch: ShapeStylePatch) => boolean;
  readonly commitContinuousStyleEdit: () => boolean;
  readonly cancelContinuousStyleEdit: () => boolean;
}

export interface ShapeEditingSnapshot {
  readonly objectId: string;
  /** "mixed" is used whenever the selection spans more than one object kind. */
  readonly objectType: "line" | "rectangle" | "ellipse" | "ink" | "mixed";
  /** Every selected object id in canonical order; the last entry is primary. */
  readonly selectedObjectIds: readonly string[];
  /** True when the whole selection is read-only because of an object or Layer lock. */
  readonly readOnly: boolean;
  readonly layerId: string | null;
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
  readonly selectionFrame?: Readonly<{
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rotation: number;
  }>;
}

/** Public composition and lifecycle callbacks accepted by {@link CanvasSurface}. */
export interface CanvasSurfaceProps {
  /** Project-owned document authority; keep its identity stable for this canvas lifetime. */
  readonly session: InkDocumentSession;
  /** Optional transactional host. Candidates prepare resources without active input/publications. */
  readonly runtime?: Readonly<{ host: ProjectRuntimeHost; entry: ProjectRuntime }>;
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
  readonly onHistoryControllerReady?: (controller: IHistoryController<SketchbookDocument>) => void;
  /** Receives session-bound delete/duplicate actions and null during cleanup. */
  readonly onObjectLifecycleActionsReady?: (actions: ObjectLifecycleActions | null) => void;
  /** Receives the session-bound canvas Escape handler and null during cleanup. */
  readonly onEscapeActionsReady?: (actions: EditorEscapeActions | null) => void;
  /** Reports a creation attempt refused because the active Layer is hidden or locked. */
  readonly onActiveLayerRefusal?: (reason: "hidden" | "locked") => void;
  /** Receives session-bound vector appearance actions and null during cleanup. */
  readonly onShapeEditingActionsReady?: (actions: ShapeEditingActions | null) => void;
  /** Receives presentation data for one selected vector object, or null. */
  readonly onShapeEditingChange?: (snapshot: ShapeEditingSnapshot | null) => void;
  /** Receives session-bound Layer actions and null during cleanup. */
  readonly onLayerActionsReady?: (actions: LayerActions | null) => void;
  /** Receives an immutable Layer presentation snapshot after every Layer change. */
  readonly onLayersChange?: (snapshot: LayersSnapshot) => void;
  /** Receives session-bound sketchbook page actions and null during cleanup. */
  readonly onPageActionsReady?: (actions: PageActions | null) => void;
  /** Receives an immutable page snapshot after every sketchbook change. */
  readonly onPagesChange?: (snapshot: PagesSnapshot) => void;
  /** Receives immutable selection state only after logical changes. */
  readonly onSelectionChange?: (state: SelectionState) => void;
  /** Receives immutable manipulation state only after logical transitions. */
  readonly onManipulationChange?: (state: ManipulationState) => void;
  /** Receives immutable post-operation History notifications. */
  readonly onHistoryChange?: (notification: HistoryNotification) => void;
  /** Receives canonical colors read from successfully committed artwork, excluding Undo/Redo. */
  readonly onArtworkColorUsed?: (color: string) => void;
  /** Temporarily claims page input for one picker-owned artwork sampling interaction. */
  readonly artworkSamplingActive?: boolean;
  /** Receives deterministic results from picker-owned artwork sampling attempts. */
  readonly onArtworkSample?: (result: ArtworkColorSampleResult) => void;
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

function readOpaqueWorkspaceColor() {
  const fallback = document.documentElement.dataset.theme === "dark" ? "#24211f" : "#f1f1ef";
  try {
    return hexToRgb(readTheme().workspaceColor);
  } catch {
    return hexToRgb(fallback);
  }
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

/** Screen-stable presentation padding shared by every selection frame. */
const SELECTION_FRAME_PADDING_PIXELS = 4;
const SELECTION_HANDLE_HIT_RADIUS_PIXELS = 12;
const ROTATION_HANDLE_OFFSET_PIXELS = 28;
const DUPLICATE_OFFSET = Object.freeze({ x: 10, y: 10 });

/** Interaction modes that deposit new artwork onto the active Layer. */
const CREATION_INTERACTION_MODES: ReadonlySet<CanvasInteractionMode> = new Set([
  "ink",
  "highlighter",
  "line",
  "rectangle",
  "ellipse",
] satisfies readonly CanvasInteractionMode[]);

function isLineObject(
  object: PageObject | undefined,
): object is Extract<VectorPageObject, { readonly type: "line" }> {
  return object !== undefined && isVectorObject(object) && object.type === "line";
}

type SelectPointerRoute =
  "selection" | ManipulationKind | "overlap-selection" | "line-endpoint" | "marquee" | "consumed";

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
/** Mounts and owns one editor canvas stack for the lifetime of the React host. */
export function CanvasSurface({
  session,
  runtime,
  className,
  interactionMode = "ink",
  drawingStyle,
  onControllerReady,
  onSelectionControllerReady,
  onManipulationControllerReady,
  onToolRegistryReady,
  onHistoryControllerReady,
  onObjectLifecycleActionsReady,
  onEscapeActionsReady,
  onActiveLayerRefusal,
  onShapeEditingActionsReady,
  onShapeEditingChange,
  onLayerActionsReady,
  onLayersChange,
  onPageActionsReady,
  onPagesChange,
  onSelectionChange,
  onManipulationChange,
  onHistoryChange,
  onArtworkColorUsed,
  artworkSamplingActive = false,
  onArtworkSample,
  onDiagnostics,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
  onError,
}: CanvasSurfaceProps) {
  const activationRef = useRef<RuntimeActivation | null>(null);
  const renderCountRef = useRef(0);
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (hostRef.current !== null) {
      hostRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });
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
  const hideLoupeRef = useRef<(() => void) | null>(null);
  const cancelContinuousStyleEditRef = useRef<(() => boolean) | null>(null);
  const controllerReadyRef = useRef(onControllerReady);
  const selectionControllerReadyRef = useRef(onSelectionControllerReady);
  const manipulationControllerReadyRef = useRef(onManipulationControllerReady);
  const toolRegistryReadyRef = useRef(onToolRegistryReady);
  const historyControllerReadyRef = useRef(onHistoryControllerReady);
  const diagnosticsRef = useRef(onDiagnostics);
  const errorRef = useRef(onError);
  const selectionChangeRef = useRef(onSelectionChange);
  const manipulationChangeRef = useRef(onManipulationChange);
  const historyChangeRef = useRef(onHistoryChange);
  const artworkColorUsedRef = useRef(onArtworkColorUsed);
  const artworkSamplingActiveRef = useRef(artworkSamplingActive);
  const artworkSampleRef = useRef(onArtworkSample);
  const objectLifecycleActionsReadyRef = useRef(onObjectLifecycleActionsReady);
  const escapeActionsReadyRef = useRef(onEscapeActionsReady);
  const activeLayerRefusalRef = useRef(onActiveLayerRefusal);
  const shapeEditingActionsReadyRef = useRef(onShapeEditingActionsReady);
  const shapeEditingChangeRef = useRef(onShapeEditingChange);
  const layerActionsReadyRef = useRef(onLayerActionsReady);
  const layersChangeRef = useRef(onLayersChange);
  const pageActionsReadyRef = useRef(onPageActionsReady);
  const pagesChangeRef = useRef(onPagesChange);
  const viewportActionsReadyRef = useRef(onViewportActionsReady);
  const viewportChangeRef = useRef(onViewportChange);
  const viewportNavigationLearnedRef = useRef(onViewportNavigationLearned);
  const editingActionsRef = useRef<EditorEditingShortcutActions | null>(null);

  useLayoutEffect(() => {
    cancelContinuousStyleEditRef.current?.();
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
    if (activationRef.current?.active) toolRegistryRef.current?.activate(interactionMode);
    updateToolDiagnosticsRef.current?.();
  }, [interactionMode]);

  useLayoutEffect(() => {
    artworkSamplingActiveRef.current = artworkSamplingActive;
    artworkSampleRef.current = onArtworkSample;
    // One exit covers every way out: a taken sample, Escape, or the picker
    // closing all clear the flag, and the loupe leaves with it.
    if (!artworkSamplingActive) {
      hideLoupeRef.current?.();
      return;
    }
    manipulationControllerRef.current?.cancelManipulation();
    releaseManipulationPointerCaptureRef.current?.();
    resetManipulationCursorRef.current?.();
    resetVectorHoverRef.current?.();
  }, [artworkSamplingActive, onArtworkSample]);

  useLayoutEffect(() => {
    controllerReadyRef.current = onControllerReady;
    selectionControllerReadyRef.current = onSelectionControllerReady;
    manipulationControllerReadyRef.current = onManipulationControllerReady;
    toolRegistryReadyRef.current = onToolRegistryReady;
    historyControllerReadyRef.current = onHistoryControllerReady;
    diagnosticsRef.current = onDiagnostics;
    errorRef.current = onError;
  }, [
    onControllerReady,
    onDiagnostics,
    onError,
    onHistoryControllerReady,
    onManipulationControllerReady,
    onSelectionControllerReady,
    onToolRegistryReady,
  ]);

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
    artworkColorUsedRef.current = onArtworkColorUsed;
  }, [onArtworkColorUsed]);

  useEffect(() => {
    objectLifecycleActionsReadyRef.current = onObjectLifecycleActionsReady;
  }, [onObjectLifecycleActionsReady]);

  useEffect(() => {
    escapeActionsReadyRef.current = onEscapeActionsReady;
  }, [onEscapeActionsReady]);

  useEffect(() => {
    activeLayerRefusalRef.current = onActiveLayerRefusal;
  }, [onActiveLayerRefusal]);

  useEffect(() => {
    shapeEditingActionsReadyRef.current = onShapeEditingActionsReady;
  }, [onShapeEditingActionsReady]);

  useEffect(() => {
    shapeEditingChangeRef.current = onShapeEditingChange;
  }, [onShapeEditingChange]);

  useEffect(() => {
    layerActionsReadyRef.current = onLayerActionsReady;
  }, [onLayerActionsReady]);

  useEffect(() => {
    layersChangeRef.current = onLayersChange;
  }, [onLayersChange]);

  useEffect(() => {
    pageActionsReadyRef.current = onPageActionsReady;
  }, [onPageActionsReady]);

  useEffect(() => {
    pagesChangeRef.current = onPagesChange;
  }, [onPagesChange]);

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

    const activation = new RuntimeActivation(
      () => runtime === undefined || runtime.host.active === runtime.entry,
      (error) => errorRef.current?.(error),
    );
    activationRef.current = activation;
    if (runtime !== undefined) runtime.host.attach(runtime.entry, activation);
    const callbacks = {
      shapeEditingChangeRef: runtimeCallback(activation, shapeEditingChangeRef),
      selectionChangeRef: runtimeCallback(activation, selectionChangeRef),
      historyChangeRef: runtimeCallback(activation, historyChangeRef, false),
      artworkColorUsedRef: runtimeCallback(activation, artworkColorUsedRef, false),
      shapeEditingActionsReadyRef: runtimeCallback(activation, shapeEditingActionsReadyRef),
      layersChangeRef: runtimeCallback(activation, layersChangeRef),
      pagesChangeRef: runtimeCallback(activation, pagesChangeRef),
      pageActionsReadyRef: runtimeCallback(activation, pageActionsReadyRef),
      layerActionsReadyRef: runtimeCallback(activation, layerActionsReadyRef),
      objectLifecycleActionsReadyRef: runtimeCallback(activation, objectLifecycleActionsReadyRef),
      manipulationChangeRef: runtimeCallback(activation, manipulationChangeRef),
      viewportChangeRef: runtimeCallback(activation, viewportChangeRef),
      diagnosticsRef: runtimeCallback(activation, diagnosticsRef),
      viewportActionsReadyRef: runtimeCallback(activation, viewportActionsReadyRef),
      viewportNavigationLearnedRef: runtimeCallback(
        activation,
        viewportNavigationLearnedRef,
        false,
      ),
      activeLayerRefusalRef: runtimeCallback(activation, activeLayerRefusalRef, false),
      artworkSampleRef: runtimeCallback(activation, artworkSampleRef, false),
      toolRegistryReadyRef: runtimeCallback(activation, toolRegistryReadyRef),
      escapeActionsReadyRef: runtimeCallback(activation, escapeActionsReadyRef),
      controllerReadyRef: runtimeCallback(activation, controllerReadyRef),
      selectionControllerReadyRef: runtimeCallback(activation, selectionControllerReadyRef),
      manipulationControllerReadyRef: runtimeCallback(activation, manipulationControllerReadyRef),
      historyControllerReadyRef: runtimeCallback(activation, historyControllerReadyRef),
      errorRef: { current: (error: Error) => activation.report(error) },
    };
    const documentSession = session;
    const editorClipboard = new EditorClipboard();
    const editorSelection = new EditorSelectionSet();
    const selectionGeometry = new EditorSelectionGeometry();
    // One resolver owns every Layer eligibility rule for this editor instance.
    const effective = createEffectiveObjectState(() => documentSession.page);
    let synchronizeViewportLayers: (snapshot: CanvasControllerSnapshot) => void = () => undefined;
    /**
     * The project runtime's Pencil material cache.
     *
     * Owned here and nowhere else: it lives exactly as long as this editor
     * runtime, is guarded by the same activation every other outward effect is,
     * and is destroyed with it. A reconstruction slice that finishes after the
     * project has been replaced finds `activation.active` false and publishes
     * nothing, which is what stops a retired runtime from painting into its
     * successor.
     */
    let requestMaterialRepaint: (keys: readonly string[]) => void = () => undefined;
    let reportMaterialDiagnostics: () => void = () => undefined;
    const materialRuntime = createPencilMaterialRuntime({
      isActive: () => activation.active,
      onMaterialPublished: (_strokeId, keys) => requestMaterialRepaint(keys),
    });
    let controller: CanvasController;
    try {
      controller = new CanvasController({
        theme: readTheme(),
        overlayHooks: [
          createPageObjectRenderHook(
            () => documentSession.collection.objects,
            (objectIds) => {
              host.dataset.renderedObjectOrder = JSON.stringify(objectIds);
            },
            effective,
            materialRuntime,
          ),
          // Trailing, so it reports what the frame that just ran actually did.
          () => reportMaterialDiagnostics(),
        ],
        onViewportChange: (snapshot) => synchronizeViewportLayers(snapshot),
        onError: (error) => callbacks.errorRef.current?.(error),
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Canvas construction failed.");
      activation.report(error);
      const result = activation.finishPreparation(() => undefined);
      if (runtime !== undefined) runtime.host.prepared(runtime.entry, result);
      else errorRef.current?.(error);
      return () => activation.dispose();
    }
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
    let rotationIndicatorElement: HTMLDivElement | null = null;
    let rotationIndicatorFrame: number | null = null;
    let loupeElement: HTMLDivElement | null = null;
    let loupeFrame: number | null = null;
    let loupePointerListeners: Array<readonly [string, EventListener]> = [];
    let manipulationController: ManipulationController<ManipulationResult> | null = null;
    let unsubscribeManipulation: (() => void) | null = null;
    let historyCoordinator: EditorHistoryCoordinator | null = null;
    let continuousLayerOpacityEdit: ContinuousLayerOpacityEdit | null = null;
    let continuousVectorStyleEdit: ContinuousVectorStyleEdit | null = null;
    let continuousSelectionStyleEdit: ContinuousSelectionStyleEdit | null = null;
    let continuousPaperColorEdit: ContinuousPaperColorEdit | null = null;
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
    let marqueeOrigin: ScreenPoint | null = null;
    let marqueeAdditive = false;
    let marqueeBaseIds: readonly string[] = Object.freeze([]);
    let activeLineEndpointInteraction: ActiveLineEndpointInteraction | null = null;
    let artworkSamplingPointerId: number | null = null;
    /**
     * Page-space region outside the page that still accepts a select press.
     *
     * A page resize or a transform can legitimately leave an object off the
     * sheet. Selection coordinates are otherwise clipped to the page, which
     * made such an object unreachable — visible, selected, and impossible to
     * drag back. This opens exactly the selected artwork's own footprint plus
     * its handles, so empty workspace stays inert as before.
     */
    let recoverableSelectionRect: Rect | null = null;
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
      // Reconstruction publishes exact tiles as they finish, so a cold viewport
      // fills in progressively instead of arriving all at once or not at all.
      // Only the tiles that appeared are invalidated.
      let publishedDiagnostics = "";
      const publishMaterialDiagnostics = (): void => {
        const canvas = inkLayer?.canvas;
        if (canvas === undefined) return;
        const stats = materialRuntime.stats();
        // Written only when something moved: this runs after every frame, and
        // thirteen dataset writes a frame would be measurable in the very path
        // the diagnostics exist to measure.
        const signature = `${String(stats.residentTiles)}:${String(stats.scheduler.tilesPublished)}:${String(stats.presentationsBuilt)}:${String(stats.materialHits)}:${String(pencilGeometryDiagnostics().builds)}`;
        if (signature === publishedDiagnostics) return;
        publishedDiagnostics = signature;
        canvas.dataset.materialResidentTiles = String(stats.residentTiles);
        canvas.dataset.materialBytes = String(stats.residentMaterialBytes);
        canvas.dataset.materialIndexBytes = String(stats.residentIndexBytes);
        canvas.dataset.materialHits = String(stats.materialHits);
        canvas.dataset.materialMisses = String(stats.materialMisses);
        canvas.dataset.materialEvictions = String(stats.materialEvictions);
        canvas.dataset.materialSlices = String(stats.scheduler.slices);
        canvas.dataset.materialLongestSlice = stats.scheduler.longestSliceMilliseconds.toFixed(3);
        canvas.dataset.materialPublished = String(stats.scheduler.tilesPublished);
        canvas.dataset.materialCancelled = String(stats.scheduler.jobsCancelled);
        canvas.dataset.materialPresentations = String(stats.presentationsBuilt);
        canvas.dataset.materialPresentationMs = stats.presentationMillisecondsTotal.toFixed(3);
        canvas.dataset.materialLongestPresentation =
          stats.longestPresentationMilliseconds.toFixed(3);
        const geometry = pencilGeometryDiagnostics();
        canvas.dataset.materialGeometryBuilds = String(geometry.builds);
        canvas.dataset.materialGeometryDabs = String(geometry.dabs);
        canvas.dataset.materialGeometryMs = geometry.millisecondsTotal.toFixed(3);
        canvas.dataset.materialLongestGeometry = geometry.longestMilliseconds.toFixed(3);
      };
      reportMaterialDiagnostics = publishMaterialDiagnostics;
      requestMaterialRepaint = (keys) => {
        if (!activation.active) return;
        for (const key of keys) {
          controller.requestRender({
            kind: "rect",
            rect: materialTileRect(key),
            coordinateSpace: "page",
          });
        }
        publishMaterialDiagnostics();
      };
      const viewport = controller.viewport;
      const coordinateConverter = controller.coordinateConverter;
      const pageCanvas = controller.canvas;
      if (viewport === null || coordinateConverter === null || pageCanvas === null) {
        throw new Error("Canvas viewport initialization failed.");
      }
      const artworkColorSampler = createCanvasArtworkColorSampler({
        canvas: pageCanvas,
        getLogicalSize: () => viewport.size,
        getPageViewportRect: () => viewport.pageViewportRect,
        getOpaqueBackingColor: readOpaqueWorkspaceColor,
        flushPendingRender: () => {
          controller.flushRender();
        },
      });
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
        onMaterialCommitted: (strokeId, committed) => {
          materialRuntime.adopt(strokeId, committed);
          publishMaterialDiagnostics();
        },
      });
      const activeStrokeRenderer = strokeRenderer;
      // Hidden Layers are removed at the injected source, so @folio/selection
      // and @folio/manipulation stay unaware of Layers. Locked Layers remain
      // reachable here and are refused at the editable boundary below.
      const objectSource = {
        getObjects: () => documentSession.collection.objects.filter(effective.selectable),
        getObject: (objectId: string) => {
          const object = documentSession.collection.lookup(objectId);
          return object !== undefined && effective.selectable(object) ? object : undefined;
        },
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
          outlineColor: SELECTION_OUTLINE_COLOR,
          highlightColor: SELECTION_HIGHLIGHT_COLOR,
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
            pointerType: object.stroke.sourceSamples[0]?.pointerType ?? "mouse",
            size: object.stroke.brush.size,
            opacity: object.stroke.brush.opacity,
            smoothing: object.stroke.brush.smoothing.amount,
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
          effective.editable,
          documentSession.page.layers,
        );
        const selectionBounds = selectedGeometry?.bounds;
        recoverableSelectionRect =
          selectionBounds === undefined
            ? null
            : inflateSelectionRect(
                selectionBounds,
                (SELECTION_FRAME_PADDING_PIXELS +
                  SELECTION_HANDLE_HIT_RADIUS_PIXELS +
                  ROTATION_HANDLE_OFFSET_PIXELS) /
                  viewport.camera.zoom,
              );
        const selectedVector =
          selectedGeometry?.objects.length === 1 && isVectorObject(selectedObject)
            ? selectedObject
            : null;
        // One selected stroke gets the same oriented frame a vector does; a
        // group keeps the axis-aligned union Phase 20 established.
        const singleInk =
          selectedGeometry?.objects.length === 1 && selectedObject instanceof InkObject
            ? selectedObject
            : null;
        activeSelectionOverlayRenderer.setSelection(
          selectedObject === undefined || selectionBounds === undefined || selectedVector !== null
            ? null
            : {
                objectId: selectedObject.id,
                bounds: selectionBounds,
                ...(singleInk === null
                  ? {}
                  : { orientation: inkSelectionOrientation(singleInk, singleInk.transform) }),
              },
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
        callbacks.shapeEditingChangeRef.current?.(
          createSelectionEditingSnapshot({
            objects: editorSelection.selectedObjects(documentSession.collection),
            page: documentSession.page,
            viewport,
            effective,
            ...(selectedVector === null ? {} : { primaryVector: selectedVector }),
          }),
        );
        if (selectionState === "empty") resetManipulationCursor();
        if (notify) callbacks.selectionChangeRef.current?.(state);
      };
      let synchronizePrimaryIntoEditorSelection = true;
      unsubscribeSelection = activeSelectionController.subscribe((state) => {
        continuousVectorStyleEdit?.cancel();
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
        continuousVectorStyleEdit?.cancel();
        continuousSelectionStyleEdit?.cancel();
        const requestedIds = new Set(objectIds);
        // Canonical document order keeps the primary object top-most, and layer
        // rules are resolved by the one effective-state resolver.
        const validIds = documentSession.collection.objects
          .filter((object) => requestedIds.has(object.id) && effective.pointerSelectable(object))
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
          editorSelection.selectedObjects(documentSession.collection).filter(effective.editable),
        );
      const manipulationObjectSource = {
        getObject: (objectId: string): PageObject | undefined => {
          const geometry = selectionGeometry.resolve(
            documentSession.collection,
            editorSelection.ids,
            effective.editable,
            documentSession.page.layers,
          );
          if (geometry?.primaryObject.id === objectId) return geometry.manipulationTarget;
          const object = documentSession.collection.lookup(objectId);
          // Locked Layers keep read-only selection but refuse manipulation.
          return object !== undefined && effective.editable(object) ? object : undefined;
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
      rotationIndicatorElement = document.createElement("div");
      const activeRotationIndicator = rotationIndicatorElement;
      activeRotationIndicator.dataset.rotationIndicator = "hidden";
      activeRotationIndicator.dataset.testid = "rotation-angle-indicator";
      activeRotationIndicator.setAttribute("aria-hidden", "true");
      Object.assign(activeRotationIndicator.style, {
        position: "absolute",
        zIndex: "5",
        display: "none",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        border: "1px solid var(--folio-border, rgba(37, 37, 34, 0.12))",
        borderRadius: "8px",
        background: "color-mix(in srgb, var(--folio-surface, #ffffff) 94%, transparent)",
        color: "var(--folio-ink, #252522)",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.12)",
        backdropFilter: "blur(10px)",
        padding: "4px 7px",
        font: "650 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
      });
      host.appendChild(activeRotationIndicator);
      /**
       * The Eyedropper's magnifier.
       *
       * Built imperatively for the same reason the brush cursor is: it follows
       * the pointer, and routing that through React would rerender the whole
       * workspace on every move. It is transient presentation with no History,
       * no PageObject, and no sampling logic of its own — it magnifies the same
       * base canvas the authoritative sampler reads, and reports the colour
       * that sampler returns.
       */
      loupeElement = document.createElement("div");
      const activeLoupe = loupeElement;
      activeLoupe.dataset.testid = "eyedropper-loupe";
      activeLoupe.dataset.loupeState = "hidden";
      activeLoupe.setAttribute("aria-hidden", "true");
      Object.assign(activeLoupe.style, {
        position: "absolute",
        left: "0",
        top: "0",
        zIndex: "6",
        display: "none",
        pointerEvents: "none",
        width: `${LOUPE_DIAMETER}px`,
        height: `${LOUPE_DIAMETER}px`,
      });
      const loupeCircle = document.createElement("div");
      Object.assign(loupeCircle.style, {
        position: "absolute",
        inset: "0",
        borderRadius: "50%",
        overflow: "hidden",
        border: "2px solid var(--folio-surface, #ffffff)",
        boxShadow: "0 0 0 1px rgba(37, 37, 34, 0.22), 0 8px 20px rgba(0, 0, 0, 0.18)",
        background: "var(--folio-surface, #ffffff)",
      });
      const loupeCanvas = document.createElement("canvas");
      Object.assign(loupeCanvas.style, {
        display: "block",
        width: "100%",
        height: "100%",
      });
      const loupeCenter = document.createElement("div");
      Object.assign(loupeCenter.style, {
        position: "absolute",
        boxSizing: "border-box",
        border: "1px solid rgba(255, 255, 255, 0.95)",
        outline: "1px solid rgba(37, 37, 34, 0.65)",
        borderRadius: "1px",
      });
      const loupeSwatch = document.createElement("div");
      loupeSwatch.dataset.loupeSwatch = "";
      Object.assign(loupeSwatch.style, {
        position: "absolute",
        left: "50%",
        bottom: "-11px",
        transform: "translateX(-50%)",
        padding: "2px 6px",
        borderRadius: "6px",
        border: "1px solid var(--folio-border, rgba(37, 37, 34, 0.12))",
        background: "color-mix(in srgb, var(--folio-surface, #ffffff) 94%, transparent)",
        color: "var(--folio-ink, #252522)",
        font: "650 10px/1.2 Inter, ui-sans-serif, system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      });
      loupeCircle.appendChild(loupeCanvas);
      loupeCircle.appendChild(loupeCenter);
      activeLoupe.appendChild(loupeCircle);
      activeLoupe.appendChild(loupeSwatch);
      host.appendChild(activeLoupe);
      const hideLoupe = (): void => {
        if (loupeFrame !== null) {
          cancelAnimationFrame(loupeFrame);
          loupeFrame = null;
        }
        activeLoupe.style.display = "none";
        activeLoupe.dataset.loupeState = "hidden";
        delete activeLoupe.dataset.loupeColor;
      };
      const renderLoupe = (clientX: number, clientY: number): void => {
        const hostBounds = host.getBoundingClientRect();
        const sample = artworkColorSampler.sampleClientPoint({ clientX, clientY });
        if (sample.status !== "success") {
          hideLoupe();
          return;
        }
        const devicePixelRatio = viewport.snapshot().devicePixelRatio;
        const source = resolveLoupeSourceRect(
          sample.backingPoint,
          { width: pageCanvas.width, height: pageCanvas.height },
          devicePixelRatio,
        );
        const backingDiameter = Math.round(LOUPE_DIAMETER * devicePixelRatio);
        if (loupeCanvas.width !== backingDiameter || loupeCanvas.height !== backingDiameter) {
          loupeCanvas.width = backingDiameter;
          loupeCanvas.height = backingDiameter;
        }
        const loupeContext = loupeCanvas.getContext("2d");
        if (loupeContext === null) {
          hideLoupe();
          return;
        }
        loupeContext.imageSmoothingEnabled = false;
        loupeContext.clearRect(0, 0, backingDiameter, backingDiameter);
        loupeContext.drawImage(
          pageCanvas,
          source.x,
          source.y,
          source.width,
          source.height,
          0,
          0,
          backingDiameter,
          backingDiameter,
        );
        const indicator = resolveLoupeCenterIndicator(sample.backingPoint, source);
        loupeCenter.style.left = `${indicator.left}px`;
        loupeCenter.style.top = `${indicator.top}px`;
        loupeCenter.style.width = `${indicator.size}px`;
        loupeCenter.style.height = `${indicator.size}px`;
        const placement = resolveLoupePlacement(
          { x: clientX - hostBounds.left, y: clientY - hostBounds.top },
          { width: host.clientWidth, height: host.clientHeight },
        );
        activeLoupe.style.transform = `translate3d(${placement.left}px, ${placement.top}px, 0)`;
        loupeSwatch.textContent = sample.color.toUpperCase();
        activeLoupe.dataset.loupeColor = sample.color;
        activeLoupe.dataset.loupeFlippedX = String(placement.flippedX);
        activeLoupe.dataset.loupeFlippedY = String(placement.flippedY);
        activeLoupe.dataset.loupeSourceX = String(source.x);
        activeLoupe.dataset.loupeSourceY = String(source.y);
        activeLoupe.style.display = "block";
        activeLoupe.dataset.loupeState = "visible";
      };
      const scheduleLoupe = (clientX: number, clientY: number): void => {
        if (loupeFrame !== null) cancelAnimationFrame(loupeFrame);
        loupeFrame = requestAnimationFrame(() => {
          loupeFrame = null;
          renderLoupe(clientX, clientY);
        });
      };
      hideLoupeRef.current = hideLoupe;
      const loupePointerMove: EventListener = (nativeEvent) => {
        if (!artworkSamplingActiveRef.current) return;
        const event = nativeEvent as PointerEvent;
        scheduleLoupe(event.clientX, event.clientY);
      };
      const loupePointerExit: EventListener = () => hideLoupe();
      // Only movement drives it. A press is the moment the sample is taken and
      // the loupe leaves, so scheduling a frame there would race that exit.
      loupePointerListeners = [
        ["pointermove", loupePointerMove],
        ["pointerleave", loupePointerExit],
        ["pointercancel", loupePointerExit],
      ];
      for (const [type, listener] of loupePointerListeners) {
        activation.listen(host, type, listener, true);
      }
      const hideRotationIndicator = (): void => {
        if (rotationIndicatorFrame !== null) {
          cancelAnimationFrame(rotationIndicatorFrame);
          rotationIndicatorFrame = null;
        }
        activeRotationIndicator.style.display = "none";
        activeRotationIndicator.dataset.rotationIndicator = "hidden";
        activeRotationIndicator.textContent = "";
      };
      /**
       * Shows the live angle beside a rotation handle.
       *
       * The chip is transient presentation only: no History, no document
       * state. Updates are coalesced onto one animation frame so a fast drag
       * cannot outrun the compositor, and the position is clamped so the chip
       * never leaves the workspace even when the handle nearly has.
       */
      const showRotationIndicator = (
        pageHandle: Readonly<{ x: number; y: number }>,
        rotationRadians: number,
      ): void => {
        if (rotationIndicatorFrame !== null) cancelAnimationFrame(rotationIndicatorFrame);
        rotationIndicatorFrame = requestAnimationFrame(() => {
          rotationIndicatorFrame = null;
          const handle = viewport.worldToViewport({
            x: viewport.pageRect.x + pageHandle.x,
            y: viewport.pageRect.y + pageHandle.y,
          });
          const degrees = normalizeRotationDegrees(rotationRadians);
          activeRotationIndicator.textContent = formatRotationAngleLabel(rotationRadians);
          activeRotationIndicator.style.left = `${Math.max(
            8,
            Math.min(host.clientWidth - 52, handle.x + 13),
          )}px`;
          activeRotationIndicator.style.top = `${Math.max(
            8,
            Math.min(host.clientHeight - 30, handle.y - 13),
          )}px`;
          activeRotationIndicator.style.display = "block";
          activeRotationIndicator.dataset.rotationIndicator = "visible";
          activeRotationIndicator.dataset.rotationDegrees = String(degrees);
        });
      };
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
      const renderPageFor = (page: Page): RenderPage =>
        Object.freeze({
          rect: Object.freeze({
            x: 0,
            y: 0,
            width: page.geometry.width,
            height: page.geometry.height,
          }),
          background:
            page.paper.type === "blank"
              ? Object.freeze({ kind: "plain" as const })
              : Object.freeze({
                  kind: page.paper.type,
                  ...(page.paper.spacing === undefined ? {} : { spacing: page.paper.spacing }),
                }),
          paperColor: page.paper.color,
        });
      let renderedDocumentObjects: readonly PageObject[] = documentSession.collection.objects;
      // Layer presentation changes preserve object identity by design, so the
      // compositor also tracks the immutable layer array.
      let renderedLayers = documentSession.page.layers;
      let renderedPagePresentation = renderPageFor(documentSession.activePage);
      const updateHistoryDiagnostics = (state: IHistoryState): void => {
        host.dataset.historyCanUndo = String(state.canUndo);
        host.dataset.historyCanRedo = String(state.canRedo);
        host.dataset.historyUndoDepth = String(state.undoDepth);
        host.dataset.historyRedoDepth = String(state.redoDepth);
        host.dataset.historyVersion = String(state.historyVersion);
        host.dataset.historyExecutionCount = String(state.executionCounter);
        host.dataset.historyLastCommandId = state.lastCommand?.id ?? "";
      };
      let publishLayersRef: (() => void) | null = null;
      let publishPagesRef: (() => void) | null = null;
      const synchronizeDocumentFromHistory = (): void => {
        const nextActivePage = documentSession.activePage;
        const nextPagePresentation = renderPageFor(nextActivePage);
        if (!sameRenderPagePresentation(nextPagePresentation, renderedPagePresentation)) {
          renderedPagePresentation = nextPagePresentation;
          // Page paper and geometry are compositor inputs even when artwork and
          // Layer identities are unchanged. Preserve the current camera while
          // installing the immutable Page restored by History.
          controller.updatePage(nextPagePresentation);
        }
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
        const nextLayers = documentSession.page.layers;
        const documentChanged =
          nextDocumentObjects.length !== renderedDocumentObjects.length ||
          nextDocumentObjects.some((object, index) => object !== renderedDocumentObjects[index]) ||
          nextLayers !== renderedLayers;
        renderedDocumentObjects = nextDocumentObjects;
        renderedLayers = nextLayers;
        if (documentChanged) controller.requestRender({ kind: "page" });
        updateDocumentDiagnostics();
        editorSelection.reconcile(documentSession.collection);
        // Hiding a Layer removes its artwork from interaction, so any selection
        // it still holds is dropped here rather than in each layer action.
        const unselectableIds = editorSelection.ids.filter((objectId) => {
          const object = documentSession.collection.lookup(objectId);
          return object !== undefined && !effective.selectable(object);
        });
        if (unselectableIds.length > 0) {
          const dropped = new Set(unselectableIds);
          editorSelection.replace(editorSelection.ids.filter((objectId) => !dropped.has(objectId)));
        }
        let selection = activeSelectionController.getSelection();
        if (
          selection.selectedObjectId !== null &&
          (!documentSession.collection.has(selection.selectedObjectId) ||
            unselectableIds.includes(selection.selectedObjectId))
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
        onDocumentChange: () => {
          synchronizeDocumentFromHistory();
          publishLayersRef?.();
          publishPagesRef?.();
        },
        onHistoryChange: (notification) => {
          updateHistoryDiagnostics(notification.state);
          // Undo and Redo restore the page the change belongs to, so a restored
          // change is always visible instead of landing on an unseen page.
          if (
            notification.outcome === "succeeded" &&
            (notification.operation === "undo" || notification.operation === "redo")
          ) {
            const pageContext = historyCoordinator?.pageContextForCommand(notification.command.id);
            const targetPageId = resolveHistoryPageContext(
              pageContext ?? null,
              documentSession.sketchbook,
            );
            if (
              targetPageId !== null &&
              targetPageId !== documentSession.activePageId &&
              documentSession.sketchbook.page(targetPageId) !== undefined
            ) {
              switchToPage(targetPageId);
              publishPagesRef?.();
            }
          }
          callbacks.historyChangeRef.current?.(notification);
        },
        onError: (error) => callbacks.errorRef.current?.(error),
      });
      const activeHistoryCoordinator = historyCoordinator;
      uninstallHistoryShortcuts = installEditorHistoryShortcuts({
        eventTarget: activation.eventTarget(window),
        controller: activeHistoryCoordinator.controller,
        onError: (error) => callbacks.errorRef.current?.(error),
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
              effective.editable,
              documentSession.page.layers,
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
            callbacks.errorRef.current?.(error);
            return false;
          }
        },
        onError: (error) => callbacks.errorRef.current?.(error),
      });
      const activeManipulationController = manipulationController;
      manipulationControllerRef.current = activeManipulationController;
      const reportEditingFailure = (cause: unknown, message: string): false => {
        callbacks.errorRef.current?.(
          cause instanceof Error ? cause : new Error(message, { cause }),
        );
        return false;
      };
      const reportArtworkColorUsed = (color: string): void => {
        try {
          callbacks.artworkColorUsedRef.current?.(color);
        } catch {
          // Application observers cannot interrupt a successful document commit.
        }
      };
      const reportCommittedCreationColor = (objectId: string): void => {
        const committed = documentSession.collection.lookup(objectId);
        if (committed !== undefined) reportArtworkColorUsed(committedArtworkColor(committed));
      };
      const reportCommittedVectorRecolor = (original: VectorPageObject): void => {
        const committed = documentSession.collection.lookup(original.id);
        if (!isVectorObject(committed)) return;
        const color = committedVectorRecolor(original, committed);
        if (color !== null) reportArtworkColorUsed(color);
      };
      const selectedVectorObject = (): VectorPageObject | null => {
        const selected = selectedEditableObjects();
        const object = selected.length === 1 ? selected[0] : undefined;
        return isVectorObject(object) ? object : null;
      };
      const patchedVectorStyle = (object: VectorPageObject, patch: ShapeStylePatch) =>
        patchVectorStyle(object.style, {
          ...(patch.strokeColor === undefined ? {} : { color: patch.strokeColor }),
          ...(patch.strokeWidth === undefined ? {} : { strokeWidth: patch.strokeWidth }),
          ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
        });
      continuousVectorStyleEdit = new ContinuousVectorStyleEdit({
        documentSession,
        commit: (object, style) => {
          const state = activeHistoryCoordinator.executeVectorStyleUpdate(object, style);
          reportCommittedVectorRecolor(object);
          return state;
        },
        onPreviewDocumentChange: () => synchronizeDocumentFromHistory(),
        isEditable: effective.editable,
      });
      const activeContinuousVectorStyleEdit = continuousVectorStyleEdit;
      continuousSelectionStyleEdit = new ContinuousSelectionStyleEdit({
        documentSession,
        commit: (edits) => {
          const state = activeHistoryCoordinator.executeSelectionStyleUpdate(edits);
          // Recent Colors follow the Phase 18 committed-artwork rule.
          for (const edit of edits.vectorEdits) reportCommittedVectorRecolor(edit.original);
          for (const edit of edits.inkEdits) {
            if (edit.initialStyle.color !== edit.finalStyle.color) {
              const committed = documentSession.collection.lookup(edit.objectId);
              if (committed !== undefined)
                callbacks.artworkColorUsedRef.current?.(committedArtworkColor(committed));
            }
          }
          return state;
        },
        onPreviewDocumentChange: () => synchronizeDocumentFromHistory(),
        isEditable: effective.editable,
      });
      const activeContinuousSelectionStyleEdit = continuousSelectionStyleEdit;
      const cancelContinuousStyleEdit = (): boolean =>
        activeContinuousVectorStyleEdit.cancel() || activeContinuousSelectionStyleEdit.cancel();
      cancelContinuousStyleEditRef.current = cancelContinuousStyleEdit;
      const shapeEditingActions: ShapeEditingActions = Object.freeze({
        updateStyle: (patch: ShapeStylePatch): boolean => {
          cancelContinuousStyleEdit();
          const object = selectedVectorObject();
          if (object === null) return false;
          try {
            const style = patchedVectorStyle(object, patch);
            if (
              style.strokeColor.hex === object.style.strokeColor.hex &&
              style.strokeColor.opacity === object.style.strokeColor.opacity &&
              style.strokeWidth === object.style.strokeWidth
            ) {
              return false;
            }
            const state = activeHistoryCoordinator.executeVectorStyleUpdate(object, style);
            updateHistoryDiagnostics(state);
            reportCommittedVectorRecolor(object);
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "Shape appearance update failed.");
          }
        },
        moveSelectionToLayer: (layerId: string): boolean => {
          cancelContinuousStyleEdit();
          const objects = selectedEditableObjects();
          if (objects.length === 0) return false;
          try {
            const state = activeHistoryCoordinator.executeMoveObjectsToLayer(
              objects.map(({ id }) => id),
              layerId,
            );
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            synchronizeDocumentFromHistory();
            publishLayersRef?.();
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "Moving the selection to a layer failed.");
          }
        },
        // The continuous path covers Ink, vector, and mixed selections through
        // one engine so a gesture is one History action regardless of contents.
        beginContinuousStyleEdit: (): boolean =>
          activeContinuousSelectionStyleEdit.begin(editorSelection.ids),
        updateContinuousStylePreview: (patch: ShapeStylePatch): boolean => {
          if (
            !activeContinuousSelectionStyleEdit.active &&
            !activeContinuousSelectionStyleEdit.begin(editorSelection.ids)
          ) {
            return false;
          }
          try {
            return activeContinuousSelectionStyleEdit.update({
              ...(patch.strokeColor === undefined ? {} : { color: patch.strokeColor }),
              ...(patch.strokeWidth === undefined ? {} : { width: patch.strokeWidth }),
              ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
            });
          } catch (cause) {
            cancelContinuousStyleEdit();
            return reportEditingFailure(cause, "Selection appearance preview failed.");
          }
        },
        commitContinuousStyleEdit: (): boolean => {
          try {
            const state = activeContinuousSelectionStyleEdit.commit();
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            synchronizeDocumentFromHistory();
            return true;
          } catch (cause) {
            return reportEditingFailure(cause, "Selection appearance commit failed.");
          }
        },
        cancelContinuousStyleEdit,
      });
      callbacks.shapeEditingActionsReadyRef.current?.(shapeEditingActions);
      const publishLayers = (): void => {
        const page = documentSession.page;
        host.dataset.layerCount = String(page.layerCount);
        host.dataset.activeLayerId = documentSession.activeLayerId;
        host.dataset.layerOrder = JSON.stringify(page.layers.map((layer) => layer.id));
        host.dataset.layerMembership = JSON.stringify(
          page.layers.map((layer) => layer.objectIds.length),
        );
        callbacks.layersChangeRef.current?.(
          Object.freeze({
            layers: Object.freeze(
              page.layers.map((layer) =>
                Object.freeze({
                  id: layer.id,
                  name: layer.name,
                  visible: layer.visible,
                  locked: layer.locked,
                  opacity: layer.opacity,
                  objectCount: layer.objectIds.length,
                }),
              ),
            ),
            activeLayerId: documentSession.activeLayerId,
          }),
        );
      };
      continuousLayerOpacityEdit = new ContinuousLayerOpacityEdit({
        documentSession,
        commit: (layerId, _initialOpacity, finalOpacity) => {
          const state =
            activeHistoryCoordinator.executeLayerPatch(
              layerId,
              { opacity: finalOpacity },
              "Set layer opacity",
            ) ?? activeHistoryCoordinator.controller.getHistoryState();
          updateHistoryDiagnostics(state);
          return state;
        },
        onPreviewDocumentChange: () => {
          synchronizeDocumentFromHistory();
          publishLayers();
        },
      });
      const activeLayerOpacityEdit = continuousLayerOpacityEdit;
      const runLayerOperation = (operation: () => boolean): boolean => {
        try {
          const changed = operation();
          if (changed) {
            synchronizeDocumentFromHistory();
            updateHistoryDiagnostics(activeHistoryCoordinator.controller.getHistoryState());
            publishLayers();
          }
          return changed;
        } catch (cause) {
          reportEditingFailure(cause, "Layer operation failed.");
          return false;
        }
      };
      const layerActions: LayerActions = Object.freeze({
        setActiveLayer: (layerId: string): boolean => {
          // Active-layer selection is editor state: no History, no document change.
          if (!documentSession.setActiveLayerId(layerId)) return false;
          publishLayers();
          return true;
        },
        addLayer: (): string | null => {
          try {
            const { layerId, state } = activeHistoryCoordinator.executeAddLayer();
            documentSession.setActiveLayerId(layerId);
            updateHistoryDiagnostics(state);
            publishLayers();
            return layerId;
          } catch (cause) {
            reportEditingFailure(cause, "Adding a layer failed.");
            return null;
          }
        },
        renameLayer: (layerId: string, name: string): boolean =>
          runLayerOperation(
            () =>
              name.trim().length > 0 &&
              activeHistoryCoordinator.executeLayerPatch(
                layerId,
                { name: name.trim() },
                "Rename layer",
              ) !== null,
          ),
        setLayerVisible: (layerId: string, visible: boolean): boolean =>
          runLayerOperation(
            () =>
              activeHistoryCoordinator.executeLayerPatch(
                layerId,
                { visible },
                visible ? "Show layer" : "Hide layer",
              ) !== null,
          ),
        setLayerLocked: (layerId: string, locked: boolean): boolean =>
          runLayerOperation(
            () =>
              activeHistoryCoordinator.executeLayerPatch(
                layerId,
                { locked },
                locked ? "Lock layer" : "Unlock layer",
              ) !== null,
          ),
        beginLayerOpacityEdit: (layerId: string): boolean => activeLayerOpacityEdit.begin(layerId),
        previewLayerOpacity: (opacity: number): boolean => activeLayerOpacityEdit.update(opacity),
        commitLayerOpacityEdit: (): boolean => {
          const committed = activeLayerOpacityEdit.commit();
          synchronizeDocumentFromHistory();
          publishLayers();
          return committed !== null;
        },
        cancelLayerOpacityEdit: (): boolean => {
          const cancelled = activeLayerOpacityEdit.cancel();
          if (cancelled) {
            synchronizeDocumentFromHistory();
            publishLayers();
          }
          return cancelled;
        },
        moveLayer: (layerId: string, targetIndex: number): boolean =>
          runLayerOperation(
            () => activeHistoryCoordinator.executeReorderLayer(layerId, targetIndex) !== null,
          ),
        deleteLayer: (layerId: string): number | null => {
          cancelContinuousStyleEdit();
          try {
            const { removedObjectCount, state } =
              activeHistoryCoordinator.executeRemoveLayer(layerId);
            editorSelection.clear();
            updateSelection(activeSelectionController.getSelection(), false);
            synchronizeDocumentFromHistory();
            updateHistoryDiagnostics(state);
            publishLayers();
            return removedObjectCount;
          } catch (cause) {
            reportEditingFailure(cause, "Deleting a layer failed.");
            return null;
          }
        },
      });
      const publishPages = (): void => {
        const sketchbook = documentSession.sketchbook;
        const activePageId = documentSession.activePageId;
        host.dataset.pageCount = String(sketchbook.pageCount);
        host.dataset.activePageId = activePageId;
        host.dataset.pageOrder = JSON.stringify(sketchbook.pages.map((page) => page.id));
        const active = documentSession.activePage;
        host.dataset.pageWidth = String(active.geometry.width);
        host.dataset.pageHeight = String(active.geometry.height);
        host.dataset.pageOrientation = active.orientation;
        host.dataset.pagePaperType = active.paper.type;
        host.dataset.pagePaperColor = active.paper.color;
        callbacks.pagesChangeRef.current?.(
          Object.freeze({
            pages: Object.freeze(
              sketchbook.pages.map((page, index) =>
                Object.freeze({
                  id: page.id,
                  name: page.name,
                  index,
                  width: page.geometry.width,
                  height: page.geometry.height,
                  orientation: page.orientation,
                  paperType: page.paper.type,
                  paperColor: page.paper.color,
                  paperSpacing: page.paper.spacing ?? null,
                  objectCount: page.objectCount,
                  layerCount: page.content.layerCount,
                }),
              ),
            ),
            activePageId,
          }),
        );
      };
      // The controller owns page geometry and refits; the editor only tells it
      // which page is current.
      const applyActivePageToViewport = (restoreMemory: boolean): void => {
        const page = documentSession.activePage;
        const memory = restoreMemory ? documentSession.viewportMemory(page.id) : null;
        renderedPagePresentation = renderPageFor(page);
        controller.setPage(renderedPagePresentation, memory === null);
        if (memory !== null) {
          viewport.camera.setZoom(memory.zoom);
          viewport.camera.setPosition(memory.position);
          controller.requestRender({ kind: "viewport" });
        }
        synchronizeDocumentFromHistory();
        publishLayers();
        publishPages();
        updateViewportDiagnostics();
      };
      const rememberActiveViewport = (): void => {
        const snapshot = viewport.snapshot();
        documentSession.rememberViewport(documentSession.activePageId, {
          zoom: snapshot.camera.zoom,
          position: { x: snapshot.camera.position.x, y: snapshot.camera.position.y },
          mode: controller.viewportMode,
        });
      };
      /** Cancels every transient interaction before leaving a page. */
      const releaseTransientInteractions = (): void => {
        cancelContinuousStyleEdit();
        activeLayerOpacityEdit.cancel();
        continuousPaperColorEdit?.cancel();
        activeManipulationController.cancelManipulation();
        releaseManipulationPointerCapture();
        activeVectorInteractionRenderer.setMarquee(null);
        marqueeOrigin = null;
        marqueeAdditive = false;
        marqueeBaseIds = Object.freeze([]);
        selectEditorObjects([]);
      };
      const switchToPage = (pageId: string, restoreMemory = true): boolean => {
        if (pageId === documentSession.activePageId) return false;
        if (documentSession.sketchbook.page(pageId) === undefined) return false;
        rememberActiveViewport();
        releaseTransientInteractions();
        // Reconstruction still running for the page being left is work whose
        // answer nobody will look at. Cancelling is the safe default: material
        // already resident survives, so coming straight back is still warm,
        // and nothing is spent finishing tiles for a page that is now behind.
        materialRuntime.scheduler.cancelAll();
        if (!documentSession.setActivePageId(pageId)) return false;
        applyActivePageToViewport(restoreMemory);
        return true;
      };
      const runPageOperation = <TResult,>(
        operation: () => TResult,
        message: string,
      ): TResult | null => {
        try {
          return operation();
        } catch (cause) {
          reportEditingFailure(cause, message);
          return null;
        }
      };
      continuousPaperColorEdit = new ContinuousPaperColorEdit({
        documentSession,
        commit: (pageId, finalColor) => {
          const state = activeHistoryCoordinator.executePagePaper(
            pageId,
            { color: finalColor },
            "Change paper color",
          );
          if (state !== null) updateHistoryDiagnostics(state);
          return state;
        },
        onPreviewDocumentChange: (pageId) => {
          if (pageId === documentSession.activePageId) applyActivePageToViewport(true);
          else publishPages();
        },
      });
      const activePaperColorEdit = continuousPaperColorEdit;
      const pageActions: PageActions = Object.freeze({
        setActivePage: (pageId: string): boolean => switchToPage(pageId),
        addPage: (): string | null =>
          runPageOperation(() => {
            rememberActiveViewport();
            releaseTransientInteractions();
            const { pageId, state } = activeHistoryCoordinator.executeAddPage();
            updateHistoryDiagnostics(state);
            documentSession.setActivePageId(pageId);
            applyActivePageToViewport(false);
            return pageId;
          }, "Adding a page failed."),
        duplicatePage: (pageId: string): string | null =>
          runPageOperation(() => {
            rememberActiveViewport();
            releaseTransientInteractions();
            const result = activeHistoryCoordinator.executeDuplicatePage(pageId);
            updateHistoryDiagnostics(result.state);
            documentSession.setActivePageId(result.pageId);
            applyActivePageToViewport(false);
            return result.pageId;
          }, "Duplicating a page failed."),
        deletePage: (pageId: string): number | null =>
          runPageOperation(() => {
            releaseTransientInteractions();
            const result = activeHistoryCoordinator.executeRemovePage(pageId);
            updateHistoryDiagnostics(result.state);
            documentSession.setActivePageId(result.nextActivePageId);
            applyActivePageToViewport(true);
            return result.objectCount;
          }, "Deleting a page failed."),
        movePage: (pageId: string, targetIndex: number): boolean =>
          runPageOperation(() => {
            const state = activeHistoryCoordinator.executeReorderPage(pageId, targetIndex);
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            publishPages();
            return true;
          }, "Reordering pages failed.") ?? false,
        renamePage: (pageId: string, name: string): boolean =>
          runPageOperation(() => {
            const state = activeHistoryCoordinator.executePageRename(pageId, name);
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            publishPages();
            return true;
          }, "Renaming a page failed.") ?? false,
        setPageGeometry: (pageId: string, width: number, height: number): boolean =>
          runPageOperation(() => {
            const state = activeHistoryCoordinator.executePageGeometry(pageId, { width, height });
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            if (pageId === documentSession.activePageId) applyActivePageToViewport(false);
            else publishPages();
            return true;
          }, "Resizing the page failed.") ?? false,
        setPageOrientation: (pageId: string, orientation: "portrait" | "landscape"): boolean =>
          runPageOperation(() => {
            const page = documentSession.sketchbook.requirePage(pageId);
            const next = orientPageGeometry(page.geometry, orientation);
            const state = activeHistoryCoordinator.executePageGeometry(
              pageId,
              next,
              orientation === "portrait" ? "Use portrait page" : "Use landscape page",
            );
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            if (pageId === documentSession.activePageId) applyActivePageToViewport(false);
            else publishPages();
            return true;
          }, "Changing page orientation failed.") ?? false,
        setPaperType: (pageId: string, type: PaperType): boolean =>
          runPageOperation(() => {
            const definition = paperTypeDefinition(type);
            const state = activeHistoryCoordinator.executePagePaper(
              pageId,
              {
                type,
                ...(definition.defaultSpacing === null
                  ? {}
                  : { spacing: definition.defaultSpacing }),
              },
              `Use ${definition.label.toLowerCase()} paper`,
            );
            if (state === null) return false;
            updateHistoryDiagnostics(state);
            if (pageId === documentSession.activePageId) applyActivePageToViewport(true);
            else publishPages();
            return true;
          }, "Changing paper failed.") ?? false,
        beginPaperColorEdit: (pageId: string): boolean => activePaperColorEdit.begin(pageId),
        previewPaperColor: (color: string): boolean => activePaperColorEdit.update(color),
        commitPaperColorEdit: (): boolean =>
          runPageOperation(
            () => activePaperColorEdit.commit() !== null,
            "Changing paper color failed.",
          ) ?? false,
        cancelPaperColorEdit: (): boolean => activePaperColorEdit.cancel(),
        hasArtworkOutsideBounds: (pageId: string): boolean =>
          documentSession.sketchbook.page(pageId)?.hasArtworkOutsideBounds() ?? false,
        getPage: (pageId: string): Page | null => documentSession.sketchbook.page(pageId) ?? null,
      });
      callbacks.pageActionsReadyRef.current?.(pageActions);
      callbacks.layerActionsReadyRef.current?.(layerActions);
      publishLayersRef = publishLayers;
      publishPagesRef = publishPages;
      applyActivePageToViewport(false);
      publishLayers();
      const deleteSelectedObjects = (): boolean => {
        cancelContinuousStyleEdit();
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
        cancelContinuousStyleEdit();
        if (refuseActiveLayerWrite()) return false;
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
          cancelContinuousStyleEdit();
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
          if (refuseActiveLayerWrite()) return false;
          try {
            const batch = editorClipboard.preparePaste(
              documentSession.collection,
              documentSession.activeInsertionIndex(),
            );
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
          const selectedIds = editorSelection.selectAllEditable(
            documentSession.collection,
            effective.editable,
          );
          if (selectedIds.length === 0) return false;
          selectEditorObjects(selectedIds);
          return true;
        },
        deleteSelection: deleteSelectedObjects,
      });
      editingActionsRef.current = editingActions;
      uninstallEditingShortcuts = installEditorEditingShortcuts({
        eventTarget: activation.eventTarget(window),
        actions: editingActions,
        onError: (error) => callbacks.errorRef.current?.(error),
      });
      updateClipboardDiagnostics();
      const objectLifecycleActions: ObjectLifecycleActions = Object.freeze({
        deleteSelection: editingActions.deleteSelection,
        duplicateSelection: editingActions.duplicate,
      });
      callbacks.objectLifecycleActionsReadyRef.current?.(objectLifecycleActions);
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
        const vectorPreviewTransform =
          state.phase === "dragging" &&
          isVectorObject(object) &&
          state.finalObjectTranslation !== null &&
          state.finalObjectRotation !== null &&
          state.finalObjectScale !== null
            ? new Transform({
                translation: state.finalObjectTranslation,
                rotation: state.finalObjectRotation,
                scale: state.finalObjectScale,
              })
            : null;
        activeVectorInteractionRenderer.setSelectionPreviewTransform(vectorPreviewTransform);
        // Rotation feedback is decided once, here, and every branch below that
        // knows a live rotation reports its handle through this one path.
        hideRotationIndicator();
        if (
          vectorPreviewTransform !== null &&
          isVectorObject(object) &&
          object.type !== "line" &&
          state.kind === "rotation"
        ) {
          const frame = resolveOrientedSelectionFrame(
            object.localBounds,
            vectorPreviewTransform,
            viewport.camera.zoom,
          );
          showRotationIndicator(frame.rotationHandle, vectorPreviewTransform.rotation);
        }
        const selectedGeometry = selectionGeometry.resolve(
          documentSession.collection,
          editorSelection.ids,
          effective.editable,
          documentSession.page.layers,
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
          if (state.kind === "rotation" && state.finalObjectRotation !== null) {
            // The group frame stays axis-aligned, so the chip reports the angle
            // the gesture is applying rather than a frame orientation.
            showRotationIndicator(
              {
                x: previewBounds.x + previewBounds.width / 2,
                y:
                  previewBounds.y -
                  (SELECTION_FRAME_PADDING_PIXELS + ROTATION_HANDLE_OFFSET_PIXELS) /
                    viewport.camera.zoom,
              },
              state.finalObjectRotation,
            );
          }
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
          const previewTransform = new Transform({
            translation: state.finalObjectTranslation,
            rotation: state.finalObjectRotation,
            scale: state.finalObjectScale,
          });
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
          // The frame follows the live preview, so a rotating stroke is not
          // left inside a stale upright box.
          activeSelectionOverlayRenderer.setSelection({
            objectId: object.id,
            bounds: getStrokeRenderedBounds(object.stroke, previewTransform),
            orientation: inkSelectionOrientation(object, previewTransform),
          });
          if (state.kind === "rotation") {
            const frame = orientedFrameGeometry(
              inkSelectionOrientation(object, previewTransform),
              SELECTION_FRAME_PADDING_PIXELS,
              viewport.camera.zoom,
            );
            showRotationIndicator(frame.rotationHandle, previewTransform.rotation);
          }
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
        if (notify) callbacks.manipulationChangeRef.current?.(state);
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
          if (presentation !== null) callbacks.viewportChangeRef.current?.(presentation);
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
        callbacks.diagnosticsRef.current?.(snapshot);
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
      callbacks.viewportActionsReadyRef.current?.(viewportActions);
      synchronizeViewportLayers(controller.snapshot());

      const editorPointerIds = new Set<number>();
      const viewportPanPointerIds = new Set<number>();
      let spacePanHeld = false;
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
                callbacks.viewportNavigationLearnedRef.current?.();
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
        if (event.code !== "Space" || isEditableKeyboardTarget(event.target)) return false;
        // A focused control keeps its own activation key: a button, a slider,
        // or a semantic SVG radio in the Brush Library all act on Space, and
        // claiming it here would leave the control inert while the view panned.
        //
        // Focus alone decides it, with no exception for where the pointer
        // happens to be. That is only truthful because a press on the artwork
        // now takes focus onto the surface itself, so during drawing the
        // focused thing really is the canvas and Space really is the pan.
        //
        // Only the press is gated. A pan that started can always end, whatever
        // took focus in between.
        if (phase === "down" && isInteractiveKeyboardTarget(event.target)) {
          return false;
        }
        // A release nobody armed is not this one's to swallow. A native button
        // activates on the Space *keyup*, so consuming every release would
        // leave a focused control inert even though the press was correctly
        // left alone. Held state is what says the pan is ours to end.
        if (phase === "up" && !spacePanHeld) return false;
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

      /**
       * The page point a Select-tool press acts on.
       *
       * Inside the page this is the ordinary mapping. Outside it, the point
       * resolves only where the current selection actually reaches, so an
       * off-page object remains grabbable while empty workspace stays inert.
       */
      const selectionInteractionPoint = (position: ScreenPoint): PagePoint | null => {
        const insidePage = manipulationCoordinateMapper.screenToPage(position, false);
        if (insidePage !== null) return insidePage;
        const recoverable = recoverableSelectionRect;
        if (recoverable === null) return null;
        const outside = manipulationCoordinateMapper.screenToPage(position, true);
        if (outside === null) return null;
        return outside.x >= recoverable.x &&
          outside.x <= recoverable.x + recoverable.width &&
          outside.y >= recoverable.y &&
          outside.y <= recoverable.y + recoverable.height
          ? outside
          : null;
      };
      const selectionCandidatesAt = (position: ScreenPoint): readonly PageObject[] => {
        const pagePosition = selectionInteractionPoint(position);
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
          effective.editable,
          documentSession.page.layers,
        );
        const pagePosition = selectionInteractionPoint(position);
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
          ...(selectedObject instanceof InkObject
            ? {
                localBounds: getStrokeVisualLocalBounds(
                  selectedObject.stroke,
                  selectedObject.transform.scale,
                ),
                transform: selectedObject.transform,
                pivot: getStrokeTransformPivot(selectedObject.stroke),
              }
            : isVectorObject(selectedObject) && selectedObject.type !== "line"
              ? { localBounds: selectedObject.localBounds, transform: selectedObject.transform }
              : {}),
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
        const candidate = selectionCandidatesAt(position)[0] ?? null;
        // Selected Ink already owns one authoritative oriented frame. Its
        // generic bounds hover would otherwise draw a competing dashed AABB.
        activeVectorInteractionRenderer.setHover(
          candidate instanceof InkObject && editorSelection.has(candidate.id) ? null : candidate,
        );
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

      /**
       * The one creation-eligibility gate for the active Layer.
       *
       * Refusal is deliberate: silently depositing invisible artwork or writing
       * through a lock is worse than declining, and auto-unlocking would undo an
       * explicit user decision.
       */
      const refuseActiveLayerWrite = (): boolean => {
        const refusal = effective.activeLayerRefusal(documentSession.activeLayerId);
        if (refusal === null) return false;
        host.dataset.activeLayerWriteRefusal = refusal;
        callbacks.activeLayerRefusalRef.current?.(refusal);
        return true;
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
        // A creation press that starts off the page produces nothing. The brush
        // cursor already reports that the workspace is not drawable, so this
        // keeps behaviour and feedback in agreement instead of depositing
        // unreachable artwork beyond the paper.
        if (
          phase === "down" &&
          CREATION_INTERACTION_MODES.has(mode) &&
          event.isPrimary &&
          event.button === 0 &&
          manipulationCoordinateMapper.screenToPage(position, false) === null
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // A hidden or locked active Layer refuses the press before any wet
        // stroke or rubber band appears, so nothing is ever drawn and discarded.
        if (
          phase === "down" &&
          CREATION_INTERACTION_MODES.has(mode) &&
          event.isPrimary &&
          event.button === 0 &&
          refuseActiveLayerWrite()
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
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
            } else if (event.shiftKey && event.isPrimary && event.button === 0) {
              // Shift owns the press outright: it must toggle membership even
              // when the point lies inside the current group's transform bounds.
              const candidate = selectionCandidatesAt(position)[0] ?? null;
              if (candidate !== null) {
                selectEditorObjects(editorSelection.toggle(candidate.id));
                selectPointerRoutes.set(event.pointerId, "consumed");
                return;
              }
              marqueeAdditive = true;
              marqueeBaseIds = editorSelection.ids;
              marqueeOrigin = position;
              selectPointerRoutes.set(event.pointerId, "marquee");
              return;
            }
            const selectedGeometry = selectionGeometry.resolve(
              documentSession.collection,
              editorSelection.ids,
              effective.editable,
              documentSession.page.layers,
            );
            const pagePosition = selectionInteractionPoint(position);
            const selectedObject =
              editorSelection.size === 1
                ? documentSession.collection.lookup(editorSelection.ids[0] ?? "")
                : undefined;
            const lineHit =
              route === undefined && isLineObject(selectedObject) && pagePosition !== null
                ? resolveLineHandleHit(selectedObject, pagePosition, viewport.camera.zoom)
                : null;
            if (
              isLineObject(selectedObject) &&
              (lineHit?.handle === "start" || lineHit?.handle === "end")
            ) {
              route = "line-endpoint";
              activeLineEndpointInteraction = {
                pointerId: event.pointerId,
                object: selectedObject,
                endpoint: lineHit.handle,
                sessionId: `line-endpoint-${selectedObject.id}-${Date.now().toString(36)}`,
                sessionTimestamp: Date.now(),
                origin: position,
                initialTransform: selectedObject.transform,
                finalTransform: selectedObject.transform,
                moved: false,
              };
              activeVectorInteractionRenderer.setLineEndpointPreview({
                object: selectedObject,
                transform: selectedObject.transform,
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
                    ...(selectedObject instanceof InkObject
                      ? {
                          localBounds: getStrokeVisualLocalBounds(
                            selectedObject.stroke,
                            selectedObject.transform.scale,
                          ),
                          transform: selectedObject.transform,
                          pivot: getStrokeTransformPivot(selectedObject.stroke),
                        }
                      : isVectorObject(selectedObject) && selectedObject.type !== "line"
                        ? {
                            localBounds: selectedObject.localBounds,
                            transform: selectedObject.transform,
                          }
                        : {}),
                  });
            if (route === undefined) {
              route = isLineObject(selectedObject) ? "selection" : (hit?.kind ?? "selection");
              if (hit !== null && !isLineObject(selectedObject)) setManipulationCursor(hit.cursor);
            }
            if (route === "selection" && event.isPrimary && event.button === 0 && !event.shiftKey) {
              // An empty-space press with no modifier begins a marquee.
              if ((selectionCandidatesAt(position)[0] ?? null) === null) {
                marqueeAdditive = false;
                marqueeBaseIds = Object.freeze([]);
                route = "marquee";
                marqueeOrigin = position;
              }
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
          } else if (route === "marquee") {
            const pagePosition = manipulationCoordinateMapper.screenToPage(position, false);
            if (phase === "move" && marqueeOrigin !== null && pagePosition !== null) {
              if (!marqueeActivated(marqueeOrigin, position)) return;
              const originPage = manipulationCoordinateMapper.screenToPage(marqueeOrigin, false);
              if (originPage === null) return;
              const rect = marqueeRectFromPoints(originPage, pagePosition);
              activeVectorInteractionRenderer.setMarquee(rect);
              const covered = marqueeSelectedObjects(
                documentSession.collection.objects,
                rect,
                effective.pointerSelectable,
              ).map(({ id }) => id);
              selectEditorObjects(marqueeAdditive ? [...marqueeBaseIds, ...covered] : covered);
              host.dataset.marqueeState = "active";
              host.dataset.marqueeSelectedCount = String(covered.length);
            } else if (phase === "up" || phase === "cancel") {
              if (marqueeOrigin !== null && !marqueeActivated(marqueeOrigin, position)) {
                // A click that never became a marquee clears the selection.
                if (!marqueeAdditive) selectEditorObjects([]);
              }
              activeVectorInteractionRenderer.setMarquee(null);
              marqueeOrigin = null;
              marqueeAdditive = false;
              marqueeBaseIds = Object.freeze([]);
              host.dataset.marqueeState = "idle";
            }
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
          } else if (route === "consumed") {
            if (phase === "up" || phase === "cancel") selectPointerRoutes.delete(event.pointerId);
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
            // Reaching here means the press already resolved to a handle or to
            // the selection's own body, so the gesture belongs to that object.
            // Clipping its coordinates to the page would refuse to start a drag
            // on artwork a page resize left outside the sheet.
            let pagePosition = manipulationCoordinateMapper.screenToPage(position, true);
            if (route === "rotation" && event.shiftKey && pagePosition !== null) {
              pagePosition = snapRotationPointer(
                activeManipulationController.getManipulationState(),
                pagePosition,
              );
              host.dataset.rotationSnapActive = "true";
            } else if (route === "rotation") {
              host.dataset.rotationSnapActive = "false";
            }
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
      const reportArtworkSample = (result: ArtworkColorSampleResult): void => {
        host.dataset.artworkSampleStatus = result.status;
        if (result.status === "success") {
          host.dataset.artworkSampleReason = "";
          host.dataset.artworkSampleColor = result.color;
          host.dataset.artworkSampleDurationMs = String(result.durationMs);
        } else {
          host.dataset.artworkSampleReason = result.reason;
          host.dataset.artworkSampleColor = "";
          if (result.status === "error") {
            host.dataset.artworkSampleDurationMs = String(result.durationMs);
          }
        }
        callbacks.artworkSampleRef.current?.(result);
      };
      const handleArtworkSamplingPointer = (
        phase: SelectionPointerInput["phase"],
        event: PointerEvent,
      ): boolean => {
        const ownsPointer = artworkSamplingPointerId === event.pointerId;
        if (!artworkSamplingActiveRef.current && !ownsPointer) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (phase === "down") {
          setContextMenu(null);
          artworkSamplingPointerId = event.pointerId;
          if (event.isPrimary && event.button === 0) {
            reportArtworkSample(
              artworkColorSampler.sampleClientPoint({
                clientX: event.clientX,
                clientY: event.clientY,
              }),
            );
          }
        }
        if ((phase === "up" || phase === "cancel") && ownsPointer) {
          artworkSamplingPointerId = null;
        }
        return true;
      };
      const addEditorPointerListener = (
        type: keyof HTMLElementEventMap,
        phase: SelectionPointerInput["phase"],
      ): void => {
        const listener: EventListener = (nativeEvent) => {
          const event = nativeEvent as PointerEvent;
          if (handleArtworkSamplingPointer(phase, event)) return;
          // A press on the artwork takes focus, the way pressing any surface
          // that owns interaction should. These listeners sit on the ink
          // canvas, so they only ever see genuine drawing-surface presses --
          // chrome, panels and menus never reach here and keep their own
          // focus. Sampling is excluded above: the eyedropper is driven from
          // the picker and has to keep it.
          if (phase === "down") host.focus({ preventScroll: true });
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
        activation.listen(inkLayer!.canvas, type, listener, true);
        editorPointerListeners.push([type, listener]);
      };
      addEditorPointerListener("pointerdown", "down");
      addEditorPointerListener("pointermove", "move");
      addEditorPointerListener("pointerup", "up");
      addEditorPointerListener("pointercancel", "cancel");
      addEditorPointerListener("lostpointercapture", "cancel");
      const wheelListener: EventListener = (nativeEvent) => {
        const event = nativeEvent as WheelEvent;
        if (artworkSamplingActiveRef.current) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
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
      activation.listen(inkLayer.canvas, "wheel", wheelListener, { capture: true, passive: false });
      editorPointerListeners.push(["wheel", wheelListener]);
      host.dataset.viewportWheelPolicy = "ctrl-zoom-wheel-pan";
      const cursorLeaveListener: EventListener = () => {
        if (
          !activeManipulationController.hasActiveSession() &&
          activeViewportPan === null &&
          !spacePanHeld
        ) {
          resetManipulationCursor();
        }
        activeVectorInteractionRenderer.setHover(null);
      };
      activation.listen(inkLayer.canvas, "pointerleave", cursorLeaveListener, true);
      editorPointerListeners.push(["pointerleave", cursorLeaveListener]);
      contextMenuListener = (event): void => {
        event.preventDefault();
        if (artworkSamplingActiveRef.current) {
          event.stopImmediatePropagation();
          return;
        }
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
      activation.listen(inkLayer.canvas, "contextmenu", contextMenuListener as EventListener);
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
            renderer: Object.freeze({
              version: 1,
              kind: family === "pen" ? "outline" : "centerline",
            }),
          });
        },
        onStrokeStart: (update) => activeStrokeRenderer.beginStroke(update),
        onStrokeUpdate: (update) => activeStrokeRenderer.updateStroke(update),
        onStrokeFinalized: (stroke) => {
          // Backstop for any press that reached the ink controller directly.
          if (refuseActiveLayerWrite()) {
            activeStrokeRenderer.cancelStroke(null);
            return;
          }
          // A stroke that lies wholly outside the paper is unreachable artwork.
          // The brush cursor already reports the workspace as undrawable, so the
          // gesture is discarded rather than committed where it cannot be seen.
          const pageGeometry = documentSession.geometry;
          const strokeBounds = getStrokeRenderedBounds(stroke);
          if (
            strokeBounds.x + strokeBounds.width <= 0 ||
            strokeBounds.y + strokeBounds.height <= 0 ||
            strokeBounds.x >= pageGeometry.width ||
            strokeBounds.y >= pageGeometry.height
          ) {
            activeStrokeRenderer.cancelStroke(null);
            return;
          }
          const object = documentSession.createStrokeObject(stroke);
          activeStrokeRenderer.finalizeStroke(
            object.stroke,
            object.transform.translation,
            object.id,
          );
          try {
            activeHistoryCoordinator.executeStroke(object);
            reportCommittedCreationColor(object.id);
          } catch (cause) {
            synchronizeDocumentFromHistory();
            const error =
              cause instanceof Error
                ? cause
                : new Error("History stroke execution failed.", { cause });
            callbacks.errorRef.current?.(error);
          } finally {
            /**
             * Hand the mark over inside this one task.
             *
             * Finalizing clears the live layer immediately -- the editor keeps
             * finished artwork on the compositor, not on the ink canvas -- while
             * the compositor's own repaint is scheduled for the next animation
             * frame. Those are two different frames, and in between them the
             * stroke the artist has just finished is on neither surface: a blank
             * frame, measured at pointer-up as one frame of nothing followed by
             * the mark arriving.
             *
             * Flushing the render the document change has already asked for puts
             * both surfaces in the same frame. Nothing is rendered twice and
             * nothing is rendered early; the work that was going to happen next
             * frame happens in this one, before the browser composites either
             * canvas, so there is no moment at which the mark is missing and
             * none at which it is drawn twice.
             */
            controller.flushRender();
          }
        },
        onStrokeCancelled: ({ dirtyRect }) => activeStrokeRenderer.cancelStroke(dirtyRect),
        onError: (error) => callbacks.errorRef.current?.(error),
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
        const screenPosition: ScreenPoint = Object.freeze({
          x: event.clientX,
          y: event.clientY,
          coordinateSpace: "screen",
        });
        // The Eraser owns its own radius; whole-stroke removal is unchanged.
        const pagePosition = manipulationCoordinateMapper.screenToPage(screenPosition, false);
        const eraserRadius = Math.max(resolveDrawingStyle().width, 1) / 2;
        const candidates =
          pagePosition === null
            ? selectionCandidatesAt(screenPosition)
            : Object.freeze(
                hitTestEngine
                  .queryNearby(pagePosition, eraserRadius)
                  .map(({ objectId }) => documentSession.collection.lookup(objectId))
                  .filter((object): object is PageObject => object !== undefined),
              );
        const object = firstErasableInkCandidate(candidates, eraserObjectIds, effective.erasable);
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
        if (!creation.draft.valid || refuseActiveLayerWrite()) {
          clearShapeCreation();
          return;
        }
        try {
          const object = createShapeObject(creation.draft);
          const state = activeHistoryCoordinator.executeObjectCreation(object);
          updateHistoryDiagnostics(state);
          reportCommittedCreationColor(object.id);
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
        host.dataset.drawingBrushFamily = style.brush?.family ?? "";
        host.dataset.drawingPresetId = style.brush?.presetId ?? "";
        host.dataset.drawingSmoothing = String(style.brush?.smoothing.amount ?? 0);
      };
      toolRegistryRef.current = activeToolRegistry;
      updateToolDiagnosticsRef.current = updateToolDiagnostics;
      activation.onActive(() => {
        // PointerInput attaches only at activation; no candidate window-blur subscription.
        try {
          activeToolRegistry.activate(interactionModeRef.current);
          updateToolDiagnostics();
        } catch (cause) {
          activePointerInput.detach();
          throw cause;
        }
        return () => activePointerInput.detach();
      });
      updateToolDiagnostics();
      callbacks.toolRegistryReadyRef.current?.(activeToolRegistry);
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
      viewportBlurListener = () => {
        cancelContinuousStyleEdit();
        cancelViewportPan();
      };
      activation.listen(window, "keydown", toolKeyboardDownListener as EventListener, true);
      activation.listen(window, "keyup", toolKeyboardUpListener as EventListener, true);
      activation.listen(window, "blur", viewportBlurListener);
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
      /**
       * Cancels the most local canvas interaction, exactly once per Escape.
       *
       * Cancelling a transform restores the original geometry through the
       * manipulation session itself, so nothing here reaches History.
       */
      const escapeActions: EditorEscapeActions = Object.freeze({
        escape: (): boolean => {
          if (activeShapeCreation !== null) {
            clearShapeCreation();
            return true;
          }
          if (activeLineEndpointInteraction !== null) {
            finishLineEndpointInteraction(false);
            return true;
          }
          if (activeManipulationController.hasActiveSession()) {
            activeManipulationController.cancelManipulation();
            releaseManipulationPointerCapture();
            activeTransformPreviewRenderer.setPreview(null);
            activeVectorInteractionRenderer.setSelectionPreviewTransform(null);
            hideRotationIndicator();
            updateSelection(activeSelectionController.getSelection(), false);
            return true;
          }
          if (marqueeOrigin !== null) {
            activeVectorInteractionRenderer.setMarquee(null);
            marqueeOrigin = null;
            marqueeAdditive = false;
            marqueeBaseIds = Object.freeze([]);
            host.dataset.marqueeState = "idle";
            return true;
          }
          if (editorSelection.ids.length > 0) {
            selectEditorObjects([]);
            return true;
          }
          return false;
        },
      });
      callbacks.escapeActionsReadyRef.current?.(escapeActions);
      callbacks.controllerReadyRef.current?.(controller);
      callbacks.selectionControllerReadyRef.current?.(activeSelectionController);
      callbacks.manipulationControllerReadyRef.current?.(activeManipulationController);
      callbacks.historyControllerReadyRef.current?.(activeHistoryCoordinator.controller);
      callbacks.diagnosticsRef.current?.(controller.snapshot());
      themeObserver = new MutationObserver(() => {
        if (controller.status === "mounted") {
          controller.setTheme(readTheme());
          callbacks.diagnosticsRef.current?.(controller.snapshot());
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "style", "class"],
      });
      // Include the first artwork render in preparation, not after disposing the old runtime.
      controller.flushRender();
      if (latestViewportPresentation !== null) {
        callbacks.viewportChangeRef.current?.(latestViewportPresentation);
      }
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
      callbacks.errorRef.current?.(error);
    }

    const cleanup = () => {
      continuousVectorStyleEdit?.cancel();
      continuousSelectionStyleEdit?.cancel();
      continuousPaperColorEdit?.cancel();
      // An opacity drag interrupted by unmount would otherwise leave its preview
      // opacity in the document with no History entry to undo it.
      continuousLayerOpacityEdit?.cancel();
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
      if (rotationIndicatorFrame !== null) {
        cancelAnimationFrame(rotationIndicatorFrame);
        rotationIndicatorFrame = null;
      }
      callbacks.viewportActionsReadyRef.current?.(null);
      unsubscribeSelection?.();
      unsubscribeManipulation?.();
      manipulationController?.destroy();
      releaseManipulationPointerCapture();
      manipulationControllerRef.current = null;
      selectionControllerRef.current = null;
      releaseManipulationPointerCaptureRef.current = null;
      resetManipulationCursorRef.current = null;
      resetVectorHoverRef.current = null;
      cancelContinuousStyleEditRef.current = null;
      toolRegistry?.destroy();
      releaseShapePointerCapture();
      toolRegistryRef.current = null;
      updateToolDiagnosticsRef.current = null;
      callbacks.toolRegistryReadyRef.current?.(null);
      uninstallHistoryShortcuts?.();
      uninstallEditingShortcuts?.();
      editingActionsRef.current = null;
      editorClipboard.clear();
      editorSelection.clear();
      selectionGeometry.clear();
      historyCoordinator?.destroy();
      callbacks.objectLifecycleActionsReadyRef.current?.(null);
      callbacks.escapeActionsReadyRef.current?.(null);
      callbacks.pageActionsReadyRef.current?.(null);
      callbacks.layerActionsReadyRef.current?.(null);
      callbacks.shapeEditingActionsReadyRef.current?.(null);
      callbacks.shapeEditingChangeRef.current?.(null);
      selectionController?.destroy();
      pointerInput?.destroy();
      selectionOverlayRenderer?.destroy();
      vectorInteractionRenderer?.destroy();
      transformPreviewRenderer?.destroy();
      shapePreviewRenderer?.destroy();
      strokeRenderer?.destroy();
      materialRuntime.destroy();
      selectionLayer?.destroy();
      vectorInteractionLayer?.destroy();
      manipulationLayer?.destroy();
      shapePreviewLayer?.destroy();
      inkLayer?.destroy();
      measurementElement?.remove();
      rotationIndicatorElement?.remove();
      if (loupeFrame !== null) {
        cancelAnimationFrame(loupeFrame);
        loupeFrame = null;
      }
      for (const [type, listener] of loupePointerListeners) {
        host.removeEventListener(type, listener, true);
      }
      loupePointerListeners = [];
      hideLoupeRef.current = null;
      loupeElement?.remove();
      controller.destroy();
    };

    const result = activation.finishPreparation(cleanup);
    if (runtime !== undefined)
      queueMicrotask(() => {
        if (runtime.entry.activation === activation) runtime.host.prepared(runtime.entry, result);
      });
    else if (result.status === "ready") {
      const armed = activation.arm();
      if (armed.status === "ready") {
        const committed = activation.commit();
        if (committed.status === "failed") {
          activation.dispose();
          errorRef.current?.(committed.error);
        }
      } else errorRef.current?.(armed.error);
    } else errorRef.current?.(result.error);
    return () => activation.dispose();
  }, [session, runtime]);

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
        // Programmatically focusable, never a Tab stop. Pressing the artwork
        // has to leave focus somewhere truthful: without this it stays on
        // whichever button was pressed last, and every keyboard rule that asks
        // "what is focused" gets a stale answer for the whole drawing session.
        tabIndex={-1}
        data-testid="canvas-surface"
        data-renderer-state="initializing"
        data-selection-capability="initializing"
        data-manipulation-capability="initializing"
        data-history-capability="initializing"
        data-clipboard-capability="initializing"
        data-context-menu-capability="initializing"
        data-artwork-sampling-state={artworkSamplingActive ? "active" : "inactive"}
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

interface SelectionEditingSnapshotInput {
  readonly objects: readonly PageObject[];
  readonly page: PageDocument;
  readonly viewport: Viewport;
  readonly effective: EffectiveObjectState;
  readonly primaryVector?: VectorPageObject;
}

function sameRenderPagePresentation(first: RenderPage, second: RenderPage): boolean {
  if (
    first.rect.x !== second.rect.x ||
    first.rect.y !== second.rect.y ||
    first.rect.width !== second.rect.width ||
    first.rect.height !== second.rect.height ||
    first.paperColor !== second.paperColor ||
    first.background.kind !== second.background.kind
  ) {
    return false;
  }
  if (first.background.kind === "plain" || second.background.kind === "plain") return true;
  return (
    first.background.spacing === second.background.spacing &&
    first.background.lineColor === second.background.lineColor
  );
}

/**
 * Presentation geometry for one selected stroke's oriented frame.
 *
 * The frame uses the stroke's *visual* local bounds, which stop at the ink
 * rather than at the padded rectangle repainting needs, and rotates about the
 * stroke's own pivot. Nothing here touches the Ink transform: this describes
 * the artwork, it does not move it.
 */
function inflateSelectionRect(rect: ObjectBounds, amount: number): Rect {
  return Object.freeze({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  });
}

function inkSelectionOrientation(
  object: InkObject,
  transform: Transform,
): SelectionOverlayOrientation {
  return Object.freeze({
    localBounds: getStrokeVisualLocalBounds(object.stroke, transform.scale),
    pivot: getStrokeTransformPivot(object.stroke),
    translation: transform.translation,
    rotation: transform.rotation,
    scale: transform.scale,
  });
}

/**
 * Builds the contextual-toolbar snapshot for the whole selection.
 *
 * A single vector or a single stroke keeps its oriented selection frame so
 * rotation and resize presentation follow the artwork; multi-object selections
 * report the axis-aligned union instead.
 */
function createSelectionEditingSnapshot(
  input: SelectionEditingSnapshotInput,
): ShapeEditingSnapshot | null {
  const { objects, page, viewport, effective, primaryVector } = input;
  const style = resolveSelectionEditingStyle(objects);
  const bounds = selectionUnionBounds(objects);
  const primary = objects.at(-1);
  if (style === null || bounds === null || primary === undefined) return null;
  const singleVector =
    objects.length === 1 && primaryVector !== undefined && primaryVector.id === primary.id
      ? primaryVector
      : null;
  const topLeft = viewport.worldToViewport({
    x: viewport.pageRect.x + bounds.x,
    y: viewport.pageRect.y + bounds.y,
  });
  const layerIds = new Set(
    objects.map((object) => page.layerIdForObject(object.id)).filter((id) => id !== undefined),
  );
  let selectionFrame: ShapeEditingSnapshot["selectionFrame"];
  if (singleVector !== null) {
    const localCenter = Object.freeze({
      x: singleVector.localBounds.x + singleVector.localBounds.width / 2,
      y: singleVector.localBounds.y + singleVector.localBounds.height / 2,
    });
    const pageCenter = singleVector.transform.applyToPoint(localCenter, localCenter);
    const viewportCenter = viewport.worldToViewport({
      x: viewport.pageRect.x + pageCenter.x,
      y: viewport.pageRect.y + pageCenter.y,
    });
    selectionFrame = Object.freeze({
      centerX: viewportCenter.x,
      centerY: viewportCenter.y,
      width: singleVector.localBounds.width * singleVector.transform.scale * viewport.camera.zoom,
      height: singleVector.localBounds.height * singleVector.transform.scale * viewport.camera.zoom,
      rotation: singleVector.transform.rotation,
    });
  } else if (objects.length === 1 && primary instanceof InkObject) {
    const orientation = inkSelectionOrientation(primary, primary.transform);
    const frame = orientedFrameGeometry(orientation, 0, viewport.camera.zoom);
    const centers = frame.corners.reduce(
      (total, corner) => ({ x: total.x + corner.x, y: total.y + corner.y }),
      { x: 0, y: 0 },
    );
    const pageCenter = { x: centers.x / 4, y: centers.y / 4 };
    const viewportCenter = viewport.worldToViewport({
      x: viewport.pageRect.x + pageCenter.x,
      y: viewport.pageRect.y + pageCenter.y,
    });
    selectionFrame = Object.freeze({
      centerX: viewportCenter.x,
      centerY: viewportCenter.y,
      width: orientation.localBounds.width * orientation.scale * viewport.camera.zoom,
      height: orientation.localBounds.height * orientation.scale * viewport.camera.zoom,
      rotation: orientation.rotation,
    });
  }
  return Object.freeze({
    objectId: primary.id,
    objectType: style.kind,
    selectedObjectIds: Object.freeze(objects.map(({ id }) => id)),
    readOnly: !objects.every(effective.editable),
    layerId: layerIds.size === 1 ? (([...layerIds][0] as string) ?? null) : null,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
    viewportBounds: Object.freeze({
      x: topLeft.x,
      y: topLeft.y,
      width: bounds.width * viewport.camera.zoom,
      height: bounds.height * viewport.camera.zoom,
    }),
    viewportSize: Object.freeze({ ...viewport.size }),
    ...(selectionFrame === undefined ? {} : { selectionFrame }),
  });
}
