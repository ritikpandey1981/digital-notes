import { describe, expect, it } from "vitest";
import * as editor from "../index";
import { InkDocumentSession } from "../InkDocumentSession";
import type {
  ArtworkColorSampleResult,
  CanvasDrawingStyle,
  CanvasSurfaceProps,
  EditorViewportSnapshot,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
  ViewportActions,
} from "../index";

describe("@folio/editor public API", () => {
  it("exposes only the application-facing canvas adapter at runtime", () => {
    expect(Object.keys(editor).sort()).toEqual([
      "BUILT_IN_COLOR_PALETTES",
      "CanvasSurface",
      "DEFAULT_BRUSH_PRESETS",
      "DEFAULT_BRUSH_PRESET_IDS",
      "DEFAULT_COLOR_PALETTE_ID",
      "DEFAULT_EDITOR_VIEWPORT_SNAPSHOT",
      "DEFAULT_PEN_PRESETS",
      "EDITOR_PRESET_COLORS",
      "EDITOR_STROKE_WIDTHS",
      "EDITOR_VIEWPORT_ZOOM_PRESETS",
      "FAVORITE_COLOR_CAPACITY",
      "ForegroundInteractionTracker",
      "MARQUEE_ACTIVATION_DISTANCE",
      "MAXIMUM_PAGE_EXTENT",
      "MINIMUM_PAGE_EXTENT",
      "PAGE_PRESETS",
      "PAPER_COLOR_PRESETS",
      "PAPER_TYPES",
      "ProjectRuntimeHost",
      "ProjectSession",
      "RECENT_COLOR_CAPACITY",
      "SPECTRUM_ACHROMATIC_CHROMA",
      "SPECTRUM_CHROMA_TIERS",
      "SPECTRUM_FAMILIES",
      "SPECTRUM_LIGHTNESS_TIERS",
      "SPECTRUM_NEUTRAL_GROUPS",
      "applyInkStyle",
      "classifySpectrumColor",
      "createAddPageCommand",
      "createBrushToolStateStore",
      "createColorPalette",
      "createDefaultPropertyDescriptorRegistry",
      "createDrawingSlotStore",
      "createEditorColorSystem",
      "createEditorToolRegistry",
      "createInkPropertyProvider",
      "createPageGeometryCommand",
      "createPagePaperCommand",
      "createPageRenameCommand",
      "createPenPresetStore",
      "createPropertyDescriptorRegistry",
      "createRemovePageCommand",
      "createReorderPagesCommand",
      "createVectorPropertyProvider",
      "describesEditableTarget",
      "describesInteractiveControl",
      "editorViewportWheelZoom",
      "formatEditorViewportZoom",
      "gamutMapOklch",
      "hexFromOklch",
      "hexToHsv",
      "hexToRgb",
      "hsvToHex",
      "hsvToRgb",
      "inkStyleChanges",
      "inkStyleValues",
      "isEditableKeyboardTarget",
      "isInteractiveKeyboardTarget",
      "liftPageCommand",
      "marqueeActivated",
      "marqueeRectFromPoints",
      "marqueeSelectedObjects",
      "matchPagePreset",
      "nearestSpectrumFamily",
      "nextEditorViewportZoom",
      "nextSpectrumFamily",
      "normalizeArtworkHex",
      "oklabSquaredDistance",
      "oklchFromHex",
      "orientPageGeometry",
      "pageOrientation",
      "pagePreset",
      "previousSpectrumFamily",
      "renderPageLayerPreview",
      "renderPagePaperPreview",
      "renderPageThumbnail",
      "requireSpectrumFamily",
      "resolveSelectionEditingStyle",
      "rgbToHex",
      "rgbToHsv",
      "selectionUnionBounds",
      "spectrumFamilies",
      "spectrumFamilyAnchor",
      "spectrumFamilyById",
      "spectrumFamilyVariants",
      "spectrumNeutralGroups",
      "spectrumVariant",
    ]);
  });

  it("preserves existing canvas props and exposes rotation and scale modes", () => {
    const session = new InkDocumentSession();
    const existingProps: CanvasSurfaceProps = { session, interactionMode: "move" };
    const rotationProps: CanvasSurfaceProps = { session, interactionMode: "rotate" };
    const scaleProps: CanvasSurfaceProps = { session, interactionMode: "scale" };
    const highlighterStyle: CanvasDrawingStyle = {
      color: "#facc15",
      width: 12,
      opacity: 0.34,
      pressureEnabled: false,
    };
    const highlighterProps: CanvasSurfaceProps = {
      session,
      interactionMode: "highlighter",
      drawingStyle: highlighterStyle,
    };
    const eraserProps: CanvasSurfaceProps = { session, interactionMode: "eraser" };
    const lineProps: CanvasSurfaceProps = { session, interactionMode: "line" };
    const rectangleProps: CanvasSurfaceProps = { session, interactionMode: "rectangle" };
    const ellipseProps: CanvasSurfaceProps = { session, interactionMode: "ellipse" };
    const historyProps: CanvasSurfaceProps = {
      session,
      onHistoryControllerReady: (controller) => controller.getHistoryState(),
      onHistoryChange: (notification) => notification.state,
      onArtworkColorUsed: (color) => color,
    };
    const sampleResult: ArtworkColorSampleResult = {
      status: "success",
      color: "#4f46e5",
      backingPoint: { x: 10, y: 20 },
      durationMs: 0.2,
    };
    const artworkSamplingProps: CanvasSurfaceProps = {
      session,
      artworkSamplingActive: true,
      onArtworkSample: (result) => result.status,
    };
    const lifecycleActions: ObjectLifecycleActions = {
      deleteSelection: () => true,
      duplicateSelection: () => true,
    };
    const lifecycleProps: CanvasSurfaceProps = {
      session,
      onObjectLifecycleActionsReady: (actions) => actions?.deleteSelection(),
    };
    const toolRegistryProps: CanvasSurfaceProps = {
      session,
      onToolRegistryReady: (registry) => registry?.snapshot(),
    };
    const shapeActions: ShapeEditingActions = {
      updateStyle: () => true,
      moveSelectionToLayer: () => true,
      beginContinuousStyleEdit: () => true,
      updateContinuousStylePreview: () => true,
      commitContinuousStyleEdit: () => true,
      cancelContinuousStyleEdit: () => true,
    };
    const shapeSnapshot: ShapeEditingSnapshot = {
      objectId: "shape-1",
      objectType: "rectangle",
      selectedObjectIds: ["shape"],
      readOnly: false,
      layerId: "layer-1",
      strokeColor: "#111111",
      strokeWidth: 2,
      opacity: 1,
      viewportBounds: { x: 20, y: 30, width: 120, height: 80 },
      viewportSize: { width: 800, height: 600 },
    };
    const shapeEditingProps: CanvasSurfaceProps = {
      session,
      onShapeEditingActionsReady: (actions) => actions?.updateStyle({ strokeWidth: 4 }),
      onShapeEditingChange: (snapshot) => snapshot?.objectId,
    };
    const viewportSnapshot: EditorViewportSnapshot = {
      zoom: 1,
      mode: "manual",
      minZoom: 0.25,
      maxZoom: 8,
    };
    const viewportActions: ViewportActions = {
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      setZoom: () => undefined,
      resetZoom: () => undefined,
      zoomAt: () => undefined,
      panBy: () => undefined,
      fitPage: () => undefined,
      fitWidth: () => undefined,
    };
    const viewportProps: CanvasSurfaceProps = {
      session,
      onViewportActionsReady: (actions) => actions?.fitPage(),
      onViewportChange: (snapshot) => snapshot.zoom,
    };

    expect(existingProps.interactionMode).toBe("move");
    expect(rotationProps.interactionMode).toBe("rotate");
    expect(scaleProps.interactionMode).toBe("scale");
    expect(highlighterProps.drawingStyle).toBe(highlighterStyle);
    expect(eraserProps.interactionMode).toBe("eraser");
    expect(lineProps.interactionMode).toBe("line");
    expect(rectangleProps.interactionMode).toBe("rectangle");
    expect(ellipseProps.interactionMode).toBe("ellipse");
    expect(historyProps.onHistoryControllerReady).toBeTypeOf("function");
    expect(historyProps.onHistoryChange).toBeTypeOf("function");
    expect(historyProps.onArtworkColorUsed).toBeTypeOf("function");
    expect(sampleResult.status).toBe("success");
    expect(artworkSamplingProps.onArtworkSample).toBeTypeOf("function");
    expect(lifecycleActions.duplicateSelection()).toBe(true);
    expect(lifecycleProps.onObjectLifecycleActionsReady).toBeTypeOf("function");
    expect(toolRegistryProps.onToolRegistryReady).toBeTypeOf("function");
    expect(shapeActions.updateStyle({ opacity: 0.5 })).toBe(true);
    expect(shapeSnapshot.objectType).toBe("rectangle");
    expect(shapeEditingProps.onShapeEditingChange).toBeTypeOf("function");
    expect(viewportSnapshot.mode).toBe("manual");
    expect(viewportActions.fitWidth).toBeTypeOf("function");
    expect(viewportProps.onViewportChange).toBeTypeOf("function");
  });
});
