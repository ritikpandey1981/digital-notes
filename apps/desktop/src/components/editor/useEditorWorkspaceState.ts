import {
  createBrushToolStateStore,
  createEditorColorSystem,
  type ActiveToolStatePatch,
  type CanvasDrawingStyle,
  type ColorTargetAdapter,
  type DrawingToolKind,
  type ShapeStylePatch,
} from "@folio/editor";
import * as React from "react";
import { constrainOpacityForTool } from "./drawing-style-policy";
import { createHistoryFreeColorTarget } from "./color-target-adapters";
import type { EditorTool, ShapeToolKind } from "./editor-types";
import {
  createFloatingToolWidgetRegistry,
  resolveFloatingWidgetAfterToolSelection,
  type FloatingToolWidgetId,
} from "./floating-tool-widget-registry";
import { createShapeToolState } from "./shape-tool-state";
import { resolveActiveDockSlotId, type DrawingSlotDefinition } from "./tool-dock-model";
import {
  createDefaultToolOptionsDescriptorRegistry,
  DEFAULT_ERASER_SIZE,
  describeEraserToolOptions,
} from "./tool-options-registry";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");
  // Which drawing slot the user last chose. Editor session state: it separates
  // two slots that share one brush family and never reaches the document.
  const [activeDrawingSlotId, setActiveDrawingSlotId] = React.useState<string | null>(null);
  // Transient workspace UI state for the radial Brush Library. It never reaches
  // the document and never creates History.
  const [brushLibraryOpen, setBrushLibraryOpen] = React.useState(false);
  const [armedShape, setArmedShape] = React.useState<ShapeToolKind>("rectangle");
  const [activeFloatingWidget, setActiveFloatingWidget] =
    React.useState<FloatingToolWidgetId | null>(null);
  const [, setFoundationVersion] = React.useState(0);
  const [colorSystem] = React.useState(() => createEditorColorSystem());
  const [brushStore] = React.useState(() => createBrushToolStateStore());
  // The Eraser owns its runtime size outright. It shares nothing with the pen
  // family, so changing a brush can never move the eraser silently.
  const [eraserSize, setEraserSize] = React.useState(DEFAULT_ERASER_SIZE);
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
  const eraserDrawingStyle: CanvasDrawingStyle = React.useMemo(
    () =>
      Object.freeze({ color: "#000000", width: eraserSize, opacity: 1, pressureEnabled: false }),
    [eraserSize],
  );
  const shapeState = shapeToolState.snapshot();
  const drawingStyle =
    activeTool === "Shapes"
      ? shapeState.style
      : activeTool === "Eraser"
        ? eraserDrawingStyle
        : penDrawingStyle;
  const toolOptions = React.useMemo(
    () =>
      activeFloatingWidget !== "drawing-options"
        ? null
        : activeTool === "Eraser"
          ? describeEraserToolOptions(eraserSize)
          : toolOptionsRegistry.describe(activeTool, resolvedBrush, presetSelection),
    [
      activeFloatingWidget,
      activeTool,
      eraserSize,
      presetSelection,
      resolvedBrush,
      toolOptionsRegistry,
    ],
  );
  const selectTool = React.useCallback(
    (tool: EditorTool): void => {
      setActiveFloatingWidget((current) =>
        resolveFloatingWidgetAfterToolSelection(activeTool, tool, current, floatingWidgetRegistry),
      );
      if (tool === "Shapes") {
        setArmedShape(shapeToolState.snapshot().activeShape);
      }
      // Any major-tool change closes the library: it is anchored to one drawing
      // slot and must never be left hanging off a slot that is no longer active.
      setBrushLibraryOpen(false);
      setActiveTool(tool);
    },
    [activeTool, floatingWidgetRegistry, shapeToolState],
  );
  const dismissFloatingWidget = React.useCallback((): void => setActiveFloatingWidget(null), []);
  const activeToolWidget = floatingWidgetRegistry.widgetFor(activeTool);
  /** The dock's explicit options affordance, independent of tool activation. */
  const toggleToolOptions = React.useCallback((): void => {
    if (activeToolWidget === null) return;
    setActiveFloatingWidget((current) => (current === activeToolWidget ? null : activeToolWidget));
  }, [activeToolWidget]);
  /**
   * Opens the active tool's settings without toggling.
   *
   * The dock's chevron toggles, because it is the one control that also has to
   * close the panel. The property rail has four entry points into the same
   * panel, so pressing a second one must not close what the first opened.
   */
  const openToolOptions = React.useCallback((): void => {
    if (activeToolWidget === null) return;
    setActiveFloatingWidget(activeToolWidget);
  }, [activeToolWidget]);
  const refresh = React.useCallback((): void => setFoundationVersion((version) => version + 1), []);
  /**
   * Activating one drawing preset slot.
   *
   * The slot pins its catalog preset against the slot's own family rather than
   * the family derived from the outgoing tool, so pinning cannot land on the
   * previous brush. Slots whose family hosts no sibling carry no preset and
   * leave the family's current choice alone, keeping Tool Options' preset
   * selection behaving exactly as it does today.
   *
   * A normal press keeps its established behaviour exactly: activating a slot
   * that is already active falls through to `selectTool`, which is what opens
   * Tool Options. `docs/design/drawing-tool-system.md` §6 eventually gives that
   * second press to the Brush Library, but that gesture migration is its own
   * task and is deliberately not made here.
   *
   * `inspectBrushLibrary` is the TEMPORARY Shift+Click development trigger
   * described below. It exists only so the radial geometry can be evaluated in
   * the real window, and adds no visible affordance for normal users.
   */
  const selectDrawingSlot = React.useCallback(
    (slot: DrawingSlotDefinition, inspectBrushLibrary = false): void => {
      if (
        inspectBrushLibrary &&
        slot.id === resolveActiveDockSlotId(activeTool, activeDrawingSlotId)
      ) {
        setBrushLibraryOpen((open) => !open);
        setActiveFloatingWidget(null);
        return;
      }
      if (slot.presetId !== null) brushStore.selectPreset(slot.family, slot.presetId);
      setActiveDrawingSlotId(slot.id);
      selectTool(slot.tool);
      refresh();
    },
    [activeDrawingSlotId, activeTool, brushStore, refresh, selectTool],
  );
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
    (strokeWidth: number): void => {
      if (activeTool === "Eraser") {
        setEraserSize(strokeWidth);
        return;
      }
      updatePreset({ size: strokeWidth });
    },
    [activeTool, updatePreset],
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
  const brushColorTargets = React.useMemo(
    () =>
      new Map<EditorTool, ColorTargetAdapter>(
        (
          [
            ["Pencil", "pencil"],
            ["Pen", "pen"],
            ["Marker", "marker"],
            ["Highlighter", "highlighter"],
          ] as const
        ).map(([tool, kind]) => [
          tool,
          createHistoryFreeColorTarget({
            id: `creation-${kind}`,
            label: `${tool} Color`,
            getColor: () => brushStore.resolvedBrush(kind).color,
            setColor: (color) => {
              brushStore.updateActiveToolState(kind, { color });
              refresh();
            },
          }),
        ]),
      ),
    [brushStore, refresh],
  );
  const shapeColorTarget = React.useMemo(
    () =>
      createHistoryFreeColorTarget({
        id: `creation-shape-${shapeState.activeShape}`,
        label: `${shapeLabel(shapeState.activeShape)} Color`,
        getColor: () => shapeToolState.snapshot().style.color,
        setColor: (color) => {
          shapeToolState.updateStyle({ strokeColor: color });
          refresh();
        },
      }),
    [refresh, shapeState.activeShape, shapeToolState],
  );
  const colorTarget =
    activeTool === "Shapes" ? shapeColorTarget : (brushColorTargets.get(activeTool) ?? null);
  const selectColorPalette = React.useCallback(
    (paletteId: string): void => {
      colorSystem.setActivePalette(paletteId);
      refresh();
    },
    [colorSystem, refresh],
  );
  const toggleFavoriteColor = React.useCallback(
    (color: string): void => {
      const canonicalHex = colorSystem.createColor(color).hex;
      if (colorSystem.snapshot().favoriteColors.includes(canonicalHex)) {
        colorSystem.removeFavorite(canonicalHex);
      } else {
        colorSystem.addFavorite(canonicalHex);
      }
      refresh();
    },
    [colorSystem, refresh],
  );

  return {
    activeTool,
    activeDrawingSlotId,
    activeDockSlotId: resolveActiveDockSlotId(activeTool, activeDrawingSlotId),
    brushLibraryOpen,
    selectDrawingSlot,
    activeShape: shapeState.activeShape,
    armedShape,
    activeFloatingWidget,
    activeToolHasOptions: activeToolWidget !== null,
    toggleToolOptions,
    openToolOptions,
    selectTool,
    selectShape,
    drawingStyle,
    toolOptions,
    colors: colorSystem.snapshot(),
    colorTarget,
    selectColorPalette,
    toggleFavoriteColor,
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

function shapeLabel(shape: ShapeToolKind): string {
  return shape.charAt(0).toUpperCase() + shape.slice(1);
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
