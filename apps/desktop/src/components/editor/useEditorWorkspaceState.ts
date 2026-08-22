import {
  createEditorColorSystem,
  createPenPresetStore,
  type CanvasDrawingStyle,
  type DrawingToolKind,
  type PenPresetPatch,
  type ShapeStylePatch,
} from "@folio/editor";
import * as React from "react";
import { constrainOpacityForTool } from "./drawing-style-policy";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import {
  createFloatingToolWidgetRegistry,
  type FloatingToolWidgetId,
} from "./floating-tool-widget-registry";
import { createShapeToolState } from "./shape-tool-state";
import { createDefaultToolOptionsDescriptorRegistry } from "./tool-options-registry";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");
  const [activeFloatingWidget, setActiveFloatingWidget] =
    React.useState<FloatingToolWidgetId | null>(null);
  const [, setFoundationVersion] = React.useState(0);
  const [colorSystem] = React.useState(() => createEditorColorSystem());
  const [presetStore] = React.useState(() => createPenPresetStore());
  const [shapeToolState] = React.useState(() => createShapeToolState());
  const [toolOptionsRegistry] = React.useState(() => createDefaultToolOptionsDescriptorRegistry());
  const [floatingWidgetRegistry] = React.useState(() => createFloatingToolWidgetRegistry());

  const drawingKind: DrawingToolKind = activeTool === "Highlighter" ? "highlighter" : "pen";
  const activePreset = presetStore.activePreset(drawingKind);
  const penDrawingStyle: CanvasDrawingStyle = React.useMemo(
    () =>
      Object.freeze({
        color: activePreset.style.strokeColor.hex,
        width: activePreset.style.strokeWidth,
        opacity: activePreset.style.strokeColor.opacity,
        pressureEnabled: activePreset.pressure.enabled,
      }),
    [activePreset],
  );
  const shapeState = shapeToolState.snapshot();
  const drawingStyle = activeTool === "Shapes" ? shapeState.style : penDrawingStyle;
  const toolOptions = React.useMemo(
    () =>
      activeFloatingWidget === "drawing-options"
        ? toolOptionsRegistry.describe(activeTool, activePreset)
        : null,
    [activeFloatingWidget, activePreset, activeTool, toolOptionsRegistry],
  );
  const selectTool = React.useCallback(
    (tool: EditorTool): void => {
      setActiveTool(tool);
      setActiveFloatingWidget(floatingWidgetRegistry.widgetFor(tool));
    },
    [floatingWidgetRegistry],
  );
  const dismissFloatingWidget = React.useCallback((): void => setActiveFloatingWidget(null), []);
  const refresh = React.useCallback((): void => setFoundationVersion((version) => version + 1), []);
  const selectShape = React.useCallback(
    (shape: ShapeToolKind): void => {
      shapeToolState.selectShape(shape);
      selectTool("Shapes");
      refresh();
    },
    [refresh, selectTool, shapeToolState],
  );
  const updateShapeStyle = React.useCallback(
    (patch: ShapeStylePatch): void => {
      shapeToolState.updateStyle(patch);
      refresh();
    },
    [refresh, shapeToolState],
  );
  const updatePreset = React.useCallback(
    (patch: PenPresetPatch): void => {
      presetStore.updateActivePreset(drawingKind, patch);
      refresh();
    },
    [drawingKind, presetStore, refresh],
  );
  const setDrawingColor = React.useCallback(
    (color: string): void => updatePreset({ color }),
    [updatePreset],
  );
  const setDrawingWidth = React.useCallback(
    (strokeWidth: number): void => updatePreset({ strokeWidth }),
    [updatePreset],
  );
  const setDrawingOpacity = React.useCallback(
    (opacity: number): void =>
      updatePreset({ opacity: constrainOpacityForTool(activeTool, opacity) }),
    [activeTool, updatePreset],
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
    activeFloatingWidget,
    selectTool,
    selectShape,
    drawingStyle,
    toolOptions,
    colors: colorSystem.snapshot(),
    setDrawingColor,
    setDrawingWidth,
    setDrawingOpacity,
    updateShapeStyle,
    rememberColorUsage,
    dismissFloatingWidget,
  };
}
