import type { InkObjectView, ObjectBounds } from "@folio/document";
import type { PagePoint } from "../model/coordinates";

type InkStrokePoint = InkObjectView["stroke"]["points"][number];

export function isValidPagePoint(point: PagePoint): boolean {
  return point.coordinateSpace === "page" && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function isWithinExpandedBounds(
  point: PagePoint,
  bounds: ObjectBounds,
  expansion: number,
): boolean {
  return (
    point.x >= bounds.x - expansion &&
    point.x <= bounds.x + bounds.width + expansion &&
    point.y >= bounds.y - expansion &&
    point.y <= bounds.y + bounds.height + expansion
  );
}

function distanceToPoint(point: PagePoint, strokePoint: InkStrokePoint): number {
  return Math.hypot(point.x - strokePoint.x, point.y - strokePoint.y);
}

function distanceToSegment(point: PagePoint, start: InkStrokePoint, end: InkStrokePoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length === 0) return distanceToPoint(point, start);
  const unitX = deltaX / length;
  const unitY = deltaY / length;
  const projection = Math.min(
    length,
    Math.max(0, (point.x - start.x) * unitX + (point.y - start.y) * unitY),
  );
  return Math.hypot(
    point.x - (start.x + projection * unitX),
    point.y - (start.y + projection * unitY),
  );
}

/**
 * Returns distance to the rendered stroke boundary, not merely its centerline.
 * Segment radii mirror the public pressure-width contract used by ink rendering.
 */
export function distanceToInkGeometry(point: PagePoint, object: InkObjectView): number {
  const localBounds = object.stroke.inflatedBounds;
  const localPoint = object.transform.invertPoint(point, {
    x: localBounds.x + localBounds.width / 2,
    y: localBounds.y + localBounds.height / 2,
  });
  const transformedPoint: PagePoint = {
    x: localPoint.x,
    y: localPoint.y,
    coordinateSpace: "page",
  };
  const points = object.stroke.points;
  const first = points[0];
  if (first === undefined) return Number.POSITIVE_INFINITY;
  if (points.length === 1) {
    return (
      Math.max(
        0,
        distanceToPoint(transformedPoint, first) -
          object.stroke.widthAtPressure(first.pressure) / 2,
      ) * object.transform.scale
    );
  }

  let shortestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    const segmentRadius =
      (object.stroke.widthAtPressure(start.pressure) +
        object.stroke.widthAtPressure(end.pressure)) /
      4;
    shortestDistance = Math.min(
      shortestDistance,
      Math.max(0, distanceToSegment(transformedPoint, start, end) - segmentRadius),
    );
  }
  return shortestDistance * object.transform.scale;
}
