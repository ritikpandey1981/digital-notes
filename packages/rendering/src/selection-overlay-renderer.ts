import { RenderingError } from "./errors";
import { assertRect, freezeRect } from "./internal/geometry";
import { RenderScheduler } from "./render-scheduler";
import type { AnimationFrameAdapter, Rect } from "./types";
import type { Viewport } from "./viewport";

/** Cached document bounds required to draw one selection overlay. */
export interface SelectionOverlayTarget {
  readonly objectId: string;
  readonly bounds: Rect;
}

/** Renderer-owned visual configuration in logical viewport pixels. */
export interface SelectionOverlayStyle {
  readonly outlineColor: string;
  readonly highlightColor: string;
  readonly outlineWidth: number;
  readonly padding: number;
}

/** Construction dependencies for an isolated selection overlay layer. */
export interface SelectionOverlayRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly canvas?: HTMLCanvasElement;
  readonly style?: Partial<SelectionOverlayStyle>;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
}

/** Demand-driven diagnostics for selection overlay rendering. */
export interface SelectionOverlayRendererSnapshot {
  readonly selectedObjectId: string | null;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly hasPendingRender: boolean;
}

const DEFAULT_SELECTION_OVERLAY_STYLE: SelectionOverlayStyle = Object.freeze({
  outlineColor: "#5b7cfa",
  highlightColor: "rgba(91, 124, 250, 0.1)",
  outlineWidth: 2,
  padding: 4,
});

function resolveStyle(style: Partial<SelectionOverlayStyle> = {}): SelectionOverlayStyle {
  const resolved = Object.freeze({ ...DEFAULT_SELECTION_OVERLAY_STYLE, ...style });
  if (
    resolved.outlineColor.trim().length === 0 ||
    resolved.highlightColor.trim().length === 0 ||
    !Number.isFinite(resolved.outlineWidth) ||
    resolved.outlineWidth <= 0 ||
    !Number.isFinite(resolved.padding) ||
    resolved.padding < 0
  ) {
    throw new RenderingError(
      "INVALID_GEOMETRY",
      "Selection overlay style must use colors and finite non-negative dimensions.",
      { style: resolved },
    );
  }
  return resolved;
}

function freezeTarget(target: SelectionOverlayTarget): SelectionOverlayTarget {
  if (target.objectId.trim().length === 0) {
    throw new RenderingError(
      "INVALID_GEOMETRY",
      "A selection overlay target requires an object identifier.",
    );
  }
  assertRect(target.bounds, "selectionOverlay.bounds");
  const bounds = Object.isFrozen(target.bounds) ? target.bounds : freezeRect(target.bounds);
  if (Object.isFrozen(target) && bounds === target.bounds) return target;
  return Object.freeze({ objectId: target.objectId, bounds });
}

function sameTarget(
  first: SelectionOverlayTarget | null,
  second: SelectionOverlayTarget | null,
): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.objectId === second.objectId &&
    first.bounds.x === second.bounds.x &&
    first.bounds.y === second.bounds.y &&
    first.bounds.width === second.bounds.width &&
    first.bounds.height === second.bounds.height
  );
}

function unionRect(first: Rect, second: Rect): Rect {
  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);
  return freezeRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

function intersectsOrTouches(first: Rect, second: Rect): boolean {
  return !(
    first.x + first.width < second.x ||
    second.x + second.width < first.x ||
    first.y + first.height < second.y ||
    second.y + second.height < first.y
  );
}

const MAX_DIRTY_SELECTION_REGIONS = 8;

/**
 * Draws only selection visuals on a dedicated transparent overlay.
 * It accepts cached bounds and never reads or mutates editor/document state.
 */
export class SelectionOverlayRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly style: SelectionOverlayStyle;
  private readonly scheduler: RenderScheduler;
  private target: SelectionOverlayTarget | null = null;
  private readonly dirtyPageRects: Rect[] = [];
  private fullRedraw = false;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private destroyed = false;

  constructor(options: SelectionOverlayRendererOptions) {
    this.context = options.context;
    this.viewport = options.viewport;
    this.canvas = options.canvas;
    this.style = resolveStyle(options.style);
    this.scheduler = new RenderScheduler(() => this.renderFrame(), options.animationFrameAdapter);
    this.updateDiagnostics();
  }

  /** Replaces the visual target, or clears the overlay when target is null. */
  setSelection(target: SelectionOverlayTarget | null): void {
    this.assertActive();
    const next = target === null ? null : freezeTarget(target);
    if (sameTarget(this.target, next)) return;
    if (this.target !== null) this.addDirtyPageRect(this.target.bounds);
    if (next !== null) this.addDirtyPageRect(next.bounds);
    this.target = next;
    this.invalidate();
  }

  /** Requests a full transparent-layer redraw, normally after resize. */
  redraw(): void {
    this.assertActive();
    if (this.fullRedraw) return;
    this.fullRedraw = true;
    this.dirtyPageRects.length = 0;
    this.invalidate();
  }

  /** Immediately flushes pending selection overlay work. */
  forceRender(): void {
    this.assertActive();
    if (!this.fullRedraw && this.dirtyPageRects.length === 0) return;
    this.scheduler.forceRender();
  }

  /** Returns immutable demand-driven rendering diagnostics. */
  snapshot(): SelectionOverlayRendererSnapshot {
    return Object.freeze({
      selectedObjectId: this.target?.objectId ?? null,
      renderCount: this.renderCountValue,
      invalidationCount: this.invalidationCountValue,
      hasPendingRender: this.scheduler.pending,
    });
  }

  /** Cancels pending frames and releases all retained overlay targets. */
  destroy(): void {
    if (this.destroyed) return;
    this.scheduler.destroy();
    this.target = null;
    this.dirtyPageRects.length = 0;
    this.destroyed = true;
    this.updateDiagnostics();
  }

  private invalidate(): void {
    this.invalidationCountValue += 1;
    this.scheduler.requestRender();
    this.updateDiagnostics();
  }

  private addDirtyPageRect(rect: Rect): void {
    if (this.fullRedraw) return;
    let next = Object.isFrozen(rect) ? rect : freezeRect(rect);
    for (let index = this.dirtyPageRects.length - 1; index >= 0; index -= 1) {
      const existing = this.dirtyPageRects[index];
      if (existing === undefined || !intersectsOrTouches(existing, next)) continue;
      next = unionRect(existing, next);
      this.dirtyPageRects.splice(index, 1);
    }
    this.dirtyPageRects.push(next);
    if (this.dirtyPageRects.length > MAX_DIRTY_SELECTION_REGIONS) {
      this.dirtyPageRects.length = 0;
      this.fullRedraw = true;
    }
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
      const padding = this.style.padding + this.style.outlineWidth + 2;
      for (const dirtyPageRect of this.dirtyPageRects) {
        const viewportRect = this.pageRectToViewport(dirtyPageRect);
        context.clearRect(
          viewportRect.x - padding,
          viewportRect.y - padding,
          viewportRect.width + padding * 2,
          viewportRect.height + padding * 2,
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

  private drawTarget(target: SelectionOverlayTarget): void {
    const snapshot = this.viewport.snapshot();
    const context = this.context;
    const padding = this.style.padding / snapshot.camera.zoom;
    const bounds = {
      x: target.bounds.x - padding,
      y: target.bounds.y - padding,
      width: target.bounds.width + padding * 2,
      height: target.bounds.height + padding * 2,
    };
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    context.translate(snapshot.size.width / 2, snapshot.size.height / 2);
    context.scale(snapshot.camera.zoom, snapshot.camera.zoom);
    context.translate(-snapshot.camera.position.x, -snapshot.camera.position.y);
    context.translate(snapshot.pageRect.x, snapshot.pageRect.y);
    context.beginPath();
    context.rect(0, 0, snapshot.pageRect.width, snapshot.pageRect.height);
    context.clip();
    context.fillStyle = this.style.highlightColor;
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.strokeStyle = this.style.outlineColor;
    context.lineWidth = this.style.outlineWidth / snapshot.camera.zoom;
    context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
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
    this.canvas.dataset.selectionState = this.target === null ? "empty" : "selected";
    this.canvas.dataset.selectedObjectId = this.target?.objectId ?? "";
    this.canvas.dataset.selectionRenderCount = String(this.renderCountValue);
    this.canvas.dataset.selectionInvalidationCount = String(this.invalidationCountValue);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("RENDERER_DESTROYED", "Selection overlay renderer is destroyed.");
    }
  }
}
