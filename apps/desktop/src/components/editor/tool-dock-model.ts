import type { DrawingToolKind } from "@folio/editor";
import type { EditorTool } from "./editor-types";

/**
 * The dock's two groups, as data.
 *
 * Folio's tool dock is one logical toolbar rendered as two capsules: five
 * configurable drawing preset slots, then the three permanent utilities. The
 * grouping is the product decision (`docs/design/drawing-tool-system.md` §2);
 * this module owns only the identity and resolution rules so they can be tested
 * without a window.
 */

export interface DockSlotDefinition {
  /** Stable identity, used for keyboard traversal and test assertions. */
  readonly id: string;
  /** Accessible name and tooltip. Unique across the whole dock. */
  readonly label: string;
  /** The existing editor tool this slot activates. Never a new tool concept. */
  readonly tool: EditorTool;
}

export interface DrawingSlotDefinition extends DockSlotDefinition {
  /**
   * The family this slot *starts* on.
   *
   * A slot is a stable physical position that owns preferences, not a fixed
   * tool: assigning a brush from the library replaces the slot's family, its
   * backing preset and its tool together. This value seeds a fresh session and
   * is never re-applied afterwards.
   */
  readonly family: DrawingToolKind;
  /**
   * The catalog preset pinned when this slot is activated, or `null` to keep
   * whatever preset the family currently has.
   *
   * Pinning exists only to keep two slots that share one brush family honestly
   * distinct: without it, Pen and Brush Pen would be the same button twice. A
   * family hosting a single slot is left alone, so choosing a preset from Tool
   * Options keeps behaving exactly as it does today. Genuine per-slot width,
   * opacity and colour need the slot-keyed preference layer that
   * `docs/design/drawing-tool-system.md` §26 records as future work.
   */
  readonly presetId: string | null;
}

/** The editor tool a drawing slot activates while it holds a given family. */
export function toolForDrawingFamily(family: DrawingToolKind): EditorTool {
  switch (family) {
    case "pencil":
      return "Pencil";
    case "marker":
      return "Marker";
    case "highlighter":
      return "Highlighter";
    default:
      return "Pen";
  }
}

/**
 * The tool each drawing slot currently activates.
 *
 * Defaults to the seeded families, so callers that have no live slot state --
 * and the dock's own tests -- keep the original behaviour.
 */
export function dockSlotTools(
  slotFamilies: Readonly<Record<string, DrawingToolKind>> = {},
): Readonly<Record<string, EditorTool>> {
  return Object.freeze(
    Object.fromEntries(
      DRAWING_SLOTS.map((slot) => [
        slot.id,
        toolForDrawingFamily(slotFamilies[slot.id] ?? slot.family),
      ]),
    ),
  );
}

/**
 * Five real drawing presets, every one of them a configuration the current
 * engine genuinely produces. The conceptual kit in the design spec ends in a
 * painting brush; the engine has no colour-brush behaviour yet, so the fifth
 * slot is a second, genuinely different pen rather than a fake watercolour.
 */
export const DRAWING_SLOTS: readonly DrawingSlotDefinition[] = Object.freeze([
  Object.freeze({
    id: "pencil",
    label: "Pencil",
    tool: "Pencil" as const,
    family: "pencil" as const,
    presetId: null,
  }),
  Object.freeze({
    id: "pen",
    label: "Pen",
    tool: "Pen" as const,
    family: "pen" as const,
    presetId: "pen-fineliner",
  }),
  Object.freeze({
    id: "brush-pen",
    label: "Brush Pen",
    tool: "Pen" as const,
    family: "pen" as const,
    presetId: "pen-brush",
  }),
  Object.freeze({
    id: "marker",
    label: "Marker",
    tool: "Marker" as const,
    family: "marker" as const,
    presetId: null,
  }),
  Object.freeze({
    id: "highlighter",
    label: "Highlighter",
    tool: "Highlighter" as const,
    family: "highlighter" as const,
    presetId: null,
  }),
]);

/** The three permanent utilities. Not replaceable, not preset slots. */
export const UTILITY_SLOTS: readonly DockSlotDefinition[] = Object.freeze([
  Object.freeze({ id: "select", label: "Select", tool: "Select" as const }),
  Object.freeze({ id: "eraser", label: "Eraser", tool: "Eraser" as const }),
  Object.freeze({ id: "shapes", label: "Shapes", tool: "Shapes" as const }),
]);

/** Visual order, which is also the roving-tabindex traversal order. */
export const DOCK_SLOT_ORDER: readonly string[] = Object.freeze([
  ...DRAWING_SLOTS.map(({ id }) => id),
  ...UTILITY_SLOTS.map(({ id }) => id),
]);

export function dockSlotById(slotId: string): DockSlotDefinition | null {
  return (
    DRAWING_SLOTS.find((slot) => slot.id === slotId) ??
    UTILITY_SLOTS.find((slot) => slot.id === slotId) ??
    null
  );
}

/**
 * The one slot that may present as active.
 *
 * A utility owns the active presentation outright whenever its tool is active,
 * so a drawing slot and a utility can never look active at the same time.
 *
 * Several drawing slots can now share a tool at once -- three of them may hold
 * pencils -- so the slot the user last chose is what separates them. The tools
 * are supplied by the caller because a slot's tool follows the brush it holds;
 * omitting them falls back to the seeded families.
 */
export function resolveActiveDockSlotId(
  activeTool: EditorTool,
  lastActivatedDrawingSlotId: string | null,
  slotFamilies: Readonly<Record<string, DrawingToolKind>> = {},
): string | null {
  const utility = UTILITY_SLOTS.find((slot) => slot.tool === activeTool);
  if (utility !== undefined) return utility.id;
  const tools = dockSlotTools(slotFamilies);
  const candidates = DRAWING_SLOTS.filter((slot) => tools[slot.id] === activeTool);
  const remembered = candidates.find((slot) => slot.id === lastActivatedDrawingSlotId);
  if (remembered !== undefined) return remembered.id;
  const first = candidates[0];
  return first === undefined ? null : first.id;
}

/**
 * The dock is one tab stop. When the active tool lives outside the dock the
 * first slot stays reachable, so the toolbar is never orphaned from keyboard.
 */
export function resolveTabbableDockSlotId(activeSlotId: string | null): string | null {
  if (activeSlotId !== null) return activeSlotId;
  const first = DOCK_SLOT_ORDER[0];
  return first === undefined ? null : first;
}

/** Arrow/Home/End traversal within the single logical toolbar. */
export function resolveDockKeyboardTarget(
  currentSlotId: string | null,
  key: string,
): string | null {
  if (currentSlotId === null) return null;
  const index = DOCK_SLOT_ORDER.indexOf(currentSlotId);
  if (index < 0) return null;
  const last = DOCK_SLOT_ORDER.length - 1;
  const next =
    key === "ArrowDown" || key === "ArrowRight"
      ? Math.min(index + 1, last)
      : key === "ArrowUp" || key === "ArrowLeft"
        ? Math.max(index - 1, 0)
        : key === "Home"
          ? 0
          : key === "End"
            ? last
            : null;
  if (next === null || next === index) return null;
  return DOCK_SLOT_ORDER[next] ?? null;
}
