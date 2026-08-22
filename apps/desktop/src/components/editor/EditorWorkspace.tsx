import type {
  CanvasDrawingStyle,
  EditorColorSystemSnapshot,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
  ShapeStylePatch,
} from "@folio/editor";
import { useCallback, useRef, useState } from "react";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { FloatingToolWidgetId } from "./floating-tool-widget-registry";
import { CanvasHost } from "./CanvasHost";
import { ShapesWidget } from "./ShapesWidget";
import { ShapeEditingToolbar } from "./ShapeEditingToolbar";
import { ToolDock } from "./ToolDock";
import { ToolOptionsWidget } from "./ToolOptionsWidget";
import type { ToolOptionsDescriptor } from "./tool-options-registry";
import { WorkspaceChrome } from "./WorkspaceChrome";

interface EditorWorkspaceProps {
  workspaceName: string;
  locationLabel: string;
  activeTool: EditorTool;
  activeShape: ShapeToolKind;
  activeFloatingWidget: FloatingToolWidgetId | null;
  onSelectTool: (tool: EditorTool) => void;
  onSelectShape: (shape: ShapeToolKind) => void;
  drawingStyle: CanvasDrawingStyle;
  toolOptions: ToolOptionsDescriptor | null;
  colors: EditorColorSystemSnapshot;
  onChangeDrawingColor: (color: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
  onChangeShapeStyle: (patch: ShapeStylePatch) => void;
  onDrawingColorUsed: (color: string) => void;
  onDismissFloatingWidget: () => void;
}

export function EditorWorkspace({
  workspaceName,
  locationLabel,
  activeTool,
  activeShape,
  activeFloatingWidget,
  onSelectTool,
  onSelectShape,
  drawingStyle,
  toolOptions,
  colors,
  onChangeDrawingColor,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
  onChangeShapeStyle,
  onDrawingColorUsed,
  onDismissFloatingWidget,
}: EditorWorkspaceProps) {
  const objectLifecycleActionsRef = useRef<ObjectLifecycleActions | null>(null);
  const shapeEditingActionsRef = useRef<ShapeEditingActions | null>(null);
  const [shapeEditingSnapshot, setShapeEditingSnapshot] = useState<ShapeEditingSnapshot | null>(
    null,
  );
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [viewportZoom, setViewportZoom] = useState(1);
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
  const dismissTransientToolUi = useCallback(() => {
    setMoreToolsOpen(false);
    onDismissFloatingWidget();
  }, [onDismissFloatingWidget]);
  const handleMoreToolsOpenChange = useCallback(
    (open: boolean) => {
      setMoreToolsOpen(open);
      if (open) onDismissFloatingWidget();
    },
    [onDismissFloatingWidget],
  );
  const selectTool = useCallback(
    (tool: EditorTool) => {
      setMoreToolsOpen(false);
      onSelectTool(tool);
    },
    [onSelectTool],
  );
  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      aria-label="Notebook workspace"
    >
      <CanvasHost
        activeTool={activeTool}
        activeShape={activeShape}
        drawingStyle={drawingStyle}
        onObjectLifecycleActionsReady={handleObjectLifecycleActionsReady}
        onShapeEditingActionsReady={handleShapeEditingActionsReady}
        onShapeEditingChange={handleShapeEditingChange}
        onDrawingColorUsed={onDrawingColorUsed}
        onViewportZoomChange={setViewportZoom}
      />
      <WorkspaceChrome workspaceName={workspaceName} locationLabel={locationLabel} />
      <ToolDock
        activeTool={activeTool}
        onSelectTool={selectTool}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        moreToolsOpen={moreToolsOpen}
        onMoreToolsOpenChange={handleMoreToolsOpenChange}
      />
      <ShapesWidget
        open={activeTool === "Shapes" && activeFloatingWidget === "shapes"}
        activeShape={activeShape}
        onSelectShape={onSelectShape}
        onDismiss={dismissTransientToolUi}
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
        onChangeColor={onChangeDrawingColor}
        onChangeWidth={onChangeDrawingWidth}
        onChangeOpacity={onChangeDrawingOpacity}
        onDismiss={dismissTransientToolUi}
        previewScale={viewportZoom}
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
