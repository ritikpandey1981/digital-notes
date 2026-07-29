import type {
  CanvasDrawingStyle,
  EditorColorSystemSnapshot,
  ObjectLifecycleActions,
  PenPreset,
} from "@folio/editor";
import { useCallback, useRef } from "react";
import type { EditorTool } from "./editor-types";
import { CanvasHost } from "./CanvasHost";
import { FloatingToolbar } from "./FloatingToolbar";
import { WorkspaceChrome } from "./WorkspaceChrome";

interface EditorWorkspaceProps {
  workspaceName: string;
  locationLabel: string;
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  drawingStyle: CanvasDrawingStyle;
  activePreset: PenPreset;
  availablePresets: readonly PenPreset[];
  colors: EditorColorSystemSnapshot;
  onSelectPreset: (presetId: string) => void;
  onChangeDrawingColor: (color: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
}

export function EditorWorkspace({
  workspaceName,
  locationLabel,
  activeTool,
  onSelectTool,
  drawingStyle,
  activePreset,
  availablePresets,
  colors,
  onSelectPreset,
  onChangeDrawingColor,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
}: EditorWorkspaceProps) {
  const objectLifecycleActionsRef = useRef<ObjectLifecycleActions | null>(null);
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

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Notebook workspace"
    >
      <CanvasHost
        activeTool={activeTool}
        drawingStyle={drawingStyle}
        onObjectLifecycleActionsReady={handleObjectLifecycleActionsReady}
      />
      <WorkspaceChrome workspaceName={workspaceName} locationLabel={locationLabel} />
      <FloatingToolbar
        activeTool={activeTool}
        onSelectTool={onSelectTool}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        activePreset={activePreset}
        availablePresets={availablePresets}
        colors={colors}
        onSelectPreset={onSelectPreset}
        onChangeDrawingColor={onChangeDrawingColor}
        onChangeDrawingWidth={onChangeDrawingWidth}
        onChangeDrawingOpacity={onChangeDrawingOpacity}
      />
    </section>
  );
}
