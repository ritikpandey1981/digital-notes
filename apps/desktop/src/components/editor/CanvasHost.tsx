import {
  CanvasSurface,
  type CanvasDrawingStyle,
  type CanvasSurfaceProps,
  type ObjectLifecycleActions,
  type ShapeEditingActions,
  type ShapeEditingSnapshot,
  type EditorViewportSnapshot,
  type ViewportActions,
} from "@folio/editor";
import { memo, useCallback, useEffect, useRef } from "react";
import { cursorPresentationForTool } from "./editor-cursor-policy";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { WorkspaceHistoryActions, WorkspaceHistoryAvailability } from "./workspace-history";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly armedShape: ShapeToolKind | null;
  readonly drawingStyle: CanvasDrawingStyle;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
  readonly onShapeEditingActionsReady: (actions: ShapeEditingActions | null) => void;
  readonly onShapeEditingChange: (snapshot: ShapeEditingSnapshot | null) => void;
  readonly onDrawingColorUsed: (color: string) => void;
  readonly onHistoryActionsReady: (actions: WorkspaceHistoryActions | null) => void;
  readonly onHistoryAvailabilityChange: (availability: WorkspaceHistoryAvailability) => void;
  readonly onViewportActionsReady: (actions: ViewportActions | null) => void;
  readonly onViewportChange: (snapshot: EditorViewportSnapshot) => void;
  readonly onViewportNavigationLearned: () => void;
}

export const CanvasHost = memo(function CanvasHost({
  activeTool,
  armedShape,
  drawingStyle,
  onObjectLifecycleActionsReady,
  onShapeEditingActionsReady,
  onShapeEditingChange,
  onDrawingColorUsed,
  onHistoryActionsReady,
  onHistoryAvailabilityChange,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
}: CanvasHostProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const drawingColorRef = useRef(drawingStyle.color);
  const onDrawingColorUsedRef = useRef(onDrawingColorUsed);
  const onHistoryAvailabilityChangeRef = useRef(onHistoryAvailabilityChange);
  const historyControllerRef = useRef<
    Parameters<NonNullable<CanvasSurfaceProps["onHistoryControllerReady"]>>[0] | null
  >(null);
  drawingColorRef.current = drawingStyle.color;
  onDrawingColorUsedRef.current = onDrawingColorUsed;
  onHistoryAvailabilityChangeRef.current = onHistoryAvailabilityChange;
  const undo = useCallback((): void => {
    historyControllerRef.current?.undo();
  }, []);
  const redo = useCallback((): void => {
    historyControllerRef.current?.redo();
  }, []);
  useEffect(() => {
    onHistoryActionsReady(Object.freeze({ undo, redo }));
    return () => onHistoryActionsReady(null);
  }, [onHistoryActionsReady, redo, undo]);
  const handleHistoryControllerReady: NonNullable<CanvasSurfaceProps["onHistoryControllerReady"]> =
    useCallback((controller) => {
      historyControllerRef.current = controller;
      const state = controller.getHistoryState();
      onHistoryAvailabilityChangeRef.current({ canUndo: state.canUndo, canRedo: state.canRedo });
    }, []);
  const handleHistoryChange: NonNullable<CanvasSurfaceProps["onHistoryChange"]> = useCallback(
    (notification) => {
      onHistoryAvailabilityChangeRef.current({
        canUndo: notification.state.canUndo,
        canRedo: notification.state.canRedo,
      });
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
                  : activeTool === "Shapes" && armedShape !== null
                    ? armedShape
                    : "disabled";
  useEffect(() => {
    const inkCanvas = hostRef.current?.querySelector<HTMLCanvasElement>(
      'canvas[data-folio-layer="ink"]',
    );
    if (inkCanvas === undefined || inkCanvas === null) return;
    const presentation = cursorPresentationForTool(activeTool);
    const cursorCss = presentation.css ?? inkCanvas.dataset.editorCursor ?? "default";
    inkCanvas.dataset.desktopToolCursor = presentation.id;
    inkCanvas.dataset.desktopCursorCss = cursorCss;
    inkCanvas.dataset.desktopCursorPhase =
      presentation.adaptiveCss === undefined ? "steady" : "fallback";
    if ((inkCanvas.dataset.viewportPanState ?? "idle") === "idle") {
      inkCanvas.style.cursor = cursorCss;
    } else {
      inkCanvas.dataset.viewportRestoreCursor = cursorCss;
    }
    const activateAdaptiveCursor = (): void => {
      const adaptiveCss = presentation.adaptiveCss;
      if (adaptiveCss === undefined || inkCanvas.dataset.desktopCursorPhase === "adaptive") return;
      inkCanvas.dataset.desktopCursorPhase = "adaptive";
      inkCanvas.dataset.desktopCursorCss = adaptiveCss;
      if ((inkCanvas.dataset.viewportPanState ?? "idle") === "idle") {
        inkCanvas.style.cursor = adaptiveCss;
      } else {
        inkCanvas.dataset.viewportRestoreCursor = adaptiveCss;
      }
    };
    inkCanvas.addEventListener("pointermove", activateAdaptiveCursor, { once: true });
    return () => inkCanvas.removeEventListener("pointermove", activateAdaptiveCursor);
  }, [activeTool, armedShape]);
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
        onHistoryControllerReady={handleHistoryControllerReady}
        onHistoryChange={handleHistoryChange}
        onObjectLifecycleActionsReady={onObjectLifecycleActionsReady}
        onShapeEditingActionsReady={onShapeEditingActionsReady}
        onShapeEditingChange={onShapeEditingChange}
        onViewportActionsReady={onViewportActionsReady}
        onViewportChange={onViewportChange}
        onViewportNavigationLearned={onViewportNavigationLearned}
      />
    </div>
  );
});
