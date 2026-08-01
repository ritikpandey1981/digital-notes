import type { Rect, TranslationPreviewVisual } from "@folio/rendering";
import { drawSmoothStrokeSegments } from "./internal/draw-stroke";
import { createProfessionalInkPath } from "./internal/professional-ink-path";
import type { Stroke } from "./stroke";
import type { StrokeStyle } from "./types";

/** Immutable, geometry-reusing visual adapter for renderer-owned overlays. */
export interface StrokeVisual extends TranslationPreviewVisual {
  readonly bounds: Rect;
}

class StrokeVisualImplementation implements StrokeVisual {
  readonly bounds: Rect;
  readonly #renderedStyle: StrokeStyle;
  readonly #path: ReturnType<typeof createProfessionalInkPath>;

  constructor(
    private readonly stroke: Stroke,
    renderedScale: number,
  ) {
    this.bounds = stroke.inflatedBounds;
    this.#renderedStyle =
      renderedScale === 1
        ? stroke.style
        : Object.freeze({ ...stroke.style, width: stroke.style.width / renderedScale });
    this.#path = createProfessionalInkPath(stroke.points);
    Object.freeze(this);
  }

  draw(context: CanvasRenderingContext2D): void {
    drawSmoothStrokeSegments(context, this.#path.points, this.#path.segments, this.#renderedStyle);
  }
}

/** Creates a renderer adapter that retains one immutable Stroke reference. */
export function createStrokeVisual(stroke: Stroke, renderedScale = 1): StrokeVisual {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Stroke visual scale must be positive and finite.");
  }
  return new StrokeVisualImplementation(stroke, renderedScale);
}
