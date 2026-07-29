import { CanvasSurface, type CanvasDrawingStyle, type ObjectLifecycleActions } from "@folio/editor";
import { memo } from "react";
import type { EditorTool } from "./editor-types";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly drawingStyle: CanvasDrawingStyle;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
}

export const CanvasHost = memo(function CanvasHost({
  activeTool,
  drawingStyle,
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
              : activeTool === "Highlighter"
                ? "highlighter"
                : activeTool === "Eraser"
                  ? "eraser"
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
        drawingStyle={drawingStyle}
        onObjectLifecycleActionsReady={onObjectLifecycleActionsReady}
      />
    </div>
  );
});
