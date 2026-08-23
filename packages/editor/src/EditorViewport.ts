import { Camera, type Point, type ViewportMode } from "@folio/rendering";

export interface EditorViewportSnapshot {
  readonly zoom: number;
  readonly mode: ViewportMode;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface ViewportActions {
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly setZoom: (zoom: number) => void;
  readonly resetZoom: () => void;
  readonly zoomAt: (zoom: number, viewportAnchor: Point) => void;
  readonly panBy: (viewportDelta: Point) => void;
  readonly fitPage: () => void;
  readonly fitWidth: () => void;
}

export const EDITOR_VIEWPORT_ZOOM_PRESETS = Object.freeze([
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8,
]);

export const DEFAULT_EDITOR_VIEWPORT_SNAPSHOT: EditorViewportSnapshot = Object.freeze({
  zoom: 1,
  mode: "fit-page",
  minZoom: Camera.DEFAULT_MIN_ZOOM,
  maxZoom: Camera.DEFAULT_MAX_ZOOM,
});

const ZOOM_EPSILON = 1e-9;
const WHEEL_ZOOM_SENSITIVITY = 0.002;

export function nextEditorViewportZoom(
  currentZoom: number,
  direction: "in" | "out",
  minZoom = Camera.DEFAULT_MIN_ZOOM,
  maxZoom = Camera.DEFAULT_MAX_ZOOM,
): number {
  const levels = [...new Set([minZoom, ...EDITOR_VIEWPORT_ZOOM_PRESETS, maxZoom])]
    .filter((zoom) => zoom >= minZoom && zoom <= maxZoom)
    .sort((first, second) => first - second);
  if (direction === "in") {
    return levels.find((zoom) => zoom > currentZoom + ZOOM_EPSILON) ?? maxZoom;
  }
  return [...levels].reverse().find((zoom) => zoom < currentZoom - ZOOM_EPSILON) ?? minZoom;
}

export function editorViewportWheelZoom(
  currentZoom: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  const deltaScale = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(viewportHeight, 1) : 1;
  return currentZoom * Math.exp(-deltaY * deltaScale * WHEEL_ZOOM_SENSITIVITY);
}

export function formatEditorViewportZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
