import { LayerMembershipError } from "./errors";

/** Page extent in page-space units. Orientation is always derived from these. */
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
}

export type PageOrientation = "portrait" | "landscape" | "square";

export type PagePresetId = "a4" | "a5" | "letter" | "square" | "screen" | "custom";

export interface PagePreset {
  readonly id: PagePresetId;
  readonly label: string;
  /** Portrait-oriented extent. Landscape simply swaps the two values. */
  readonly geometry: PageGeometry;
  /** Square and screen presets have no meaningful orientation swap. */
  readonly orientable: boolean;
}

/** Smallest and largest page extent accepted from custom input. */
export const MINIMUM_PAGE_EXTENT = 64;
export const MAXIMUM_PAGE_EXTENT = 20_000;

/**
 * Built-in page presets in page-space units at 96 units per inch.
 *
 * DPI is deliberately absent: page-space units are the document's own
 * coordinate system, and physical resolution is an export concern.
 */
export const PAGE_PRESETS: readonly PagePreset[] = Object.freeze([
  Object.freeze({
    id: "a4" as const,
    label: "A4",
    geometry: Object.freeze({ width: 794, height: 1123 }),
    orientable: true,
  }),
  Object.freeze({
    id: "a5" as const,
    label: "A5",
    geometry: Object.freeze({ width: 559, height: 794 }),
    orientable: true,
  }),
  Object.freeze({
    id: "letter" as const,
    label: "US Letter",
    geometry: Object.freeze({ width: 816, height: 1056 }),
    orientable: true,
  }),
  Object.freeze({
    id: "square" as const,
    label: "Square",
    geometry: Object.freeze({ width: 900, height: 900 }),
    orientable: false,
  }),
  Object.freeze({
    id: "screen" as const,
    label: "Screen",
    geometry: Object.freeze({ width: 1080, height: 1920 }),
    orientable: true,
  }),
]);

/**
 * A new sketchbook opens on A4 landscape.
 *
 * Sketching favours the wider format, and every later page inherits the current
 * page instead of this constant, so an existing document is never re-oriented.
 */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = Object.freeze({ width: 1123, height: 794 });

/** Validates and freezes one page extent. */
export function createPageGeometry(geometry: PageGeometry): PageGeometry {
  const { width, height } = geometry;
  for (const [name, value] of [
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isFinite(value) || value < MINIMUM_PAGE_EXTENT || value > MAXIMUM_PAGE_EXTENT) {
      throw new LayerMembershipError(
        "INVALID_PAGE_GEOMETRY",
        `Page ${name} must be between ${MINIMUM_PAGE_EXTENT} and ${MAXIMUM_PAGE_EXTENT}.`,
        { width, height },
      );
    }
  }
  return Object.freeze({ width, height });
}

/** Orientation is derived, never stored, so the two can never disagree. */
export function pageOrientation(geometry: PageGeometry): PageOrientation {
  if (geometry.width === geometry.height) return "square";
  return geometry.width < geometry.height ? "portrait" : "landscape";
}

/** Returns the same extent expressed in one orientation. */
export function orientPageGeometry(
  geometry: PageGeometry,
  orientation: Exclude<PageOrientation, "square">,
): PageGeometry {
  const shorter = Math.min(geometry.width, geometry.height);
  const longer = Math.max(geometry.width, geometry.height);
  return createPageGeometry(
    orientation === "portrait"
      ? { width: shorter, height: longer }
      : { width: longer, height: shorter },
  );
}

export function pagePreset(id: PagePresetId): PagePreset | undefined {
  return PAGE_PRESETS.find((preset) => preset.id === id);
}

/** Resolves the preset a geometry matches, falling back to "custom". */
export function matchPagePreset(geometry: PageGeometry): PagePresetId {
  const shorter = Math.min(geometry.width, geometry.height);
  const longer = Math.max(geometry.width, geometry.height);
  const match = PAGE_PRESETS.find(
    (preset) =>
      Math.min(preset.geometry.width, preset.geometry.height) === shorter &&
      Math.max(preset.geometry.width, preset.geometry.height) === longer,
  );
  return match?.id ?? "custom";
}
