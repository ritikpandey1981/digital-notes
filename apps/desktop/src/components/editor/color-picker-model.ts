import { normalizeArtworkHex, rgbToHex, type HsvColor } from "@folio/editor";
import type { ColorPickerSource } from "./useColorPickerSession";
import type { EditorTool } from "./editor-types";

export interface PickerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PickerPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: "left" | "right" | "above" | "below" | "fallback";
}

export interface PickerPlacementConstraints {
  /** Usable workspace bounds in the same coordinate space as the anchor. */
  readonly bounds?: PickerRect;
  /** Selected artwork that should remain visible while its color is previewed. */
  readonly avoidRect?: PickerRect | undefined;
  /** Floating workspace chrome that must remain reachable. */
  readonly occupiedRects?: readonly PickerRect[];
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
const OCCUPIED_GAP = 0;
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
  const width = Math.min(Math.max(0, picker.width), bounds.width);
  const height = Math.min(Math.max(0, picker.height), bounds.height);
  const anchorPositions = {
    left: {
      left: anchor.left - PICKER_GAP - width,
      top: anchor.top + anchor.height / 2 - height / 2,
      side: "left" as const,
    },
    right: {
      left: anchor.left + anchor.width + PICKER_GAP,
      top: anchor.top + anchor.height / 2 - height / 2,
      side: "right" as const,
    },
    above: {
      left: anchor.left + anchor.width / 2 - width / 2,
      top: anchor.top - PICKER_GAP - height,
      side: "above" as const,
    },
    below: {
      left: anchor.left + anchor.width / 2 - width / 2,
      top: anchor.top + anchor.height + PICKER_GAP,
      side: "below" as const,
    },
  };
  const anchorOrder =
    source === "quick-rail"
      ? (["left", "right", "below", "above"] as const)
      : (["right", "below", "left", "above"] as const);
  const avoidCandidates =
    constraints.avoidRect === undefined
      ? []
      : candidatesAroundRect(constraints.avoidRect, width, height);
  const workspaceFallbacks = fallbackCandidates(bounds, width, height);
  const candidates =
    source === "selected-vector"
      ? [
          ...workspaceFallbacks.slice(0, 1),
          ...avoidCandidates,
          ...anchorOrder.map((side) => anchorPositions[side]),
          ...workspaceFallbacks.slice(1),
        ]
      : [...anchorOrder.map((side) => anchorPositions[side]), ...workspaceFallbacks];
  const evaluated = candidates.map((candidate, index) => {
    const clamped = {
      ...candidate,
      left: clamp(candidate.left, bounds.left, bounds.left + bounds.width - width),
      top: clamp(candidate.top, bounds.top, bounds.top + bounds.height - height),
    };
    const rect = { left: clamped.left, top: clamped.top, width, height };
    return {
      candidate: clamped,
      index,
      clampDistance:
        Math.abs(candidate.left - clamped.left) + Math.abs(candidate.top - clamped.top),
      avoidOverlap:
        constraints.avoidRect === undefined ? 0 : intersectionArea(rect, constraints.avoidRect),
      occupiedOverlap: (constraints.occupiedRects ?? []).reduce(
        (total, occupied) => total + intersectionArea(rect, inflateRect(occupied, OCCUPIED_GAP)),
        0,
      ),
    };
  });
  const preferred =
    evaluated.find(
      ({ avoidOverlap, occupiedOverlap }) => avoidOverlap === 0 && occupiedOverlap === 0,
    ) ??
    [...evaluated].sort(
      (first, second) =>
        first.occupiedOverlap - second.occupiedOverlap ||
        first.avoidOverlap - second.avoidOverlap ||
        first.clampDistance - second.clampDistance ||
        first.index - second.index,
    )[0];
  const placement = preferred?.candidate ?? {
    left: bounds.left,
    top: bounds.top,
    side: "fallback" as const,
  };
  return Object.freeze({
    side: placement.side,
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

interface PlacementCandidate {
  readonly left: number;
  readonly top: number;
  readonly side: PickerPlacement["side"];
}

function candidatesAroundRect(
  rect: PickerRect,
  width: number,
  height: number,
): readonly PlacementCandidate[] {
  return [
    {
      left: rect.left - PICKER_GAP - width,
      top: rect.top,
      side: "left",
    },
    {
      left: rect.left + rect.width + PICKER_GAP,
      top: rect.top,
      side: "right",
    },
    {
      left: rect.left + rect.width / 2 - width / 2,
      top: rect.top - PICKER_GAP - height,
      side: "above",
    },
    {
      left: rect.left + rect.width / 2 - width / 2,
      top: rect.top + rect.height + PICKER_GAP,
      side: "below",
    },
  ];
}

function fallbackCandidates(
  bounds: PickerRect,
  width: number,
  height: number,
): readonly PlacementCandidate[] {
  const left = bounds.left;
  const right = bounds.left + bounds.width - width;
  const top = bounds.top;
  const bottom = bounds.top + bounds.height - height;
  const centerX = bounds.left + (bounds.width - width) / 2;
  const centerY = bounds.top + (bounds.height - height) / 2;
  return [
    { left, top, side: "fallback" },
    { left: right, top, side: "fallback" },
    { left, top: bottom, side: "fallback" },
    { left: right, top: bottom, side: "fallback" },
    { left: centerX, top, side: "fallback" },
    { left: centerX, top: bottom, side: "fallback" },
    { left, top: centerY, side: "fallback" },
    { left: right, top: centerY, side: "fallback" },
  ];
}

function insetRect(rect: PickerRect, amount: number): PickerRect {
  return {
    left: rect.left + amount,
    top: rect.top + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  };
}

function inflateRect(rect: PickerRect, amount: number): PickerRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function intersectionArea(first: PickerRect, second: PickerRect): number {
  const width = Math.max(
    0,
    Math.min(first.left + first.width, second.left + second.width) -
      Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.top + first.height, second.top + second.height) -
      Math.max(first.top, second.top),
  );
  return width * height;
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
