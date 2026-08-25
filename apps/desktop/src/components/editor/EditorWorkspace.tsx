import type {
  CanvasDrawingStyle,
  ColorTargetAdapter,
  EditorColorSystemSnapshot,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
  ShapeStylePatch,
  EditorViewportSnapshot,
  ViewportActions,
} from "@folio/editor";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import type { FloatingToolWidgetId } from "./floating-tool-widget-registry";
import { CanvasHost } from "./CanvasHost";
import { ShapesWidget } from "./ShapesWidget";
import { ShapeEditingToolbar } from "./ShapeEditingToolbar";
import { ToolDock } from "./ToolDock";
import { ToolOptionsWidget } from "./ToolOptionsWidget";
import { FullColorPicker } from "./FullColorPicker";
import { QuickColorRail } from "./QuickColorRail";
import { createContinuousColorTarget } from "./color-target-adapters";
import { quickColorRailSupportsTool } from "./color-picker-model";
import { useColorPickerSession } from "./useColorPickerSession";
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
  colorTarget: ColorTargetAdapter | null;
  onSelectColorPalette: (paletteId: string) => void;
  onToggleFavoriteColor: (color: string) => void;
  onSelectDrawingPreset: (presetId: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
  onChangeDrawingSmoothing: (amount: number) => void;
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
  colorTarget,
  onSelectColorPalette,
  onToggleFavoriteColor,
  onSelectDrawingPreset,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
  onChangeDrawingSmoothing,
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
  const colorPicker = useColorPickerSession();
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
  const beginContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.beginContinuousStyleEdit() ?? false;
  }, []);
  const previewContinuousShapeStyle = useCallback((patch: ShapeStylePatch): boolean => {
    return shapeEditingActionsRef.current?.updateContinuousStylePreview(patch) ?? false;
  }, []);
  const commitContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.commitContinuousStyleEdit() ?? false;
  }, []);
  const cancelContinuousShapeStyleEdit = useCallback((): boolean => {
    return shapeEditingActionsRef.current?.cancelContinuousStyleEdit() ?? false;
  }, []);
  const selectedVectorTargetId =
    shapeEditingSnapshot === null ? null : `selected-vector-${shapeEditingSnapshot.objectId}`;
  useEffect(() => {
    const activeSession = colorPicker.snapshot;
    if (activeSession === null) return;
    const validTargetIds = new Set(
      [colorTarget?.id, selectedVectorTargetId].filter((id): id is string => id !== undefined),
    );
    if (!validTargetIds.has(activeSession.target.id)) colorPicker.cancel();
  }, [colorPicker, colorPicker.snapshot, colorTarget?.id, selectedVectorTargetId]);
  const openCreationPicker = useCallback(
    (anchor: HTMLElement, source: "quick-rail" | "tool-settings", ownerScope?: string): void => {
      if (colorTarget === null) return;
      colorPicker.open({ target: colorTarget, source, anchor, ownerScope });
    },
    [colorPicker, colorTarget],
  );
  const openSelectedVectorPicker = useCallback(
    (anchor: HTMLElement): void => {
      if (shapeEditingSnapshot === null) return;
      const objectType = shapeEditingSnapshot.objectType;
      const selectedVectorColorTarget = createContinuousColorTarget({
        id: `selected-vector-${shapeEditingSnapshot.objectId}`,
        label: `${objectType.charAt(0).toUpperCase() + objectType.slice(1)} Color`,
        getColor: () => shapeEditingSnapshot.strokeColor,
        beginContinuousEdit: beginContinuousShapeStyleEdit,
        previewContinuousEdit: (strokeColor) => previewContinuousShapeStyle({ strokeColor }),
        commitContinuousEdit: commitContinuousShapeStyleEdit,
        cancelContinuousEdit: cancelContinuousShapeStyleEdit,
      });
      colorPicker.open({
        target: selectedVectorColorTarget,
        source: "selected-vector",
        anchor,
        ownerScope: undefined,
      });
    },
    [
      beginContinuousShapeStyleEdit,
      cancelContinuousShapeStyleEdit,
      colorPicker,
      commitContinuousShapeStyleEdit,
      previewContinuousShapeStyle,
      shapeEditingSnapshot,
    ],
  );
  const quickColorRailVisible = quickColorRailSupportsTool(activeTool) && colorTarget !== null;
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
        onBeginStyleEdit={beginContinuousShapeStyleEdit}
        onPreviewStyle={previewContinuousShapeStyle}
        onCommitStyleEdit={commitContinuousShapeStyleEdit}
        onCancelStyleEdit={cancelContinuousShapeStyleEdit}
        onOpenColorPicker={openSelectedVectorPicker}
        onDuplicate={duplicateSelection}
        onDelete={deleteSelection}
        rightOccupiedWidth={quickColorRailVisible ? 76 : 0}
      />
      <ToolOptionsWidget
        descriptor={toolOptions}
        onSelectPreset={onSelectDrawingPreset}
        onOpenColorPicker={(anchor, ownerScope) =>
          openCreationPicker(anchor, "tool-settings", ownerScope)
        }
        onChangeWidth={onChangeDrawingWidth}
        onChangeOpacity={onChangeDrawingOpacity}
        onChangeSmoothing={onChangeDrawingSmoothing}
        onDismiss={onDismissFloatingWidget}
        previewScale={viewportSnapshot.zoom}
      />
      <QuickColorRail
        activeTool={activeTool}
        target={colorTarget}
        palette={colors.activePalette}
        onOpenPicker={(anchor) => openCreationPicker(anchor, "quick-rail")}
        onApplyColor={(color) => {
          if (colorTarget !== null) colorPicker.applyDirect(colorTarget, color);
        }}
      />
      {colorPicker.snapshot === null ? null : (
        <FullColorPicker
          key={colorPicker.snapshot.target.id}
          session={colorPicker.snapshot}
          colors={colors}
          onPreviewHex={colorPicker.previewHex}
          onPreviewHsv={colorPicker.previewHsv}
          onSelectPalette={onSelectColorPalette}
          onToggleFavorite={onToggleFavoriteColor}
          onCommit={colorPicker.commit}
          onCancel={colorPicker.cancel}
        />
      )}
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
