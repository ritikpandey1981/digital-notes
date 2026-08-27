import { RenderingError } from "./errors";
import { assertPoint, assertRect, freezePoint, freezeRect } from "./internal/geometry";
import { RenderScheduler } from "./render-scheduler";
import type { AnimationFrameAdapter, Point, Rect } from "./types";
import type { Viewport } from "./viewport";

/** Local geometry that lets one selected object carry an oriented frame. */
export interface SelectionOverlayOrientation {
  /** Tight local bounds of the artwork, before its transform. */
  readonly localBounds: Rect;
  readonly translation: Point;
  readonly rotation: number;
  readonly scale: number;
  /** The point the object rotates about, in the same local space. */
  readonly pivot: Point;
}

/** Cached document bounds required to draw one selection overlay. */
export interface SelectionOverlayTarget {
  readonly objectId: string;
  /** Axis-aligned page bounds, used for invalidation and for group frames. */
  readonly bounds: Rect;
  /**
   * Present for a single transformed object. The frame then follows the
   * object's own orientation instead of boxing its axis-aligned extent.
   */
  readonly orientation?: SelectionOverlayOrientation | undefined;
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

const HANDLE_SIZE_PIXELS = 10;
const ROTATION_HANDLE_OFFSET_PIXELS = 28;

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
  const orientation =
    target.orientation === undefined ? undefined : freezeOrientation(target.orientation);
  if (Object.isFrozen(target) && bounds === target.bounds && orientation === target.orientation) {
    return target;
  }
  return Object.freeze({
    objectId: target.objectId,
    bounds,
    ...(orientation === undefined ? {} : { orientation }),
  });
}

function freezeOrientation(orientation: SelectionOverlayOrientation): SelectionOverlayOrientation {
  assertRect(orientation.localBounds, "selectionOverlay.orientation.localBounds");
  assertPoint(orientation.translation, "selectionOverlay.orientation.translation");
  assertPoint(orientation.pivot, "selectionOverlay.orientation.pivot");
  if (
    !Number.isFinite(orientation.rotation) ||
    !Number.isFinite(orientation.scale) ||
    orientation.scale <= 0
  ) {
    throw new RenderingError(
      "INVALID_GEOMETRY",
      "An oriented selection frame requires finite rotation and positive finite scale.",
      { orientation },
    );
  }
  return Object.freeze({
    localBounds: freezeRect(orientation.localBounds),
    translation: freezePoint(orientation.translation),
    rotation: orientation.rotation,
    scale: orientation.scale,
    pivot: freezePoint(orientation.pivot),
  });
}

function sameOrientation(
  first: SelectionOverlayOrientation | undefined,
  second: SelectionOverlayOrientation | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return (
    first.rotation === second.rotation &&
    first.scale === second.scale &&
    first.translation.x === second.translation.x &&
    first.translation.y === second.translation.y &&
    first.pivot.x === second.pivot.x &&
    first.pivot.y === second.pivot.y &&
    first.localBounds.x === second.localBounds.x &&
    first.localBounds.y === second.localBounds.y &&
    first.localBounds.width === second.localBounds.width &&
    first.localBounds.height === second.localBounds.height
  );
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
    first.bounds.height === second.bounds.height &&
    sameOrientation(first.orientation, second.orientation)
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
 * Page-space frame points for an oriented selection.
 *
 * Padding and the rotation offset are divided by both zoom and scale so the
 * frame keeps one screen-stable thickness whatever the object or camera does.
 */
export function orientedFrameGeometry(
  orientation: SelectionOverlayOrientation,
  paddingPixels: number,
  zoom: number,
): Readonly<{
  corners: readonly Point[];
  topMidpoint: Point;
  rotationHandle: Point;
}> {
  const { localBounds, pivot, rotation, scale, translation } = orientation;
  const padding = paddingPixels / zoom / scale;
  const rotationOffset = ROTATION_HANDLE_OFFSET_PIXELS / zoom / scale;
  const left = localBounds.x - padding;
  const right = localBounds.x + localBounds.width + padding;
  const top = localBounds.y - padding;
  const bottom = localBounds.y + localBounds.height + padding;
  const centerX = (left + right) / 2;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const project = (x: number, y: number): Point => {
    const localX = (x - pivot.x) * scale;
    const localY = (y - pivot.y) * scale;
    return Object.freeze({
      x: pivot.x + translation.x + localX * cosine - localY * sine,
      y: pivot.y + translation.y + localX * sine + localY * cosine,
    });
  };
  return Object.freeze({
    corners: Object.freeze([
      project(left, top),
      project(right, top),
      project(right, bottom),
      project(left, bottom),
    ]),
    topMidpoint: project(centerX, top),
    rotationHandle: project(centerX, top - rotationOffset),
  });
}

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
      const padding =
        this.style.padding +
        this.style.outlineWidth +
        ROTATION_HANDLE_OFFSET_PIXELS +
        HANDLE_SIZE_PIXELS;
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
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    context.translate(snapshot.size.width / 2, snapshot.size.height / 2);
    context.scale(snapshot.camera.zoom, snapshot.camera.zoom);
    context.translate(-snapshot.camera.position.x, -snapshot.camera.position.y);
    context.translate(snapshot.pageRect.x, snapshot.pageRect.y);
    // Deliberately unclipped. Artwork stays clipped to the page by the layers
    // that draw it; selection chrome is how a user drags an object that a page
    // resize pushed off the sheet, so clipping it strands the object instead.
    context.strokeStyle = this.style.outlineColor;
    context.lineWidth = this.style.outlineWidth / snapshot.camera.zoom;
    context.fillStyle = this.style.highlightColor;
    if (target.orientation === undefined) {
      const padding = this.style.padding / snapshot.camera.zoom;
      const bounds = {
        x: target.bounds.x - padding,
        y: target.bounds.y - padding,
        width: target.bounds.width + padding * 2,
        height: target.bounds.height + padding * 2,
      };
      context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      this.drawHandles(bounds, snapshot.camera.zoom);
    } else {
      this.drawOrientedFrame(target.orientation, snapshot.camera.zoom);
    }
    context.restore();
  }

  /** Draws the frame in the object's own orientation, handles included. */
  private drawOrientedFrame(orientation: SelectionOverlayOrientation, zoom: number): void {
    const context = this.context;
    const frame = orientedFrameGeometry(orientation, this.style.padding, zoom);
    const first = frame.corners[0];
    if (first === undefined) return;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const corner of frame.corners.slice(1)) context.lineTo(corner.x, corner.y);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(frame.topMidpoint.x, frame.topMidpoint.y);
    context.lineTo(frame.rotationHandle.x, frame.rotationHandle.y);
    context.stroke();
    const handleSize = HANDLE_SIZE_PIXELS / zoom;
    const halfHandle = handleSize / 2;
    context.fillStyle = "#ffffff";
    for (const corner of frame.corners) {
      context.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
      context.strokeRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
    }
    context.beginPath();
    context.arc(frame.rotationHandle.x, frame.rotationHandle.y, halfHandle, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  private drawHandles(bounds: Rect, zoom: number): void {
    const context = this.context;
    const handleSize = HANDLE_SIZE_PIXELS / zoom;
    const halfHandle = handleSize / 2;
    const rotationOffset = ROTATION_HANDLE_OFFSET_PIXELS / zoom;
    const centerX = bounds.x + bounds.width / 2;
    const rotationY = bounds.y - rotationOffset;
    const corners = [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ];

    context.beginPath();
    context.moveTo(centerX, bounds.y);
    context.lineTo(centerX, rotationY);
    context.stroke();
    context.fillStyle = "#ffffff";
    for (const corner of corners) {
      context.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
      context.strokeRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
    }
    context.beginPath();
    context.arc(centerX, rotationY, halfHandle, 0, Math.PI * 2);
    context.fill();
    context.stroke();
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
    this.canvas.dataset.selectionHandles = this.target === null ? "hidden" : "visible";
    this.canvas.dataset.selectedObjectId = this.target?.objectId ?? "";
    const orientation = this.target?.orientation;
    if (orientation === undefined) {
      this.canvas.dataset.selectionFrameKind = this.target === null ? "empty" : "axis-aligned";
      this.canvas.dataset.selectionFrameCorners = "[]";
      this.canvas.dataset.selectionRotationHandle = "";
    } else {
      const frame = orientedFrameGeometry(
        orientation,
        this.style.padding,
        this.viewport.camera.zoom,
      );
      this.canvas.dataset.selectionFrameKind = "oriented";
      this.canvas.dataset.selectionFrameCorners = JSON.stringify(frame.corners);
      this.canvas.dataset.selectionRotationHandle = JSON.stringify(frame.rotationHandle);
    }
    this.canvas.dataset.selectionRenderCount = String(this.renderCountValue);
    this.canvas.dataset.selectionInvalidationCount = String(this.invalidationCountValue);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("RENDERER_DESTROYED", "Selection overlay renderer is destroyed.");
    }
  }
}
