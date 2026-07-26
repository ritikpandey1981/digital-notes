import * as React from "react";
import type { EditorTool } from "./editor-types";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");

  return {
    activeTool,
    selectTool: setActiveTool,
  };
}
