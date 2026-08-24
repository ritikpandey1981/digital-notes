import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";

/** Evaluates the immutable JSON-safe pressure-size contract for rendering and bounds. */
export function brushSizeAtPressure(brush: ResolvedBrushSnapshot, pressure: number): number {
  return brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, pressure);
}

export function maximumBrushSize(brush: ResolvedBrushSnapshot): number {
  return (
    brush.size *
    (brush.dynamics.pressureSize.enabled ? brush.dynamics.pressureSize.maximumFactor : 1)
  );
}
