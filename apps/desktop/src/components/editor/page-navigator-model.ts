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

export const PAGE_THUMBNAIL_WIDTH = 66;
export const PAGE_THUMBNAIL_HEIGHT = 84;
export const PAGE_NAVIGATOR_MAX_WIDTH = 620;
/** Horizontal space reserved on each side for the hint and viewport controls. */
export const PAGE_NAVIGATOR_SIDE_RESERVE = 280;

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

export function describeDeletedPage(label: string, objectCount: number): string {
  if (objectCount === 0) return `${label} deleted`;
  return `${label} deleted with ${objectCount} object${objectCount === 1 ? "" : "s"}`;
}

/** Preset options offered by Page Settings, including the custom sentinel. */
export const PAGE_PRESET_OPTIONS: readonly Readonly<{ id: PagePresetId; label: string }>[] =
  Object.freeze([
    ...PAGE_PRESETS.map((preset) => Object.freeze({ id: preset.id, label: preset.label })),
    Object.freeze({ id: "custom" as PagePresetId, label: "Custom" }),
  ]);

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
