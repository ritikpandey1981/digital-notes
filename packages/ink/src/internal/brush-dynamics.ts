import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../brush-model";

/** Evaluates the immutable JSON-safe pressure-size contract for rendering and bounds. */
export function brushSizeAtPressure(brush: ResolvedBrushSnapshot, pressure: number): number {
  return brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, pressure);
}
