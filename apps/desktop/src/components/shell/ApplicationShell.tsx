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
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { ContextHintProvider } from "./ContextHintProvider";
import { SegmentedTopChrome } from "./SegmentedTopChrome";
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
  // The shell owns the only surface that can ask about unsaved work, so the
  // project lifecycle borrows it rather than growing a dialog of its own.
  const { confirmUnsavedChanges } = useShellDialog();
  const historyActionsRef = useRef<WorkspaceHistoryActions | null>(null);
  const [historyAvailability, setHistoryAvailability] =
    useState<WorkspaceHistoryAvailability>(EMPTY_WORKSPACE_HISTORY);
  const [navigationTeachingLearned, setNavigationTeachingLearned] = useState(false);
  const [pageNavigatorOpen, setPageNavigatorOpen] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  /**
   * Opens the Layers experience, in whichever view it last showed.
   *
   * It takes over the page, so the panels that also talk about the page step
   * aside first. Closing it disturbs nothing, hence the guard.
   */
  const toggleLayers = useCallback(() => {
    editorWorkspace.toggleLayers();
  }, [editorWorkspace]);
  const togglePageNavigator = useCallback(() => setPageNavigatorOpen((open) => !open), []);
  const dismissPageNavigator = useCallback(() => setPageNavigatorOpen(false), []);
  // Page Settings and the Layers experience both claim the page, so opening one
  // puts the other away.
  const openPageSettings = useCallback(() => {
    editorWorkspace.closeLayersStackView();
    setPageSettingsOpen(true);
  }, [editorWorkspace]);
  const togglePageSettings = useCallback(() => {
    setPageSettingsOpen((open) => {
      if (!open) editorWorkspace.closeLayersStackView();
      return !open;
    });
  }, [editorWorkspace]);
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
    // No top row. The workspace is the whole content area, and the top chrome
    // overlays it as a few small islands -- so the canvas is visible behind
    // every part of the top that no control actually occupies.
    <div
      className="folio-editor-chrome-selection flex h-screen flex-col overflow-hidden bg-folio-workspace text-folio-ink"
      data-testid="editor-shell"
    >
      <main
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-folio-workspace"
        data-testid="sketchbook-workspace"
        data-workspace-presentation="focused-canvas"
      >
        {/*
          Before the workspace in the document, not just above it on screen.
          The chrome overlays the canvas rather than sitting in a row of its
          own, so nothing but source order decides whether the keyboard reaches
          the application menu before the tool dock -- and the top-left control
          is where a keyboard user expects to arrive first.
        */}
        <SegmentedTopChrome
          canUndo={historyAvailability.canUndo}
          canRedo={historyAvailability.canRedo}
          onUndo={undo}
          onRedo={redo}
          pageNavigatorOpen={pageNavigatorOpen}
          onTogglePageNavigator={togglePageNavigator}
          pageSettingsOpen={pageSettingsOpen}
          onTogglePageSettings={togglePageSettings}
        />
        <EditorWorkspace
          onConfirmUnsavedChanges={confirmUnsavedChanges}
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
