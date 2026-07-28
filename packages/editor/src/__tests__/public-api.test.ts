import { describe, expect, it } from "vitest";
import * as editor from "../index";
import type { CanvasSurfaceProps } from "../index";

describe("@folio/editor public API", () => {
  it("exposes only the application-facing canvas adapter at runtime", () => {
    expect(Object.keys(editor).sort()).toEqual(["CanvasSurface"]);
  });

  it("adds optional History callbacks without narrowing existing canvas props", () => {
    const existingProps: CanvasSurfaceProps = { interactionMode: "move" };
    const historyProps: CanvasSurfaceProps = {
      onHistoryControllerReady: (controller) => controller.getHistoryState(),
      onHistoryChange: (notification) => notification.state,
    };

    expect(existingProps.interactionMode).toBe("move");
    expect(historyProps.onHistoryControllerReady).toBeTypeOf("function");
    expect(historyProps.onHistoryChange).toBeTypeOf("function");
  });
});
