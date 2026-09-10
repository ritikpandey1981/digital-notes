import { InkError } from "../errors";
import { DEFAULT_STROKE_STYLE, type StrokeStyle } from "../types";

export function createStrokeStyle(style: Partial<StrokeStyle> = {}): StrokeStyle {
  if ("pressureCurve" in style) {
    throw new InkError(
      "INVALID_STYLE",
      "Finalized stroke pressure behavior must come from its resolved brush snapshot.",
    );
  }
  const result: StrokeStyle = {
    color: style.color ?? DEFAULT_STROKE_STYLE.color,
    width: style.width ?? DEFAULT_STROKE_STYLE.width,
    opacity: style.opacity ?? DEFAULT_STROKE_STYLE.opacity,
    pressureEnabled: style.pressureEnabled ?? DEFAULT_STROKE_STYLE.pressureEnabled,
    lineCap: "round",
    lineJoin: "round",
    ...(style.brushTextureId === undefined ? {} : { brushTextureId: style.brushTextureId }),
  };
  if (result.color.trim().length === 0) {
    throw new InkError("INVALID_STYLE", "Stroke color must not be empty.");
  }
  if (!Number.isFinite(result.width) || result.width <= 0) {
    throw new InkError("INVALID_STYLE", "Stroke width must be positive.", {
      width: result.width,
    });
  }
  if (!Number.isFinite(result.opacity) || result.opacity < 0 || result.opacity > 1) {
    throw new InkError("INVALID_STYLE", "Stroke opacity must be between zero and one.", {
      opacity: result.opacity,
    });
  }
  return Object.freeze(result);
}
