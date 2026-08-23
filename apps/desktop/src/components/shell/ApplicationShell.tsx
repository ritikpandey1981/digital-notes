import { EditorWorkspace } from "../editor/EditorWorkspace";
import { useCallback, useState } from "react";
import { TooltipLayerProvider } from "../editor/ToolTooltip";
import { useEditorWorkspaceState } from "../editor/useEditorWorkspaceState";
import { useEditorViewportState } from "../editor/useEditorViewportState";
import { AppMenuBar } from "./AppMenuBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { ContextHintProvider } from "./ContextHintProvider";
import { useShellUiState } from "./useShellUiState";

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
  const shellUi = useShellUiState();
  const editorWorkspace = useEditorWorkspaceState();
  const viewport = useEditorViewportState();
  const [navigationTeachingLearned, setNavigationTeachingLearned] = useState(false);
  const learnViewportNavigation = useCallback(() => setNavigationTeachingLearned(true), []);

  return (
    <div className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-folio-workspace text-folio-ink">
      <AppMenuBar
        sidebarExpanded={shellUi.sidebarExpanded}
        onToggleSidebar={shellUi.toggleSidebar}
        onSelectTool={editorWorkspace.selectTool}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          expanded={shellUi.sidebarExpanded}
          activeSection={shellUi.activeSection}
          onToggle={shellUi.toggleSidebar}
          onSelectSection={shellUi.selectSection}
        />
        <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-folio-workspace">
          <EditorWorkspace
            workspaceName="Studio Notes"
            locationLabel={shellUi.activeSection}
            activeTool={editorWorkspace.activeTool}
            activeShape={editorWorkspace.activeShape}
            activeFloatingWidget={editorWorkspace.activeFloatingWidget}
            onSelectTool={editorWorkspace.selectTool}
            onSelectShape={editorWorkspace.selectShape}
            drawingStyle={editorWorkspace.drawingStyle}
            toolOptions={editorWorkspace.toolOptions}
            colors={editorWorkspace.colors}
            onChangeDrawingColor={editorWorkspace.setDrawingColor}
            onChangeDrawingWidth={editorWorkspace.setDrawingWidth}
            onChangeDrawingOpacity={editorWorkspace.setDrawingOpacity}
            onChangeShapeStyle={editorWorkspace.updateShapeStyle}
            onDrawingColorUsed={editorWorkspace.rememberColorUsage}
            onDismissFloatingWidget={editorWorkspace.dismissFloatingWidget}
            viewportSnapshot={viewport.snapshot}
            onViewportActionsReady={viewport.handleActionsReady}
            onViewportChange={viewport.handleViewportChange}
            onViewportNavigationLearned={learnViewportNavigation}
          />
        </main>
      </div>
      <StatusBar
        activeTool={editorWorkspace.activeTool}
        activeShape={editorWorkspace.activeShape}
        viewport={viewport.snapshot}
        onZoomOut={viewport.zoomOut}
        onZoomIn={viewport.zoomIn}
        onSetZoom={viewport.setZoom}
        onResetZoom={viewport.resetZoom}
        onFitPage={viewport.fitPage}
        onFitWidth={viewport.fitWidth}
        navigationTeachingAvailable={!navigationTeachingLearned}
      />
    </div>
  );
}
