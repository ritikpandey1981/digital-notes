import { describe, expect, it } from "vitest";
import * as ink from "../index";

describe("@folio/ink public API", () => {
  it("exposes only the documented runtime entry points", () => {
    expect(Object.keys(ink).sort()).toEqual([
      "DEFAULT_STROKE_STYLE",
      "InkError",
      "PointerInputController",
      "Stroke",
      "StrokeBuilder",
      "StrokeRenderer",
      "StrokeSmoother",
    ]);
  });

  it("provides structured immutable errors", () => {
    const error = new ink.InkError("INVALID_STROKE", "Invalid", { strokeId: "s-1" });
    expect(error).toMatchObject({ code: "INVALID_STROKE", details: { strokeId: "s-1" } });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
