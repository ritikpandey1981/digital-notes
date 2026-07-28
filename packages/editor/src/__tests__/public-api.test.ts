import { describe, expect, it } from "vitest";
import * as editor from "../index";
import type { CanvasSurfaceProps, ObjectLifecycleActions } from "../index";

describe("@folio/editor public API", () => {
  it("exposes only the application-facing canvas adapter at runtime", () => {
    expect(Object.keys(editor).sort()).toEqual(["CanvasSurface"]);
  });

  it("preserves existing canvas props and exposes rotation and scale modes", () => {
    const existingProps: CanvasSurfaceProps = { interactionMode: "move" };
    const rotationProps: CanvasSurfaceProps = { interactionMode: "rotate" };
    const scaleProps: CanvasSurfaceProps = { interactionMode: "scale" };
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

    expect(existingProps.interactionMode).toBe("move");
    expect(rotationProps.interactionMode).toBe("rotate");
    expect(scaleProps.interactionMode).toBe("scale");
    expect(historyProps.onHistoryControllerReady).toBeTypeOf("function");
    expect(historyProps.onHistoryChange).toBeTypeOf("function");
    expect(lifecycleActions.duplicateSelection()).toBe(true);
    expect(lifecycleProps.onObjectLifecycleActionsReady).toBeTypeOf("function");
  });
});
