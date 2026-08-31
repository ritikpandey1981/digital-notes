import { EditorWorkspace } from "../editor/EditorWorkspace";
import { useCallback, useRef, useState } from "react";
import { TooltipLayerProvider } from "../editor/ToolTooltip";
import { useEditorWorkspaceState } from "../editor/useEditorWorkspaceState";
import { useEditorViewportState } from "../editor/useEditorViewportState";
import {
  EMPTY_WORKSPACE_HISTORY,
  type WorkspaceHistoryActions,
  type WorkspaceHistoryAvailability,
} from "../editor/workspace-history";
import { ContextHintProvider } from "./ContextHintProvider";
import { SketchbookTopBar } from "./SketchbookTopBar";
import { WorkspaceContextHint } from "./WorkspaceContextHint";
import { WorkspaceViewportControl } from "./WorkspaceViewportControl";

export function ApplicationShell() {
  return (
    <TooltipLayerProvider>
      <ContextHintProvider>
        <ApplicationShellContent />
      </ContextHintProvider>
    </TooltipLayerProvider>
  );
}

function ApplicationShellContent() {
  const editorWorkspace = useEditorWorkspaceState();
  const viewport = useEditorViewportState();
  const historyActionsRef = useRef<WorkspaceHistoryActions | null>(null);
  const [historyAvailability, setHistoryAvailability] =
    useState<WorkspaceHistoryAvailability>(EMPTY_WORKSPACE_HISTORY);
  const [navigationTeachingLearned, setNavigationTeachingLearned] = useState(false);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  // Page Settings and the Layers panel share the top-right slot, so opening one
  // closes the other. The page navigator coexists with both.
  const toggleLayersPanel = useCallback(() => {
    setLayersPanelOpen((open) => {
      if (!open) setPageSettingsOpen(false);
      return !open;
    });
  }, []);
  const dismissLayersPanel = useCallback(() => setLayersPanelOpen(false), []);
  const togglePageNavigator = useCallback(() => setPageNavigatorOpen((open) => !open), []);
  const dismissPageNavigator = useCallback(() => setPageNavigatorOpen(false), []);
  const openPageSettings = useCallback(() => {
    setLayersPanelOpen(false);
    setPageSettingsOpen(true);
  }, []);
  const togglePageSettings = useCallback(() => {
    setPageSettingsOpen((open) => {
      if (!open) setLayersPanelOpen(false);
      return !open;
    });
  }, []);
  const dismissPageSettings = useCallback(() => setPageSettingsOpen(false), []);
  const learnViewportNavigation = useCallback(() => setNavigationTeachingLearned(true), []);
  const handleHistoryActionsReady = useCallback((actions: WorkspaceHistoryActions | null) => {
    historyActionsRef.current = actions;
  }, []);
  const handleHistoryAvailabilityChange = useCallback(
    (availability: WorkspaceHistoryAvailability) => {
      setHistoryAvailability((previous) =>
        previous.canUndo === availability.canUndo && previous.canRedo === availability.canRedo
          ? previous
          : availability,
      );
    },
    [],
  );
  const undo = useCallback(() => historyActionsRef.current?.undo(), []);
  const redo = useCallback(() => historyActionsRef.current?.redo(), []);

  return (
    // The shell always fills the real content area. It never asserts a minimum
    // height of its own, so the workspace can never overflow into an
    // unscrollable strip when the OS frame eats part of the window.
    <div
      className="folio-editor-chrome-selection flex h-screen flex-col overflow-hidden bg-folio-workspace text-folio-ink"
      data-testid="editor-shell"
    >
      <SketchbookTopBar
        canUndo={historyAvailability.canUndo}
        canRedo={historyAvailability.canRedo}
        onUndo={undo}
        onRedo={redo}
        pageNavigatorOpen={pageNavigatorOpen}
        onTogglePageNavigator={togglePageNavigator}
        pageSettingsOpen={pageSettingsOpen}
        onTogglePageSettings={togglePageSettings}
      />
      <main
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-folio-workspace"
        data-testid="sketchbook-workspace"
        data-workspace-presentation="focused-canvas"
      >
        <EditorWorkspace
          layersPanelOpen={layersPanelOpen}
          onToggleLayersPanel={toggleLayersPanel}
          onDismissLayersPanel={dismissLayersPanel}
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
          activeDockSlotId={editorWorkspace.activeDockSlotId}
          brushLibraryOpen={editorWorkspace.brushLibraryOpen}
          activeSlotBrushId={editorWorkspace.activeSlotBrushId}
          selectLibraryBrush={editorWorkspace.selectLibraryBrush}
          onSelectDrawingSlot={editorWorkspace.selectDrawingSlot}
          activeShape={editorWorkspace.activeShape}
          armedShape={editorWorkspace.armedShape}
          activeFloatingWidget={editorWorkspace.activeFloatingWidget}
          activeToolHasOptions={editorWorkspace.activeToolHasOptions}
          onToggleToolOptions={editorWorkspace.toggleToolOptions}
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
          onViewportActionsReady={viewport.handleActionsReady}
          onViewportChange={viewport.handleViewportChange}
          onViewportNavigationLearned={learnViewportNavigation}
        />
        <WorkspaceContextHint
          activeTool={editorWorkspace.activeTool}
          armedShape={editorWorkspace.armedShape}
          navigationTeachingAvailable={!navigationTeachingLearned}
        />
        <WorkspaceViewportControl
          viewport={viewport.snapshot}
          onZoomOut={viewport.zoomOut}
          onZoomIn={viewport.zoomIn}
          onSetZoom={viewport.setZoom}
          onResetZoom={viewport.resetZoom}
          onFitPage={viewport.fitPage}
          onFitWidth={viewport.fitWidth}
        />
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-0"
          data-future-utility-rail-boundary="reserved"
          aria-hidden="true"
        />
      </main>
    </div>
  );
}
