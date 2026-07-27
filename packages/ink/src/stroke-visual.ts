import type { Rect, TranslationPreviewVisual } from "@folio/rendering";
import { drawStrokePoints } from "./internal/draw-stroke";
import type { Stroke } from "./stroke";

/** Immutable, geometry-reusing visual adapter for renderer-owned overlays. */
export interface StrokeVisual extends TranslationPreviewVisual {
  readonly bounds: Rect;
}

class StrokeVisualImplementation implements StrokeVisual {
  readonly bounds: Rect;

  constructor(private readonly stroke: Stroke) {
    this.bounds = stroke.inflatedBounds;
    Object.freeze(this);
  }

  draw(context: CanvasRenderingContext2D): void {
    drawStrokePoints(context, this.stroke.points, this.stroke.style);
  }
}

/** Creates a renderer adapter that retains one immutable Stroke reference. */
export function createStrokeVisual(stroke: Stroke): StrokeVisual {
  return new StrokeVisualImplementation(stroke);
}
