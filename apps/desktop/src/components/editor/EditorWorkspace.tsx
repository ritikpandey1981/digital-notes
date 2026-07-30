import type {
  CanvasDrawingStyle,
  EditorColorSystemSnapshot,
  ObjectLifecycleActions,
} from "@folio/editor";
import { useCallback, useRef, useState } from "react";
import type { EditorTool } from "./editor-types";
import { CanvasHost } from "./CanvasHost";
import { ToolDock } from "./ToolDock";
import { ToolOptionsWidget } from "./ToolOptionsWidget";
import type { ToolOptionsDescriptor } from "./tool-options-registry";
import { WorkspaceChrome } from "./WorkspaceChrome";

interface EditorWorkspaceProps {
  workspaceName: string;
  locationLabel: string;
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  drawingStyle: CanvasDrawingStyle;
  toolOptions: ToolOptionsDescriptor | null;
  colors: EditorColorSystemSnapshot;
  onChangeDrawingColor: (color: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
  onDrawingColorUsed: (color: string) => void;
  onDismissToolOptions: () => void;
}

export function EditorWorkspace({
  workspaceName,
  locationLabel,
  activeTool,
  onSelectTool,
  drawingStyle,
  toolOptions,
  colors,
  onChangeDrawingColor,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
  onDrawingColorUsed,
  onDismissToolOptions,
}: EditorWorkspaceProps) {
  const objectLifecycleActionsRef = useRef<ObjectLifecycleActions | null>(null);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const handleObjectLifecycleActionsReady = useCallback(
    (actions: ObjectLifecycleActions | null) => {
      objectLifecycleActionsRef.current = actions;
    },
    [],
  );
  const deleteSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.deleteSelection();
  }, []);
  const duplicateSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.duplicateSelection();
  }, []);
  const dismissTransientToolUi = useCallback(() => {
    setMoreToolsOpen(false);
    onDismissToolOptions();
  }, [onDismissToolOptions]);

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Notebook workspace"
    >
      <CanvasHost
        activeTool={activeTool}
        drawingStyle={drawingStyle}
        onObjectLifecycleActionsReady={handleObjectLifecycleActionsReady}
        onDrawingColorUsed={onDrawingColorUsed}
      />
      <WorkspaceChrome workspaceName={workspaceName} locationLabel={locationLabel} />
      <ToolDock
        activeTool={activeTool}
        onSelectTool={onSelectTool}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        moreToolsOpen={moreToolsOpen}
        onMoreToolsOpenChange={setMoreToolsOpen}
      />
      <ToolOptionsWidget
        descriptor={toolOptions}
        colors={colors}
        onChangeColor={onChangeDrawingColor}
        onChangeWidth={onChangeDrawingWidth}
        onChangeOpacity={onChangeDrawingOpacity}
        onDismiss={dismissTransientToolUi}
      />
    </section>
  );
}
