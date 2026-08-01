import { describe, expect, it } from "vitest";
import * as editor from "../index";
import type {
  CanvasDrawingStyle,
  CanvasSurfaceProps,
  ObjectLifecycleActions,
  ShapeEditingActions,
  ShapeEditingSnapshot,
} from "../index";

describe("@folio/editor public API", () => {
  it("exposes only the application-facing canvas adapter at runtime", () => {
    expect(Object.keys(editor).sort()).toEqual([
      "CanvasSurface",
      "DEFAULT_PEN_PRESETS",
      "EDITOR_PRESET_COLORS",
      "EDITOR_STROKE_WIDTHS",
      "createDefaultPropertyDescriptorRegistry",
      "createEditorColorSystem",
      "createEditorToolRegistry",
      "createInkPropertyProvider",
      "createPenPresetStore",
      "createPropertyDescriptorRegistry",
      "createVectorPropertyProvider",
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
    const shapeActions: ShapeEditingActions = { updateStyle: () => true };
    const shapeSnapshot: ShapeEditingSnapshot = {
      objectId: "shape-1",
      objectType: "rectangle",
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
    expect(lifecycleActions.duplicateSelection()).toBe(true);
    expect(lifecycleProps.onObjectLifecycleActionsReady).toBeTypeOf("function");
    expect(toolRegistryProps.onToolRegistryReady).toBeTypeOf("function");
    expect(shapeActions.updateStyle({ opacity: 0.5 })).toBe(true);
    expect(shapeSnapshot.objectType).toBe("rectangle");
    expect(shapeEditingProps.onShapeEditingChange).toBeTypeOf("function");
  });
});
