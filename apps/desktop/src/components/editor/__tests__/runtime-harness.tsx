import { StrictMode, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ProjectSession,
  type ProjectRuntimeHost,
  type RuntimePreparationResult,
  type ProjectRuntime,
  type ViewportActions,
} from "@folio/editor";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { EditorWorkspace } from "../EditorWorkspace";
import { useEditorWorkspaceState } from "../useEditorWorkspaceState";
import { useEditorViewportState } from "../useEditorViewportState";
import { TooltipLayerProvider } from "../ToolTooltip";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { NotificationProvider } from "../../notifications/NotificationProvider";
import { ContextHintProvider } from "../../shell/ContextHintProvider";
import type { ProjectPersistenceCoordinator } from "../../../persistence/project-persistence-coordinator";
import type { WorkspaceHistoryActions, WorkspaceHistoryAvailability } from "../workspace-history";

let host: ProjectRuntimeHost;
let persistence: ProjectPersistenceCoordinator;
let held: (() => void) | null = null;
let latestResult = "";
let viewportActions: ViewportActions | null = null;
let historyActions: WorkspaceHistoryActions | null = null;
let historyAvailability: WorkspaceHistoryAvailability = { canUndo: false, canRedo: false };
let saved: { entry: ProjectRuntime; root: unknown; surface: Element | null } | null = null;
let delayedPublication: (() => void) | null = null;
let automaticActivation = false;
const noop = () => undefined;

const runtimeHarness = {
  // The dedicated baseline drives the same mounted runtime as lifecycle tests.
  get project() {
    return host.active.project;
  },
  get viewportActions() {
    return viewportActions;
  },
  async replaceForBaseline(project: ProjectSession) {
    automaticActivation = true;
    try {
      return await host.replace(project);
    } finally {
      automaticActivation = false;
    }
  },
  async open() {
    automaticActivation = true;
    try {
      return await persistence.open();
    } finally {
      automaticActivation = false;
    }
  },
  save: () => persistence.save(),
  saveAs: () => persistence.saveAs(),
  get backing() {
    return persistence.backing;
  },
  get metadata() {
    return host.active.project.metadata;
  },
  get encoded() {
    return encodeFolioProject(host.active.project.captureSnapshot());
  },
  capture() {
    saved = {
      entry: host.active,
      root: host.active.project.documentSession.getDocument(),
      surface: document.querySelector(
        '[data-project-runtime="active"] [data-testid="canvas-surface"]',
      ),
    };
    const scope = host.active.activation!;
    const publish = scope.publish.bind(scope);
    scope.publish = (key, publication, retain) => {
      if (retain !== false) delayedPublication = () => publish(key, publication, retain);
      publish(key, publication, retain);
    };
    viewportActions?.setZoom(1.25);
  },
  unchanged() {
    return (
      saved !== null &&
      host.active === saved.entry &&
      host.active.project.documentSession.getDocument() === saved.root &&
      saved.surface ===
        document.querySelector('[data-project-runtime="active"] [data-testid="canvas-surface"]')
    );
  },
  begin(name: string, failure: "none" | "context" | "activation" = "none") {
    latestResult = "";
    const original = HTMLCanvasElement.prototype.getContext;
    if (failure === "context")
      HTMLCanvasElement.prototype.getContext = (() => null) as typeof original;
    const request = host.replace(
      new ProjectSession(createEmptyFolioProject({ documentId: name, title: name, pageId: name })),
    );
    if (failure === "activation") {
      const candidate = host.getSnapshot()[1]!;
      const prepare = host.prepared.bind(host);
      host.prepared = (entry, result) => {
        host.prepared = prepare;
        if (entry === candidate && result.status === "ready")
          entry.activation!.onActive(() => {
            throw new Error("Injected activation failure");
          });
        prepare(entry, result);
      };
    }
    void request
      .then((result) => {
        latestResult = result.status;
      })
      .finally(() => {
        HTMLCanvasElement.prototype.getContext = original;
      });
  },
  commit() {
    const commit = held;
    held = null;
    commit?.();
  },
  get ready() {
    return held !== null;
  },
  get result() {
    return latestResult;
  },
  get activeTitle() {
    return host.active.project.metadata.title;
  },
  get activeRootCount() {
    return host.active.project.documentSession.collection.size;
  },
  get canUndo() {
    return historyAvailability.canUndo;
  },
  get canRedo() {
    return historyAvailability.canRedo;
  },
  undo() {
    historyActions?.undo();
  },
  redo() {
    historyActions?.redo();
  },
  deliverStale() {
    delayedPublication?.();
  },
  get oldDetached() {
    return saved?.surface?.isConnected === false;
  },
  get saveIsBusy() {
    return persistence.isSaving;
  },
};
declare global {
  interface Window {
    runtimeHarness: typeof runtimeHarness;
  }
}
window.runtimeHarness = runtimeHarness;

export function Harness() {
  const editorWorkspace = useEditorWorkspaceState();
  const viewport = useEditorViewportState();
  const viewportHandleActionsReady = viewport.handleActionsReady;
  const onRuntimeReady = useCallback((value: ProjectRuntimeHost | null) => {
    if (value === null || value === host) return;
    host = value;
    const prepare = value.prepared.bind(value);
    value.prepared = (entry: ProjectRuntime, result: RuntimePreparationResult) => {
      if (!automaticActivation && entry !== value.active && result.status === "ready")
        held = () => prepare(entry, result);
      else prepare(entry, result);
    };
  }, []);
  const onPersistenceReady = useCallback((value: ProjectPersistenceCoordinator | null) => {
    if (value !== null) persistence = value;
  }, []);
  const handleHistoryActionsReady = useCallback((actions: WorkspaceHistoryActions | null) => {
    historyActions = actions;
  }, []);
  const handleHistoryAvailabilityChange = useCallback((value: WorkspaceHistoryAvailability) => {
    historyAvailability = value;
  }, []);
  const handleViewportActionsReady = useCallback(
    (actions: ViewportActions | null) => {
      viewportActions = actions;
      viewportHandleActionsReady(actions);
    },
    [viewportHandleActionsReady],
  );
  const toggleLayers = editorWorkspace.toggleLayers;
  const pageNavigatorOpen = false;
  const pageSettingsOpen = false;
  const dismissPageNavigator = noop;
  const dismissPageSettings = noop;
  const openPageSettings = noop;
  const learnViewportNavigation = noop;
  return (
    <div className="flex h-screen flex-col">
      <EditorWorkspace
        onProjectRuntimeReady={onRuntimeReady}
        onProjectPersistenceReady={onPersistenceReady}
        layersOpen={editorWorkspace.layersOpen}
        layersView={editorWorkspace.layersView}
        onShowLayersView={editorWorkspace.showLayersView}
        onToggleLayers={toggleLayers}
        onDismissLayers={editorWorkspace.dismissLayers}
        pageNavigatorOpen={pageNavigatorOpen}
        onDismissPageNavigator={dismissPageNavigator}
        pageSettingsOpen={pageSettingsOpen}
        onOpenPageSettings={openPageSettings}
        onDismissPageSettings={dismissPageSettings}
        activeTool={editorWorkspace.activeTool}
        activeDrawingSlotId={editorWorkspace.activeDrawingSlotId}
        slotFamilies={editorWorkspace.slotFamilies}
        slotBrushIds={editorWorkspace.slotBrushIds}
        slotBrushNames={editorWorkspace.slotBrushNames}
        slotDrawingColors={editorWorkspace.slotDrawingColors}
        activeDockSlotId={editorWorkspace.activeDockSlotId}
        brushLibraryOpen={editorWorkspace.brushLibraryOpen}
        onDismissBrushLibrary={editorWorkspace.dismissBrushLibrary}
        activeSlotBrushId={editorWorkspace.activeSlotBrushId}
        selectLibraryBrush={editorWorkspace.selectLibraryBrush}
        onSelectDrawingSlot={editorWorkspace.selectDrawingSlot}
        activeShape={editorWorkspace.activeShape}
        armedShape={editorWorkspace.armedShape}
        activeFloatingWidget={editorWorkspace.activeFloatingWidget}
        onOpenToolOptions={editorWorkspace.openToolOptions}
        onSelectTool={editorWorkspace.selectTool}
        onSelectShape={editorWorkspace.selectShape}
        drawingStyle={editorWorkspace.drawingStyle}
        toolOptions={editorWorkspace.toolOptions}
        colors={editorWorkspace.colors}
        colorTarget={editorWorkspace.colorTarget}
        onSelectColorPalette={editorWorkspace.selectColorPalette}
        onToggleFavoriteColor={editorWorkspace.toggleFavoriteColor}
        onSelectDrawingPreset={editorWorkspace.selectDrawingPreset}
        onChangeDrawingWidth={editorWorkspace.setDrawingWidth}
        onChangeDrawingOpacity={editorWorkspace.setDrawingOpacity}
        onChangeDrawingSmoothing={editorWorkspace.setDrawingSmoothing}
        onDrawingColorUsed={editorWorkspace.rememberColorUsage}
        onDismissFloatingWidget={editorWorkspace.dismissFloatingWidget}
        onHistoryActionsReady={handleHistoryActionsReady}
        onHistoryAvailabilityChange={handleHistoryAvailabilityChange}
        viewportSnapshot={viewport.snapshot}
        onViewportActionsReady={handleViewportActionsReady}
        onViewportChange={viewport.handleViewportChange}
        onViewportNavigationLearned={learnViewportNavigation}
      />
      <output data-testid="shell-viewport">{viewport.snapshot.zoom}</output>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <NotificationProvider>
        <TooltipLayerProvider>
          <ContextHintProvider>
            <Harness />
          </ContextHintProvider>
        </TooltipLayerProvider>
      </NotificationProvider>
    </ThemeProvider>
  </StrictMode>,
);
