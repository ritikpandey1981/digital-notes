import {
  createBrushToolStateStore,
  createEditorColorSystem,
  type ActiveToolStatePatch,
  type CanvasDrawingStyle,
  type DrawingToolKind,
  type ShapeStylePatch,
} from "@folio/editor";
import * as React from "react";
import { constrainOpacityForTool } from "./drawing-style-policy";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import {
  createFloatingToolWidgetRegistry,
  resolveFloatingWidgetAfterToolSelection,
  type FloatingToolWidgetId,
} from "./floating-tool-widget-registry";
import { createShapeToolState } from "./shape-tool-state";
import { createDefaultToolOptionsDescriptorRegistry } from "./tool-options-registry";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");
  const [armedShape, setArmedShape] = React.useState<ShapeToolKind | null>(null);
  const [activeFloatingWidget, setActiveFloatingWidget] =
    React.useState<FloatingToolWidgetId | null>(null);
  const [, setFoundationVersion] = React.useState(0);
  const [colorSystem] = React.useState(() => createEditorColorSystem());
  const [brushStore] = React.useState(() => createBrushToolStateStore());
  const [shapeToolState] = React.useState(() => createShapeToolState());
  const [toolOptionsRegistry] = React.useState(() => createDefaultToolOptionsDescriptorRegistry());
  const [floatingWidgetRegistry] = React.useState(() => createFloatingToolWidgetRegistry());

  const drawingKind = drawingKindForTool(activeTool);
  const resolvedBrush = brushStore.resolvedBrush(drawingKind);
  const presetSelection = Object.freeze({
    activeId: brushStore.activeState(drawingKind).presetId,
    options: Object.freeze(
      brushStore.presetsFor(drawingKind).map((preset) =>
        Object.freeze({
          id: preset.id,
          name: preset.name,
          defaultSize: preset.defaults.size,
          defaultOpacity: preset.defaults.opacity,
          defaultSmoothing: preset.defaults.smoothing.amount,
        }),
      ),
    ),
  });
  const penDrawingStyle: CanvasDrawingStyle = React.useMemo(
    () =>
      Object.freeze({
        color: resolvedBrush.color,
        width: resolvedBrush.size,
        opacity: resolvedBrush.opacity,
        pressureEnabled: resolvedBrush.dynamics.pressureSize.enabled,
        brush: resolvedBrush,
      }),
    [resolvedBrush],
  );
  const shapeState = shapeToolState.snapshot();
  const drawingStyle = activeTool === "Shapes" ? shapeState.style : penDrawingStyle;
  const toolOptions = React.useMemo(
    () =>
      activeFloatingWidget === "drawing-options"
        ? toolOptionsRegistry.describe(activeTool, resolvedBrush, presetSelection)
        : null,
    [activeFloatingWidget, activeTool, presetSelection, resolvedBrush, toolOptionsRegistry],
  );
  const selectTool = React.useCallback(
    (tool: EditorTool): void => {
      setActiveFloatingWidget((current) =>
        resolveFloatingWidgetAfterToolSelection(activeTool, tool, current, floatingWidgetRegistry),
      );
      setArmedShape((current) => (tool === "Shapes" && activeTool === "Shapes" ? current : null));
      setActiveTool(tool);
    },
    [activeTool, floatingWidgetRegistry],
  );
  const dismissFloatingWidget = React.useCallback((): void => setActiveFloatingWidget(null), []);
  const refresh = React.useCallback((): void => setFoundationVersion((version) => version + 1), []);
  const selectShape = React.useCallback(
    (shape: ShapeToolKind): void => {
      shapeToolState.selectShape(shape);
      setActiveTool("Shapes");
      setArmedShape(shape);
      setActiveFloatingWidget(null);
      refresh();
    },
    [refresh, shapeToolState],
  );
  const updateShapeStyle = React.useCallback(
    (patch: ShapeStylePatch): void => {
      shapeToolState.updateStyle(patch);
      refresh();
    },
    [refresh, shapeToolState],
  );
  const updatePreset = React.useCallback(
    (patch: ActiveToolStatePatch): void => {
      brushStore.updateActiveToolState(drawingKind, patch);
      refresh();
    },
    [brushStore, drawingKind, refresh],
  );
  const setDrawingColor = React.useCallback(
    (color: string): void => updatePreset({ color }),
    [updatePreset],
  );
  const selectDrawingPreset = React.useCallback(
    (presetId: string): void => {
      brushStore.selectPreset(drawingKind, presetId);
      refresh();
    },
    [brushStore, drawingKind, refresh],
  );
  const setDrawingWidth = React.useCallback(
    (strokeWidth: number): void => updatePreset({ size: strokeWidth }),
    [updatePreset],
  );
  const setDrawingOpacity = React.useCallback(
    (opacity: number): void =>
      updatePreset({ opacity: constrainOpacityForTool(activeTool, opacity) }),
    [activeTool, updatePreset],
  );
  const setDrawingSmoothing = React.useCallback(
    (amount: number): void =>
      updatePreset({ smoothing: { mode: amount === 0 ? "none" : "average", amount } }),
    [updatePreset],
  );
  const rememberColorUsage = React.useCallback(
    (color: string): void => {
      colorSystem.remember(colorSystem.createColor(color));
      refresh();
    },
    [colorSystem, refresh],
  );

  return {
    activeTool,
    activeShape: shapeState.activeShape,
    armedShape,
    activeFloatingWidget,
    selectTool,
    selectShape,
    drawingStyle,
    toolOptions,
    colors: colorSystem.snapshot(),
    setDrawingColor,
    selectDrawingPreset,
    setDrawingWidth,
    setDrawingOpacity,
    setDrawingSmoothing,
    updateShapeStyle,
    rememberColorUsage,
    dismissFloatingWidget,
  };
}

function drawingKindForTool(tool: EditorTool): DrawingToolKind {
  switch (tool) {
    case "Pencil":
      return "pencil";
    case "Marker":
      return "marker";
    case "Highlighter":
      return "highlighter";
    default:
      return "pen";
  }
}
