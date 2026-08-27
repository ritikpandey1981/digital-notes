import type { PageSnapshot, PagesSnapshot } from "@folio/editor";
import {
  MAXIMUM_PAGE_EXTENT,
  MINIMUM_PAGE_EXTENT,
  matchPagePreset,
  PAGE_PRESETS,
  type PagePresetId,
} from "@folio/editor";

/** One navigator row. Pages read left to right, matching document order. */
export interface PageRow extends PageSnapshot {
  readonly active: boolean;
  readonly canMovePrevious: boolean;
  readonly canMoveNext: boolean;
  readonly label: string;
}

export const PAGE_THUMBNAIL_HEIGHT = 66;
export const PAGE_THUMBNAIL_MINIMUM_WIDTH = 44;
export const PAGE_THUMBNAIL_MAXIMUM_WIDTH = 104;

/**
 * Thumbnail card size for one page.
 *
 * The card follows the page's own aspect so a landscape page reads as landscape
 * in the filmstrip instead of being letterboxed inside a portrait frame.
 */
export function pageThumbnailSize(
  page: Pick<PageSnapshot, "width" | "height">,
): Readonly<{ width: number; height: number }> {
  const aspect = page.width / page.height;
  const width = Math.round(
    Math.min(
      PAGE_THUMBNAIL_MAXIMUM_WIDTH,
      Math.max(PAGE_THUMBNAIL_MINIMUM_WIDTH, PAGE_THUMBNAIL_HEIGHT * aspect),
    ),
  );
  return Object.freeze({ width, height: PAGE_THUMBNAIL_HEIGHT });
}
export const PAGE_NAVIGATOR_MAX_WIDTH = 620;
/**
 * Horizontal space reserved on each side of the centred navigator.
 *
 * Sized so the strip can never reach the Layers / Page Settings slot on the
 * right or the tool dock on the left, at any supported window width.
 */
export const PAGE_NAVIGATOR_SIDE_RESERVE = 340;

export function pageRows(snapshot: PagesSnapshot): readonly PageRow[] {
  const total = snapshot.pages.length;
  return Object.freeze(
    snapshot.pages.map((page) =>
      Object.freeze({
        ...page,
        active: page.id === snapshot.activePageId,
        canMovePrevious: page.index > 0,
        canMoveNext: page.index < total - 1,
        label: page.name.trim().length > 0 ? page.name : `Page ${page.index + 1}`,
      }),
    ),
  );
}

/** Resolves the target index for a relative page move, or null at the ends. */
export function pageMoveTarget(
  row: Pick<PageRow, "index">,
  direction: "previous" | "next",
  pageCount: number,
): number | null {
  const target = direction === "previous" ? row.index - 1 : row.index + 1;
  return target < 0 || target > pageCount - 1 ? null : target;
}

export function canDeletePage(pageCount: number): boolean {
  return pageCount > 1;
}

export function nextPageFocusIndex(
  currentIndex: number,
  direction: "previous" | "next",
  pageCount: number,
): number {
  if (pageCount === 0) return 0;
  const next = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
  return Math.min(Math.max(next, 0), pageCount - 1);
}

/** One concise sentence; the notification title carries it alone. */
export function describeDeletedPage(label: string, objectCount: number): string {
  if (objectCount === 0) return `${label} deleted`;
  return `${label} deleted with ${objectCount} object${objectCount === 1 ? "" : "s"}`;
}

/**
 * Preset options offered by Page Settings.
 *
 * "Custom" is a state the width and height fields produce, never an option the
 * user picks, so it is only listed while the current geometry matches no preset.
 */
export const PAGE_PRESET_OPTIONS: readonly Readonly<{ id: PagePresetId; label: string }>[] =
  Object.freeze(
    PAGE_PRESETS.map((preset) => Object.freeze({ id: preset.id, label: preset.label })),
  );

export function pagePresetOptions(
  activeId: PagePresetId,
): readonly Readonly<{ id: PagePresetId; label: string }>[] {
  if (activeId !== "custom") return PAGE_PRESET_OPTIONS;
  return Object.freeze([
    ...PAGE_PRESET_OPTIONS,
    Object.freeze({ id: "custom" as PagePresetId, label: "Custom" }),
  ]);
}

export function activePresetId(page: Pick<PageSnapshot, "width" | "height">): PagePresetId {
  return matchPagePreset({ width: page.width, height: page.height });
}

/**
 * Parses one page-dimension draft.
 *
 * Typing is draft state; this only reports whether a committed value is usable,
 * so a partially typed number never reaches History.
 */
export function parsePageExtent(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MINIMUM_PAGE_EXTENT || rounded > MAXIMUM_PAGE_EXTENT) return null;
  return rounded;
}
