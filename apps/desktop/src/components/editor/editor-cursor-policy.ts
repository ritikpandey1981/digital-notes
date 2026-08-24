import type { EditorTool } from "./editor-types";

export interface EditorCursorPresentation {
  readonly id: string;
  readonly css: string | null;
  readonly adaptiveCss?: string;
}

export const MINIMUM_BRUSH_CURSOR_DIAMETER = 7;

export function usesImperativeBrushCursor(tool: EditorTool): boolean {
  return tool === "Pencil" || tool === "Pen" || tool === "Marker" || tool === "Highlighter";
}

export function brushCursorDiameter(nominalSize: number, zoom: number): number {
  if (!Number.isFinite(nominalSize) || nominalSize <= 0 || !Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError("Brush cursor size and zoom must be positive and finite.");
  }
  return Math.max(MINIMUM_BRUSH_CURSOR_DIAMETER, nominalSize * zoom);
}

export function pointIsWithinBrushPage(
  point: Readonly<{ x: number; y: number }>,
  page: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return (
    point.x >= page.x &&
    point.x <= page.x + page.width &&
    point.y >= page.y &&
    point.y <= page.y + page.height
  );
}

const eraserCursor = createSvgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5.2 14.8l8.9-8.9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8l-8 8H7.3l-2.1-2.1a1.4 1.4 0 010-2z" fill="#f9a8d4" stroke="#111827" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.2 18.9l-4.7-4.7M11.2 18.9h7.3" stroke="#111827" stroke-width="1.5" stroke-linecap="round"/></svg>',
  6,
  18,
  "cell",
);

const initialShapeCrosshairCursor = createSvgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" fill="none" stroke="#111111" stroke-width="1.5" stroke-linecap="square"/></svg>',
  12,
  12,
  "crosshair",
);

const cursorByTool: Readonly<Record<EditorTool, EditorCursorPresentation>> = Object.freeze({
  Select: Object.freeze({ id: "select", css: null }),
  Move: Object.freeze({ id: "move", css: null }),
  Rotate: Object.freeze({ id: "rotate", css: null }),
  Scale: Object.freeze({ id: "scale", css: null }),
  Pencil: Object.freeze({ id: "pencil", css: "none" }),
  Pen: Object.freeze({ id: "pen", css: "none" }),
  Marker: Object.freeze({ id: "marker", css: "none" }),
  Highlighter: Object.freeze({ id: "highlighter", css: "none" }),
  Eraser: Object.freeze({ id: "eraser", css: eraserCursor }),
  Shapes: Object.freeze({
    id: "shapes",
    css: initialShapeCrosshairCursor,
    adaptiveCss: "crosshair",
  }),
  Text: Object.freeze({ id: "text", css: "text" }),
  Image: Object.freeze({ id: "image", css: "copy" }),
  Table: Object.freeze({ id: "table", css: "cell" }),
  "Sticky Note": Object.freeze({ id: "sticky-note", css: "alias" }),
});

export function cursorPresentationForTool(tool: EditorTool): EditorCursorPresentation {
  return cursorByTool[tool];
}

function createSvgCursor(
  svg: string,
  hotspotX: number,
  hotspotY: number,
  fallback: string,
): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspotX} ${hotspotY}, ${fallback}`;
}
