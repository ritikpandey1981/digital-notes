import type { Rect, TranslationPreviewVisual } from "@folio/rendering";
import {
  drawBrushRenderGeometry,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "./internal/brush-render-strategy";
import type { PencilMaterialRuntime } from "./internal/pencil-material";
import { getStrokeLocalRenderBounds } from "./rendered-stroke-bounds";
import type { Stroke } from "./stroke";

/** Immutable, geometry-reusing visual adapter for renderer-owned overlays. */
export interface StrokeVisual extends TranslationPreviewVisual {
  readonly bounds: Rect;
  /**
   * Material this visual wanted and the cache did not have, from its last draw.
   *
   * Empty for every strategy that describes itself completely. A deposited
   * medium reports here instead of approximating, so the caller can ask the
   * runtime to reconstruct exactly these tiles and repaint when they arrive.
   */
  readonly missingMaterial: readonly string[];
}

class StrokeVisualImplementation implements StrokeVisual {
  readonly bounds: Rect;
  readonly #geometry: BrushRenderGeometry;
  readonly #runtime: PencilMaterialRuntime | null;
  #missing: readonly string[] = [];

  constructor(
    private readonly stroke: Stroke,
    renderedScale: number,
    runtime: PencilMaterialRuntime | null,
  ) {
    this.bounds = getStrokeLocalRenderBounds(stroke, renderedScale);
    this.#geometry = resolveStrokeRenderGeometry(stroke, renderedScale);
    this.#runtime = runtime;
  }

  get missingMaterial(): readonly string[] {
    return this.#missing;
  }

  /** The stroke this visual paints, so a caller can ask for its material. */
  get source(): Stroke {
    return this.stroke;
  }

  draw(context: CanvasRenderingContext2D): void {
    drawBrushRenderGeometry(context, this.#geometry, this.stroke.brush, {
      materialRuntime: this.#runtime,
      onMissing: (keys) => {
        this.#missing = keys;
      },
    });
  }
}

/** Creates a renderer adapter that retains one immutable Stroke reference. */
export function createStrokeVisual(
  stroke: Stroke,
  renderedScale = 1,
  materialRuntime: PencilMaterialRuntime | null = null,
): StrokeVisual {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Stroke visual scale must be positive and finite.");
  }
  return new StrokeVisualImplementation(stroke, renderedScale, materialRuntime);
}
