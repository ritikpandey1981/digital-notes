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
  readonly side: "left" | "right" | "below";
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
): PickerPlacement {
  const candidates =
    source === "quick-rail"
      ? (["left", "right", "below"] as const)
      : (["right", "below", "left"] as const);
  const positions = {
    left: {
      left: anchor.left - PICKER_GAP - picker.width,
      top: anchor.top + anchor.height / 2 - picker.height / 2,
      side: "left" as const,
    },
    right: {
      left: anchor.left + anchor.width + PICKER_GAP,
      top: anchor.top + anchor.height / 2 - picker.height / 2,
      side: "right" as const,
    },
    below: {
      left: anchor.left + anchor.width / 2 - picker.width / 2,
      top: anchor.top + anchor.height + PICKER_GAP,
      side: "below" as const,
    },
  };
  const fitting = candidates
    .map((side) => positions[side])
    .find(
      ({ left, top }) =>
        left >= VIEWPORT_PADDING &&
        top >= VIEWPORT_PADDING &&
        left + picker.width <= viewport.width - VIEWPORT_PADDING &&
        top + picker.height <= viewport.height - VIEWPORT_PADDING,
    );
  const preferred = fitting ?? positions[candidates[0]];
  return Object.freeze({
    side: preferred.side,
    left: clamp(
      preferred.left,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, viewport.width - VIEWPORT_PADDING - picker.width),
    ),
    top: clamp(
      preferred.top,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, viewport.height - VIEWPORT_PADDING - picker.height),
    ),
  });
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

function parseRgbChannel(draft: string): number | null {
  if (!/^\d{1,3}$/u.test(draft)) return null;
  const value = Number(draft);
  return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(Math.max(value, minimum), maximum);
}
