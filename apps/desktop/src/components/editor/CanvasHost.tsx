import { CanvasSurface, type ObjectLifecycleActions } from "@folio/editor";
import { memo } from "react";
import type { EditorTool } from "./editor-types";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
}

export const CanvasHost = memo(function CanvasHost({
  activeTool,
  onObjectLifecycleActionsReady,
}: CanvasHostProps) {
  const interactionMode =
    activeTool === "Select"
      ? "select"
      : activeTool === "Move"
        ? "move"
        : activeTool === "Rotate"
          ? "rotate"
          : activeTool === "Scale"
            ? "scale"
            : activeTool === "Pen"
              ? "ink"
              : "disabled";
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="canvas-host"
      data-canvas-state="ready"
      data-document-state="ready"
      data-ink-state="ready"
      data-selection-capability="ready"
      data-manipulation-capability="ready"
    >
      <CanvasSurface
        className="relative size-full"
        interactionMode={interactionMode}
        onObjectLifecycleActionsReady={onObjectLifecycleActionsReady}
      />
    </div>
  );
});
