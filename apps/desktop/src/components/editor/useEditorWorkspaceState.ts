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

/** How the Layers experience is presented. Session state, never a document value. */
export type LayersView = "stack" | "list";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");
  // Which drawing slot the user last chose. Editor session state: it separates
  // two slots that share one brush family and never reaches the document.
  const [activeDrawingSlotId, setActiveDrawingSlotId] = React.useState<string | null>(null);
  // Transient workspace UI state for the radial Brush Library. It never reaches
  // the document and never creates History.
  const [brushLibraryOpen, setBrushLibraryOpen] = React.useState(false);
  // The Layers experience. Transient workspace UI state exactly like the Brush
  // Library: never serialized, never a document value, never History.
  //
  // One trigger, two presentations. Keeping the view beside the open flag is
  // what will later let a large layer count default to the list without another
  // ownership redesign.
  const [layersOpen, setLayersOpen] = React.useState(false);
  const [layersView, setLayersView] = React.useState<LayersView>("stack");
  /**
   * Puts away only the modal presentation.
   *
   * The spatial stack owns the page, so reaching for a tool has to close it.
   * The list is an ordinary floating panel and has always coexisted with
   * drawing, so it stays exactly where it was.
   */
  const closeLayersStackView = React.useCallback((): void => {
    if (layersView === "stack") setLayersOpen(false);
  }, [layersView]);
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
  // Every slot's own resolved colour, not merely the one currently active. The
  // dock can therefore remain a truthful visual memory of the five brushes
  // without owning or copying any colour state itself.
  const slotDrawingColors = Object.freeze(
    Object.fromEntries(
      DRAWING_SLOTS.map((slot) => [slot.id, slotStore.resolvedBrush(slot.id).color]),
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
      // Choosing a tool is a request to work on the page, so the structural
      // Layers view steps aside. The list panel is not modal and stays put.
      closeLayersStackView();
      setActiveTool(tool);
    },
    [activeTool, closeLayersStackView, floatingWidgetRegistry, shapeToolState],
  );
  const dismissFloatingWidget = React.useCallback((): void => setActiveFloatingWidget(null), []);
  const dismissBrushLibrary = React.useCallback((): void => setBrushLibraryOpen(false), []);
  const dismissLayers = React.useCallback((): void => setLayersOpen(false), []);
  /**
   * Opens or closes the Layers experience.
   *
   * Opening it takes the page, so the Brush Library and any tool palette give
   * way first: those talk about the drawing tools, and Layers is a different
   * claim on the same workspace. Zero History either way.
   */
  const toggleLayers = React.useCallback((): void => {
    // The radial is the one surface that cannot coexist: it and the stack are
    // both structural views of the same page. Ordinary panels are left alone --
    // the stack sits below them in the workspace strata, and they have always
    // been usable alongside the Layers list.
    setLayersOpen((open) => {
      if (!open) setBrushLibraryOpen(false);
      return !open;
    });
  }, []);
  /** Switching presentation only. No document change, no History. */
  const showLayersView = React.useCallback((view: LayersView): void => setLayersView(view), []);
  const activeToolWidget = floatingWidgetRegistry.widgetFor(activeTool);
  /**
   * Opens the active tool's settings without toggling.
   *
   * The Property Rail has several entry points into the same panel, so pressing
   * a second one must not close what the first opened.
   */
  const openToolOptions = React.useCallback((): void => {
    if (activeToolWidget === null) return;
    setBrushLibraryOpen(false);
    closeLayersStackView();
    setActiveFloatingWidget(activeToolWidget);
  }, [activeToolWidget, closeLayersStackView]);
  const refresh = React.useCallback((): void => setFoundationVersion((version) => version + 1), []);
  /**
   * Activating one drawing preset slot.
   *
   * Two presses, two meanings. The first press on a slot the artist is not
   * already using means "give me this tool", and must hand the canvas straight
   * back so drawing can start immediately — it never opens anything. Pressing
   * the slot that is already active is the second, deliberate press, and that
   * is the one that asks which brush should live there.
   *
   * The routing is keyed on the active slot id alone. A slot is a physical
   * position, so a slot holding a marker behaves exactly like one holding a
   * pencil, and nothing here consults the family a slot was seeded with.
   *
   * The Brush Library and Tool Options are alternate ways of talking about the
   * same slot, never two panels to accumulate: opening one dismisses the other.
   */
  const selectDrawingSlot = React.useCallback(
    (slot: DrawingSlotDefinition): void => {
      if (slot.id === resolveActiveDockSlotId(activeTool, activeDrawingSlotId, slotFamilies)) {
        // The second press on the slot already in use. Toggling the same
        // logical request is what lets a press during the unfolding retarget
        // toward closing, and one during the collapse turn back toward open,
        // through the choreography's own reversal rather than a second state
        // machine.
        setBrushLibraryOpen((open) => !open);
        setActiveFloatingWidget(null);
        // The radial and the Layers stack are both structural surfaces over the
        // page; reaching for one puts the other away.
        closeLayersStackView();
        return;
      }
      // First press: activate, and nothing more. `selectTool` closes any open
      // library, and the surface stays latched to the slot it unfolded from so
      // the collapse still resolves into that slot rather than this one.
      setActiveDrawingSlotId(slot.id);
      selectTool(toolForDrawingFamily(slotStore.stateFor(slot.id).family));
      refresh();
    },
    [
      activeDrawingSlotId,
      activeTool,
      closeLayersStackView,
      refresh,
      selectTool,
      slotFamilies,
      slotStore,
    ],
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
    slotDrawingColors,
    brushLibraryOpen,
    dismissBrushLibrary,
    layersOpen,
    layersView,
    showLayersView,
    toggleLayers,
    dismissLayers,
    closeLayersStackView,
    activeSlotBrushId: slotState.brushId,
    selectDrawingSlot,
    selectLibraryBrush,
    activeShape: shapeState.activeShape,
    armedShape,
    activeFloatingWidget,
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
