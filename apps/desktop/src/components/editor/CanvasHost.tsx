import {
  CanvasSurface,
  type ArtworkColorSampleResult,
  type CanvasDrawingStyle,
  type CanvasSurfaceProps,
  type ObjectLifecycleActions,
  type ShapeEditingActions,
  type ShapeEditingSnapshot,
  type LayerActions,
  type LayersSnapshot,
  type EditorViewportSnapshot,
  type ViewportActions,
} from "@folio/editor";
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  brushCursorDiameter,
  cursorPresentationForTool,
  nativeCursorForBrushRegion,
  pointIsWithinBrushPage,
  usesImperativeBrushCursor,
} from "./editor-cursor-policy";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { WorkspaceHistoryActions, WorkspaceHistoryAvailability } from "./workspace-history";

interface CanvasHostProps {
  readonly activeTool: EditorTool;
  readonly armedShape: ShapeToolKind | null;
  readonly artworkSamplingActive: boolean;
  readonly artworkSamplingOwnerScope: string | undefined;
  readonly drawingStyle: CanvasDrawingStyle;
  readonly onArtworkSample: (result: ArtworkColorSampleResult) => void;
  readonly viewportSnapshot: EditorViewportSnapshot;
  readonly onObjectLifecycleActionsReady: (actions: ObjectLifecycleActions | null) => void;
  readonly onShapeEditingActionsReady: (actions: ShapeEditingActions | null) => void;
  readonly onShapeEditingChange: (snapshot: ShapeEditingSnapshot | null) => void;
  readonly onLayerActionsReady: (actions: LayerActions | null) => void;
  readonly onLayersChange: (snapshot: LayersSnapshot) => void;
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
  artworkSamplingActive,
  artworkSamplingOwnerScope,
  drawingStyle,
  onArtworkSample,
  viewportSnapshot,
  onObjectLifecycleActionsReady,
  onShapeEditingActionsReady,
  onShapeEditingChange,
  onLayerActionsReady,
  onLayersChange,
  onDrawingColorUsed,
  onHistoryActionsReady,
  onHistoryAvailabilityChange,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
}: CanvasHostProps) {
  const renderCountRef = useRef(0);
  const diagnosticsCallbackGeneration = renderCountRef.current + 1;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const onHistoryAvailabilityChangeRef = useRef(onHistoryAvailabilityChange);
  const historyControllerRef = useRef<
    Parameters<NonNullable<CanvasSurfaceProps["onHistoryControllerReady"]>>[0] | null
  >(null);
  onHistoryAvailabilityChangeRef.current = onHistoryAvailabilityChange;
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (hostRef.current !== null) {
      hostRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });
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
            : activeTool === "Pencil" || activeTool === "Pen" || activeTool === "Marker"
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
    if (artworkSamplingActive) {
      inkCanvas.dataset.desktopToolCursor = "eyedropper";
      inkCanvas.dataset.desktopCursorCss = "default";
      inkCanvas.dataset.desktopCursorPhase = "steady";
      inkCanvas.style.cursor = "default";
      return;
    }
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
  }, [activeTool, armedShape, artworkSamplingActive]);
  useEffect(() => {
    const outerHost = hostRef.current;
    const brushCursor = brushCursorRef.current;
    const inkCanvas = outerHost?.querySelector<HTMLCanvasElement>('canvas[data-folio-layer="ink"]');
    if (
      outerHost === null ||
      brushCursor === null ||
      inkCanvas === undefined ||
      inkCanvas === null
    ) {
      return;
    }
    const nominalSize = drawingStyle.width ?? 1;
    const cursorDiameter = brushCursorDiameter(nominalSize, viewportSnapshot.zoom);
    brushCursor.style.width = `${cursorDiameter}px`;
    brushCursor.style.height = `${cursorDiameter}px`;
    brushCursor.dataset.nominalSize = String(nominalSize);
    brushCursor.dataset.zoom = String(viewportSnapshot.zoom);
    const positionCursor = (x: number, y: number): void => {
      brushCursor.dataset.x = String(x);
      brushCursor.dataset.y = String(y);
      brushCursor.style.transform = `translate3d(${x - cursorDiameter / 2}px, ${y - cursorDiameter / 2}px, 0)`;
    };
    const previousX = Number(brushCursor.dataset.x);
    const previousY = Number(brushCursor.dataset.y);
    if (Number.isFinite(previousX) && Number.isFinite(previousY)) {
      positionCursor(previousX, previousY);
    }
    const brushActive = !artworkSamplingActive && usesImperativeBrushCursor(activeTool);
    let cursorFrame: number | null = null;
    let pendingPosition: Readonly<{ clientX: number; clientY: number }> | null = null;
    const setVisible = (visible: boolean): void => {
      brushCursor.dataset.visible = String(visible);
      brushCursor.style.opacity = visible ? "1" : "0";
    };
    const setNativeCursor = (brushCursorEligible: boolean): void => {
      if ((inkCanvas.dataset.viewportPanState ?? "idle") !== "idle") return;
      const cursor = nativeCursorForBrushRegion(brushCursorEligible);
      inkCanvas.style.cursor = cursor;
      inkCanvas.dataset.desktopCursorCss = cursor;
      inkCanvas.dataset.brushNativeCursor = cursor;
    };
    const renderPendingPosition = (): void => {
      cursorFrame = null;
      const position = pendingPosition;
      pendingPosition = null;
      if (position === null) return;
      const viewportHost = inkCanvas.closest<HTMLElement>("[data-viewport-page-x]");
      if (
        !brushActive ||
        viewportHost === null ||
        (viewportHost.dataset.viewportPanState ?? "idle") !== "idle"
      ) {
        setVisible(false);
        return;
      }
      const bounds = outerHost.getBoundingClientRect();
      const x = position.clientX - bounds.left;
      const y = position.clientY - bounds.top;
      const pageX = Number(viewportHost.dataset.viewportPageX);
      const pageY = Number(viewportHost.dataset.viewportPageY);
      const pageWidth = Number(viewportHost.dataset.viewportPageWidth);
      const pageHeight = Number(viewportHost.dataset.viewportPageHeight);
      const overPage = pointIsWithinBrushPage(
        { x, y },
        { x: pageX, y: pageY, width: pageWidth, height: pageHeight },
      );
      if (!overPage) {
        setVisible(false);
        setNativeCursor(false);
        return;
      }
      positionCursor(x, y);
      setVisible(true);
      setNativeCursor(true);
    };
    const handlePointerMove = (event: PointerEvent): void => {
      if (!brushActive || event.pointerType === "touch") {
        pendingPosition = null;
        setVisible(false);
        setNativeCursor(false);
        return;
      }
      pendingPosition = Object.freeze({ clientX: event.clientX, clientY: event.clientY });
      if (cursorFrame === null) cursorFrame = requestAnimationFrame(renderPendingPosition);
    };
    const hideCursor = (restoreNativeCursor = true): void => {
      pendingPosition = null;
      setVisible(false);
      if (restoreNativeCursor) setNativeCursor(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Space") hideCursor(false);
    };
    const panStateObserver = new MutationObserver(() => {
      if ((inkCanvas.dataset.viewportPanState ?? "idle") !== "idle") hideCursor(false);
    });
    panStateObserver.observe(inkCanvas, {
      attributes: true,
      attributeFilter: ["data-viewport-pan-state"],
    });
    if (!brushActive) setVisible(false);
    inkCanvas.addEventListener("pointermove", handlePointerMove);
    const handlePointerExit = (): void => hideCursor();
    inkCanvas.addEventListener("pointerleave", handlePointerExit);
    inkCanvas.addEventListener("pointercancel", handlePointerExit);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      inkCanvas.removeEventListener("pointermove", handlePointerMove);
      inkCanvas.removeEventListener("pointerleave", handlePointerExit);
      inkCanvas.removeEventListener("pointercancel", handlePointerExit);
      window.removeEventListener("keydown", handleKeyDown, true);
      panStateObserver.disconnect();
      if (cursorFrame !== null) cancelAnimationFrame(cursorFrame);
      if (brushActive && inkCanvas.style.cursor === "none") inkCanvas.style.cursor = "default";
    };
  }, [activeTool, artworkSamplingActive, drawingStyle.width, viewportSnapshot.zoom]);
  useEffect(() => {
    if (!artworkSamplingActive) return;
    const outerHost = hostRef.current;
    const brushCursor = brushCursorRef.current;
    const inkCanvas = outerHost?.querySelector<HTMLCanvasElement>('canvas[data-folio-layer="ink"]');
    if (
      outerHost === null ||
      brushCursor === null ||
      inkCanvas === undefined ||
      inkCanvas === null
    ) {
      return;
    }
    brushCursor.dataset.visible = "false";
    brushCursor.style.opacity = "0";
    const setCursor = (cursor: "crosshair" | "default"): void => {
      inkCanvas.style.cursor = cursor;
      inkCanvas.dataset.eyedropperCursor = cursor;
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const surface = inkCanvas.closest<HTMLElement>("[data-viewport-page-x]");
      if (surface === null) {
        setCursor("default");
        return;
      }
      const bounds = outerHost.getBoundingClientRect();
      const overPage = pointIsWithinBrushPage(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        {
          x: Number(surface.dataset.viewportPageX),
          y: Number(surface.dataset.viewportPageY),
          width: Number(surface.dataset.viewportPageWidth),
          height: Number(surface.dataset.viewportPageHeight),
        },
      );
      setCursor(overPage ? "crosshair" : "default");
    };
    const handlePointerLeave = (): void => setCursor("default");
    outerHost.addEventListener("pointermove", handlePointerMove, true);
    outerHost.addEventListener("pointerleave", handlePointerLeave, true);
    return () => {
      outerHost.removeEventListener("pointermove", handlePointerMove, true);
      outerHost.removeEventListener("pointerleave", handlePointerLeave, true);
      delete inkCanvas.dataset.eyedropperCursor;
    };
  }, [artworkSamplingActive]);
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
      data-floating-widget-owner={artworkSamplingActive ? artworkSamplingOwnerScope : undefined}
      data-eyedropper-input={artworkSamplingActive ? "owned" : "inactive"}
    >
      <CanvasSurface
        className="relative size-full"
        interactionMode={interactionMode}
        artworkSamplingActive={artworkSamplingActive}
        drawingStyle={drawingStyle}
        onArtworkSample={onArtworkSample}
        onHistoryControllerReady={handleHistoryControllerReady}
        onDiagnostics={() => {
          if (hostRef.current !== null) {
            hostRef.current.dataset.latestDiagnosticsCallbackGeneration = String(
              diagnosticsCallbackGeneration,
            );
          }
        }}
        onHistoryChange={handleHistoryChange}
        onArtworkColorUsed={onDrawingColorUsed}
        onObjectLifecycleActionsReady={onObjectLifecycleActionsReady}
        onShapeEditingActionsReady={onShapeEditingActionsReady}
        onShapeEditingChange={onShapeEditingChange}
        onLayerActionsReady={onLayerActionsReady}
        onLayersChange={onLayersChange}
        onViewportActionsReady={onViewportActionsReady}
        onViewportChange={onViewportChange}
        onViewportNavigationLearned={onViewportNavigationLearned}
      />
      <div
        ref={brushCursorRef}
        className="pointer-events-none absolute left-0 top-0 z-[12] rounded-full border border-white/90 opacity-0 shadow-[0_0_0_1px_rgba(17,24,39,0.88)] transition-[width,height] duration-75"
        data-testid="brush-cursor"
        data-visible="false"
        aria-hidden="true"
      />
    </div>
  );
});
