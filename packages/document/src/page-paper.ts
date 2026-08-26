import { normalizeHexColor } from "./editable-style";
import { LayerMembershipError } from "./errors";

export type PaperType = "blank" | "ruled" | "grid" | "dotted" | "isometric";

export interface PaperTypeDefinition {
  readonly id: PaperType;
  readonly label: string;
  /** Pattern spacing in page-space units, or null for blank paper. */
  readonly defaultSpacing: number | null;
}

export const PAPER_TYPES: readonly PaperTypeDefinition[] = Object.freeze([
  Object.freeze({ id: "blank" as const, label: "Blank", defaultSpacing: null }),
  Object.freeze({ id: "ruled" as const, label: "Ruled", defaultSpacing: 32 }),
  Object.freeze({ id: "grid" as const, label: "Grid", defaultSpacing: 24 }),
  Object.freeze({ id: "dotted" as const, label: "Dotted", defaultSpacing: 24 }),
  Object.freeze({ id: "isometric" as const, label: "Isometric", defaultSpacing: 32 }),
]);

export const MINIMUM_PAPER_SPACING = 4;
export const MAXIMUM_PAPER_SPACING = 400;

export const DEFAULT_PAPER_COLOR = "#fffdf8";

/** Restrained built-in paper colors. Custom values are still accepted. */
export const PAPER_COLOR_PRESETS: readonly Readonly<{ label: string; hex: string }>[] =
  Object.freeze([
    Object.freeze({ label: "White", hex: "#ffffff" }),
    Object.freeze({ label: "Warm white", hex: "#fffdf8" }),
    Object.freeze({ label: "Cream", hex: "#fbf3e0" }),
    Object.freeze({ label: "Light gray", hex: "#ececed" }),
  ]);

/**
 * Page paper: a presentation property of the page itself.
 *
 * Paper is not a PageObject, not a Layer, and not editor theme. It renders below
 * every Layer, is clipped to page bounds, and never participates in selection,
 * hit testing, or erasing.
 */
export interface PagePaper {
  readonly type: PaperType;
  readonly color: string;
  /** Present for every patterned paper type; absent for blank. */
  readonly spacing?: number;
}

export interface PagePaperInput {
  readonly type?: PaperType;
  readonly color?: string;
  readonly spacing?: number;
}

export function paperTypeDefinition(type: PaperType): PaperTypeDefinition {
  const definition = PAPER_TYPES.find((candidate) => candidate.id === type);
  if (definition === undefined) {
    throw new LayerMembershipError("INVALID_PAPER", `Unknown paper type '${type}'.`, { type });
  }
  return definition;
}

/** Validates and freezes one paper description. */
export function createPagePaper(input: PagePaperInput = {}): PagePaper {
  const type = input.type ?? "blank";
  const definition = paperTypeDefinition(type);
  const color = normalizeHexColor(input.color ?? DEFAULT_PAPER_COLOR);
  if (definition.defaultSpacing === null) {
    return Object.freeze({ type, color });
  }
  const spacing = input.spacing ?? definition.defaultSpacing;
  if (
    !Number.isFinite(spacing) ||
    spacing < MINIMUM_PAPER_SPACING ||
    spacing > MAXIMUM_PAPER_SPACING
  ) {
    throw new LayerMembershipError(
      "INVALID_PAPER",
      `Paper spacing must be between ${MINIMUM_PAPER_SPACING} and ${MAXIMUM_PAPER_SPACING}.`,
      { type, spacing },
    );
  }
  return Object.freeze({ type, color, spacing });
}

export const DEFAULT_PAGE_PAPER: PagePaper = createPagePaper();

export function samePagePaper(first: PagePaper, second: PagePaper): boolean {
  return (
    first.type === second.type && first.color === second.color && first.spacing === second.spacing
  );
}
