import { describe, expect, it } from "vitest";
import * as editor from "../index";
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
      "MARQUEE_ACTIVATION_DISTANCE",
      "MAXIMUM_PAGE_EXTENT",
      "MINIMUM_PAGE_EXTENT",
      "PAGE_PRESETS",
      "PAPER_COLOR_PRESETS",
      "PAPER_TYPES",
      "RECENT_COLOR_CAPACITY",
      "applyInkStyle",
      "createAddPageCommand",
      "createBrushToolStateStore",
      "createColorPalette",
      "createDefaultPropertyDescriptorRegistry",
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
      "editorViewportWheelZoom",
      "formatEditorViewportZoom",
      "hexToHsv",
      "hexToRgb",
      "hsvToHex",
      "hsvToRgb",
      "inkStyleChanges",
      "inkStyleValues",
      "liftPageCommand",
      "marqueeActivated",
      "marqueeRectFromPoints",
      "marqueeSelectedObjects",
      "matchPagePreset",
      "nextEditorViewportZoom",
      "normalizeArtworkHex",
      "orientPageGeometry",
      "pageOrientation",
      "pagePreset",
      "renderPageThumbnail",
      "resolveSelectionEditingStyle",
      "rgbToHex",
      "rgbToHsv",
      "selectionUnionBounds",
    ]);
  });

  it("preserves existing canvas props and exposes rotation and scale modes", () => {
    const existingProps: CanvasSurfaceProps = { interactionMode: "move" };
    const rotationProps: CanvasSurfaceProps = { interactionMode: "rotate" };
    const scaleProps: CanvasSurfaceProps = { interactionMode: "scale" };
    const highlighterStyle: CanvasDrawingStyle = {
      color: "#facc15",
      width: 12,
      opacity: 0.34,
      pressureEnabled: false,
    };
    const highlighterProps: CanvasSurfaceProps = {
      interactionMode: "highlighter",
      drawingStyle: highlighterStyle,
    };
    const eraserProps: CanvasSurfaceProps = { interactionMode: "eraser" };
    const lineProps: CanvasSurfaceProps = { interactionMode: "line" };
    const rectangleProps: CanvasSurfaceProps = { interactionMode: "rectangle" };
    const ellipseProps: CanvasSurfaceProps = { interactionMode: "ellipse" };
    const historyProps: CanvasSurfaceProps = {
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
      artworkSamplingActive: true,
      onArtworkSample: (result) => result.status,
    };
    const lifecycleActions: ObjectLifecycleActions = {
      deleteSelection: () => true,
      duplicateSelection: () => true,
    };
    const lifecycleProps: CanvasSurfaceProps = {
      onObjectLifecycleActionsReady: (actions) => actions?.deleteSelection(),
    };
    const toolRegistryProps: CanvasSurfaceProps = {
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
