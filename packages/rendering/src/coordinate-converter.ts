import { assertPoint, assertRect, assertSize } from "./internal/geometry";
import type { CanvasBounds, Point } from "./types";
import type { Viewport } from "./viewport";

export class CoordinateConverter {
  constructor(private readonly viewport: Viewport) {}

  screenToCanvas(point: Point, canvasBounds: CanvasBounds): Point {
    assertPoint(point, "screenPoint");
    assertRect(canvasBounds, "canvasBounds");
    assertSize(this.viewport.size, "viewport.size");
    return Object.freeze({
      x: (point.x - canvasBounds.x) * (this.viewport.size.width / canvasBounds.width),
      y: (point.y - canvasBounds.y) * (this.viewport.size.height / canvasBounds.height),
    });
  }

  canvasToScreen(point: Point, canvasBounds: CanvasBounds): Point {
    assertPoint(point, "canvasPoint");
    assertRect(canvasBounds, "canvasBounds");
    assertSize(this.viewport.size, "viewport.size", false);
    return Object.freeze({
      x: canvasBounds.x + point.x * (canvasBounds.width / this.viewport.size.width),
      y: canvasBounds.y + point.y * (canvasBounds.height / this.viewport.size.height),
    });
  }

  canvasToViewport(point: Point): Point {
    assertPoint(point, "canvasPoint");
    return Object.freeze({ ...point });
  }

  viewportToCanvas(point: Point): Point {
    assertPoint(point, "viewportPoint");
    return Object.freeze({ ...point });
  }

  viewportToWorld(point: Point): Point {
    return this.viewport.viewportToWorld(point);
  }

  worldToViewport(point: Point): Point {
    return this.viewport.worldToViewport(point);
  }

  worldToPage(point: Point): Point {
    assertPoint(point, "worldPoint");
    return Object.freeze({
      x: point.x - this.viewport.pageRect.x,
      y: point.y - this.viewport.pageRect.y,
    });
  }

  pageToWorld(point: Point): Point {
    assertPoint(point, "pagePoint");
    return Object.freeze({
      x: point.x + this.viewport.pageRect.x,
      y: point.y + this.viewport.pageRect.y,
    });
  }

  screenToPage(point: Point, canvasBounds: CanvasBounds): Point {
    const canvasPoint = this.screenToCanvas(point, canvasBounds);
    const viewportPoint = this.canvasToViewport(canvasPoint);
    const worldPoint = this.viewportToWorld(viewportPoint);
    return this.worldToPage(worldPoint);
  }

  pageToScreen(point: Point, canvasBounds: CanvasBounds): Point {
    const worldPoint = this.pageToWorld(point);
    const viewportPoint = this.worldToViewport(worldPoint);
    const canvasPoint = this.viewportToCanvas(viewportPoint);
    return this.canvasToScreen(canvasPoint, canvasBounds);
  }
}
