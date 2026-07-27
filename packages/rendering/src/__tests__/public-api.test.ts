import { describe, expect, it } from "vitest";
import * as rendering from "../index";

describe("@folio/rendering public API", () => {
  it("exposes only the rendering engine, lifecycle models, diagnostics, errors, and defaults", () => {
    expect(Object.keys(rendering).sort()).toEqual([
      "Camera",
      "CanvasController",
      "CoordinateConverter",
      "DEFAULT_FIT_PADDING",
      "DEFAULT_PAGE",
      "DEFAULT_RENDER_THEME",
      "Diagnostics",
      "RenderScheduler",
      "Renderer",
      "RenderingError",
      "SelectionOverlayRenderer",
      "TranslationPreviewRenderer",
      "Viewport",
    ]);
  });

  it("provides structured immutable rendering failures", () => {
    const error = new rendering.RenderingError("INVALID_VIEWPORT", "Invalid viewport.", {
      width: -1,
    });

    expect(error).toMatchObject({
      name: "RenderingError",
      code: "INVALID_VIEWPORT",
      message: "Invalid viewport.",
      details: { width: -1 },
    });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
