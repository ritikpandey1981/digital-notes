import type {
  InkObjectView,
  LineObjectView,
  ObjectBounds,
  VectorPageObject,
} from "@folio/document";
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

/** Returns distance to the visible vector outline, with optional future fill support. */
export function distanceToVectorGeometry(point: PagePoint, object: VectorPageObject): number {
  const pivot = {
    x: object.localBounds.x + object.localBounds.width / 2,
    y: object.localBounds.y + object.localBounds.height / 2,
  };
  const local = object.transform.invertPoint(point, pivot);
  let centerlineDistance: number;
  switch (object.type) {
    case "line":
      centerlineDistance = distanceToLine(local, object);
      break;
    case "rectangle": {
      const { x, y, width, height } = object.geometry;
      if (object.style.fillColor !== undefined && insideRect(local, x, y, width, height)) return 0;
      centerlineDistance = distanceToRectangleOutline(local, x, y, width, height);
      break;
    }
    case "ellipse": {
      const { center, radiusX, radiusY } = object.geometry;
      const normalized = Math.hypot((local.x - center.x) / radiusX, (local.y - center.y) / radiusY);
      if (object.style.fillColor !== undefined && normalized <= 1) return 0;
      centerlineDistance = distanceToEllipseOutline(local, center, radiusX, radiusY);
      break;
    }
  }
  return Math.max(0, centerlineDistance * object.transform.scale - object.style.strokeWidth / 2);
}

function distanceToLine(point: Readonly<{ x: number; y: number }>, object: LineObjectView): number {
  return distanceToSegment(
    { ...point, coordinateSpace: "page" },
    object.geometry.start as InkStrokePoint,
    object.geometry.end as InkStrokePoint,
  );
}

function insideRect(
  point: Readonly<{ x: number; y: number }>,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
}

function distanceToRectangleOutline(
  point: Readonly<{ x: number; y: number }>,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  if (insideRect(point, x, y, width, height)) {
    return Math.min(point.x - x, x + width - point.x, point.y - y, y + height - point.y);
  }
  const deltaX = Math.max(x - point.x, 0, point.x - (x + width));
  const deltaY = Math.max(y - point.y, 0, point.y - (y + height));
  return Math.hypot(deltaX, deltaY);
}

function distanceToEllipseOutline(
  point: Readonly<{ x: number; y: number }>,
  center: Readonly<{ x: number; y: number }>,
  radiusX: number,
  radiusY: number,
): number {
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  const normalized = Math.hypot(deltaX / radiusX, deltaY / radiusY);
  if (normalized === 0) return Math.min(radiusX, radiusY);
  const boundaryX = center.x + deltaX / normalized;
  const boundaryY = center.y + deltaY / normalized;
  return Math.hypot(point.x - boundaryX, point.y - boundaryY);
}
