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
    <div className="folio-editor-chrome-selection flex h-screen min-h-[640px] flex-col overflow-hidden bg-folio-workspace text-folio-ink">
      <SketchbookTopBar
        canUndo={historyAvailability.canUndo}
        canRedo={historyAvailability.canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <main
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-folio-workspace"
        data-testid="sketchbook-workspace"
        data-workspace-presentation="focused-canvas"
      >
        <EditorWorkspace
          activeTool={editorWorkspace.activeTool}
          activeShape={editorWorkspace.activeShape}
          armedShape={editorWorkspace.armedShape}
          activeFloatingWidget={editorWorkspace.activeFloatingWidget}
          onSelectTool={editorWorkspace.selectTool}
          onSelectShape={editorWorkspace.selectShape}
          drawingStyle={editorWorkspace.drawingStyle}
          toolOptions={editorWorkspace.toolOptions}
          colors={editorWorkspace.colors}
          colorTarget={editorWorkspace.colorTarget}
          onSelectColorPalette={editorWorkspace.selectColorPalette}
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
