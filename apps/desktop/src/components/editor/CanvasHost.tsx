import {
  CanvasSurface,
  type CanvasDrawingStyle,
  type CanvasSurfaceProps,
  type ObjectLifecycleActions,
  type ShapeEditingActions,
  type ShapeEditingSnapshot,
} from "@folio/editor";
import { memo, useCallback, useEffect, useRef } from "react";
import { cursorPresentationForTool } from "./editor-cursor-policy";
import type { EditorTool, ShapeToolKind } from "./editor-types";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly activeShape: ShapeToolKind;
  readonly drawingStyle: CanvasDrawingStyle;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
  readonly onShapeEditingActionsReady: (actions: ShapeEditingActions | null) => void;
  readonly onShapeEditingChange: (snapshot: ShapeEditingSnapshot | null) => void;
  readonly onDrawingColorUsed: (color: string) => void;
  readonly onViewportZoomChange: (zoom: number) => void;
}

export const CanvasHost = memo(function CanvasHost({
  activeTool,
  activeShape,
  drawingStyle,
  onObjectLifecycleActionsReady,
  onShapeEditingActionsReady,
  onShapeEditingChange,
  onDrawingColorUsed,
  onViewportZoomChange,
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
        (notification.command.id.startsWith("stroke-") ||
          notification.command.id.startsWith("create-line-") ||
          notification.command.id.startsWith("create-rectangle-") ||
          notification.command.id.startsWith("create-ellipse-")) &&
        drawingColorRef.current !== undefined
      ) {
        onDrawingColorUsedRef.current(drawingColorRef.current);
      }
    },
    [],
  );
  const handleDiagnostics: NonNullable<CanvasSurfaceProps["onDiagnostics"]> = useCallback(
    (snapshot) => onViewportZoomChange(snapshot.viewport?.camera.zoom ?? 1),
    [onViewportZoomChange],
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
                  : activeTool === "Shapes"
                    ? activeShape
                    : "disabled";
  useEffect(() => {
    const inkCanvas = hostRef.current?.querySelector<HTMLCanvasElement>(
      'canvas[data-folio-layer="ink"]',
    );
    if (inkCanvas === undefined || inkCanvas === null) return;
    const presentation = cursorPresentationForTool(activeTool);
    inkCanvas.dataset.desktopToolCursor = presentation.id;
    inkCanvas.style.cursor = presentation.css ?? inkCanvas.dataset.editorCursor ?? "default";
  }, [activeShape, activeTool]);
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
        onShapeEditingActionsReady={onShapeEditingActionsReady}
        onShapeEditingChange={onShapeEditingChange}
        onDiagnostics={handleDiagnostics}
      />
    </div>
  );
});
