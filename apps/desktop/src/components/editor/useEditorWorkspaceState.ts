import {
  DEFAULT_BRUSH_PRESETS,
  createDrawingSlotStore,
  createEditorColorSystem,
  type ActiveToolStatePatch,
  type CanvasDrawingStyle,
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
import {
  assignmentForBrush,
  brushLibraryEntryById,
  DEFAULT_SLOT_BRUSH_IDS,
} from "./brush-library-catalogue";
import {
  DRAWING_SLOTS,
  resolveActiveDockSlotId,
  toolForDrawingFamily,
  type DrawingSlotDefinition,
} from "./tool-dock-model";
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
  // Five independent slot states. Each dock slot owns its own brush identity
  // and working values, so activating one can never overwrite another.
  const [slotStore] = React.useState(() =>
    createDrawingSlotStore(
      DRAWING_SLOTS.map((slot) => ({
        id: slot.id,
        family: slot.family,
        presetId: slot.presetId,
        brushId: DEFAULT_SLOT_BRUSH_IDS[slot.id] ?? null,
      })),
    ),
  );
  // The Eraser owns its runtime size outright. It shares nothing with the pen
  // family, so changing a brush can never move the eraser silently.
  const [eraserSize, setEraserSize] = React.useState(DEFAULT_ERASER_SIZE);
  const [shapeToolState] = React.useState(() => createShapeToolState());
  const [toolOptionsRegistry] = React.useState(() => createDefaultToolOptionsDescriptorRegistry());
  const [floatingWidgetRegistry] = React.useState(() => createFloatingToolWidgetRegistry());

  const drawingKind = drawingKindForTool(activeTool);
  // The one slot every drawing read resolves through. When the active tool is
  // not a drawing tool the dock still names a drawing slot, so the rail and the
  // options panel keep reading a real slot rather than a family default.
  const slotFamilies = Object.freeze(
    Object.fromEntries(DRAWING_SLOTS.map((slot) => [slot.id, slotStore.stateFor(slot.id).family])),
  );
  // What each slot currently holds, for the dock's name and tooltip. The
  // library identity is the truth where there is one; a slot that holds no
  // catalogue brush falls back to the name of the preset actually backing it,
  // which is still what it draws with.
  const slotBrushIds = Object.freeze(
    Object.fromEntries(
      DRAWING_SLOTS.map((slot) => [slot.id, slotStore.stateFor(slot.id).brushId ?? ""]),
    ),
  );
  const slotBrushNames = Object.freeze(
    Object.fromEntries(
      DRAWING_SLOTS.map((slot) => {
        const state = slotStore.stateFor(slot.id);
        const identity = brushLibraryEntryById(state.brushId);
        const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === state.presetId);
        return [slot.id, identity?.name ?? preset?.name ?? slot.label];
      }),
    ),
  );
  const drawingSlotId = resolveDrawingSlotId(
    activeTool,
    activeDrawingSlotId,
    drawingKind,
    slotFamilies,
  );
  const slotState = slotStore.stateFor(drawingSlotId);
  const resolvedBrush = slotStore.resolvedBrush(drawingSlotId);
  const presetSelection = Object.freeze({
    activeId: slotState.presetId,
    options: Object.freeze(
      slotStore.presetsFor(drawingSlotId).map((preset) =>
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
        slot.id === resolveActiveDockSlotId(activeTool, activeDrawingSlotId, slotFamilies)
      ) {
        setBrushLibraryOpen((open) => !open);
        setActiveFloatingWidget(null);
        return;
      }
      // No re-pinning. The slot already holds its own brush identity and
      // values, and activating it simply makes that state current again. The
      // tool follows whatever family the slot currently holds, so a slot given
      // a pencil activates the Pencil tool even if it started as a pen.
      setActiveDrawingSlotId(slot.id);
      selectTool(toolForDrawingFamily(slotStore.stateFor(slot.id).family));
      refresh();
    },
    [activeDrawingSlotId, activeTool, refresh, selectTool, slotFamilies, slotStore],
  );

  /**
   * Replaces the brush identity held by the currently active drawing slot.
   *
   * Editor preference state: it changes what the next stroke will look like and
   * touches nothing already drawn, so it creates no History whatsoever.
   */
  const selectLibraryBrush = React.useCallback(
    (brushId: string): void => {
      const assignment = assignmentForBrush(brushId);
      if (assignment === null) return;
      const targetSlotId = resolveActiveDockSlotId(activeTool, activeDrawingSlotId, slotFamilies);
      if (targetSlotId === null) return;
      // Any brush may go in any slot; the slot's family, backing preset and
      // tool all follow the brush that was chosen.
      if (!DRAWING_SLOTS.some((candidate) => candidate.id === targetSlotId)) return;
      slotStore.assignBrush(targetSlotId, assignment);
      selectTool(toolForDrawingFamily(assignment.family));
      setActiveDrawingSlotId(targetSlotId);
      // Choosing a brush returns the artist to drawing: the library folds away
      // through the approved close choreography, from wherever it was rotated.
      setBrushLibraryOpen(false);
      refresh();
    },
    [activeDrawingSlotId, activeTool, refresh, selectTool, slotFamilies, slotStore],
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
      slotStore.updateProperties(drawingSlotId, patch);
      refresh();
    },
    [drawingSlotId, refresh, slotStore],
  );
  const setDrawingColor = React.useCallback(
    (color: string): void => updatePreset({ color }),
    [updatePreset],
  );
  const selectDrawingPreset = React.useCallback(
    (presetId: string): void => {
      slotStore.selectPreset(drawingSlotId, presetId);
      refresh();
    },
    [drawingSlotId, refresh, slotStore],
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
  const brushColorTarget = React.useMemo(
    () =>
      createHistoryFreeColorTarget({
        // Identity follows the slot, so switching slots is a new colour target
        // rather than one target quietly changing what it points at.
        id: `creation-${drawingSlotId}`,
        label: `${slotLabel(drawingSlotId)} Color`,
        getColor: () => slotStore.resolvedBrush(drawingSlotId).color,
        setColor: (color) => {
          slotStore.updateProperties(drawingSlotId, { color });
          refresh();
        },
      }),
    [drawingSlotId, refresh, slotStore],
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
    activeTool === "Shapes"
      ? shapeColorTarget
      : isDrawingTool(activeTool)
        ? brushColorTarget
        : null;
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
    activeDockSlotId: resolveActiveDockSlotId(activeTool, activeDrawingSlotId, slotFamilies),
    slotFamilies,
    slotBrushIds,
    slotBrushNames,
    brushLibraryOpen,
    activeSlotBrushId: slotState.brushId,
    selectDrawingSlot,
    selectLibraryBrush,
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

function slotLabel(slotId: string): string {
  return DRAWING_SLOTS.find((slot) => slot.id === slotId)?.label ?? "Drawing";
}

function isDrawingTool(tool: EditorTool): boolean {
  return DRAWING_SLOTS.some((slot) => slot.tool === tool);
}

/**
 * The drawing slot every drawing read resolves through.
 *
 * While a drawing tool is active this is that tool's slot, which is what makes
 * the five slots genuinely independent.
 *
 * While Select, Eraser or Shapes is active there is no active drawing slot, and
 * the answer falls back to the first slot of the tool's nominal family. That
 * deliberately reproduces the established behaviour: the creation-tool
 * diagnostics are expected to report a stable family default at that point, not
 * whichever drawing slot happened to be used last. Resolving to the remembered
 * slot instead would make a selection edit appear to change the creation brush.
 */
function resolveDrawingSlotId(
  tool: EditorTool,
  lastActivatedDrawingSlotId: string | null,
  family: DrawingToolKind,
  slotFamilies: Readonly<Record<string, DrawingToolKind>>,
): string {
  const active = resolveActiveDockSlotId(tool, lastActivatedDrawingSlotId, slotFamilies);
  if (active !== null && DRAWING_SLOTS.some((slot) => slot.id === active)) return active;
  const byFamily = DRAWING_SLOTS.find((slot) => (slotFamilies[slot.id] ?? slot.family) === family);
  return (byFamily ?? DRAWING_SLOTS[0]!).id;
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
