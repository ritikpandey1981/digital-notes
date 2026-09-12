import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject } from "@folio/persistence/project";
import { ProjectPersistenceCoordinator } from "../../persistence/project-persistence-coordinator";
import {
  DeferredUnsavedChangesPrompt,
  ProjectLifecycleCoordinator,
  type UnsavedChangesDecision,
  type UnsavedChangesRequest,
} from "../../persistence/project-lifecycle-coordinator";
import { RecoveryAutosaveCoordinator } from "../../persistence/recovery-autosave-coordinator";
import { useProjectCloseProtection } from "../../persistence/useProjectCloseProtection";
import type {
  ArtworkColorSampleResult,
  CanvasDrawingStyle,
  ColorTargetAdapter,
  DrawingToolKind,
  EditorColorSystemSnapshot,
  EditorEscapeActions,
  LayerActions,
  LayersSnapshot,
  PageActions,
  PagesSnapshot,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
  ShapeStylePatch,
  EditorViewportSnapshot,
  ViewportActions,
} from "@folio/editor";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { FloatingToolWidgetId } from "./floating-tool-widget-registry";
import { CanvasHost } from "./CanvasHost";
import { DrawingPropertyRail } from "./DrawingPropertyRail";
import { RadialBrushLibrary } from "./RadialBrushLibrary";
import { resolveDrawingPropertyRail } from "./drawing-property-rail-model";
import { LayersPanel } from "./LayersPanel";
import { PageNavigator } from "./PageNavigator";
import { PageSettingsPanel } from "./PageSettingsPanel";
import { useNotifications } from "../notifications/NotificationProvider";
import { ShapesWidget } from "./ShapesWidget";
import { ShapeEditingToolbar } from "./ShapeEditingToolbar";
import { SpatialLayersView } from "./SpatialLayersView";
import { ToolDock } from "./ToolDock";
import { ToolOptionsWidget } from "./ToolOptionsWidget";
import { FullColorPicker } from "./FullColorPicker";
import { QuickColorRail } from "./QuickColorRail";
import { WorkspaceUtilityRail } from "./WorkspaceUtilityRail";
import { createContinuousColorTarget } from "./color-target-adapters";
import { resolveCreationColorSession } from "./creation-color-session";
import { registerCanvasEscape } from "./floating-dismissal-stack";
import { useColorPickerSession } from "./useColorPickerSession";
import type { DrawingSlotDefinition } from "./tool-dock-model";
import type { LayersView } from "./useEditorWorkspaceState";
import type { ToolOptionsDescriptor } from "./tool-options-registry";
import type { WorkspaceHistoryActions, WorkspaceHistoryAvailability } from "./workspace-history";

interface EditorWorkspaceProps {
  onProjectRuntimeReady?: (host: ProjectRuntimeHost | null) => void;
  onProjectPersistenceReady?: (coordinator: ProjectPersistenceCoordinator | null) => void;
  onProjectLifecycleReady?: (coordinator: ProjectLifecycleCoordinator | null) => void;
  /**
   * Asks the user about unsaved work before a destructive lifecycle action.
   *
   * Without one the guard answers "cancel": a shell that cannot ask must not
   * silently discard a drawing.
   */
  onConfirmUnsavedChanges?: (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>;
  pageNavigatorOpen: boolean;
  onDismissPageNavigator: () => void;
  pageSettingsOpen: boolean;
  onOpenPageSettings: () => void;
  onDismissPageSettings: () => void;
  activeTool: EditorTool;
  activeDrawingSlotId: string | null;
  /** The family each drawing slot currently holds, so the dock follows it. */
  slotFamilies: Readonly<Record<string, DrawingToolKind>>;
  /** The library identity id each drawing slot holds, or "" for none. */
  slotBrushIds: Readonly<Record<string, string>>;
  /** The brush each drawing slot currently holds, for its name and tooltip. */
  slotBrushNames: Readonly<Record<string, string>>;
  /** Canonical resolved artwork colour retained independently by each slot. */
  slotDrawingColors: Readonly<Record<string, string>>;
  activeDockSlotId: string | null;
  brushLibraryOpen: boolean;
  onDismissBrushLibrary: () => void;
  layersOpen: boolean;
  layersView: LayersView;
  onShowLayersView: (view: LayersView) => void;
  onToggleLayers: () => void;
  onDismissLayers: () => void;
  activeSlotBrushId: string | null;
  selectLibraryBrush: (brushId: string) => void;
  onSelectDrawingSlot: (slot: DrawingSlotDefinition) => void;
  activeShape: ShapeToolKind;
  armedShape: ShapeToolKind | null;
  activeFloatingWidget: FloatingToolWidgetId | null;
  onOpenToolOptions: () => void;
  onSelectTool: (tool: EditorTool) => void;
  onSelectShape: (shape: ShapeToolKind) => void;
  drawingStyle: CanvasDrawingStyle;
  toolOptions: ToolOptionsDescriptor | null;
  colors: EditorColorSystemSnapshot;
  colorTarget: ColorTargetAdapter | null;
  onSelectColorPalette: (paletteId: string) => void;
  onToggleFavoriteColor: (color: string) => void;
  onSelectDrawingPreset: (presetId: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
  onChangeDrawingSmoothing: (amount: number) => void;
  onDrawingColorUsed: (color: string) => void;
  onDismissFloatingWidget: () => void;
  onHistoryActionsReady: (actions: WorkspaceHistoryActions | null) => void;
  onHistoryAvailabilityChange: (availability: WorkspaceHistoryAvailability) => void;
  viewportSnapshot: EditorViewportSnapshot;
  onViewportActionsReady: (actions: ViewportActions | null) => void;
  onViewportChange: (snapshot: EditorViewportSnapshot) => void;
  onViewportNavigationLearned: () => void;
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const [{ host, persistence, lifecycle, recovery, unsavedPrompt }] = useState(() => {
    const runtimeHost = new ProjectRuntimeHost(
      new ProjectSession(createEmptyFolioProject()),
      () => coordinator.canReplaceRuntime,
    );
    const coordinator: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
      () => runtimeHost.active.project,
      { save: (request) => window.folio.projects.save(request) },
      () => !runtimeHost.replacing,
      {
        host: runtimeHost,
        port: {
          open: () => window.folio.projects.open(),
          adopt: (targetId) => window.folio.projects.adopt(targetId),
          release: (targetId) => window.folio.projects.release(targetId),
        },
      },
    );
    const prompt = new DeferredUnsavedChangesPrompt();
    return {
      host: runtimeHost,
      persistence: coordinator,
      lifecycle: new ProjectLifecycleCoordinator(coordinator, prompt),
      recovery: new RecoveryAutosaveCoordinator({
        store: {
          store: (request) => window.folio.recovery.store(request),
          clear: (recoveryId) => window.folio.recovery.clear(recoveryId),
        },
        persistenceState: () => coordinator.persistenceState,
        backingTargetId: () => coordinator.backing?.id ?? null,
      }),
      unsavedPrompt: prompt,
    };
  });
  const { onConfirmUnsavedChanges } = props;
  useEffect(() => {
    unsavedPrompt.setHandler(onConfirmUnsavedChanges ?? null);
    return () => unsavedPrompt.setHandler(null);
  }, [unsavedPrompt, onConfirmUnsavedChanges]);
  useProjectCloseProtection(lifecycle, recovery);
  const runtimes = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot);
  const escapeActionsRef = useRef<EditorEscapeActions | null>(null);
  const publishEscape = useCallback((actions: EditorEscapeActions | null) => {
    escapeActionsRef.current = actions;
  }, []);
  // The shared fallback belongs to the stable host, never to an inert candidate.
  useEffect(() => registerCanvasEscape(() => escapeActionsRef.current?.escape() ?? false), []);
  useEffect(() => host.connect(), [host]);
  useEffect(() => recovery.connect(), [recovery]);
  // Following the active project is also how a committed replacement retires the
  // project it replaced: the previous snapshot goes only once B is really live.
  const activeProject = host.active.project;
  useEffect(() => {
    recovery.setProject(activeProject);
  }, [recovery, activeProject]);
  const { onProjectLifecycleReady, onProjectPersistenceReady, onProjectRuntimeReady } = props;
  useEffect(() => {
    onProjectPersistenceReady?.(persistence);
    onProjectRuntimeReady?.(host);
    onProjectLifecycleReady?.(lifecycle);
    return () => {
      onProjectPersistenceReady?.(null);
      onProjectRuntimeReady?.(null);
      onProjectLifecycleReady?.(null);
    };
  }, [
    host,
    persistence,
    lifecycle,
    onProjectPersistenceReady,
    onProjectRuntimeReady,
    onProjectLifecycleReady,
  ]);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {runtimes.map((entry) => (
        <ProjectWorkspace
          key={entry.id}
          {...props}
          host={host}
          entry={entry}
          publishEscape={publishEscape}
        />
      ))}
    </div>
  );
}

function ProjectWorkspace({
  host,
  entry,
  publishEscape,
  pageNavigatorOpen,
  onDismissPageNavigator,
  pageSettingsOpen,
  onOpenPageSettings,
  onDismissPageSettings,
  activeTool,
  activeDrawingSlotId,
  slotFamilies,
  slotBrushIds,
  slotBrushNames,
  slotDrawingColors,
  activeDockSlotId,
  brushLibraryOpen,
  onDismissBrushLibrary,
  layersOpen,
  layersView,
  onShowLayersView,
  onToggleLayers,
  onDismissLayers,
  activeSlotBrushId,
  selectLibraryBrush,
  onSelectDrawingSlot,
  activeShape,
  armedShape,
  activeFloatingWidget,
  onOpenToolOptions,
  onSelectTool,
  onSelectShape,
  drawingStyle,
  toolOptions,
  colors,
  colorTarget,
  onSelectColorPalette,
  onToggleFavoriteColor,
  onSelectDrawingPreset,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
  onChangeDrawingSmoothing,
  onDrawingColorUsed,
  onDismissFloatingWidget,
  onHistoryActionsReady,
  onHistoryAvailabilityChange,
  viewportSnapshot,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
}: EditorWorkspaceProps & {
  host: ProjectRuntimeHost;
  entry: ProjectRuntime;
  publishEscape: (actions: EditorEscapeActions | null) => void;
}) {
  const projectSession = entry.project;
  const active = host.active === entry;
  const runtime = useMemo(() => ({ host, entry }), [host, entry]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const historyActionsRef = useRef<WorkspaceHistoryActions | null>(null);
  const handleHistoryActionsReady = useCallback(
    (actions: WorkspaceHistoryActions | null) => {
      historyActionsRef.current = actions;
      onHistoryActionsReady(actions);
    },
    [onHistoryActionsReady],
  );
  const [pageActions, setPageActions] = useState<PageActions | null>(null);
  const [pagesSnapshot, setPagesSnapshot] = useState<PagesSnapshot>(() =>
    Object.freeze({ pages: Object.freeze([]), activePageId: "" }),
  );
  const [thumbnailRevision, setThumbnailRevision] = useState(0);
  const handlePageActionsReady = useCallback((actions: PageActions | null) => {
    setPageActions(actions);
  }, []);
  const handlePagesChange = useCallback((snapshot: PagesSnapshot) => {
    setPagesSnapshot(snapshot);
    // Thumbnails redraw on committed document changes only, never per pointer move.
    setThumbnailRevision((revision) => revision + 1);
  }, []);
  const renderCountRef = useRef(0);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (workspaceRef.current !== null) {
      workspaceRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });
  const objectLifecycleActionsRef = useRef<ObjectLifecycleActions | null>(null);
  const shapeEditingActionsRef = useRef<ShapeEditingActions | null>(null);
  const [layerActions, setLayerActions] = useState<LayerActions | null>(null);
  const [layersSnapshot, setLayersSnapshot] = useState<LayersSnapshot>(() =>
    Object.freeze({ layers: Object.freeze([]), activeLayerId: "" }),
  );
  const handleLayerActionsReady = useCallback((actions: LayerActions | null) => {
    setLayerActions(actions);
  }, []);
  const handleMoveSelectionToLayer = useCallback((layerId: string): void => {
    shapeEditingActionsRef.current?.moveSelectionToLayer(layerId);
  }, []);
  const handleLayersChange = useCallback((snapshot: LayersSnapshot) => {
    setLayersSnapshot(snapshot);
  }, []);
  const { notify } = useNotifications();
  // Editor errors may contain internal command details; only presentation is
  // normalized here, without observing History again or retrying the operation.
  const handleEditorError = useCallback(() => {
    notify({ title: "Couldn’t complete that edit.", tone: "error" });
  }, [notify]);
  // Destructive page and Layer removals are undoable, so the notification offers
  // the recovery directly instead of only announcing the loss.
  const notifyPageDeleted = useCallback(
    (message: string) =>
      notify({
        title: message,
        action: { label: "Undo", onAction: () => historyActionsRef.current?.undo() },
      }),
    [notify],
  );
  const notifyLayerDeleted = useCallback(
    (message: string) =>
      notify({
        title: message,
        action: { label: "Undo", onAction: () => historyActionsRef.current?.undo() },
      }),
    [notify],
  );
  // Refusal feedback is transient and identical for every creation route, so one
  // short notification replaces silent, invisible artwork.
  const handleActiveLayerRefusal = useCallback(
    (reason: "hidden" | "locked") =>
      notify({
        title: reason === "hidden" ? "Layer is hidden" : "Layer is locked",
        description:
          reason === "hidden"
            ? "Show the active layer to draw on it."
            : "Unlock the active layer to draw on it.",
      }),
    [notify],
  );
  const [shapeEditingSnapshot, setShapeEditingSnapshot] = useState<ShapeEditingSnapshot | null>(
    null,
  );
  const colorPicker = useColorPickerSession();
  const {
    cancel: cancelPickerSession,
    commit: commitPickerSession,
    open: openPickerSession,
  } = colorPicker;
  const colorPickerFloatingScope = useId();
  const [eyedropperState, setEyedropperState] = useState<{
    readonly targetId: string | null;
    readonly active: boolean;
    readonly message: string | null;
    readonly sampledColor: string | null;
  }>(() => ({ targetId: null, active: false, message: null, sampledColor: null }));
  const activePickerTargetId = colorPicker.snapshot?.target.id ?? null;
  const eyedropperActive =
    eyedropperState.active && eyedropperState.targetId === activePickerTargetId;
  const clearEyedropperState = useCallback((): void => {
    setEyedropperState({ targetId: null, active: false, message: null, sampledColor: null });
  }, []);
  const handleObjectLifecycleActionsReady = useCallback(
    (actions: ObjectLifecycleActions | null) => {
      objectLifecycleActionsRef.current = actions;
    },
    [],
  );
  const handleShapeEditingActionsReady = useCallback((actions: ShapeEditingActions | null) => {
    shapeEditingActionsRef.current = actions;
  }, []);
  const handleShapeEditingChange = useCallback((snapshot: ShapeEditingSnapshot | null) => {
    setShapeEditingSnapshot((previous) => stabilizeShapeToolbarAnchor(previous, snapshot));
  }, []);
  const deleteSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.deleteSelection();
  }, []);
  const duplicateSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.duplicateSelection();
  }, []);
  const beginContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.beginContinuousStyleEdit() ?? false;
  }, []);
  const previewContinuousShapeStyle = useCallback((patch: ShapeStylePatch): boolean => {
    return shapeEditingActionsRef.current?.updateContinuousStylePreview(patch) ?? false;
  }, []);
  const commitContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.commitContinuousStyleEdit() ?? false;
  }, []);
  const cancelContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.cancelContinuousStyleEdit() ?? false;
  }, []);
  const selectedVectorTargetId =
    shapeEditingSnapshot === null ? null : `selected-vector-${shapeEditingSnapshot.objectId}`;
  // The abort path, and only that. A session whose target has genuinely gone --
  // the selected object was deleted or deselected, the workspace tore down --
  // is cancelled, which restores the value the picker opened on. Deliberate
  // ownership changes never reach here: they are committed first, at the
  // activation boundary below.
  useEffect(() => {
    const activeSession = colorPicker.snapshot;
    if (activeSession === null) return;
    const validTargetIds = new Set(
      [colorTarget?.id, selectedVectorTargetId].filter((id): id is string => id !== undefined),
    );
    if (!validTargetIds.has(activeSession.target.id)) cancelPickerSession();
  }, [cancelPickerSession, colorPicker.snapshot, colorTarget?.id, selectedVectorTargetId]);
  const setEyedropperActive = useCallback(
    (active: boolean): void => {
      setEyedropperState({
        targetId: active ? activePickerTargetId : null,
        active: active && activePickerTargetId !== null,
        message: null,
        sampledColor: null,
      });
    },
    [activePickerTargetId],
  );
  const handleArtworkSample = useCallback(
    (result: ArtworkColorSampleResult): void => {
      if (!eyedropperActive || activePickerTargetId !== eyedropperState.targetId) return;
      if (result.status === "success") {
        setEyedropperState({
          targetId: eyedropperState.targetId,
          active: false,
          message: null,
          sampledColor: result.color,
        });
        return;
      }
      if (result.status === "miss" && result.reason === "outside-page") return;
      setEyedropperState((current) => ({
        ...current,
        message:
          result.status === "miss"
            ? "Color sampling isn't available."
            : "This color can't be sampled.",
      }));
    },
    [activePickerTargetId, eyedropperActive, eyedropperState.targetId],
  );
  const commitColorPicker = useCallback((): void => {
    clearEyedropperState();
    commitPickerSession();
  }, [clearEyedropperState, commitPickerSession]);
  const cancelColorPicker = useCallback((): void => {
    clearEyedropperState();
    cancelPickerSession();
  }, [cancelPickerSession, clearEyedropperState]);
  const openCreationPicker = useCallback(
    (anchor: HTMLElement, source: "quick-rail" | "tool-settings", ownerScope?: string): void => {
      if (colorTarget === null) return;
      clearEyedropperState();
      openPickerSession({ target: colorTarget, source, anchor, ownerScope });
    },
    [clearEyedropperState, colorTarget, openPickerSession],
  );
  /**
   * Resolves an open creation-colour session before tool ownership moves.
   *
   * Every surface that replaces the creation colour target routes through here
   * first, so the colour the artist just chose is committed rather than left
   * for the valid-target guard to abort. No stroke is required to make a
   * creation colour stick, and no second colour store is involved: the slot
   * already holds the previewed value, and commit merely ends the transaction
   * that would otherwise restore over it.
   */
  /** Selecting a Layer plane is session state: zero History, no mutation. */
  const handleActivateStackLayer = useCallback(
    (layerId: string): void => {
      layerActions?.setActiveLayer(layerId);
    },
    [layerActions],
  );
  /**
   * A page switch ends the stack rather than rebuilding it for the new page:
   * the view is transient, and cross-page transient state is a bug factory.
   *
   * Stack only, and only for a real page change. The list is an ordinary panel
   * that has always survived a page switch, and closing it here would also
   * reorder the dismissal stack, so the next press on the canvas would put away
   * the page navigator instead of the panel. Comparing the remembered page is
   * what separates "the page changed" from "the stack stopped being shown".
   */
  const stackOpen = layersOpen && layersView === "stack";
  const stackPageId = pagesSnapshot.activePageId;
  const stackOpenedOnPage = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !stackOpen) {
      stackOpenedOnPage.current = null;
      return;
    }
    if (stackOpenedOnPage.current === null) {
      stackOpenedOnPage.current = stackPageId;
      return;
    }
    if (stackOpenedOnPage.current !== stackPageId) onDismissLayers();
  }, [active, onDismissLayers, stackOpen, stackPageId]);
  const resolveCreationColorForOwnershipChange = useCallback((): void => {
    const resolution = resolveCreationColorSession(
      colorPicker.snapshot?.target.id ?? null,
      colorTarget?.id ?? null,
    );
    if (resolution === "commit") commitColorPicker();
  }, [colorPicker.snapshot, colorTarget?.id, commitColorPicker]);
  const handleSelectDrawingSlot = useCallback(
    (slot: DrawingSlotDefinition): void => {
      resolveCreationColorForOwnershipChange();
      onSelectDrawingSlot(slot);
    },
    [onSelectDrawingSlot, resolveCreationColorForOwnershipChange],
  );
  const handleSelectTool = useCallback(
    (tool: EditorTool): void => {
      resolveCreationColorForOwnershipChange();
      onSelectTool(tool);
    },
    [onSelectTool, resolveCreationColorForOwnershipChange],
  );
  const handleSelectLibraryBrush = useCallback(
    (brushId: string): void => {
      resolveCreationColorForOwnershipChange();
      selectLibraryBrush(brushId);
    },
    [resolveCreationColorForOwnershipChange, selectLibraryBrush],
  );
  const handleSelectShape = useCallback(
    (shape: ShapeToolKind): void => {
      resolveCreationColorForOwnershipChange();
      onSelectShape(shape);
    },
    [onSelectShape, resolveCreationColorForOwnershipChange],
  );
  // Entering the structural Layers view ends a creation-colour edit the same way
  // choosing another tool does: the artist keeps the colour they picked, and no
  // session is left stranded behind a mode that has taken over the page.
  const handleToggleLayers = useCallback((): void => {
    resolveCreationColorForOwnershipChange();
    onToggleLayers();
  }, [onToggleLayers, resolveCreationColorForOwnershipChange]);
  // Derived on every render from the brush the editor already resolved, so the
  // rail cannot drift from the active preset and owns no state of its own.
  const propertyRailModel = resolveDrawingPropertyRail({
    tool: activeTool,
    brush: drawingStyle.brush,
    color: colorTarget?.getCurrentColor() ?? null,
  });
  const openSelectedVectorPicker = useCallback(
    (anchor: HTMLElement): void => {
      if (shapeEditingSnapshot === null) return;
      const objectType = shapeEditingSnapshot.objectType;
      const selectedVectorColorTarget = createContinuousColorTarget({
        id: `selected-vector-${shapeEditingSnapshot.objectId}`,
        label: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} Color`,
        getColor: () => shapeEditingSnapshot.strokeColor,
        beginContinuousEdit: beginContinuousShapeStyleEdit,
        previewContinuousEdit: (strokeColor) => previewContinuousShapeStyle({ strokeColor }),
        commitContinuousEdit: commitContinuousShapeStyleEdit,
        cancelContinuousEdit: cancelContinuousShapeStyleEdit,
      });
      clearEyedropperState();
      openPickerSession({
        target: selectedVectorColorTarget,
        source: "selected-vector",
        anchor,
        ownerScope: undefined,
      });
    },
    [
      beginContinuousShapeStyleEdit,
      cancelContinuousShapeStyleEdit,
      clearEyedropperState,
      commitContinuousShapeStyleEdit,
      openPickerSession,
      previewContinuousShapeStyle,
      shapeEditingSnapshot,
    ],
  );
  return (
    <section
      ref={workspaceRef}
      className={
        active
          ? "relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
          : "absolute inset-0 overflow-hidden"
      }
      style={active ? undefined : { visibility: "hidden", pointerEvents: "none" }}
      inert={!active}
      aria-hidden={!active}
      data-project-runtime={active ? "active" : "candidate"}
      aria-label="Notebook workspace"
      data-testid="editor-workspace"
    >
      <CanvasHost
        session={projectSession.documentSession}
        runtime={runtime}
        onEditorError={handleEditorError}
        activeTool={activeTool}
        armedShape={armedShape}
        artworkSamplingActive={eyedropperActive}
        artworkSamplingOwnerScope={colorPickerFloatingScope}
        drawingStyle={drawingStyle}
        onArtworkSample={handleArtworkSample}
        viewportSnapshot={viewportSnapshot}
        onObjectLifecycleActionsReady={handleObjectLifecycleActionsReady}
        onEscapeActionsReady={publishEscape}
        onActiveLayerRefusal={handleActiveLayerRefusal}
        onShapeEditingActionsReady={handleShapeEditingActionsReady}
        onShapeEditingChange={handleShapeEditingChange}
        onLayerActionsReady={handleLayerActionsReady}
        onLayersChange={handleLayersChange}
        onPageActionsReady={handlePageActionsReady}
        onPagesChange={handlePagesChange}
        onDrawingColorUsed={onDrawingColorUsed}
        onHistoryActionsReady={handleHistoryActionsReady}
        onHistoryAvailabilityChange={onHistoryAvailabilityChange}
        onViewportActionsReady={onViewportActionsReady}
        onViewportChange={onViewportChange}
        onViewportNavigationLearned={onViewportNavigationLearned}
      />
      {active ? (
        <>
          <SpatialLayersView
            open={layersOpen && layersView === "stack"}
            page={pageActions?.getPage(pagesSnapshot.activePageId) ?? null}
            snapshot={layersSnapshot}
            revision={thumbnailRevision}
            actions={layerActions}
            onActivateLayer={handleActivateStackLayer}
            onShowList={() => onShowLayersView("list")}
            onDismiss={onDismissLayers}
            onNotify={notifyLayerDeleted}
          />
          <RadialBrushLibrary
            open={brushLibraryOpen}
            anchorSlotId={activeDockSlotId}
            selectedBrushId={activeSlotBrushId}
            onSelectBrush={handleSelectLibraryBrush}
            onDismiss={onDismissBrushLibrary}
          />
          <ToolDock
            activeTool={activeTool}
            activeDrawingSlotId={activeDrawingSlotId}
            slotFamilies={slotFamilies}
            slotBrushIds={slotBrushIds}
            slotBrushNames={slotBrushNames}
            slotDrawingColors={slotDrawingColors}
            onSelectDrawingSlot={handleSelectDrawingSlot}
            onSelectTool={handleSelectTool}
          />
          <PageNavigator
            open={pageNavigatorOpen}
            snapshot={pagesSnapshot}
            actions={pageActions}
            getPage={pageActions?.getPage ?? null}
            thumbnailRevision={thumbnailRevision}
            onDismiss={onDismissPageNavigator}
            onOpenPageSettings={onOpenPageSettings}
            onNotify={notifyPageDeleted}
          />
          <PageSettingsPanel
            open={pageSettingsOpen}
            snapshot={pagesSnapshot}
            actions={pageActions}
            onDismiss={onDismissPageSettings}
          />
          <LayersPanel
            open={layersOpen && layersView === "list"}
            snapshot={layersSnapshot}
            actions={layerActions}
            onShowStack={() => onShowLayersView("stack")}
            onDismiss={onDismissLayers}
            onNotify={notifyLayerDeleted}
          />
          <ShapesWidget
            open={activeTool === "Shapes" && activeFloatingWidget === "shapes"}
            activeShape={activeShape}
            onSelectShape={handleSelectShape}
            onDismiss={onDismissFloatingWidget}
          />
          <ShapeEditingToolbar
            snapshot={shapeEditingSnapshot}
            onBeginStyleEdit={beginContinuousShapeStyleEdit}
            onPreviewStyle={previewContinuousShapeStyle}
            onCommitStyleEdit={commitContinuousShapeStyleEdit}
            onCancelStyleEdit={cancelContinuousShapeStyleEdit}
            onOpenColorPicker={openSelectedVectorPicker}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
            layers={layersSnapshot.layers}
            onMoveToLayer={handleMoveSelectionToLayer}
          />
          <DrawingPropertyRail
            model={propertyRailModel}
            onOpenToolOptions={onOpenToolOptions}
            onOpenColorPicker={(anchor) => openCreationPicker(anchor, "tool-settings")}
          />
          <ToolOptionsWidget
            descriptor={toolOptions}
            onSelectPreset={onSelectDrawingPreset}
            onOpenColorPicker={(anchor, ownerScope) =>
              openCreationPicker(anchor, "tool-settings", ownerScope)
            }
            onChangeWidth={onChangeDrawingWidth}
            onChangeOpacity={onChangeDrawingOpacity}
            onChangeSmoothing={onChangeDrawingSmoothing}
            onDismiss={onDismissFloatingWidget}
            previewScale={viewportSnapshot.zoom}
          />
          {/*
        One Layers entry point. Which presentation it opens -- the spatial
        stack or the mature list panel -- is decided inside the experience.
      */}
          <WorkspaceUtilityRail layersOpen={layersOpen} onToggleLayers={handleToggleLayers}>
            <QuickColorRail
              activeTool={activeTool}
              target={colorTarget}
              palette={colors.activePalette}
              onOpenPicker={(anchor) => openCreationPicker(anchor, "quick-rail")}
              onApplyColor={(color) => {
                if (colorTarget !== null) colorPicker.applyDirect(colorTarget, color);
              }}
            />
          </WorkspaceUtilityRail>
          {colorPicker.snapshot === null ? null : (
            <FullColorPicker
              key={colorPicker.snapshot.target.id}
              session={colorPicker.snapshot}
              colors={colors}
              eyedropperActive={eyedropperActive}
              eyedropperMessage={eyedropperState.message}
              eyedropperSampledColor={
                eyedropperState.targetId === activePickerTargetId
                  ? eyedropperState.sampledColor
                  : null
              }
              floatingScope={colorPickerFloatingScope}
              workspaceAvoidRect={
                colorPicker.snapshot.source === "selected-vector"
                  ? shapeEditingSnapshot?.viewportBounds
                  : undefined
              }
              onPreviewHex={colorPicker.previewHex}
              onPreviewHsv={colorPicker.previewHsv}
              onSelectPalette={onSelectColorPalette}
              onToggleFavorite={onToggleFavoriteColor}
              onEyedropperActiveChange={setEyedropperActive}
              onRequestPageNavigatorYield={onDismissPageNavigator}
              onCommit={commitColorPicker}
              onCancel={cancelColorPicker}
            />
          )}
        </>
      ) : null}
    </section>
  );
}

function stabilizeShapeToolbarAnchor(
  previous: ShapeEditingSnapshot | null,
  next: ShapeEditingSnapshot | null,
): ShapeEditingSnapshot | null {
  if (
    previous === null ||
    next === null ||
    previous.objectId !== next.objectId ||
    previous.viewportSize.width !== next.viewportSize.width ||
    previous.viewportSize.height !== next.viewportSize.height
  ) {
    return next;
  }
  const styleChanged =
    previous.strokeColor !== next.strokeColor ||
    previous.strokeWidth !== next.strokeWidth ||
    previous.opacity !== next.opacity;
  if (!styleChanged) return next;
  const previousCenter = {
    x: previous.viewportBounds.x + previous.viewportBounds.width / 2,
    y: previous.viewportBounds.y + previous.viewportBounds.height / 2,
  };
  const nextCenter = {
    x: next.viewportBounds.x + next.viewportBounds.width / 2,
    y: next.viewportBounds.y + next.viewportBounds.height / 2,
  };
  if (
    !nearlyEqual(previousCenter.x, nextCenter.x) ||
    !nearlyEqual(previousCenter.y, nextCenter.y)
  ) {
    return next;
  }
  return Object.freeze({ ...next, viewportBounds: previous.viewportBounds });
}

function nearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= 0.01;
}
