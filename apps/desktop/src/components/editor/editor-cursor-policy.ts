import type { EditorTool } from "./editor-types";

export interface EditorCursorPresentation {
  readonly id: string;
  readonly css: string | null;
  readonly adaptiveCss?: string;
}

const penCursor = createSvgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 19l1.2-4.5L16.7 4a2 2 0 012.8 2.8L9 17.3 5 19z" fill="white" stroke="#111827" stroke-width="1.6" stroke-linejoin="round"/><path d="M14.8 5.9l3.3 3.3" stroke="#4f46e5" stroke-width="1.6"/></svg>',
  5,
  19,
  "crosshair",
);

const highlighterCursor = createSvgCursor(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 18l2-5L16.5 3.5l4 4L11 17l-6 1z" fill="#fde047" stroke="#111827" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 13l4 4M15 5l4 4" stroke="#ca8a04" stroke-width="1.5"/></svg>',
  5,
  18,
  "crosshair",
);

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
  Pen: Object.freeze({ id: "pen", css: penCursor }),
  Highlighter: Object.freeze({ id: "highlighter", css: highlighterCursor }),
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
