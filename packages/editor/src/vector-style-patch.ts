import type { EditableStyle, EditableStyleInput } from "@folio/document";

/** What a colour, width or opacity control can change about a vector style. */
export interface VectorStylePatch {
  readonly color?: string;
  readonly strokeWidth?: number;
  /** Stroke alpha. Fill keeps its own, which is a separate durable value. */
  readonly opacity?: number;
}

/** A style input whose stroke is already resolved, so callers can compare it. */
export type PatchedVectorStyle = EditableStyleInput &
  Readonly<{
    strokeColor: Readonly<{ hex: string; opacity: number }>;
    strokeWidth: number;
  }>;

/**
 * Applies one style change without discarding the rest of the style.
 *
 * A vector object's style carries more than a colour and a width: a dashed
 * line, a shadow, a blend mode, and text metrics are all durable and all
 * survive a save. Rebuilding the style from the few fields a control happens to
 * know about silently deletes the others, so every style control patches
 * through here and names only what it is changing.
 */
export function patchVectorStyle(
  style: EditableStyle,
  patch: VectorStylePatch,
): PatchedVectorStyle {
  return {
    ...style,
    strokeColor: Object.freeze({
      hex: patch.color ?? style.strokeColor.hex,
      opacity: patch.opacity ?? style.strokeColor.opacity,
    }),
    strokeWidth: patch.strokeWidth ?? style.strokeWidth,
  };
}
