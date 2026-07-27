import type { Point, Rect } from "@folio/rendering";
import { InkError } from "../errors";
import type { StrokeBounds } from "../types";

export const MAX_COORDINATE = 1_000_000_000;

export function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new InkError("INVALID_POINTER_DATA", `${name} must be finite.`, { name, value });
  }
}

export function assertCoordinate(point: Point): void {
  assertFinite(point.x, "point.x");
  assertFinite(point.y, "point.y");
  if (Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
    throw new InkError("INVALID_COORDINATE", "Pointer coordinates exceed supported bounds.", {
      point,
      maximum: MAX_COORDINATE,
    });
  }
}

export function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function freezePoint(point: Point): Point {
  return Object.freeze({ x: point.x, y: point.y });
}

export function freezeRect(rect: Rect): Rect {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

export function createBounds(minX: number, minY: number, maxX: number, maxY: number): StrokeBounds {
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return Object.freeze({
    x: minX,
    y: minY,
    width,
    height,
    center: freezePoint({ x: minX + width / 2, y: minY + height / 2 }),
  });
}

export function inflateBounds(bounds: StrokeBounds, amount: number): StrokeBounds {
  return createBounds(
    bounds.x - amount,
    bounds.y - amount,
    bounds.x + bounds.width + amount,
    bounds.y + bounds.height + amount,
  );
}

export function unionRects(first: Rect | null, second: Rect): Rect {
  if (first === null) return freezeRect(second);
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);
  return freezeRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}
