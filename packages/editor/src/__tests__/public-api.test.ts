import { describe, expect, it } from "vitest";
import * as editor from "../index";
import type { CanvasDrawingStyle, CanvasSurfaceProps, ObjectLifecycleActions } from "../index";

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

    expect(existingProps.interactionMode).toBe("move");
    expect(rotationProps.interactionMode).toBe("rotate");
    expect(scaleProps.interactionMode).toBe("scale");
    expect(highlighterProps.drawingStyle).toBe(highlighterStyle);
    expect(eraserProps.interactionMode).toBe("eraser");
    expect(historyProps.onHistoryControllerReady).toBeTypeOf("function");
    expect(historyProps.onHistoryChange).toBeTypeOf("function");
    expect(lifecycleActions.duplicateSelection()).toBe(true);
    expect(lifecycleProps.onObjectLifecycleActionsReady).toBeTypeOf("function");
    expect(toolRegistryProps.onToolRegistryReady).toBeTypeOf("function");
  });
});
