import type { ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type { ProfessionalInkSegment } from "./professional-ink-path";
import type { StrokedPathRenderGeometry } from "./technical-pen";

/**
 * Paints one Technical Pen path.
 *
 * The whole path is one `beginPath`/`stroke` pair under a single alpha, which
 * is what makes a partly drawn stroke converge on the committed one: painting
 * each span separately would accumulate opacity wherever spans meet, so a live
 * stroke would darken at its own joins and then lighten when it committed.
 *
 * Round caps and joins come from the context rather than from geometry. A
 * constant-width path has nothing to gain from building its own silhouette, and
 * a great deal to lose -- that is the expensive outline pipeline this strategy
 * exists to avoid.
 */
export function drawStrokedPath(
  context: CanvasRenderingContext2D,
  geometry: StrokedPathRenderGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  const origin = geometry.origin;
  if (origin === null) return;
  context.save();
  context.globalAlpha *= brush.opacity;
  context.strokeStyle = brush.color;
  context.fillStyle = brush.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (geometry.segments.length === 0) {
    // A tap is a round mark of the nominal width, not an absence of one.
    context.beginPath();
    context.arc(origin.x, origin.y, geometry.width / (geometry.renderedScale * 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  context.lineWidth = geometry.width / geometry.renderedScale;
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  for (const segment of geometry.segments) {
    context.bezierCurveTo(
      segment.control1X,
      segment.control1Y,
      segment.control2X,
      segment.control2Y,
      segment.endX,
      segment.endY,
    );
  }
  context.stroke();
  context.restore();
}

/** Shared low-latency path used by live ink; only newly sampled segments are drawn. */
export function drawStrokePoints(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  startIndex = 0,
): void {
  if (points.length === 0) return;
  prepareContext(context, brush);
  drawStartingDot(context, points, brush, startIndex);
  const firstSegmentIndex = Math.max(1, startIndex + 1);
  for (let index = firstSegmentIndex; index < points.length; index += 1) {
    drawPointSegment(context, points, index, brush);
  }
  context.restore();
}

/** Draws cached finalized curves without rebuilding spline geometry on later renders. */
export function drawSmoothStrokeSegments(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  segments: readonly ProfessionalInkSegment[],
  brush: ResolvedBrushSnapshot,
  renderedScale = 1,
): void {
  if (points.length === 0) return;
  prepareContext(context, brush);
  const firstSegment = segments[0];
  if (firstSegment === undefined) {
    drawStartingDot(context, points, brush, 0, renderedScale);
    context.restore();
    return;
  }
  context.lineWidth = averageStrokeWidth(points, brush) / renderedScale;
  context.beginPath();
  context.moveTo(firstSegment.start.x, firstSegment.start.y);
  for (const segment of segments) {
    context.bezierCurveTo(
      segment.control1X,
      segment.control1Y,
      segment.control2X,
      segment.control2Y,
      segment.end.x,
      segment.end.y,
    );
  }
  context.stroke();
  context.restore();
}

function prepareContext(context: CanvasRenderingContext2D, brush: ResolvedBrushSnapshot): void {
  context.save();
  context.globalAlpha *= brush.opacity;
  context.strokeStyle = brush.color;
  context.fillStyle = brush.color;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function drawStartingDot(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  startIndex: number,
  renderedScale = 1,
): void {
  if (startIndex !== 0) return;
  const first = points[0];
  if (first === undefined) return;
  context.beginPath();
  context.arc(
    first.x,
    first.y,
    brushSizeAtPressure(brush, first.pressure) / (renderedScale * 2),
    0,
    Math.PI * 2,
  );
  context.fill();
}

function drawPointSegment(
  context: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  endIndex: number,
  brush: ResolvedBrushSnapshot,
): void {
  const start = points[endIndex - 1];
  const end = points[endIndex];
  if (start === undefined || end === undefined) return;
  const before = points[endIndex - 2] ?? start;
  const after = points[endIndex + 1] ?? end;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  drawCubicSegment(
    context,
    start,
    clamp(start.x + (end.x - before.x) / 6, minX, maxX),
    clamp(start.y + (end.y - before.y) / 6, minY, maxY),
    clamp(end.x - (after.x - start.x) / 6, minX, maxX),
    clamp(end.y - (after.y - start.y) / 6, minY, maxY),
    end,
    brush,
  );
}

function averageStrokeWidth(points: readonly StrokePoint[], brush: ResolvedBrushSnapshot): number {
  let total = 0;
  for (const point of points) total += brushSizeAtPressure(brush, point.pressure);
  return total / points.length;
}

function drawCubicSegment(
  context: CanvasRenderingContext2D,
  start: StrokePoint,
  control1X: number,
  control1Y: number,
  control2X: number,
  control2Y: number,
  end: StrokePoint,
  brush: ResolvedBrushSnapshot,
): void {
  context.lineWidth =
    (brushSizeAtPressure(brush, start.pressure) + brushSizeAtPressure(brush, end.pressure)) / 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(control1X, control1Y, control2X, control2Y, end.x, end.y);
  context.stroke();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
