import { strokeWidth } from "./style";
import type { StrokePoint, StrokeStyle } from "../types";

/** Shared Canvas 2D stroke path used by permanent ink and preview visuals. */
export function drawStrokePoints(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  style: StrokeStyle,
  startIndex = 0,
): void {
  if (points.length === 0) return;
  context.save();
  context.globalAlpha *= style.opacity;
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineCap = style.lineCap;
  context.lineJoin = style.lineJoin;
  if (startIndex === 0) {
    const first = points[0];
    if (first !== undefined) {
      context.beginPath();
      context.arc(first.x, first.y, strokeWidth(style, first.pressure) / 2, 0, Math.PI * 2);
      context.fill();
    }
  }
  const firstSegmentIndex = Math.max(1, startIndex + 1);
  for (let index = firstSegmentIndex; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    context.lineWidth =
      (strokeWidth(style, previous.pressure) + strokeWidth(style, point.pressure)) / 2;
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
}
