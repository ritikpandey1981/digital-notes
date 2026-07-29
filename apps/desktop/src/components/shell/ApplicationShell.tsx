import { EditorWorkspace } from "../editor/EditorWorkspace";
import { useEditorWorkspaceState } from "../editor/useEditorWorkspaceState";
import { AppMenuBar } from "./AppMenuBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { useShellUiState } from "./useShellUiState";

export function ApplicationShell() {
  const shellUi = useShellUiState();
  const editorWorkspace = useEditorWorkspaceState();

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
            onSelectTool={editorWorkspace.selectTool}
            drawingStyle={editorWorkspace.drawingStyle}
            activePreset={editorWorkspace.activePreset}
            availablePresets={editorWorkspace.availablePresets}
            colors={editorWorkspace.colors}
            onSelectPreset={editorWorkspace.selectPreset}
            onChangeDrawingColor={editorWorkspace.setDrawingColor}
            onChangeDrawingWidth={editorWorkspace.setDrawingWidth}
            onChangeDrawingOpacity={editorWorkspace.setDrawingOpacity}
          />
        </main>
      </div>
      <StatusBar activeTool={editorWorkspace.activeTool} />
    </div>
  );
}
