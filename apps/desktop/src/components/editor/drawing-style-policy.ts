import type { EditorTool } from "./editor-types";

export const MIN_DRAWING_OPACITY = 0.1;
export const MAX_HIGHLIGHTER_OPACITY = 0.45;

export function maximumOpacityForTool(tool: EditorTool): number {
  return tool === "Highlighter" ? MAX_HIGHLIGHTER_OPACITY : 1;
}

export function defaultOpacityForTool(tool: EditorTool): number {
  return tool === "Highlighter" ? 0.34 : 1;
}

export function constrainOpacityForTool(tool: EditorTool, opacity: number): number {
  if (!Number.isFinite(opacity)) {
    throw new RangeError("Drawing opacity must be finite.");
  }
  return Math.min(maximumOpacityForTool(tool), Math.max(MIN_DRAWING_OPACITY, opacity));
}
