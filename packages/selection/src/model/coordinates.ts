/** Coordinate spaces understood by the selection boundary. */
export type SelectionCoordinateSpace = "screen" | "viewport" | "page";

/** A point whose coordinate space is explicit at the type and runtime boundaries. */
export interface SelectionPoint<TSpace extends SelectionCoordinateSpace> {
  readonly x: number;
  readonly y: number;
  readonly coordinateSpace: TSpace;
}

/** Pointer position expressed in browser screen coordinates. */
export type ScreenPoint = SelectionPoint<"screen">;

/** Pointer position expressed in logical viewport coordinates. */
export type ViewportPoint = SelectionPoint<"viewport">;

/** Pointer position expressed relative to the active page. */
export type PagePoint = SelectionPoint<"page">;
