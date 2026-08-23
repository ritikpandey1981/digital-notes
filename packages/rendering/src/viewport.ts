import { Camera } from "./camera";
import { RenderingError } from "./errors";
import {
  assertFiniteNumber,
  assertPoint,
  assertRect,
  assertSize,
  freezeRect,
  freezeSize,
} from "./internal/geometry";
import type { Insets, Point, Rect, Size, ViewportSnapshot } from "./types";

/** Screen-space page extent retained at every manual navigation boundary. */
export const MINIMUM_VISIBLE_PAGE_PIXELS = 64;

export interface ViewportOptions {
  readonly size: Size;
  readonly pageRect: Rect;
  readonly devicePixelRatio?: number;
  readonly worldBounds?: Rect;
  readonly camera?: Camera;
}

export class Viewport {
  readonly camera: Camera;
  private currentSize: Size;
  private currentPageRect: Rect;
  private currentDevicePixelRatio: number;
  private currentWorldBounds: Rect;

  constructor(options: ViewportOptions) {
    assertSize(options.size, "viewport.size");
    assertRect(options.pageRect, "viewport.pageRect");
    this.currentSize = freezeSize(options.size);
    this.currentPageRect = freezeRect(options.pageRect);
    this.currentDevicePixelRatio = options.devicePixelRatio ?? 1;
    this.assertDevicePixelRatio(this.currentDevicePixelRatio);
    this.currentWorldBounds = freezeRect(
      options.worldBounds ?? this.createDefaultWorldBounds(options.pageRect),
    );
    assertRect(this.currentWorldBounds, "viewport.worldBounds");
    this.camera = options.camera ?? new Camera();
  }

  get size(): Size {
    return this.currentSize;
  }

  get pageRect(): Rect {
    return this.currentPageRect;
  }

  get devicePixelRatio(): number {
    return this.currentDevicePixelRatio;
  }

  get worldBounds(): Rect {
    return this.currentWorldBounds;
  }

  get visibleWorldRect(): Rect {
    return freezeRect({
      x: this.camera.position.x - this.currentSize.width / 2 / this.camera.zoom,
      y: this.camera.position.y - this.currentSize.height / 2 / this.camera.zoom,
      width: this.currentSize.width / this.camera.zoom,
      height: this.currentSize.height / this.camera.zoom,
    });
  }

  get pageViewportRect(): Rect {
    return freezeRect({
      x:
        (this.currentPageRect.x - this.camera.position.x) * this.camera.zoom +
        this.currentSize.width / 2,
      y:
        (this.currentPageRect.y - this.camera.position.y) * this.camera.zoom +
        this.currentSize.height / 2,
      width: this.currentPageRect.width * this.camera.zoom,
      height: this.currentPageRect.height * this.camera.zoom,
    });
  }

  resize(size: Size, devicePixelRatio = this.currentDevicePixelRatio): void {
    assertSize(size, "viewport.size");
    this.assertDevicePixelRatio(devicePixelRatio);
    this.currentSize = freezeSize(size);
    this.currentDevicePixelRatio = devicePixelRatio;
    this.ensurePageRecoverable();
  }

  setPageRect(pageRect: Rect): void {
    assertRect(pageRect, "viewport.pageRect");
    this.currentPageRect = freezeRect(pageRect);
    this.ensurePageRecoverable();
  }

  setWorldBounds(worldBounds: Rect): void {
    assertRect(worldBounds, "viewport.worldBounds");
    this.currentWorldBounds = freezeRect(worldBounds);
  }

  centerPage(): void {
    this.camera.centerPage(this.currentPageRect);
  }

  fitPage(padding: Insets): number {
    return this.camera.fitPage(this.currentPageRect, this.currentSize, padding);
  }

  fitWidth(padding: Insets): number {
    return this.camera.fitWidth(this.currentPageRect, this.currentSize, padding);
  }

  panBy(delta: Point): void {
    this.camera.panBy(delta);
    this.ensurePageRecoverable();
  }

  zoomAt(zoom: number, viewportAnchor: Point): void {
    assertPoint(viewportAnchor, "viewportAnchor");
    const worldAnchor = this.viewportToWorld(viewportAnchor);
    this.camera.setZoom(zoom);
    const worldAfterZoom = this.viewportToWorld(viewportAnchor);
    this.camera.panBy({
      x: worldAnchor.x - worldAfterZoom.x,
      y: worldAnchor.y - worldAfterZoom.y,
    });
    this.ensurePageRecoverable();
  }

  ensurePageRecoverable(minimumVisiblePixels = MINIMUM_VISIBLE_PAGE_PIXELS): void {
    assertFiniteNumber(minimumVisiblePixels, "minimumVisiblePixels");
    if (minimumVisiblePixels < 0) {
      throw new RenderingError(
        "INVALID_GEOMETRY",
        "Minimum visible page pixels must be non-negative.",
        { minimumVisiblePixels },
      );
    }
    const zoom = this.camera.zoom;
    const horizontalVisiblePixels = Math.min(
      minimumVisiblePixels,
      this.currentSize.width,
      this.currentPageRect.width * zoom,
    );
    const verticalVisiblePixels = Math.min(
      minimumVisiblePixels,
      this.currentSize.height,
      this.currentPageRect.height * zoom,
    );
    const halfWorldWidth = this.currentSize.width / 2 / zoom;
    const halfWorldHeight = this.currentSize.height / 2 / zoom;
    const minimumX = this.currentPageRect.x - halfWorldWidth + horizontalVisiblePixels / zoom;
    const maximumX =
      this.currentPageRect.x +
      this.currentPageRect.width +
      halfWorldWidth -
      horizontalVisiblePixels / zoom;
    const minimumY = this.currentPageRect.y - halfWorldHeight + verticalVisiblePixels / zoom;
    const maximumY =
      this.currentPageRect.y +
      this.currentPageRect.height +
      halfWorldHeight -
      verticalVisiblePixels / zoom;
    this.camera.setPosition({
      x: Math.min(maximumX, Math.max(minimumX, this.camera.position.x)),
      y: Math.min(maximumY, Math.max(minimumY, this.camera.position.y)),
    });
  }

  viewportToWorld(point: Point): Point {
    assertPoint(point);
    return Object.freeze({
      x: this.camera.position.x + (point.x - this.currentSize.width / 2) / this.camera.zoom,
      y: this.camera.position.y + (point.y - this.currentSize.height / 2) / this.camera.zoom,
    });
  }

  worldToViewport(point: Point): Point {
    assertPoint(point);
    return Object.freeze({
      x: (point.x - this.camera.position.x) * this.camera.zoom + this.currentSize.width / 2,
      y: (point.y - this.camera.position.y) * this.camera.zoom + this.currentSize.height / 2,
    });
  }

  snapshot(): ViewportSnapshot {
    return Object.freeze({
      camera: this.camera.snapshot(),
      size: freezeSize(this.currentSize),
      visibleWorldRect: this.visibleWorldRect,
      pageRect: freezeRect(this.currentPageRect),
      pageViewportRect: this.pageViewportRect,
      devicePixelRatio: this.currentDevicePixelRatio,
      worldBounds: freezeRect(this.currentWorldBounds),
    });
  }

  private assertDevicePixelRatio(value: number): void {
    assertFiniteNumber(value, "viewport.devicePixelRatio");
    if (value <= 0) {
      throw new RenderingError("INVALID_DPR", "Device pixel ratio must be positive.", { value });
    }
  }

  private createDefaultWorldBounds(pageRect: Rect): Rect {
    const margin = Math.max(pageRect.width, pageRect.height) * 4;
    return {
      x: pageRect.x - margin,
      y: pageRect.y - margin,
      width: pageRect.width + margin * 2,
      height: pageRect.height + margin * 2,
    };
  }
}
