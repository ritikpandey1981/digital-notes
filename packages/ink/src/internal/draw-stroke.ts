import type { Point } from "@folio/rendering";
import type { ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type {
  FilledPathRenderGeometry,
  StampsRenderGeometry,
  StrokedPathRenderGeometry,
} from "./brush-geometry";
import type { ProfessionalInkSegment } from "./professional-ink-path";

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

/**
 * Paints one Pressure Pen silhouette.
 *
 * One band, one alpha, one fill. Inside a band the boundary may double back on
 * itself at a tight corner and still composite once, because a single `fill()`
 * covers the union of what it encloses. Between bands there is nothing to
 * composite twice: they are cut on a shared cross-section, so they meet along an
 * edge rather than overlapping across one.
 *
 * The inherited alpha is read rather than multiplied into, because a band's
 * alpha already carries the brush's own opacity. Multiplying again would apply
 * it twice -- the same mistake that once let a vector's outline alpha leak into
 * its fill.
 */
export function drawFilledPath(
  context: CanvasRenderingContext2D,
  geometry: FilledPathRenderGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  const inherited = context.globalAlpha;
  context.save();
  context.fillStyle = brush.color;
  const dot = geometry.dot;
  if (dot !== null) {
    context.globalAlpha = inherited * dot.alpha;
    context.beginPath();
    context.arc(dot.center.x, dot.center.y, dot.radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (const band of geometry.bands) {
    const start = band.left[0];
    const finish = band.left.at(-1);
    const back = band.right[0];
    if (start === undefined || finish === undefined || back === undefined) continue;
    context.globalAlpha = inherited * band.alpha;
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (let index = 1; index < band.left.length; index += 1) {
      const point = band.left[index];
      if (point !== undefined) context.lineTo(point.x, point.y);
    }
    if (band.roundEnd) appendCap(context, band.endCenter, band.endRadius, finish);
    for (let index = band.right.length - 1; index >= 0; index -= 1) {
      const point = band.right[index];
      if (point !== undefined) context.lineTo(point.x, point.y);
    }
    if (band.roundStart) appendCap(context, band.startCenter, band.startRadius, back);
    context.closePath();
    context.fill();
  }
  context.restore();
}

/**
 * The most contours one `fill()` is given.
 *
 * Canvas 2D resolves a path's contours against one another, and the cost of
 * doing so is quadratic in how many there are: measured on a twenty-thousand
 * sample stroke, six thousand contours in a single fill took 155 ms a frame,
 * while the same contours in batches take single digits. Batching is safe here
 * only because a Pencil's streaks are laid out never to overlap -- see
 * `pencil.ts` -- so splitting the path cannot composite anything twice.
 *
 * Disjoint is not the same as distant. Two streaks that share an edge are
 * resolved correctly within one fill and still *look* wrong across two, because
 * a boundary pixel each of them half covers is composited twice and comes out
 * lighter than either. Streaks reach the painter in the order they were opened,
 * so neighbours share a fill as long as a batch outlasts a streak -- which makes
 * this number and the length of a Pencil streak two ends of one decision.
 *
 * E4.1 settled it at the geometry end rather than here. Raising the batch buys
 * locality at the quadratic term's expense -- measured at about a millisecond and
 * a half a frame on the heaviest workload for a doubling, against a per-contour
 * term of three and a half -- and it only ever made the artefact rarer. Keeping
 * the grain field able to open a pressed core removed it instead, by making the
 * shared edges short in the first place, and that change improves the picture
 * rather than merely hiding a flaw in it.
 *
 * Forty-eight is the balance: large enough that the per-call overhead is a small
 * share of the work, small enough that the quadratic term never matters.
 */
const STAMP_FILL_BATCH = 48;

/**
 * Paints one Pencil stamp stream.
 *
 * Every run is painted at one alpha, and runs do not overlap, so the deposited
 * tone is exactly the brush's own opacity wherever graphite landed and nowhere
 * darker. Where a stroke crosses *itself* the crossing does darken, which is
 * both what graphite does and what `pressure-pen@1` already does between bands.
 *
 * The inherited alpha is read rather than multiplied into, for the same reason
 * a band's is: the geometry's alpha already carries the brush's opacity, and
 * multiplying again would apply it twice.
 */
export function drawStamps(
  context: CanvasRenderingContext2D,
  geometry: StampsRenderGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  const ribbons = geometry.ribbons;
  const dot = geometry.dot;
  if (ribbons.length === 0 && dot === null) return;
  const inherited = context.globalAlpha;
  context.save();
  context.fillStyle = brush.color;
  context.globalAlpha = inherited * geometry.alpha;
  if (dot !== null) {
    context.beginPath();
    context.arc(dot.center.x, dot.center.y, dot.radius, 0, Math.PI * 2);
    context.fill();
  }
  let batched = 0;
  if (ribbons.length > 0) context.beginPath();
  for (const ribbon of ribbons) {
    const left = ribbon.left;
    const right = ribbon.right;
    if (left.length < 4) continue;
    context.moveTo(left[0] as number, left[1] as number);
    for (let index = 2; index < left.length; index += 2) {
      context.lineTo(left[index] as number, left[index + 1] as number);
    }
    for (let index = right.length - 2; index >= 0; index -= 2) {
      context.lineTo(right[index] as number, right[index + 1] as number);
    }
    context.closePath();
    batched += 1;
    if (batched < STAMP_FILL_BATCH) continue;
    context.fill();
    context.beginPath();
    batched = 0;
  }
  if (batched > 0) context.fill();
  context.restore();
}

/**
 * The half-circle that closes one end of a silhouette.
 *
 * It sweeps backwards through decreasing angles because that is the half of the
 * circle lying beyond the stroke rather than back along it.
 */
function appendCap(
  context: CanvasRenderingContext2D,
  center: Point,
  radius: number,
  from: Point,
): void {
  const angle = Math.atan2(from.y - center.y, from.x - center.x);
  context.arc(center.x, center.y, radius, angle, angle - Math.PI, true);
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
