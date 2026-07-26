import type { EditorTool } from "./editor-types";
import { CanvasHost } from "./CanvasHost";
import { FloatingToolbar } from "./FloatingToolbar";
import { WorkspaceChrome } from "./WorkspaceChrome";

interface EditorWorkspaceProps {
  workspaceName: string;
  locationLabel: string;
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
}

export function EditorWorkspace({
  workspaceName,
  locationLabel,
  activeTool,
  onSelectTool,
}: EditorWorkspaceProps) {
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Notebook workspace"
    >
      <CanvasHost />
      <WorkspaceChrome workspaceName={workspaceName} locationLabel={locationLabel} />
      <FloatingToolbar activeTool={activeTool} onSelectTool={onSelectTool} />
    </section>
  );
}
