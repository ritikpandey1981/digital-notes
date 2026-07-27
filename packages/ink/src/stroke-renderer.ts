import { RenderScheduler, type Point, type Rect, type Viewport } from "@folio/rendering";
import { InkError } from "./errors";
import { drawStrokePoints } from "./internal/draw-stroke";
import { freezeRect, unionRects } from "./internal/geometry";
import type { Stroke } from "./stroke";
import type {
  StrokePoint,
  StrokeRendererOptions,
  StrokeRendererSnapshot,
  StrokeStyle,
  StrokeUpdate,
} from "./types";

interface LiveStrokeState {
  readonly id: string;
  readonly style: StrokeStyle;
  points: ReadonlyArray<StrokePoint>;
  dirtyRect: Rect;
}

interface FinalizedStrokeState {
  readonly stroke: Stroke;
  readonly translation: Point;
  readonly bounds: Rect;
}

function freezeTranslation(translation: Point): Point {
  if (!Number.isFinite(translation.x) || !Number.isFinite(translation.y)) {
    throw new InkError("INVALID_STROKE", "Stroke translation must contain finite coordinates.");
  }
  return Object.freeze({ x: translation.x, y: translation.y });
}

function createFinalizedStrokeState(stroke: Stroke, translation: Point): FinalizedStrokeState {
  const frozenTranslation = freezeTranslation(translation);
  return Object.freeze({
    stroke,
    translation: frozenTranslation,
    bounds: freezeRect({
      x: stroke.inflatedBounds.x + frozenTranslation.x,
      y: stroke.inflatedBounds.y + frozenTranslation.y,
      width: stroke.inflatedBounds.width,
      height: stroke.inflatedBounds.height,
    }),
  });
}

export class StrokeRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly onInvalidate: ((dirtyRect: Rect) => void) | undefined;
  private readonly scheduler: RenderScheduler;
  private readonly finalizedStrokes: FinalizedStrokeState[] = [];
  private liveStroke: LiveStrokeState | null = null;
  private pendingDirtyRect: Rect | null = null;
  private renderedLivePointCount = 0;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private lastDirtyRectValue: Rect | null = null;
  private destroyed = false;

  constructor(options: StrokeRendererOptions) {
    this.context = options.context;
    this.viewport = options.viewport;
    this.canvas = options.canvas;
    this.onInvalidate = options.onInvalidate;
    this.scheduler = new RenderScheduler(
      () => this.renderIncrementalFrame(),
      options.animationFrameAdapter,
    );
  }

  beginStroke(update: StrokeUpdate): void {
    this.assertActive();
    if (this.liveStroke !== null) {
      throw new InkError("INVALID_STROKE", "A live stroke is already being rendered.");
    }
    this.liveStroke = {
      id: update.strokeId,
      style: update.style,
      points: update.points,
      dirtyRect: update.dirtyRect,
    };
    this.renderedLivePointCount = 0;
    this.invalidate(update.dirtyRect);
  }

  updateStroke(update: StrokeUpdate): void {
    this.assertActive();
    if (this.liveStroke === null || this.liveStroke.id !== update.strokeId) {
      throw new InkError(
        "NO_ACTIVE_STROKE",
        "The live stroke update has no matching renderer state.",
        {
          strokeId: update.strokeId,
        },
      );
    }
    this.liveStroke.points = update.points;
    this.liveStroke.dirtyRect = unionRects(this.liveStroke.dirtyRect, update.dirtyRect);
    this.invalidate(update.dirtyRect);
  }

  finalizeStroke(stroke: Stroke, translation: Point = { x: 0, y: 0 }): void {
    this.assertActive();
    const finalized = createFinalizedStrokeState(stroke, translation);
    if (this.liveStroke !== null && this.liveStroke.id === stroke.id) {
      // Finalization releases the builder's mutable point buffer. Swap to the
      // immutable stroke points before flushing the final pending segment.
      this.liveStroke.points = stroke.points;
      this.scheduler.forceRender();
      this.finalizedStrokes.push(finalized);
      this.liveStroke = null;
      this.pendingDirtyRect = null;
      this.renderedLivePointCount = 0;
    } else {
      this.finalizedStrokes.push(finalized);
      this.redraw();
    }
    this.updateCanvasDiagnostics();
  }

  /** Updates one permanent stroke's absolute page translation and redraws only affected bounds. */
  setStrokeTranslation(strokeId: string, translation: Point): boolean {
    this.assertActive();
    const index = this.finalizedStrokes.findIndex(({ stroke }) => stroke.id === strokeId);
    const current = this.finalizedStrokes[index];
    if (current === undefined) return false;
    if (current.translation.x === translation.x && current.translation.y === translation.y) {
      return false;
    }
    const next = createFinalizedStrokeState(current.stroke, translation);
    this.finalizedStrokes[index] = next;
    const affected = unionRects(current.bounds, next.bounds);
    this.recordInvalidation(affected);
    this.clearAndRedrawRegion(affected);
    return true;
  }

  cancelStroke(dirtyRect: Rect | null): void {
    this.assertActive();
    this.scheduler.cancelRender();
    const affected = dirtyRect ?? this.liveStroke?.dirtyRect ?? null;
    this.liveStroke = null;
    this.pendingDirtyRect = null;
    this.renderedLivePointCount = 0;
    if (affected !== null) {
      this.recordInvalidation(affected);
      this.clearAndRedrawRegion(affected);
    }
  }

  redraw(): void {
    this.assertActive();
    this.scheduler.cancelRender();
    const { width, height } = this.viewport.size;
    const context = this.context;
    context.save();
    context.setTransform(
      this.viewport.devicePixelRatio,
      0,
      0,
      this.viewport.devicePixelRatio,
      0,
      0,
    );
    context.clearRect(0, 0, width, height);
    context.restore();

    this.withPageTransform(null, () => {
      for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
      if (this.liveStroke !== null) {
        this.drawPoints(this.liveStroke.points, this.liveStroke.style, 0);
        this.renderedLivePointCount = this.liveStroke.points.length;
      }
    });
    this.renderCountValue += 1;
    this.pendingDirtyRect = null;
    this.updateCanvasDiagnostics();
  }

  snapshot(): StrokeRendererSnapshot {
    return Object.freeze({
      finalizedStrokeCount: this.finalizedStrokes.length,
      finalizedPointCount: this.finalizedStrokes.reduce(
        (total, { stroke }) => total + stroke.pointCount,
        0,
      ),
      livePointCount: this.liveStroke?.points.length ?? 0,
      renderCount: this.renderCountValue,
      invalidationCount: this.invalidationCountValue,
      lastDirtyRect: this.lastDirtyRectValue,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.scheduler.destroy();
    this.liveStroke = null;
    this.pendingDirtyRect = null;
    this.finalizedStrokes.length = 0;
    this.destroyed = true;
  }

  private invalidate(dirtyRect: Rect): void {
    this.pendingDirtyRect = unionRects(this.pendingDirtyRect, dirtyRect);
    this.recordInvalidation(dirtyRect);
    this.scheduler.requestRender();
  }

  private recordInvalidation(dirtyRect: Rect): void {
    this.invalidationCountValue += 1;
    this.lastDirtyRectValue = freezeRect(dirtyRect);
    this.onInvalidate?.(this.lastDirtyRectValue);
    this.updateCanvasDiagnostics();
  }

  private renderIncrementalFrame(): void {
    if (this.destroyed || this.liveStroke === null || this.pendingDirtyRect === null) return;
    const startIndex = this.renderedLivePointCount === 0 ? 0 : this.renderedLivePointCount - 1;
    this.withPageTransform(this.pendingDirtyRect, () => {
      this.drawPoints(this.liveStroke?.points ?? [], this.liveStroke?.style, startIndex);
    });
    this.renderedLivePointCount = this.liveStroke.points.length;
    this.pendingDirtyRect = null;
    this.renderCountValue += 1;
    this.updateCanvasDiagnostics();
  }

  private clearAndRedrawRegion(dirtyRect: Rect): void {
    const viewportRect = this.pageRectToViewport(dirtyRect);
    const context = this.context;
    context.save();
    context.setTransform(
      this.viewport.devicePixelRatio,
      0,
      0,
      this.viewport.devicePixelRatio,
      0,
      0,
    );
    context.beginPath();
    context.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
    context.clip();
    context.clearRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
    context.restore();
    this.withPageTransform(dirtyRect, () => {
      for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
    });
    this.renderCountValue += 1;
    this.updateCanvasDiagnostics();
  }

  private withPageTransform(dirtyRect: Rect | null, draw: () => void): void {
    const context = this.context;
    const snapshot = this.viewport.snapshot();
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    if (dirtyRect !== null) {
      const viewportRect = this.pageRectToViewport(dirtyRect);
      context.beginPath();
      context.rect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
      context.clip();
    }
    context.translate(snapshot.size.width / 2, snapshot.size.height / 2);
    context.scale(snapshot.camera.zoom, snapshot.camera.zoom);
    context.translate(-snapshot.camera.position.x, -snapshot.camera.position.y);
    context.translate(snapshot.pageRect.x, snapshot.pageRect.y);
    context.beginPath();
    context.rect(0, 0, snapshot.pageRect.width, snapshot.pageRect.height);
    context.clip();
    draw();
    context.restore();
  }

  private drawPoints(
    points: readonly StrokePoint[],
    style: StrokeStyle | undefined,
    startIndex: number,
  ): void {
    if (style === undefined || points.length === 0) return;
    drawStrokePoints(this.context, points, style, startIndex);
  }

  private drawFinalizedStroke(state: FinalizedStrokeState): void {
    this.context.save();
    this.context.translate(state.translation.x, state.translation.y);
    drawStrokePoints(this.context, state.stroke.points, state.stroke.style);
    this.context.restore();
  }

  private pageRectToViewport(rect: Rect): Rect {
    const snapshot = this.viewport.snapshot();
    const worldTopLeft: Point = {
      x: snapshot.pageRect.x + rect.x,
      y: snapshot.pageRect.y + rect.y,
    };
    const topLeft = this.viewport.worldToViewport(worldTopLeft);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width * snapshot.camera.zoom,
      height: rect.height * snapshot.camera.zoom,
    };
  }

  private updateCanvasDiagnostics(): void {
    if (this.canvas === undefined) return;
    this.canvas.dataset.inkStrokeCount = String(this.finalizedStrokes.length);
    this.canvas.dataset.inkLivePointCount = String(this.liveStroke?.points.length ?? 0);
    this.canvas.dataset.inkRenderCount = String(this.renderCountValue);
    this.canvas.dataset.inkInvalidationCount = String(this.invalidationCountValue);
    if (this.lastDirtyRectValue !== null) {
      this.canvas.dataset.inkDirtyX = String(this.lastDirtyRectValue.x);
      this.canvas.dataset.inkDirtyY = String(this.lastDirtyRectValue.y);
      this.canvas.dataset.inkDirtyWidth = String(this.lastDirtyRectValue.width);
      this.canvas.dataset.inkDirtyHeight = String(this.lastDirtyRectValue.height);
    }
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new InkError("RENDERER_DESTROYED", "The stroke renderer has been destroyed.");
    }
  }
}
