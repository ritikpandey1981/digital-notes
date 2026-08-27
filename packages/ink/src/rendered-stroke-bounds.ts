import type { Point, Rect } from "@folio/rendering";
import { resolveStrokeRenderGeometry } from "./internal/brush-render-strategy";
import type { Stroke } from "./stroke";
import type { StrokeTransform } from "./types";

const RENDER_PADDING = 2;

/** Conservative local bounds centered on the stable Ink transform pivot. */
export function getStrokeLocalRenderBounds(stroke: Stroke, renderedScale = 1): Rect {
  const geometry = resolveStrokeRenderGeometry(stroke, renderedScale);
  const padding = RENDER_PADDING / renderedScale;
  const actual = inflate(geometry.bounds, padding);
  const pivot = stroke.bounds.center;
  const halfWidth = Math.max(pivot.x - actual.x, actual.x + actual.width - pivot.x, 0);
  const halfHeight = Math.max(pivot.y - actual.y, actual.y + actual.height - pivot.y, 0);
  return freezeRect({
    x: pivot.x - halfWidth,
    y: pivot.y - halfHeight,
    width: halfWidth * 2,
    height: halfHeight * 2,
  });
}

/**
 * Tight local bounds describing only the ink a reader can see.
 *
 * `getStrokeLocalRenderBounds` deliberately overstates: it adds a render
 * padding margin so dirty-rect invalidation never clips a repaint, and it
 * squares the rectangle around the transform pivot so rotation stays stable.
 * Both are correct for repainting and wrong for a selection frame, where the
 * slack reads as a loose box floating around a thin stroke. This is the same
 * geometry without either allowance, and it is presentation-only: nothing
 * about repainting, hit testing, or the document reads it.
 */
export function getStrokeVisualLocalBounds(stroke: Stroke, renderedScale = 1): Rect {
  return freezeRect(resolveStrokeRenderGeometry(stroke, renderedScale).bounds);
}

/** The stable pivot both the render and visual local bounds rotate about. */
export function getStrokeTransformPivot(stroke: Stroke): Point {
  return stroke.bounds.center;
}

/** Bounds actual brush geometry under Folio's scale-compensated Ink transform semantics. */
export function getStrokeRenderedBounds(
  stroke: Stroke,
  transform: StrokeTransform = IDENTITY_TRANSFORM,
): Rect {
  assertTransform(transform);
  const localBounds = getStrokeLocalRenderBounds(stroke, transform.scale);
  const pivot = stroke.bounds.center;
  const corners = [
    transformPoint({ x: localBounds.x, y: localBounds.y }, pivot, transform),
    transformPoint({ x: localBounds.x + localBounds.width, y: localBounds.y }, pivot, transform),
    transformPoint(
      { x: localBounds.x + localBounds.width, y: localBounds.y + localBounds.height },
      pivot,
      transform,
    ),
    transformPoint({ x: localBounds.x, y: localBounds.y + localBounds.height }, pivot, transform),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const minimumX = Math.min(...xs);
  const minimumY = Math.min(...ys);
  const maximumX = Math.max(...xs);
  const maximumY = Math.max(...ys);
  return freezeRect({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  });
}

const IDENTITY_TRANSFORM: StrokeTransform = Object.freeze({
  translation: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
  scale: 1,
});

function transformPoint(point: Point, pivot: Point, transform: StrokeTransform): Point {
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  const localX = (point.x - pivot.x) * transform.scale;
  const localY = (point.y - pivot.y) * transform.scale;
  return Object.freeze({
    x: pivot.x + transform.translation.x + localX * cosine - localY * sine,
    y: pivot.y + transform.translation.y + localX * sine + localY * cosine,
  });
}

function inflate(rect: Rect, amount: number): Rect {
  return freezeRect({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  });
}

function assertTransform(transform: StrokeTransform): void {
  if (
    !Number.isFinite(transform.translation.x) ||
    !Number.isFinite(transform.translation.y) ||
    !Number.isFinite(transform.rotation) ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    throw new RangeError("Stroke render transform must be finite with positive scale.");
  }
}

function freezeRect(rect: Rect): Rect {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError("Rendered stroke bounds must be finite and non-negative.");
  }
  return Object.freeze(rect);
}
