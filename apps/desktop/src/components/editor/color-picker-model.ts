import { normalizeArtworkHex, rgbToHex, type HsvColor } from "@folio/editor";
import {
  candidatesAroundRect,
  hardZone,
  insetRect,
  resolveOccupiedAwarePlacement,
  unionRects,
  workspaceFallbackCandidates,
  type OccupiedZone,
  type PlacementCandidate,
  type WorkspaceRect,
} from "./editor-occupied-zones";
import type { ColorPickerSource } from "./useColorPickerSession";
import type { EditorTool } from "./editor-types";

export type PickerRect = WorkspaceRect;

export interface PickerPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: "left" | "right" | "above" | "below" | "fallback";
}

export interface PickerPlacementConstraints {
  /** Usable workspace bounds in the same coordinate space as the anchor. */
  readonly bounds?: PickerRect;
  /** Measured editor chrome and artwork, classified hard or soft. */
  readonly zones?: readonly OccupiedZone[];
}

export interface RgbDraft {
  readonly red: string;
  readonly green: string;
  readonly blue: string;
}

export type FavoriteCollectionDisplayPolicy = "compact" | "bounded-scroll";

export const FAVORITE_COMPACT_CAPACITY = 20;

const VIEWPORT_PADDING = 12;
const PICKER_GAP = 10;
/** Chrome stays reachable rather than merely uncovered. */
const HARD_ZONE_GAP = 6;
const QUICK_COLOR_TOOLS = new Set<EditorTool>(["Pencil", "Pen", "Marker", "Highlighter", "Shapes"]);

export function quickColorRailSupportsTool(tool: EditorTool): boolean {
  return QUICK_COLOR_TOOLS.has(tool);
}

export function isFavoriteColor(favorites: readonly string[], color: string): boolean {
  return favorites.includes(normalizeArtworkHex(color));
}

export function favoriteCollectionDisplayPolicy(
  favoriteCount: number,
): FavoriteCollectionDisplayPolicy {
  return favoriteCount > FAVORITE_COMPACT_CAPACITY ? "bounded-scroll" : "compact";
}

/**
 * Places the full color picker inside the workspace it was opened from.
 *
 * The picker never covers the control that opened it, treats measured editor
 * chrome as hard, treats the selected artwork as soft, and falls back through a
 * fixed candidate order so the same inputs always produce the same position.
 */
export function resolveColorPickerPlacement(
  anchor: PickerRect,
  picker: Readonly<{ width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
  source: ColorPickerSource,
  constraints: PickerPlacementConstraints = {},
): PickerPlacement {
  const rawBounds = constraints.bounds ?? {
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
  };
  const bounds = insetRect(rawBounds, VIEWPORT_PADDING);
  const surface = {
    width: Math.min(Math.max(0, picker.width), bounds.width),
    height: Math.min(Math.max(0, picker.height), bounds.height),
  };
  // The picker's own trigger is always hard: covering it strands the user with
  // no way back to the control they just used.
  const zones = [...(constraints.zones ?? []), hardZone("picker-anchor", anchor)].filter(
    (zone): zone is OccupiedZone => zone !== null,
  );
  const softRects = zones.filter((zone) => zone.kind === "soft").map((zone) => zone.rect);
  // A trigger normally sits *inside* a rail or panel. Opening a gap from the
  // button's own edge leaves the picker overlapping the few pixels of rail
  // around it, which disqualifies every anchor-relative side and drops the
  // picker into a far corner. Opening from the containing surface instead is
  // what "beside the control you clicked" actually means.
  const launchRect = zones.reduce(
    (rect, zone) =>
      zone.kind === "hard" && containsRect(zone.rect, anchor) ? unionRects(rect, zone.rect) : rect,
    anchor,
  );
  const candidates: readonly PlacementCandidate[] = [
    ...anchorCandidates(launchRect, surface, source),
    ...softRects.flatMap((rect) => candidatesAroundRect(rect, surface, PICKER_GAP, "artwork")),
    ...workspaceFallbackCandidates(bounds, surface),
  ];
  const placement = resolveOccupiedAwarePlacement({
    surface,
    bounds,
    candidates,
    zones,
    anchor,
    hardGap: HARD_ZONE_GAP,
  });
  return Object.freeze({
    side: sideFromReason(placement.reason),
    left: placement.left,
    top: placement.top,
  });
}

/** Reserves the bottom workspace controls while leaving the picker internally scrollable. */
export function resolveColorPickerMaximumHeight(
  workspace: PickerRect,
  bottomControls?: PickerRect,
): number {
  const usableBounds = resolveColorPickerUsableBounds(workspace, bottomControls);
  return Math.max(0, usableBounds.height - VIEWPORT_PADDING * 2);
}

/** Clips the picker layout region above bottom chrome without resizing the canvas workspace. */
export function resolveColorPickerUsableBounds(
  workspace: PickerRect,
  bottomControls?: PickerRect,
  leftControls?: PickerRect,
): PickerRect {
  let left = workspace.left;
  let bottom = workspace.top + workspace.height;
  if (
    bottomControls !== undefined &&
    bottomControls.top > workspace.top &&
    bottomControls.top < bottom &&
    horizontalOverlap(workspace, bottomControls)
  ) {
    bottom = bottomControls.top;
  }
  if (
    leftControls !== undefined &&
    leftControls.left + leftControls.width > left &&
    leftControls.left + leftControls.width < workspace.left + workspace.width &&
    verticalOverlap(workspace, leftControls)
  ) {
    left = leftControls.left + leftControls.width + PICKER_GAP;
  }
  return {
    left,
    top: workspace.top,
    width: Math.max(0, workspace.left + workspace.width - left),
    height: Math.max(0, bottom - workspace.top),
  };
}

export function hsvFromSvPointer(
  rect: PickerRect,
  clientX: number,
  clientY: number,
  hue: number,
): HsvColor {
  return Object.freeze({
    hue,
    saturation: clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1),
    value: 1 - clamp((clientY - rect.top) / Math.max(rect.height, 1), 0, 1),
  });
}

export function adjustSvWithKeyboard(
  hsv: HsvColor,
  key: string,
  largeStep: boolean,
): HsvColor | null {
  const step = largeStep ? 0.1 : 0.01;
  if (key === "ArrowLeft")
    return Object.freeze({ ...hsv, saturation: clamp(hsv.saturation - step) });
  if (key === "ArrowRight")
    return Object.freeze({ ...hsv, saturation: clamp(hsv.saturation + step) });
  if (key === "ArrowUp") return Object.freeze({ ...hsv, value: clamp(hsv.value + step) });
  if (key === "ArrowDown") return Object.freeze({ ...hsv, value: clamp(hsv.value - step) });
  if (key === "Home") return Object.freeze({ ...hsv, saturation: 0, value: 1 });
  if (key === "End") return Object.freeze({ ...hsv, saturation: 1, value: 0 });
  return null;
}

export function completeHexDraft(draft: string): string | null {
  const trimmed = draft.trim();
  if (!/^#?[\da-f]{6}$/iu.test(trimmed)) return null;
  return normalizeArtworkHex(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
}

export function rgbDraftToHex(draft: RgbDraft): string | null {
  const values = [draft.red, draft.green, draft.blue].map(parseRgbChannel);
  if (values.some((value) => value === null)) return null;
  return rgbToHex({ red: values[0]!, green: values[1]!, blue: values[2]! });
}

/** Deterministic Rail capacity with no internal scrolling. */
export function quickColorRailSwatchCount(workspaceHeight: number): number {
  if (!Number.isFinite(workspaceHeight)) return 3;
  if (workspaceHeight < 520) return 3;
  if (workspaceHeight < 590) return 4;
  if (workspaceHeight < 660) return 5;
  if (workspaceHeight < 730) return 6;
  return 7;
}

/**
 * Anchor-relative positions in the order that suits each launch site.
 *
 * A Rail trigger on the right edge opens inward; a Tool Options trigger on the
 * left opens outward; a selection toolbar floats over the artwork, so it opens
 * below or above before it tries either side.
 */
function anchorCandidates(
  anchor: PickerRect,
  surface: Readonly<{ width: number; height: number }>,
  source: ColorPickerSource,
): readonly PlacementCandidate[] {
  const positions = {
    left: {
      left: anchor.left - PICKER_GAP - surface.width,
      top: anchor.top + anchor.height / 2 - surface.height / 2,
      reason: "anchor-left",
    },
    right: {
      left: anchor.left + anchor.width + PICKER_GAP,
      top: anchor.top + anchor.height / 2 - surface.height / 2,
      reason: "anchor-right",
    },
    above: {
      left: anchor.left + anchor.width / 2 - surface.width / 2,
      top: anchor.top - PICKER_GAP - surface.height,
      reason: "anchor-above",
    },
    below: {
      left: anchor.left + anchor.width / 2 - surface.width / 2,
      top: anchor.top + anchor.height + PICKER_GAP,
      reason: "anchor-below",
    },
  } as const;
  const order =
    source === "quick-rail"
      ? (["left", "below", "above", "right"] as const)
      : source === "selected-vector"
        ? (["below", "above", "right", "left"] as const)
        : (["right", "below", "above", "left"] as const);
  return Object.freeze(order.map((side) => positions[side]));
}

function containsRect(outer: PickerRect, inner: PickerRect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  );
}

function sideFromReason(reason: string): PickerPlacement["side"] {
  if (!reason.startsWith("anchor-") && !reason.startsWith("artwork-")) return "fallback";
  const side = reason.slice(reason.indexOf("-") + 1);
  return side === "left" || side === "right" || side === "above" || side === "below"
    ? side
    : "fallback";
}

function horizontalOverlap(first: PickerRect, second: PickerRect): boolean {
  return first.left < second.left + second.width && second.left < first.left + first.width;
}

function verticalOverlap(first: PickerRect, second: PickerRect): boolean {
  return first.top < second.top + second.height && second.top < first.top + first.height;
}

function parseRgbChannel(draft: string): number | null {
  if (!/^\d{1,3}$/u.test(draft)) return null;
  const value = Number(draft);
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(Math.max(value, minimum), maximum);
}
