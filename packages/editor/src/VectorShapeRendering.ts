import {
  InkObject,
  isVectorObject,
  type EllipseGeometry,
  type LineGeometry,
  type ObjectBounds,
  type PageObject,
  type RectangleGeometry,
  type VectorGeometry,
  type VectorObjectType,
  type VectorPageObject,
} from "@folio/document";
import { createStrokeVisual, type Stroke, type StrokeVisual } from "@folio/ink";
import type { OverlayRenderHook, TransformPreviewVisual } from "@folio/rendering";
import type { VectorShapeDraft } from "./VectorShapeCreation";

interface VectorRenderable {
  readonly type: VectorObjectType;
  readonly geometry: VectorGeometry;
  readonly style: VectorPageObject["style"];
  readonly localBounds: ObjectBounds;
}

export interface VectorShapeVisual extends TransformPreviewVisual {
  readonly bounds: ObjectBounds;
}

/** Creates a lightweight immutable visual for creation and manipulation overlays. */
export function createVectorShapeVisual(
  shape: VectorRenderable,
  renderedScale = 1,
): VectorShapeVisual {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Vector preview scale must be positive and finite.");
  }
  return Object.freeze({
    bounds: shape.localBounds,
    draw: (context: CanvasRenderingContext2D) => drawVectorGeometry(context, shape, renderedScale),
  });
}

/** Uses the base renderer's ordered hook seam for finalized immutable vector objects. */
export function createVectorObjectRenderHook(
  getObjects: () => readonly unknown[],
): OverlayRenderHook {
  return (context, input) => {
    const objects = getObjects().filter(isVectorObject);
    if (objects.length === 0) return;
    context.save();
    context.beginPath();
    context.rect(
      input.page.rect.x,
      input.page.rect.y,
      input.page.rect.width,
      input.page.rect.height,
    );
    context.clip();
    context.translate(input.page.rect.x, input.page.rect.y);
    for (const object of objects) drawVectorObject(context, object);
    context.restore();
  };
}

/** Renders every finalized PageObject through one document-ordered compositor. */
export function createPageObjectRenderHook(
  getObjects: () => readonly PageObject[],
  onRenderOrder?: (objectIds: readonly string[]) => void,
): OverlayRenderHook {
  const strokeVisuals = new WeakMap<Stroke, Map<number, StrokeVisual>>();
  return (context, input) => {
    const objects = getObjects();
    if (objects.length === 0) return;
    context.save();
    context.beginPath();
    context.rect(
      input.page.rect.x,
      input.page.rect.y,
      input.page.rect.width,
      input.page.rect.height,
    );
    context.clip();
    context.translate(input.page.rect.x, input.page.rect.y);
    const renderedObjectIds: string[] = [];
    for (const object of objects) {
      if (!object.visible) continue;
      if (object instanceof InkObject) {
        drawInkObject(context, object, resolveStrokeVisual(strokeVisuals, object));
        renderedObjectIds.push(object.id);
      } else if (isVectorObject(object)) {
        drawVectorObject(context, object);
        renderedObjectIds.push(object.id);
      }
    }
    onRenderOrder?.(Object.freeze(renderedObjectIds));
    context.restore();
  };
}

function resolveStrokeVisual(
  visuals: WeakMap<Stroke, Map<number, StrokeVisual>>,
  object: InkObject,
): StrokeVisual {
  let byScale = visuals.get(object.stroke);
  if (byScale === undefined) {
    byScale = new Map<number, StrokeVisual>();
    visuals.set(object.stroke, byScale);
  }
  let visual = byScale.get(object.transform.scale);
  if (visual === undefined) {
    visual = createStrokeVisual(object.stroke, object.transform.scale);
    byScale.set(object.transform.scale, visual);
  }
  return visual;
}

function drawInkObject(
  context: CanvasRenderingContext2D,
  object: InkObject,
  visual: StrokeVisual,
): void {
  const { transform } = object;
  const pivotX = object.stroke.bounds.center.x;
  const pivotY = object.stroke.bounds.center.y;
  context.save();
  context.translate(transform.translation.x, transform.translation.y);
  if (transform.rotation !== 0 || transform.scale !== 1) {
    context.translate(pivotX, pivotY);
    if (transform.rotation !== 0) context.rotate(transform.rotation);
    if (transform.scale !== 1) context.scale(transform.scale, transform.scale);
    context.translate(-pivotX, -pivotY);
  }
  visual.draw(context);
  context.restore();
}

function drawVectorObject(context: CanvasRenderingContext2D, object: VectorPageObject): void {
  const { transform, localBounds } = object;
  const pivotX = localBounds.x + localBounds.width / 2;
  const pivotY = localBounds.y + localBounds.height / 2;
  context.save();
  context.translate(transform.translation.x, transform.translation.y);
  if (transform.rotation !== 0 || transform.scale !== 1) {
    context.translate(pivotX, pivotY);
    if (transform.rotation !== 0) context.rotate(transform.rotation);
    if (transform.scale !== 1) context.scale(transform.scale, transform.scale);
    context.translate(-pivotX, -pivotY);
  }
  drawVectorGeometry(context, object, transform.scale);
  context.restore();
}

function drawVectorGeometry(
  context: CanvasRenderingContext2D,
  shape: VectorRenderable | VectorShapeDraft,
  renderedScale: number,
): void {
  context.save();
  context.lineWidth = shape.style.strokeWidth / renderedScale;
  context.strokeStyle = shape.style.strokeColor.hex;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha *= shape.style.strokeColor.opacity;
  context.beginPath();
  appendVectorGeometryPath(context, shape.type, shape.geometry);
  if (shape.style.fillColor !== undefined) {
    context.save();
    context.fillStyle = shape.style.fillColor.hex;
    context.globalAlpha *= shape.style.fillColor.opacity;
    context.fill();
    context.restore();
  }
  context.stroke();
  context.restore();
}

/** Editor-internal path builder shared by finalized, preview, hover, and selection visuals. */
export function appendVectorGeometryPath(
  context: CanvasRenderingContext2D,
  type: VectorObjectType,
  geometry: VectorGeometry,
): void {
  switch (type) {
    case "line": {
      const line = geometry as LineGeometry;
      context.moveTo(line.start.x, line.start.y);
      context.lineTo(line.end.x, line.end.y);
      return;
    }
    case "rectangle": {
      const rectangle = geometry as RectangleGeometry;
      context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
      return;
    }
    case "ellipse": {
      const ellipse = geometry as EllipseGeometry;
      context.ellipse(
        ellipse.center.x,
        ellipse.center.y,
        ellipse.radiusX,
        ellipse.radiusY,
        0,
        0,
        Math.PI * 2,
      );
    }
  }
}
