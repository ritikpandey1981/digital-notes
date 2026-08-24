import type { Rect, TranslationPreviewVisual } from "@folio/rendering";
import {
  drawBrushRenderGeometry,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "./internal/brush-render-strategy";
import { getStrokeLocalRenderBounds } from "./rendered-stroke-bounds";
import type { Stroke } from "./stroke";

/** Immutable, geometry-reusing visual adapter for renderer-owned overlays. */
export interface StrokeVisual extends TranslationPreviewVisual {
  readonly bounds: Rect;
}

class StrokeVisualImplementation implements StrokeVisual {
  readonly bounds: Rect;
  readonly #geometry: BrushRenderGeometry;

  constructor(
    private readonly stroke: Stroke,
    renderedScale: number,
  ) {
    this.bounds = getStrokeLocalRenderBounds(stroke, renderedScale);
    this.#geometry = resolveStrokeRenderGeometry(stroke, renderedScale);
    Object.freeze(this);
  }

  draw(context: CanvasRenderingContext2D): void {
    drawBrushRenderGeometry(context, this.#geometry, this.stroke.brush);
  }
}

/** Creates a renderer adapter that retains one immutable Stroke reference. */
export function createStrokeVisual(stroke: Stroke, renderedScale = 1): StrokeVisual {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Stroke visual scale must be positive and finite.");
  }
  return new StrokeVisualImplementation(stroke, renderedScale);
}
