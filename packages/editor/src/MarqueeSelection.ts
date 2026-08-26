import type { ObjectBounds, PageObject } from "@folio/document";
import type { Point } from "@folio/rendering";

/** Axis-aligned selection region expressed in one coordinate space. */
export interface MarqueeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Minimum drag distance in screen pixels before a marquee begins. */
export const MARQUEE_ACTIVATION_DISTANCE = 3;

/** Normalizes two corner points into a positive-extent rectangle. */
export function marqueeRectFromPoints(origin: Point, current: Point): MarqueeRect {
  const x = Math.min(origin.x, current.x);
  const y = Math.min(origin.y, current.y);
  return Object.freeze({
    x,
    y,
    width: Math.abs(current.x - origin.x),
    height: Math.abs(current.y - origin.y),
  });
}

/** True once a drag has travelled far enough to be a marquee rather than a click. */
export function marqueeActivated(origin: Point, current: Point): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) >= MARQUEE_ACTIVATION_DISTANCE;
}

function intersects(bounds: ObjectBounds, rect: MarqueeRect): boolean {
  return (
    bounds.x < rect.x + rect.width &&
    rect.x < bounds.x + bounds.width &&
    bounds.y < rect.y + rect.height &&
    rect.y < bounds.y + bounds.height
  );
}

/**
 * Resolves the objects a page-space marquee selects.
 *
 * Selection uses intersection rather than containment so partially covered
 * strokes are reachable, and results keep canonical document order so the
 * primary object stays the top-most member.
 */
export function marqueeSelectedObjects(
  objects: readonly PageObject[],
  rect: MarqueeRect,
  isSelectable: (object: PageObject) => boolean,
): readonly PageObject[] {
  if (rect.width <= 0 && rect.height <= 0) return Object.freeze([]);
  return Object.freeze(
    objects.filter((object) => isSelectable(object) && intersects(object.bounds, rect)),
  );
}
