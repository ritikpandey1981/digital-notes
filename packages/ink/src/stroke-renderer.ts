import { RenderScheduler, type Point, type Rect, type Viewport } from "@folio/rendering";
import { InkError } from "./errors";
import {
  createBrushRenderGeometry,
  createLiveBrushEvaluator,
  drawBrushRenderGeometry,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "./internal/brush-render-strategy";
import type { LiveBrushEvaluator, LiveEvaluationSnapshot } from "./internal/brush-geometry";
import { PencilMaterialEvaluator, materialTileRect } from "./internal/pencil-material-strategy";
import { drawStrokePoints } from "./internal/draw-stroke";
import { freezeRect, unionRects } from "./internal/geometry";
import { getStrokeRenderedBounds } from "./rendered-stroke-bounds";
import type { Stroke } from "./stroke";
import type { CommittedPencilMaterial } from "./internal/pencil-material";
import type {
  FinalizedStrokeVisual,
  StrokePoint,
  StrokeRendererOptions,
  StrokeRendererSnapshot,
  StrokeTransform,
  StrokeUpdate,
} from "./types";

interface LiveStrokeState {
  readonly id: string;
  readonly brush: import("./brush-model").ResolvedBrushSnapshot;
  /**
   * The stroke's incremental evaluator, when its strategy has one.
   *
   * Holding it for the life of the gesture is the whole point: geometry behind
   * the settled watermark is computed once and reused every frame after, so a
   * frame costs the open tail rather than the stroke.
   */
  readonly evaluator: LiveBrushEvaluator | null;
  points: ReadonlyArray<StrokePoint>;
  dirtyRect: Rect;
}

interface FinalizedStrokeState {
  readonly id: string;
  readonly stroke: Stroke;
  readonly transform: StrokeTransform;
  readonly geometry: BrushRenderGeometry;
  readonly bounds: Rect;
}

function freezeTranslation(translation: Point): Point {
  if (!Number.isFinite(translation.x) || !Number.isFinite(translation.y)) {
    throw new InkError("INVALID_STROKE", "Stroke translation must contain finite coordinates.");
  }
  return Object.freeze({ x: translation.x, y: translation.y });
}

function freezeTransform(transform: StrokeTransform): StrokeTransform {
  const translation = freezeTranslation(transform.translation);
  if (
    !Number.isFinite(transform.rotation) ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    throw new InkError(
      "INVALID_STROKE",
      "Stroke rotation must be finite and scale must be positive and finite.",
    );
  }
  return Object.freeze({ translation, rotation: transform.rotation, scale: transform.scale });
}

function createFinalizedStrokeState(
  id: string,
  stroke: Stroke,
  transform: StrokeTransform,
  geometry: BrushRenderGeometry,
): FinalizedStrokeState {
  if (typeof id !== "string" || id.trim().length === 0 || !Object.isFrozen(stroke)) {
    throw new InkError("INVALID_STROKE", "A retained stroke requires identity and immutability.");
  }
  const frozenTransform = freezeTransform(transform);
  return Object.freeze({
    id,
    stroke,
    transform: frozenTransform,
    geometry,
    bounds: getStrokeRenderedBounds(stroke, frozenTransform),
  });
}

export class StrokeRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly onInvalidate: ((dirtyRect: Rect) => void) | undefined;
  private readonly finalizedPresentation: "retained" | "external";
  private readonly onMaterialCommitted:
    ((strokeId: string, material: CommittedPencilMaterial) => void) | undefined;
  private readonly scheduler: RenderScheduler;
  private readonly diagnosedGeometry = new WeakSet<Stroke>();
  private readonly finalizedStrokes: FinalizedStrokeState[] = [];
  private liveStroke: LiveStrokeState | null = null;
  private pendingDirtyRect: Rect | null = null;
  private renderedLivePointCount = 0;
  private finalizedSourcePointCountValue = 0;
  private finalizedFilteredPointCountValue = 0;
  private finalizedSegmentCountValue = 0;
  private pathBuildCountValue = 0;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private lastDirtyRectValue: Rect | null = null;
  private destroyed = false;

  constructor(options: StrokeRendererOptions) {
    this.context = options.context;
    this.viewport = options.viewport;
    this.canvas = options.canvas;
    this.onInvalidate = options.onInvalidate;
    this.finalizedPresentation = options.finalizedPresentation ?? "retained";
    this.onMaterialCommitted = options.onMaterialCommitted;
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
      brush: update.brush,
      evaluator: createLiveBrushEvaluator(update.brush, 1, update.strokeId),
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

  finalizeStroke(stroke: Stroke, translation: Point = { x: 0, y: 0 }, visualId = stroke.id): void {
    this.assertActive();
    if (this.finalizedStrokes.some(({ id }) => id === visualId)) {
      throw new InkError("INVALID_STROKE", "A finalized stroke visual ID already exists.", {
        visualId,
      });
    }
    // Settle the live material against the finalized samples and hand it over
    // before the evaluator is dropped: what the artist watched being deposited
    // is exactly what the cache keeps.
    const live = this.liveStroke;
    if (
      live !== null &&
      live.id === stroke.id &&
      live.evaluator instanceof PencilMaterialEvaluator
    ) {
      live.evaluator.append(stroke.points, true);
      this.onMaterialCommitted?.(stroke.id, live.evaluator.commit());
    }
    const geometry = this.resolveGeometry(stroke, 1);
    const finalized = createFinalizedStrokeState(
      visualId,
      stroke,
      {
        translation,
        rotation: 0,
        scale: 1,
      },
      geometry,
    );
    if (this.liveStroke !== null && this.liveStroke.id === stroke.id) {
      this.finalizedStrokes.push(finalized);
      this.addPathDiagnostics(geometry);
      this.liveStroke = null;
      this.pendingDirtyRect = null;
      this.renderedLivePointCount = 0;
      // Replace the immediate incremental preview with the cached finalized curve once.
      this.redraw();
    } else {
      this.finalizedStrokes.push(finalized);
      this.addPathDiagnostics(geometry);
      this.redraw();
    }
    this.updateCanvasDiagnostics();
  }

  /** Updates one permanent stroke's absolute page translation and redraws only affected bounds. */
  setStrokeTranslation(strokeId: string, translation: Point): boolean {
    this.assertActive();
    const index = this.finalizedStrokes.findIndex(({ id }) => id === strokeId);
    const current = this.finalizedStrokes[index];
    if (current === undefined) return false;
    if (
      current.transform.translation.x === translation.x &&
      current.transform.translation.y === translation.y
    ) {
      return false;
    }
    return this.setStrokeTransform(strokeId, {
      translation,
      rotation: current.transform.rotation,
      scale: current.transform.scale,
    });
  }

  /** Updates one permanent stroke's complete absolute transform. */
  setStrokeTransform(strokeId: string, transform: StrokeTransform): boolean {
    this.assertActive();
    const index = this.finalizedStrokes.findIndex(({ id }) => id === strokeId);
    const current = this.finalizedStrokes[index];
    if (current === undefined) return false;
    if (
      current.transform.translation.x === transform.translation.x &&
      current.transform.translation.y === transform.translation.y &&
      current.transform.rotation === transform.rotation &&
      current.transform.scale === transform.scale
    ) {
      return false;
    }
    const next = createFinalizedStrokeState(
      current.id,
      current.stroke,
      transform,
      current.transform.scale === transform.scale
        ? current.geometry
        : this.resolveGeometry(current.stroke, transform.scale),
    );
    this.finalizedStrokes[index] = next;
    const affected = unionRects(current.bounds, next.bounds);
    this.recordInvalidation(affected);
    this.clearAndRedrawRegion(affected);
    return true;
  }

  /** Replaces retained visuals from one immutable editor-document projection. */
  replaceFinalizedStrokes(visuals: readonly FinalizedStrokeVisual[]): boolean {
    this.assertActive();
    if (!Array.isArray(visuals)) {
      throw new InkError("INVALID_STROKE", "Finalized stroke visuals must be an array.");
    }
    const ids = new Set<string>();
    const next = visuals.map((visual) => {
      if (visual === null || typeof visual !== "object" || ids.has(visual.id)) {
        throw new InkError("INVALID_STROKE", "Finalized stroke visual identities must be unique.");
      }
      ids.add(visual.id);
      return createFinalizedStrokeState(
        visual.id,
        visual.stroke,
        visual.transform,
        this.resolveGeometry(visual.stroke, visual.transform.scale),
      );
    });
    const unchanged =
      next.length === this.finalizedStrokes.length &&
      next.every((state, index) => {
        const current = this.finalizedStrokes[index];
        return (
          current !== undefined &&
          current.id === state.id &&
          current.stroke === state.stroke &&
          current.transform.translation.x === state.transform.translation.x &&
          current.transform.translation.y === state.transform.translation.y &&
          current.transform.rotation === state.transform.rotation &&
          current.transform.scale === state.transform.scale
        );
      });
    if (unchanged) return false;
    this.finalizedStrokes.splice(0, this.finalizedStrokes.length, ...next);
    this.refreshPathDiagnostics();
    this.redraw();
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
      if (this.finalizedPresentation === "retained") {
        for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
      }
      if (this.liveStroke !== null) {
        this.drawLiveStroke(this.liveStroke);
        this.renderedLivePointCount = this.liveStroke.points.length;
      }
    });
    this.renderCountValue += 1;
    this.pendingDirtyRect = null;
    this.updateCanvasDiagnostics();
  }

  /**
   * How the active stroke's incremental evaluator is doing, or null when its
   * strategy has none. The counters are what make "the tail, not the stroke"
   * an assertion rather than a claim.
   */
  liveEvaluationSnapshot(): LiveEvaluationSnapshot | null {
    return this.liveStroke?.evaluator?.evaluationSnapshot() ?? null;
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
    this.finalizedSourcePointCountValue = 0;
    this.finalizedFilteredPointCountValue = 0;
    this.finalizedSegmentCountValue = 0;
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
  }

  private renderIncrementalFrame(): void {
    if (this.destroyed || this.liveStroke === null || this.pendingDirtyRect === null) return;
    const evaluator = this.liveStroke.evaluator;
    if (evaluator instanceof PencilMaterialEvaluator) {
      this.renderMaterialFrame(this.liveStroke, evaluator);
      return;
    }
    if (evaluator !== null) {
      // Only the samples this frame added are evaluated; everything settled is
      // already in the evaluator's geometry and is never rebuilt.
      evaluator.append(this.liveStroke.points, false);
      const geometry = evaluator.geometry();
      const affected = unionRects(this.liveStroke.dirtyRect, inflateRect(geometry.bounds, 2));
      this.liveStroke.dirtyRect = affected;
      this.recordInvalidation(affected);
      this.pendingDirtyRect = null;
      this.renderedLivePointCount = this.liveStroke.points.length;
      this.clearAndRedrawRegion(affected, true, geometry);
      return;
    }
    if (requiresFullGeometry(this.liveStroke.brush)) {
      const geometry = createBrushRenderGeometry(
        this.liveStroke.points,
        this.liveStroke.brush,
        1,
        this.liveStroke.id,
      );
      const affected = unionRects(this.liveStroke.dirtyRect, inflateRect(geometry.bounds, 2));
      this.liveStroke.dirtyRect = affected;
      this.recordInvalidation(affected);
      this.pendingDirtyRect = null;
      this.renderedLivePointCount = this.liveStroke.points.length;
      this.clearAndRedrawRegion(affected, true, geometry);
      return;
    }
    const startIndex = this.renderedLivePointCount === 0 ? 0 : this.renderedLivePointCount - 1;
    this.withPageTransform(this.pendingDirtyRect, () => {
      this.drawPoints(this.liveStroke?.points ?? [], this.liveStroke?.brush, startIndex);
    });
    this.renderedLivePointCount = this.liveStroke.points.length;
    this.pendingDirtyRect = null;
    this.renderCountValue += 1;
    this.updateCanvasDiagnostics();
  }

  /**
   * One frame of a deposited medium: repaint the tiles that changed, and no
   * others.
   *
   * This is the difference between an incremental *evaluator* and an
   * incremental *repaint*, and only the second one bounds a frame. The other
   * strategies rebuild their geometry cheaply and repaint the whole mark, which
   * is affordable because a contour is cheap to re-emit; a deposited medium is
   * pixels, and repainting the whole of a long stroke every frame would cost
   * more the longer the artist drew.
   *
   * The accumulator already knows exactly which tiles its last append touched --
   * the settled dabs it added, plus the provisional tail it rolled back -- so a
   * frame clears and redraws those and leaves the rest of the mark alone. The
   * cumulative rectangle is still tracked, because cancelling a stroke has to
   * erase all of it at once.
   */
  private renderMaterialFrame(state: LiveStrokeState, evaluator: PencilMaterialEvaluator): void {
    evaluator.append(state.points, false);
    const dirty = evaluator.dirtyTiles;
    this.pendingDirtyRect = null;
    this.renderedLivePointCount = state.points.length;
    if (dirty.size === 0) return;
    const geometry = evaluator.geometry();
    let affected: Rect | null = null;
    for (const key of dirty) affected = unionRects(affected, materialTileRect(key));
    if (affected === null) return;
    state.dirtyRect = unionRects(state.dirtyRect, affected);
    this.recordInvalidation(affected);

    const context = this.context;
    const snapshot = this.viewport.snapshot();
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    for (const key of dirty) {
      const viewportRect = this.pageRectToViewport(materialTileRect(key));
      context.clearRect(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
    }
    context.restore();

    this.withPageTransform(affected, () => {
      if (this.finalizedPresentation === "retained") {
        for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
      }
      // A live accumulator supplies its own tiles, so no runtime cache is
      // consulted and nothing can be missing.
      drawBrushRenderGeometry(this.context, geometry, state.brush, {
        materialRuntime: null,
        tiles: dirty,
      });
    });
    this.renderCountValue += 1;
    this.updateCanvasDiagnostics();
  }

  /** The tiles the live material changed on its last frame, for the integration tests. */
  liveMaterialDirtyTiles(): readonly string[] {
    const evaluator = this.liveStroke?.evaluator;
    return evaluator instanceof PencilMaterialEvaluator ? [...evaluator.dirtyTiles] : [];
  }

  private clearAndRedrawRegion(
    dirtyRect: Rect,
    includeLiveStroke = false,
    liveGeometry?: BrushRenderGeometry,
  ): void {
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
      if (this.finalizedPresentation === "retained") {
        for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
      }
      if (includeLiveStroke && this.liveStroke !== null) {
        if (liveGeometry === undefined) this.drawLiveStroke(this.liveStroke);
        else drawBrushRenderGeometry(this.context, liveGeometry, this.liveStroke.brush);
      }
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
    brush: import("./brush-model").ResolvedBrushSnapshot | undefined,
    startIndex: number,
  ): void {
    if (brush === undefined || points.length === 0) return;
    drawStrokePoints(this.context, points, brush, startIndex);
  }

  private drawLiveStroke(state: LiveStrokeState): void {
    if (state.points.length === 0) return;
    if (state.evaluator !== null) {
      state.evaluator.append(state.points, false);
      drawBrushRenderGeometry(this.context, state.evaluator.geometry(), state.brush);
      return;
    }
    if (!requiresFullGeometry(state.brush)) {
      this.drawPoints(state.points, state.brush, 0);
      return;
    }
    drawBrushRenderGeometry(
      this.context,
      createBrushRenderGeometry(state.points, state.brush, 1, state.id),
      state.brush,
    );
  }

  private drawFinalizedStroke(state: FinalizedStrokeState): void {
    const pivotX = state.stroke.bounds.center.x;
    const pivotY = state.stroke.bounds.center.y;
    this.context.save();
    this.context.translate(state.transform.translation.x, state.transform.translation.y);
    if (state.transform.rotation !== 0 || state.transform.scale !== 1) {
      this.context.translate(pivotX, pivotY);
      if (state.transform.rotation !== 0) this.context.rotate(state.transform.rotation);
      if (state.transform.scale !== 1) {
        this.context.scale(state.transform.scale, state.transform.scale);
      }
      this.context.translate(-pivotX, -pivotY);
    }
    drawBrushRenderGeometry(this.context, state.geometry, state.stroke.brush);
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
    this.canvas.dataset.inkFinalizedPresentation = this.finalizedPresentation;
    this.canvas.dataset.inkPathMode = "adaptive-error-fit-bezier";
    this.canvas.dataset.inkSourcePointCount = String(this.finalizedSourcePointCountValue);
    this.canvas.dataset.inkFilteredPointCount = String(this.finalizedFilteredPointCountValue);
    this.canvas.dataset.inkCurveSegmentCount = String(this.finalizedSegmentCountValue);
    this.canvas.dataset.inkPathBuildCount = String(this.pathBuildCountValue);
    this.canvas.dataset.inkBrushStrategy = this.liveStroke?.brush.renderer.kind ?? "hybrid";
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

  private addPathDiagnostics(geometry: BrushRenderGeometry): void {
    // Every strategy reports the same three counts; only the names it keeps
    // them under differ, because a stroked path has no fitted-curve stage.
    if (geometry.kind === "stroked-path") {
      this.finalizedSourcePointCountValue += geometry.sourcePointCount;
      this.finalizedFilteredPointCountValue += geometry.keptPointCount;
      this.finalizedSegmentCountValue += geometry.segments.length;
      return;
    }
    if (geometry.kind === "filled-path") {
      this.finalizedSourcePointCountValue += geometry.sourcePointCount;
      this.finalizedFilteredPointCountValue += geometry.keptPointCount;
      // A filled silhouette has spans between kept samples rather than fitted
      // curves, and one span is the same unit of work a segment is elsewhere.
      this.finalizedSegmentCountValue += Math.max(0, geometry.keptPointCount - 1);
      return;
    }
    if (geometry.kind === "material") {
      this.finalizedSourcePointCountValue += geometry.sourcePointCount;
      this.finalizedFilteredPointCountValue += geometry.keptPointCount;
      // A stamped or deposited stroke has no curves at all. Its comparable unit
      // of drawn work is the contact, which is what a repaint actually costs.
      this.finalizedSegmentCountValue += geometry.markCount;
      return;
    }
    const path = geometry.path;
    this.finalizedSourcePointCountValue += path.sourcePointCount;
    this.finalizedFilteredPointCountValue += path.points.length;
    this.finalizedSegmentCountValue += path.segments.length;
  }

  private refreshPathDiagnostics(): void {
    this.finalizedSourcePointCountValue = 0;
    this.finalizedFilteredPointCountValue = 0;
    this.finalizedSegmentCountValue = 0;
    for (const { geometry } of this.finalizedStrokes) this.addPathDiagnostics(geometry);
  }

  private resolveGeometry(stroke: Stroke, renderedScale: number): BrushRenderGeometry {
    if (!this.diagnosedGeometry.has(stroke)) {
      this.diagnosedGeometry.add(stroke);
      this.pathBuildCountValue += 1;
    }
    return resolveStrokeRenderGeometry(stroke, renderedScale);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new InkError("RENDERER_DESTROYED", "The stroke renderer has been destroyed.");
    }
  }
}

/**
 * Whether a live frame must build real geometry rather than extend the canvas
 * path directly.
 *
 * The direct path in `draw-stroke` is `centerline@1`'s own incremental
 * painter and produces `centerline@1`'s picture. Only that strategy, and only
 * when it is not smoothing, may use it; every other strategy asks its own
 * geometry builder, which is also what keeps live and committed agreeing.
 */
function requiresFullGeometry(brush: import("./brush-model").ResolvedBrushSnapshot): boolean {
  return (
    brush.renderer.kind !== "centerline" ||
    (brush.smoothing.mode !== "none" && brush.smoothing.amount > 0)
  );
}

function inflateRect(rect: Rect, amount: number): Rect {
  return freezeRect({
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  });
}
