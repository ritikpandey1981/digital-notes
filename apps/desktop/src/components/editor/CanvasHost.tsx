import {
  CanvasSurface,
  type CanvasDrawingStyle,
  type CanvasSurfaceProps,
  type ObjectLifecycleActions,
} from "@folio/editor";
import { memo, useCallback, useEffect, useRef } from "react";
import { cursorPresentationForTool } from "./editor-cursor-policy";
import type { EditorTool } from "./editor-types";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly drawingStyle: CanvasDrawingStyle;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
  readonly onDrawingColorUsed: (color: string) => void;
}

export const CanvasHost = memo(function CanvasHost({
  activeTool,
  drawingStyle,
  onObjectLifecycleActionsReady,
  onDrawingColorUsed,
}: CanvasHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const drawingColorRef = useRef(drawingStyle.color);
  const onDrawingColorUsedRef = useRef(onDrawingColorUsed);
  drawingColorRef.current = drawingStyle.color;
  onDrawingColorUsedRef.current = onDrawingColorUsed;
  const handleHistoryChange: NonNullable<CanvasSurfaceProps["onHistoryChange"]> = useCallback(
    (notification) => {
      if (
        notification.outcome === "succeeded" &&
        notification.operation === "execute" &&
        notification.command.id.startsWith("stroke-") &&
        drawingColorRef.current !== undefined
      ) {
        onDrawingColorUsedRef.current(drawingColorRef.current);
      }
    },
    [],
  );
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
  useEffect(() => {
    const inkCanvas = hostRef.current?.querySelector<HTMLCanvasElement>(
      'canvas[data-folio-layer="ink"]',
    );
    if (inkCanvas === undefined || inkCanvas === null) return;
    const presentation = cursorPresentationForTool(activeTool);
    inkCanvas.dataset.desktopToolCursor = presentation.id;
    inkCanvas.style.cursor = presentation.css ?? inkCanvas.dataset.editorCursor ?? "default";
  }, [activeTool]);
  return (
    <div
      ref={hostRef}
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
        onHistoryChange={handleHistoryChange}
        onObjectLifecycleActionsReady={onObjectLifecycleActionsReady}
      />
    </div>
  );
});
