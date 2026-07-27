import { type CanvasBounds, CoordinateConverter, type Viewport } from "@folio/rendering";
import type { PagePoint, ScreenPoint, SelectionCoordinateMapper } from "@folio/selection";

export interface PageSelectionCoordinateMapperOptions {
  readonly coordinateConverter: CoordinateConverter;
  readonly viewport: Viewport;
  readonly getCanvasBounds: () => CanvasBounds | null;
}

/**
 * Adapts the rendering engine's canonical coordinate pipeline to selection's
 * screen-to-active-page contract without exposing rendering to selection.
 */
export class PageSelectionCoordinateMapper implements SelectionCoordinateMapper {
  private readonly coordinateConverter: CoordinateConverter;
  private readonly viewport: Viewport;
  private readonly getCanvasBounds: () => CanvasBounds | null;

  constructor(options: PageSelectionCoordinateMapperOptions) {
    this.coordinateConverter = options.coordinateConverter;
    this.viewport = options.viewport;
    this.getCanvasBounds = options.getCanvasBounds;
  }

  screenToPage(position: ScreenPoint): PagePoint | null {
    const bounds = this.getCanvasBounds();
    if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return null;
    try {
      const pagePosition = this.coordinateConverter.screenToPage(position, bounds);
      const pageRect = this.viewport.pageRect;
      if (
        pagePosition.x < 0 ||
        pagePosition.y < 0 ||
        pagePosition.x > pageRect.width ||
        pagePosition.y > pageRect.height
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
