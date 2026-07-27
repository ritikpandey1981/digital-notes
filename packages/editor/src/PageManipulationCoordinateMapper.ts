import { type CanvasBounds, CoordinateConverter, type Viewport } from "@folio/rendering";
import type { PagePoint, ScreenPoint } from "@folio/selection";

export interface PageManipulationCoordinateMapperOptions {
  readonly coordinateConverter: CoordinateConverter;
  readonly viewport: Viewport;
  readonly getCanvasBounds: () => CanvasBounds | null;
}

/**
 * Editor-owned bridge from browser screen coordinates to manipulation's
 * normalized page-space input. Rendering remains the canonical math owner.
 */
export class PageManipulationCoordinateMapper {
  private readonly coordinateConverter: CoordinateConverter;
  private readonly viewport: Viewport;
  private readonly getCanvasBounds: () => CanvasBounds | null;

  constructor(options: PageManipulationCoordinateMapperOptions) {
    this.coordinateConverter = options.coordinateConverter;
    this.viewport = options.viewport;
    this.getCanvasBounds = options.getCanvasBounds;
  }

  screenToPage(position: ScreenPoint, allowOutsidePage = false): PagePoint | null {
    const bounds = this.getCanvasBounds();
    if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return null;
    try {
      const pagePosition = this.coordinateConverter.screenToPage(position, bounds);
      const pageRect = this.viewport.pageRect;
      if (
        !allowOutsidePage &&
        (pagePosition.x < 0 ||
          pagePosition.y < 0 ||
          pagePosition.x > pageRect.width ||
          pagePosition.y > pageRect.height)
      ) {
        return null;
      }
      return Object.freeze({
        x: pagePosition.x,
        y: pagePosition.y,
        coordinateSpace: "page",
      });
    } catch {
      return null;
    }
  }
}
