import { describe, expect, it } from "vitest";
import * as ink from "../index";

describe("@folio/ink public API", () => {
  it("exposes only the documented runtime entry points", () => {
    expect(Object.keys(ink).sort()).toEqual([
      "DEFAULT_INDEX_BUDGET_BYTES",
      "DEFAULT_MATERIAL_BUDGET_BYTES",
      "DEFAULT_STROKE_STYLE",
      "InkError",
      "MaterialPriority",
      "PencilMaterialRuntime",
      "PointerInputController",
      "SLICE_BUDGET_MS",
      "Stroke",
      "StrokeBuilder",
      "StrokeRenderer",
      "StrokeSmoother",
      "createBrushPreset",
      "createPencilMaterialRuntime",
      "createResolvedBrushSnapshot",
      "createStrokeVisual",
      "evaluatePressureResponse",
      "getStrokeLocalRenderBounds",
      "getStrokeRenderedBounds",
      "getStrokeTransformPivot",
      "getStrokeVisualLocalBounds",
      "isSupportedBrushStrategy",
      "materialTileKey",
      "materialTileRect",
      "pencilGeometryDiagnostics",
      "pencilMaterialCacheId",
      "resolveBrushPreset",
      "supportedBrushStrategies",
    ]);
  });

  it("provides structured immutable errors", () => {
    const error = new ink.InkError("INVALID_STROKE", "Invalid", { strokeId: "s-1" });
    expect(error).toMatchObject({ code: "INVALID_STROKE", details: { strokeId: "s-1" } });
    expect(Object.isFrozen(error.details)).toBe(true);
  });
});
