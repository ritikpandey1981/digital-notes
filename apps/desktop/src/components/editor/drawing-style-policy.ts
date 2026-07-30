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

export function displayOpacityForTool(tool: EditorTool, modelOpacity: number): number {
  const constrained = constrainOpacityForTool(tool, modelOpacity);
  if (tool !== "Highlighter") return constrained;
  return mapRange(
    constrained,
    MIN_DRAWING_OPACITY,
    MAX_HIGHLIGHTER_OPACITY,
    MIN_DRAWING_OPACITY,
    1,
  );
}

export function modelOpacityForTool(tool: EditorTool, displayOpacity: number): number {
  if (!Number.isFinite(displayOpacity)) {
    throw new RangeError("Displayed drawing opacity must be finite.");
  }
  const constrainedDisplay = Math.min(1, Math.max(MIN_DRAWING_OPACITY, displayOpacity));
  if (tool !== "Highlighter") return constrainedDisplay;
  return mapRange(
    constrainedDisplay,
    MIN_DRAWING_OPACITY,
    1,
    MIN_DRAWING_OPACITY,
    MAX_HIGHLIGHTER_OPACITY,
  );
}

function mapRange(
  value: number,
  sourceMinimum: number,
  sourceMaximum: number,
  targetMinimum: number,
  targetMaximum: number,
): number {
  if (value <= sourceMinimum) return targetMinimum;
  if (value >= sourceMaximum) return targetMaximum;
  const progress = (value - sourceMinimum) / (sourceMaximum - sourceMinimum);
  return targetMinimum + progress * (targetMaximum - targetMinimum);
}
