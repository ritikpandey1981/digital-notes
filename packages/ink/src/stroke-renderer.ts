import { RenderScheduler, type Point, type Rect, type Viewport } from "@folio/rendering";
import { InkError } from "./errors";
import { drawSmoothStrokeSegments, drawStrokePoints } from "./internal/draw-stroke";
import { freezeRect, unionRects } from "./internal/geometry";
import {
  createProfessionalInkPath,
  type ProfessionalInkPath,
} from "./internal/professional-ink-path";
import type { Stroke } from "./stroke";
import type {
  FinalizedStrokeVisual,
  StrokePoint,
  StrokeRendererOptions,
  StrokeRendererSnapshot,
  StrokeStyle,
  StrokeTransform,
  StrokeUpdate,
} from "./types";

interface LiveStrokeState {
  readonly id: string;
  readonly style: StrokeStyle;
  points: ReadonlyArray<StrokePoint>;
  dirtyRect: Rect;
}

interface FinalizedStrokeState {
  readonly id: string;
  readonly stroke: Stroke;
  readonly transform: StrokeTransform;
  readonly renderedStyle: StrokeStyle;
  readonly path: ProfessionalInkPath;
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

function transformedBounds(stroke: Stroke, transform: StrokeTransform): Rect {
  const bounds = stroke.bounds;
  const inflatedBounds = stroke.inflatedBounds;
  const strokePadding = Math.max(
    bounds.x - inflatedBounds.x,
    bounds.y - inflatedBounds.y,
    inflatedBounds.x + inflatedBounds.width - (bounds.x + bounds.width),
    inflatedBounds.y + inflatedBounds.height - (bounds.y + bounds.height),
  );
  const cosine = Math.abs(Math.cos(transform.rotation));
  const sine = Math.abs(Math.sin(transform.rotation));
  const width =
    transform.scale * (bounds.width * cosine + bounds.height * sine) + strokePadding * 2;
  const height =
    transform.scale * (bounds.width * sine + bounds.height * cosine) + strokePadding * 2;
  const centerX = bounds.x + bounds.width / 2 + transform.translation.x;
  const centerY = bounds.y + bounds.height / 2 + transform.translation.y;
  return freezeRect({ x: centerX - width / 2, y: centerY - height / 2, width, height });
}

function compensateStrokeWidth(style: StrokeStyle, scale: number): StrokeStyle {
  if (scale === 1) return style;
  return Object.freeze({ ...style, width: style.width / scale });
}

function createFinalizedStrokeState(
  id: string,
  stroke: Stroke,
  transform: StrokeTransform,
  path: ProfessionalInkPath,
): FinalizedStrokeState {
  if (typeof id !== "string" || id.trim().length === 0 || !Object.isFrozen(stroke)) {
    throw new InkError("INVALID_STROKE", "A retained stroke requires identity and immutability.");
  }
  const frozenTransform = freezeTransform(transform);
  return Object.freeze({
    id,
    stroke,
    transform: frozenTransform,
    renderedStyle: compensateStrokeWidth(stroke.style, frozenTransform.scale),
    path,
    bounds: transformedBounds(stroke, frozenTransform),
  });
}

export class StrokeRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly onInvalidate: ((dirtyRect: Rect) => void) | undefined;
  private readonly finalizedPresentation: "retained" | "external";
  private readonly scheduler: RenderScheduler;
  private readonly pathCache = new WeakMap<Stroke, ProfessionalInkPath>();
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

  finalizeStroke(stroke: Stroke, translation: Point = { x: 0, y: 0 }, visualId = stroke.id): void {
    this.assertActive();
    if (this.finalizedStrokes.some(({ id }) => id === visualId)) {
      throw new InkError("INVALID_STROKE", "A finalized stroke visual ID already exists.", {
        visualId,
      });
    }
    const path = this.resolvePath(stroke);
    const finalized = createFinalizedStrokeState(
      visualId,
      stroke,
      {
        translation,
        rotation: 0,
        scale: 1,
      },
      path,
    );
    if (this.liveStroke !== null && this.liveStroke.id === stroke.id) {
      this.finalizedStrokes.push(finalized);
      this.addPathDiagnostics(path);
      this.liveStroke = null;
      this.pendingDirtyRect = null;
      this.renderedLivePointCount = 0;
      // Replace the immediate incremental preview with the cached finalized curve once.
      this.redraw();
    } else {
      this.finalizedStrokes.push(finalized);
      this.addPathDiagnostics(path);
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
    const next = createFinalizedStrokeState(current.id, current.stroke, transform, current.path);
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
        this.resolvePath(visual.stroke),
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
      if (this.finalizedPresentation === "retained") {
        for (const stroke of this.finalizedStrokes) this.drawFinalizedStroke(stroke);
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
    style: StrokeStyle | undefined,
    startIndex: number,
  ): void {
    if (style === undefined || points.length === 0) return;
    drawStrokePoints(this.context, points, style, startIndex);
  }

  private drawFinalizedStroke(state: FinalizedStrokeState): void {
    const bounds = state.stroke.inflatedBounds;
    const pivotX = bounds.x + bounds.width / 2;
    const pivotY = bounds.y + bounds.height / 2;
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
    drawSmoothStrokeSegments(
      this.context,
      state.path.points,
      state.path.segments,
      state.renderedStyle,
    );
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

  private addPathDiagnostics(path: ProfessionalInkPath): void {
    this.finalizedSourcePointCountValue += path.sourcePointCount;
    this.finalizedFilteredPointCountValue += path.points.length;
    this.finalizedSegmentCountValue += path.segments.length;
  }

  private refreshPathDiagnostics(): void {
    this.finalizedSourcePointCountValue = 0;
    this.finalizedFilteredPointCountValue = 0;
    this.finalizedSegmentCountValue = 0;
    for (const { path } of this.finalizedStrokes) this.addPathDiagnostics(path);
  }

  private resolvePath(stroke: Stroke): ProfessionalInkPath {
    const cached = this.pathCache.get(stroke);
    if (cached !== undefined) return cached;
    const path = createProfessionalInkPath(stroke.points);
    this.pathCache.set(stroke, path);
    this.pathBuildCountValue += 1;
    return path;
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new InkError("RENDERER_DESTROYED", "The stroke renderer has been destroyed.");
    }
  }
}
