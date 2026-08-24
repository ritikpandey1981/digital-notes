import type {
  CanvasDrawingStyle,
  EditorColorSystemSnapshot,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
  ShapeStylePatch,
  EditorViewportSnapshot,
  ViewportActions,
} from "@folio/editor";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { FloatingToolWidgetId } from "./floating-tool-widget-registry";
import { CanvasHost } from "./CanvasHost";
import { ShapesWidget } from "./ShapesWidget";
import { ShapeEditingToolbar } from "./ShapeEditingToolbar";
import { ToolDock } from "./ToolDock";
import { ToolOptionsWidget } from "./ToolOptionsWidget";
import type { ToolOptionsDescriptor } from "./tool-options-registry";
import type { WorkspaceHistoryActions, WorkspaceHistoryAvailability } from "./workspace-history";

interface EditorWorkspaceProps {
  activeTool: EditorTool;
  activeShape: ShapeToolKind;
  armedShape: ShapeToolKind | null;
  activeFloatingWidget: FloatingToolWidgetId | null;
  onSelectTool: (tool: EditorTool) => void;
  onSelectShape: (shape: ShapeToolKind) => void;
  drawingStyle: CanvasDrawingStyle;
  toolOptions: ToolOptionsDescriptor | null;
  colors: EditorColorSystemSnapshot;
  onChangeDrawingColor: (color: string) => void;
  onSelectDrawingPreset: (presetId: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
  onChangeDrawingSmoothing: (amount: number) => void;
  onChangeShapeStyle: (patch: ShapeStylePatch) => void;
  onDrawingColorUsed: (color: string) => void;
  onDismissFloatingWidget: () => void;
  onHistoryActionsReady: (actions: WorkspaceHistoryActions | null) => void;
  onHistoryAvailabilityChange: (availability: WorkspaceHistoryAvailability) => void;
  viewportSnapshot: EditorViewportSnapshot;
  onViewportActionsReady: (actions: ViewportActions | null) => void;
  onViewportChange: (snapshot: EditorViewportSnapshot) => void;
  onViewportNavigationLearned: () => void;
}

export function EditorWorkspace({
  activeTool,
  activeShape,
  armedShape,
  activeFloatingWidget,
  onSelectTool,
  onSelectShape,
  drawingStyle,
  toolOptions,
  colors,
  onChangeDrawingColor,
  onSelectDrawingPreset,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
  onChangeDrawingSmoothing,
  onChangeShapeStyle,
  onDrawingColorUsed,
  onDismissFloatingWidget,
  onHistoryActionsReady,
  onHistoryAvailabilityChange,
  viewportSnapshot,
  onViewportActionsReady,
  onViewportChange,
  onViewportNavigationLearned,
}: EditorWorkspaceProps) {
  const workspaceRef = useRef<HTMLElement | null>(null);
  const renderCountRef = useRef(0);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (workspaceRef.current !== null) {
      workspaceRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });
  const objectLifecycleActionsRef = useRef<ObjectLifecycleActions | null>(null);
  const shapeEditingActionsRef = useRef<ShapeEditingActions | null>(null);
  const [shapeEditingSnapshot, setShapeEditingSnapshot] = useState<ShapeEditingSnapshot | null>(
    null,
  );
  const handleObjectLifecycleActionsReady = useCallback(
    (actions: ObjectLifecycleActions | null) => {
      objectLifecycleActionsRef.current = actions;
    },
    [],
  );
  const handleShapeEditingActionsReady = useCallback((actions: ShapeEditingActions | null) => {
    shapeEditingActionsRef.current = actions;
  }, []);
  const handleShapeEditingChange = useCallback((snapshot: ShapeEditingSnapshot | null) => {
    setShapeEditingSnapshot((previous) => stabilizeShapeToolbarAnchor(previous, snapshot));
  }, []);
  const deleteSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.deleteSelection();
  }, []);
  const duplicateSelection = useCallback(() => {
    objectLifecycleActionsRef.current?.duplicateSelection();
  }, []);
  const updateShapeStyle = useCallback(
    (patch: ShapeStylePatch) => {
      onChangeShapeStyle(patch);
      shapeEditingActionsRef.current?.updateStyle(patch);
    },
    [onChangeShapeStyle],
  );
  return (
    <section
      ref={workspaceRef}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Notebook workspace"
      data-testid="editor-workspace"
    >
      <CanvasHost
        activeTool={activeTool}
        armedShape={armedShape}
        drawingStyle={drawingStyle}
        viewportSnapshot={viewportSnapshot}
        onObjectLifecycleActionsReady={handleObjectLifecycleActionsReady}
        onShapeEditingActionsReady={handleShapeEditingActionsReady}
        onShapeEditingChange={handleShapeEditingChange}
        onDrawingColorUsed={onDrawingColorUsed}
        onHistoryActionsReady={onHistoryActionsReady}
        onHistoryAvailabilityChange={onHistoryAvailabilityChange}
        onViewportActionsReady={onViewportActionsReady}
        onViewportChange={onViewportChange}
        onViewportNavigationLearned={onViewportNavigationLearned}
      />
      <ToolDock activeTool={activeTool} onSelectTool={onSelectTool} />
      <ShapesWidget
        open={activeTool === "Shapes" && activeFloatingWidget === "shapes"}
        activeShape={activeShape}
        onSelectShape={onSelectShape}
        onDismiss={onDismissFloatingWidget}
      />
      <ShapeEditingToolbar
        snapshot={shapeEditingSnapshot}
        onUpdateStyle={updateShapeStyle}
        onDuplicate={duplicateSelection}
        onDelete={deleteSelection}
      />
      <ToolOptionsWidget
        descriptor={toolOptions}
        colors={colors}
        onSelectPreset={onSelectDrawingPreset}
        onChangeColor={onChangeDrawingColor}
        onChangeWidth={onChangeDrawingWidth}
        onChangeOpacity={onChangeDrawingOpacity}
        onChangeSmoothing={onChangeDrawingSmoothing}
        onDismiss={onDismissFloatingWidget}
        previewScale={viewportSnapshot.zoom}
      />
    </section>
  );
}

function stabilizeShapeToolbarAnchor(
  previous: ShapeEditingSnapshot | null,
  next: ShapeEditingSnapshot | null,
): ShapeEditingSnapshot | null {
  if (
    previous === null ||
    next === null ||
    previous.objectId !== next.objectId ||
    previous.viewportSize.width !== next.viewportSize.width ||
    previous.viewportSize.height !== next.viewportSize.height
  ) {
    return next;
  }
  const styleChanged =
    previous.strokeColor !== next.strokeColor ||
    previous.strokeWidth !== next.strokeWidth ||
    previous.opacity !== next.opacity;
  if (!styleChanged) return next;
  const previousCenter = {
    x: previous.viewportBounds.x + previous.viewportBounds.width / 2,
    y: previous.viewportBounds.y + previous.viewportBounds.height / 2,
  };
  const nextCenter = {
    x: next.viewportBounds.x + next.viewportBounds.width / 2,
    y: next.viewportBounds.y + next.viewportBounds.height / 2,
  };
  if (
    !nearlyEqual(previousCenter.x, nextCenter.x) ||
    !nearlyEqual(previousCenter.y, nextCenter.y)
  ) {
    return next;
  }
  return Object.freeze({ ...next, viewportBounds: previous.viewportBounds });
}

function nearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= 0.01;
}
