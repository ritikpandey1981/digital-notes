import { RenderingError } from "./errors";
import {
  assertFiniteNumber,
  assertPoint,
  assertRect,
  assertSize,
  freezePoint,
} from "./internal/geometry";
import type { CameraSnapshot, Insets, Point, Rect, Size } from "./types";

export interface CameraOptions {
  readonly position?: Point;
  readonly zoom?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export class Camera {
  static readonly DEFAULT_MIN_ZOOM = 0.25;
  static readonly DEFAULT_MAX_ZOOM = 8;

  readonly minZoom: number;
  readonly maxZoom: number;
  private currentPosition: Point;
  private currentZoom: number;

  constructor(options: CameraOptions = {}) {
    this.minZoom = options.minZoom ?? Camera.DEFAULT_MIN_ZOOM;
    this.maxZoom = options.maxZoom ?? Camera.DEFAULT_MAX_ZOOM;
    this.assertZoomRange();
    this.currentPosition = freezePoint(options.position ?? { x: 0, y: 0 });
    assertPoint(this.currentPosition, "camera.position");
    this.currentZoom = options.zoom ?? 1;
    this.assertZoom(this.currentZoom);
  }

  get position(): Point {
    return this.currentPosition;
  }

  get zoom(): number {
    return this.currentZoom;
  }

  /** Reserved for future rotation support. Phase 6 intentionally fixes rotation at zero. */
  get rotation(): 0 {
    return 0;
  }

  setPosition(position: Point): void {
    assertPoint(position, "camera.position");
    this.currentPosition = freezePoint(position);
  }

  panBy(delta: Point): void {
    assertPoint(delta, "camera.panDelta");
    this.setPosition({
      x: this.currentPosition.x + delta.x,
      y: this.currentPosition.y + delta.y,
    });
  }

  setZoom(zoom: number): void {
    this.assertZoom(zoom);
    this.currentZoom = zoom;
  }

  reset(): void {
    this.currentPosition = freezePoint({ x: 0, y: 0 });
    this.currentZoom = 1;
  }

  centerPage(pageRect: Rect): void {
    assertRect(pageRect, "pageRect");
    this.setPosition({
      x: pageRect.x + pageRect.width / 2,
      y: pageRect.y + pageRect.height / 2,
    });
  }

  fitPage(pageRect: Rect, viewportSize: Size, padding: Insets): number {
    assertRect(pageRect, "pageRect");
    assertSize(viewportSize, "viewportSize");
    const availableWidth = viewportSize.width - padding.left - padding.right;
    const availableHeight = viewportSize.height - padding.top - padding.bottom;
    if (availableWidth <= 0 || availableHeight <= 0) {
      this.centerPage(pageRect);
      this.setZoom(this.minZoom);
      return this.currentZoom;
    }

    const zoom = Math.min(availableWidth / pageRect.width, availableHeight / pageRect.height);
    this.centerPage(pageRect);
    this.setZoom(Math.min(this.maxZoom, Math.max(this.minZoom, zoom)));
    return this.currentZoom;
  }

  fitWidth(pageRect: Rect, viewportSize: Size, padding: Insets): number {
    assertRect(pageRect, "pageRect");
    assertSize(viewportSize, "viewportSize");
    const availableWidth = viewportSize.width - padding.left - padding.right;
    const zoom =
      availableWidth <= 0
        ? this.minZoom
        : Math.min(this.maxZoom, Math.max(this.minZoom, availableWidth / pageRect.width));
    this.setZoom(zoom);
    this.setPosition({
      x: pageRect.x + pageRect.width / 2,
      y: pageRect.y + (viewportSize.height / 2 - padding.top) / zoom,
    });
    return this.currentZoom;
  }

  snapshot(): CameraSnapshot {
    return Object.freeze({
      position: freezePoint(this.currentPosition),
      zoom: this.currentZoom,
      rotation: 0,
    });
  }

  private assertZoomRange(): void {
    assertFiniteNumber(this.minZoom, "camera.minZoom");
    assertFiniteNumber(this.maxZoom, "camera.maxZoom");
    if (this.minZoom <= 0 || this.maxZoom < this.minZoom) {
      throw new RenderingError("INVALID_ZOOM", "Camera zoom limits must be positive and ordered.", {
        minZoom: this.minZoom,
        maxZoom: this.maxZoom,
      });
    }
  }

  private assertZoom(zoom: number): void {
    assertFiniteNumber(zoom, "camera.zoom");
    if (zoom < this.minZoom || zoom > this.maxZoom) {
      throw new RenderingError(
        "INVALID_ZOOM",
        `Zoom must be between ${this.minZoom} and ${this.maxZoom}.`,
        { zoom, minZoom: this.minZoom, maxZoom: this.maxZoom },
      );
    }
  }
}
