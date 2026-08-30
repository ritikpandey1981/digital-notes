import type { ResolvedDrawingBrush } from "@folio/editor";
import { displayOpacityForTool } from "./drawing-style-policy";
import type { EditorTool } from "./editor-types";
import { DRAWING_SLOTS } from "./tool-dock-model";

/**
 * The compact property rail beside the drawing capsule, as data.
 *
 * The rail is a presentation surface over state the editor already owns: the
 * brush store's active tool state supplies width, opacity and smoothing, and the
 * existing colour target supplies the current colour. Nothing here stores a
 * value; every field is derived on each render from the resolved brush.
 *
 * `docs/design/drawing-tool-system.md` §9 fixes the order — width, opacity,
 * smoothness, then colour — and §11 fixes that the rail is contextual: it
 * belongs to drawing presets and must not present drawing controls for Select,
 * Eraser or Shapes.
 */

export type DrawingPropertyKey = "strokeWidth" | "opacity" | "smoothing" | "strokeColor";

export interface DrawingPropertyControl {
  readonly key: DrawingPropertyKey;
  readonly label: string;
  /** Canonical model value: px for width, 0–1 for opacity/smoothing, hex for colour. */
  readonly value: number | string;
  /**
   * The value as the rail prints it beneath the icon, or null where no number
   * belongs: the colour swatch shows itself, and an unavailable parameter shows
   * a dash rather than a number it does not have.
   */
  readonly displayValue: string | null;
  /**
   * False when the active brush genuinely has no such parameter. The control
   * still renders, disabled, rather than pretending to offer the setting.
   */
  readonly available: boolean;
  /** Spoken and tooltip text: the property, its current value, and what a press does. */
  readonly accessibleLabel: string;
}

/** Printed where a parameter genuinely has no value, never as a stand-in for one. */
export const UNAVAILABLE_VALUE_TEXT = "—";

export interface DrawingPropertyRailModel {
  readonly tool: EditorTool;
  readonly controls: readonly DrawingPropertyControl[];
}

/** Every tool that owns a drawing preset slot, and therefore this rail. */
const DRAWING_TOOLS: ReadonlySet<EditorTool> = new Set(DRAWING_SLOTS.map(({ tool }) => tool));

export function isDrawingPropertyTool(tool: EditorTool): boolean {
  return DRAWING_TOOLS.has(tool);
}

/**
 * Smoothing is a real per-brush parameter everywhere except the Highlighter,
 * which the tool-options registry deliberately gives no smoothing control: its
 * strokes are laid down unsmoothed on purpose. Showing an adjustable smoothness
 * for it would be inventing a setting the engine does not have.
 */
export function supportsSmoothing(tool: EditorTool): boolean {
  return tool !== "Highlighter";
}

/**
 * Stroke width as the rail prints it.
 *
 * Rounded to one decimal, and integers print without one, so a 2px liner reads
 * "2 px" rather than "2.0 px" while a scrubbed 29.4 keeps its precision. This
 * is display only: the canonical value is never rounded.
 */
export function formatWidth(width: number): string {
  return `${Math.round(width * 10) / 10} px`;
}

/** A 0–1 parameter as a whole percentage. */
export function formatPercentage(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Derives the four controls for the active drawing preset.
 *
 * Returns null for any tool without a drawing preset, which is what keeps the
 * rail from presenting drawing properties for Select, Eraser or Shapes.
 */
export function resolveDrawingPropertyRail(input: {
  readonly tool: EditorTool;
  readonly brush: ResolvedDrawingBrush | null | undefined;
  readonly color: string | null;
}): DrawingPropertyRailModel | null {
  if (!isDrawingPropertyTool(input.tool)) return null;
  const brush = input.brush;
  if (brush === null || brush === undefined) return null;
  const displayOpacity = displayOpacityForTool(input.tool, brush.opacity);
  const smoothingAvailable = supportsSmoothing(input.tool);
  const color = input.color ?? brush.color;
  return Object.freeze({
    tool: input.tool,
    controls: Object.freeze([
      Object.freeze({
        key: "strokeWidth" as const,
        label: "Stroke width",
        value: brush.size,
        displayValue: formatWidth(brush.size),
        available: true,
        accessibleLabel: `Stroke width ${formatWidth(brush.size)}. Open tool options`,
      }),
      Object.freeze({
        key: "opacity" as const,
        label: "Opacity",
        value: brush.opacity,
        // The Highlighter's model ceiling is 0.45; the printed number uses the
        // same remapped scale the tool options panel shows, so the two agree.
        displayValue: formatPercentage(displayOpacity),
        available: true,
        accessibleLabel: `Opacity ${formatPercentage(displayOpacity)}. Open tool options`,
      }),
      Object.freeze({
        key: "smoothing" as const,
        label: "Smoothness",
        value: brush.smoothing.amount,
        displayValue: smoothingAvailable
          ? formatPercentage(brush.smoothing.amount)
          : UNAVAILABLE_VALUE_TEXT,
        available: smoothingAvailable,
        accessibleLabel: smoothingAvailable
          ? `Smoothness ${formatPercentage(brush.smoothing.amount)}. Open tool options`
          : `Smoothness unavailable for ${input.tool}`,
      }),
      Object.freeze({
        key: "strokeColor" as const,
        label: "Color",
        value: color,
        displayValue: null,
        available: true,
        accessibleLabel: `Current color ${color}. Open full color picker`,
      }),
    ]),
  });
}
