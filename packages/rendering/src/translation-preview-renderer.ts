import { RenderingError } from "./errors";
import { assertPoint, assertRect, freezePoint, freezeRect } from "./internal/geometry";
import { RenderScheduler } from "./render-scheduler";
import type { AnimationFrameAdapter, Point, Rect } from "./types";
import type { Viewport } from "./viewport";

/** Immutable object-specific visual invoked inside the renderer's page transform. */
export interface TranslationPreviewVisual {
  draw(context: CanvasRenderingContext2D): void;
}

/** Cached geometry and absolute page translation required for one preview. */
export interface TranslationPreviewTarget {
  readonly objectId: string;
  readonly bounds: Rect;
  readonly translation: Point;
  readonly visual: TranslationPreviewVisual;
}

/** Renderer-owned appearance for translated object previews. */
export interface TranslationPreviewStyle {
  readonly opacity: number;
  readonly clearPadding: number;
}

/** Construction dependencies for the isolated translation preview layer. */
export interface TranslationPreviewRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly canvas?: HTMLCanvasElement;
  readonly style?: Partial<TranslationPreviewStyle>;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
}

/** Immutable demand-driven diagnostics for preview rendering. */
export interface TranslationPreviewRendererSnapshot {
  readonly objectId: string | null;
  readonly translation: Point | null;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly hasPendingRender: boolean;
}

const DEFAULT_STYLE: TranslationPreviewStyle = Object.freeze({ opacity: 0.68, clearPadding: 3 });
const MAX_DIRTY_REGIONS = 8;

function resolveStyle(style: Partial<TranslationPreviewStyle> = {}): TranslationPreviewStyle {
  const resolved = Object.freeze({ ...DEFAULT_STYLE, ...style });
  if (
    !Number.isFinite(resolved.opacity) ||
    resolved.opacity <= 0 ||
    resolved.opacity > 1 ||
    !Number.isFinite(resolved.clearPadding) ||
    resolved.clearPadding < 0
  ) {
    throw new RenderingError("INVALID_GEOMETRY", "Translation preview style is invalid.", {
      style: resolved,
    });
  }
  return resolved;
}

function freezeTarget(target: TranslationPreviewTarget): TranslationPreviewTarget {
  if (target.objectId.trim().length === 0 || typeof target.visual.draw !== "function") {
    throw new RenderingError("INVALID_GEOMETRY", "A preview requires identity and a visual.");
  }
  assertRect(target.bounds, "translationPreview.bounds");
  assertPoint(target.translation, "translationPreview.translation");
  return Object.freeze({
    objectId: target.objectId,
    bounds: Object.isFrozen(target.bounds) ? target.bounds : freezeRect(target.bounds),
    translation: Object.isFrozen(target.translation)
      ? target.translation
      : freezePoint(target.translation),
    visual: target.visual,
  });
}

function translatedBounds(target: TranslationPreviewTarget): Rect {
  return freezeRect({
    x: target.bounds.x + target.translation.x,
    y: target.bounds.y + target.translation.y,
    width: target.bounds.width,
    height: target.bounds.height,
  });
}

function sameTarget(
  first: TranslationPreviewTarget | null,
  second: TranslationPreviewTarget | null,
): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.objectId === second.objectId &&
    first.bounds.x === second.bounds.x &&
    first.bounds.y === second.bounds.y &&
    first.bounds.width === second.bounds.width &&
    first.bounds.height === second.bounds.height &&
    first.translation.x === second.translation.x &&
    first.translation.y === second.translation.y &&
    first.visual === second.visual
  );
}

/** Draws one translated object visual on an independently invalidated overlay. */
export class TranslationPreviewRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly style: TranslationPreviewStyle;
  private readonly scheduler: RenderScheduler;
  private readonly dirtyPageRects: Rect[] = [];
  private target: TranslationPreviewTarget | null = null;
  private fullRedraw = false;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private destroyed = false;

  constructor(options: TranslationPreviewRendererOptions) {
    this.context = options.context;
    this.viewport = options.viewport;
    this.canvas = options.canvas;
    this.style = resolveStyle(options.style);
    this.scheduler = new RenderScheduler(() => this.renderFrame(), options.animationFrameAdapter);
    this.updateDiagnostics();
  }

  /** Replaces the preview target or clears the transient visual. */
  setPreview(target: TranslationPreviewTarget | null): void {
    this.assertActive();
    const next = target === null ? null : freezeTarget(target);
    if (sameTarget(this.target, next)) return;
    if (this.target !== null) this.addDirtyRect(translatedBounds(this.target));
    if (next !== null) this.addDirtyRect(translatedBounds(next));
    this.target = next;
    this.invalidate();
  }

  /** Requests a complete transparent-layer redraw after viewport changes. */
  redraw(): void {
    this.assertActive();
    if (this.fullRedraw) return;
    this.fullRedraw = true;
    this.dirtyPageRects.length = 0;
    this.invalidate();
  }

  /** Immediately renders pending work without starting a continuous loop. */
  forceRender(): void {
    this.assertActive();
    if (!this.fullRedraw && this.dirtyPageRects.length === 0) return;
    this.scheduler.forceRender();
  }

  /** Returns immutable preview diagnostics. */
  snapshot(): TranslationPreviewRendererSnapshot {
    return Object.freeze({
      objectId: this.target?.objectId ?? null,
      translation: this.target?.translation ?? null,
      renderCount: this.renderCountValue,
      invalidationCount: this.invalidationCountValue,
      hasPendingRender: this.scheduler.pending,
    });
  }

  /** Cancels frames and releases the cached visual. */
  destroy(): void {
    if (this.destroyed) return;
    this.scheduler.destroy();
    this.target = null;
    this.dirtyPageRects.length = 0;
    this.destroyed = true;
    this.updateDiagnostics();
  }

  private addDirtyRect(rect: Rect): void {
    if (this.fullRedraw) return;
    if (
      this.dirtyPageRects.some(
        (existing) =>
          existing.x === rect.x &&
          existing.y === rect.y &&
          existing.width === rect.width &&
          existing.height === rect.height,
      )
    ) {
      return;
    }
    this.dirtyPageRects.push(rect);
    if (this.dirtyPageRects.length > MAX_DIRTY_REGIONS) {
      this.dirtyPageRects.length = 0;
      this.fullRedraw = true;
    }
  }

  private invalidate(): void {
    this.invalidationCountValue += 1;
    this.scheduler.requestRender();
    this.updateDiagnostics();
  }

  private renderFrame(): void {
    if (this.destroyed || (!this.fullRedraw && this.dirtyPageRects.length === 0)) return;
    const snapshot = this.viewport.snapshot();
    const context = this.context;
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    if (this.fullRedraw) {
      context.clearRect(0, 0, snapshot.size.width, snapshot.size.height);
    } else {
      for (const rect of this.dirtyPageRects) {
        const viewportRect = this.pageRectToViewport(rect);
        context.clearRect(
          viewportRect.x - this.style.clearPadding,
          viewportRect.y - this.style.clearPadding,
          viewportRect.width + this.style.clearPadding * 2,
          viewportRect.height + this.style.clearPadding * 2,
        );
      }
    }
    context.restore();
    if (this.target !== null) this.drawTarget(this.target);
    this.fullRedraw = false;
    this.dirtyPageRects.length = 0;
    this.renderCountValue += 1;
    this.updateDiagnostics();
  }

  private drawTarget(target: TranslationPreviewTarget): void {
    const snapshot = this.viewport.snapshot();
    const context = this.context;
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    context.translate(snapshot.size.width / 2, snapshot.size.height / 2);
    context.scale(snapshot.camera.zoom, snapshot.camera.zoom);
    context.translate(-snapshot.camera.position.x, -snapshot.camera.position.y);
    context.translate(snapshot.pageRect.x, snapshot.pageRect.y);
    context.beginPath();
    context.rect(0, 0, snapshot.pageRect.width, snapshot.pageRect.height);
    context.clip();
    context.globalAlpha = this.style.opacity;
    context.translate(target.translation.x, target.translation.y);
    target.visual.draw(context);
    context.restore();
  }

  private pageRectToViewport(rect: Rect): Rect {
    const snapshot = this.viewport.snapshot();
    const topLeft = this.viewport.worldToViewport({
      x: snapshot.pageRect.x + rect.x,
      y: snapshot.pageRect.y + rect.y,
    });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width * snapshot.camera.zoom,
      height: rect.height * snapshot.camera.zoom,
    };
  }

  private updateDiagnostics(): void {
    if (this.canvas === undefined) return;
    this.canvas.dataset.manipulationPreviewState = this.target === null ? "empty" : "active";
    this.canvas.dataset.manipulationObjectId = this.target?.objectId ?? "";
    this.canvas.dataset.manipulationTranslationX = String(this.target?.translation.x ?? 0);
    this.canvas.dataset.manipulationTranslationY = String(this.target?.translation.y ?? 0);
    this.canvas.dataset.manipulationRenderCount = String(this.renderCountValue);
    this.canvas.dataset.manipulationInvalidationCount = String(this.invalidationCountValue);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("RENDERER_DESTROYED", "Translation preview renderer is destroyed.");
    }
  }
}
