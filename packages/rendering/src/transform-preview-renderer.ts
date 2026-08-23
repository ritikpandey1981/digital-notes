import { RenderingError } from "./errors";
import { assertPoint, assertRect, freezePoint, freezeRect } from "./internal/geometry";
import { RenderScheduler } from "./render-scheduler";
import type { AnimationFrameAdapter, Point, Rect } from "./types";
import type { Viewport } from "./viewport";

export interface TransformPreviewVisual {
  draw(context: CanvasRenderingContext2D): void;
}

export interface TransformPreviewValue {
  readonly translation: Point;
  readonly rotation: number;
  readonly scale: number;
}

export interface TransformPreviewTarget {
  readonly objectId: string;
  readonly bounds: Rect;
  readonly transform: TransformPreviewValue;
  readonly visual: TransformPreviewVisual;
}

export interface TransformPreviewStyle {
  readonly opacity: number;
  readonly clearPadding: number;
}

export interface TransformPreviewRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly canvas?: HTMLCanvasElement;
  readonly style?: Partial<TransformPreviewStyle>;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
}

export interface TransformPreviewRendererSnapshot {
  readonly objectId: string | null;
  readonly transform: TransformPreviewValue | null;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly hasPendingRender: boolean;
}

const DEFAULT_STYLE: TransformPreviewStyle = Object.freeze({ opacity: 0.68, clearPadding: 3 });
const MAX_DIRTY_REGIONS = 8;

function resolveStyle(style: Partial<TransformPreviewStyle> = {}): TransformPreviewStyle {
  const resolved = Object.freeze({ ...DEFAULT_STYLE, ...style });
  if (
    !Number.isFinite(resolved.opacity) ||
    resolved.opacity <= 0 ||
    resolved.opacity > 1 ||
    !Number.isFinite(resolved.clearPadding) ||
    resolved.clearPadding < 0
  ) {
    throw new RenderingError("INVALID_GEOMETRY", "Transform preview style is invalid.", {
      style: resolved,
    });
  }
  return resolved;
}

function freezeTransform(transform: TransformPreviewValue): TransformPreviewValue {
  assertPoint(transform.translation, "transformPreview.translation");
  if (
    !Number.isFinite(transform.rotation) ||
    !Number.isFinite(transform.scale) ||
    transform.scale <= 0
  ) {
    throw new RenderingError(
      "INVALID_GEOMETRY",
      "A transform preview requires finite rotation and positive finite scale.",
    );
  }
  const translation = Object.isFrozen(transform.translation)
    ? transform.translation
    : freezePoint(transform.translation);
  if (Object.isFrozen(transform) && transform.translation === translation) return transform;
  return Object.freeze({ translation, rotation: transform.rotation, scale: transform.scale });
}

function freezeTarget(target: TransformPreviewTarget): TransformPreviewTarget {
  if (target.objectId.trim().length === 0 || typeof target.visual.draw !== "function") {
    throw new RenderingError("INVALID_GEOMETRY", "A preview requires identity and a visual.");
  }
  assertRect(target.bounds, "transformPreview.bounds");
  return Object.freeze({
    objectId: target.objectId,
    bounds: Object.isFrozen(target.bounds) ? target.bounds : freezeRect(target.bounds),
    transform: freezeTransform(target.transform),
    visual: target.visual,
  });
}

function transformedBounds(target: TransformPreviewTarget): Rect {
  const { bounds, transform } = target;
  const cosine = Math.abs(Math.cos(transform.rotation));
  const sine = Math.abs(Math.sin(transform.rotation));
  const width = transform.scale * (bounds.width * cosine + bounds.height * sine);
  const height = transform.scale * (bounds.width * sine + bounds.height * cosine);
  const centerX = bounds.x + bounds.width / 2 + transform.translation.x;
  const centerY = bounds.y + bounds.height / 2 + transform.translation.y;
  return freezeRect({ x: centerX - width / 2, y: centerY - height / 2, width, height });
}

function sameTarget(
  first: TransformPreviewTarget | null,
  second: TransformPreviewTarget | null,
): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.objectId === second.objectId &&
    first.bounds.x === second.bounds.x &&
    first.bounds.y === second.bounds.y &&
    first.bounds.width === second.bounds.width &&
    first.bounds.height === second.bounds.height &&
    first.transform.translation.x === second.transform.translation.x &&
    first.transform.translation.y === second.transform.translation.y &&
    first.transform.rotation === second.transform.rotation &&
    first.transform.scale === second.transform.scale &&
    first.visual === second.visual
  );
}

/** Demand-driven preview for one translated, rotated, and uniformly scaled visual. */
export class TransformPreviewRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly style: TransformPreviewStyle;
  private readonly scheduler: RenderScheduler;
  private readonly dirtyPageRects: Rect[] = [];
  private target: TransformPreviewTarget | null = null;
  private fullRedraw = false;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private destroyed = false;

  constructor(options: TransformPreviewRendererOptions) {
    this.context = options.context;
    this.viewport = options.viewport;
    this.canvas = options.canvas;
    this.style = resolveStyle(options.style);
    this.scheduler = new RenderScheduler(() => this.renderFrame(), options.animationFrameAdapter);
    this.updateDiagnostics();
  }

  setPreview(target: TransformPreviewTarget | null): void {
    this.assertActive();
    const next = target === null ? null : freezeTarget(target);
    if (sameTarget(this.target, next)) return;
    if (next === null) {
      this.target = null;
      this.fullRedraw = true;
      this.dirtyPageRects.length = 0;
      this.invalidate();
      return;
    }
    if (this.target !== null) this.addDirtyRect(transformedBounds(this.target));
    this.addDirtyRect(transformedBounds(next));
    this.target = next;
    this.invalidate();
  }

  redraw(): void {
    this.assertActive();
    if (this.fullRedraw) return;
    this.fullRedraw = true;
    this.dirtyPageRects.length = 0;
    this.invalidate();
  }

  forceRender(): void {
    this.assertActive();
    if (!this.fullRedraw && this.dirtyPageRects.length === 0) return;
    this.scheduler.forceRender();
  }

  snapshot(): TransformPreviewRendererSnapshot {
    return Object.freeze({
      objectId: this.target?.objectId ?? null,
      transform: this.target?.transform ?? null,
      renderCount: this.renderCountValue,
      invalidationCount: this.invalidationCountValue,
      hasPendingRender: this.scheduler.pending,
    });
  }

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

  private drawTarget(target: TransformPreviewTarget): void {
    const snapshot = this.viewport.snapshot();
    const context = this.context;
    const pivotX = target.bounds.x + target.bounds.width / 2;
    const pivotY = target.bounds.y + target.bounds.height / 2;
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
    context.translate(target.transform.translation.x, target.transform.translation.y);
    if (target.transform.rotation !== 0 || target.transform.scale !== 1) {
      context.translate(pivotX, pivotY);
      if (target.transform.rotation !== 0) context.rotate(target.transform.rotation);
      if (target.transform.scale !== 1) {
        context.scale(target.transform.scale, target.transform.scale);
      }
      context.translate(-pivotX, -pivotY);
    }
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
    this.canvas.dataset.manipulationTranslationX = String(
      this.target?.transform.translation.x ?? 0,
    );
    this.canvas.dataset.manipulationTranslationY = String(
      this.target?.transform.translation.y ?? 0,
    );
    this.canvas.dataset.manipulationRotation = String(this.target?.transform.rotation ?? 0);
    this.canvas.dataset.manipulationScale = String(this.target?.transform.scale ?? 1);
    this.canvas.dataset.manipulationRenderCount = String(this.renderCountValue);
    this.canvas.dataset.manipulationInvalidationCount = String(this.invalidationCountValue);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("RENDERER_DESTROYED", "Transform preview renderer is destroyed.");
    }
  }
}
