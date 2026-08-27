/**
 * The editor's one shared model of which workspace rectangles a floating
 * surface may not, or would rather not, cover.
 *
 * Before this existed each floating surface carried its own private idea of
 * "chrome to avoid": the color picker collected a handful of DOM rects, the
 * selection toolbar collected selection handles, and neither knew about the
 * other. Ad-hoc weighting tweaks kept fixing one arrangement by breaking
 * another. This module replaces the weighting guesswork with two explicit
 * classes of zone and one deterministic resolution order.
 *
 * HARD zones are controls and panels that must stay reachable. SOFT zones are
 * the artwork or interaction region a surface should stay off when it can, but
 * may cover when the workspace leaves no honest alternative.
 */

export interface WorkspaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type OccupiedZoneKind = "hard" | "soft";

export interface OccupiedZone {
  /** Stable identifier, used for diagnostics and test assertions. */
  readonly id: string;
  readonly kind: OccupiedZoneKind;
  readonly rect: WorkspaceRect;
}

/** One position a surface could take, in the order its owner prefers it. */
export interface PlacementCandidate {
  readonly left: number;
  readonly top: number;
  /** Owner-defined label describing where the candidate came from. */
  readonly reason: string;
}

export interface OccupiedPlacementRequest {
  readonly surface: Readonly<{ width: number; height: number }>;
  /** Usable workspace. Every resolved placement is clamped inside it. */
  readonly bounds: WorkspaceRect;
  readonly candidates: readonly PlacementCandidate[];
  readonly zones: readonly OccupiedZone[];
  /** Launch anchor. Ties break toward the candidate nearest to it. */
  readonly anchor?: WorkspaceRect | undefined;
  /** Breathing room required around hard zones. */
  readonly hardGap?: number;
}

export interface ResolvedPlacement {
  readonly left: number;
  readonly top: number;
  readonly reason: string;
  readonly hardOverlap: number;
  readonly softOverlap: number;
  readonly clampDistance: number;
  readonly anchorDistance: number;
}

export const DEFAULT_HARD_ZONE_GAP = 8;

export function hardZone(id: string, rect: WorkspaceRect | undefined): OccupiedZone | null {
  return rect === undefined ? null : Object.freeze({ id, kind: "hard" as const, rect });
}

export function softZone(id: string, rect: WorkspaceRect | undefined): OccupiedZone | null {
  return rect === undefined ? null : Object.freeze({ id, kind: "soft" as const, rect });
}

/** Drops the absent surfaces so callers can list every zone unconditionally. */
export function collectZones(zones: readonly (OccupiedZone | null)[]): readonly OccupiedZone[] {
  return Object.freeze(zones.filter((zone): zone is OccupiedZone => zone !== null));
}

/**
 * Resolves one placement under the editor's fixed priority order:
 *
 * 1. remain inside the usable workspace (every candidate is clamped)
 * 2. avoid hard occupied chrome
 * 3. avoid soft zones such as the selected artwork
 * 4. stay near the launch anchor
 * 5. deterministic candidate order
 *
 * The first candidate that clears both zone classes wins outright: candidate
 * order already encodes "near the anchor first", so scanning it keeps the
 * common case cheap and obviously predictable. Clamping is not disqualifying —
 * a clamped candidate is still inside the workspace, and the anchor itself is
 * normally a hard zone, so clamping a surface back over its own trigger is
 * rejected on overlap rather than on distance. Only when nothing is clean does
 * the full set get ranked, so an impossible workspace still yields the least
 * obstructive position rather than an arbitrary corner.
 */
export function resolveOccupiedAwarePlacement(
  request: OccupiedPlacementRequest,
): ResolvedPlacement {
  const { bounds, zones, anchor } = request;
  const hardGap = request.hardGap ?? DEFAULT_HARD_ZONE_GAP;
  const width = Math.min(Math.max(0, request.surface.width), Math.max(0, bounds.width));
  const height = Math.min(Math.max(0, request.surface.height), Math.max(0, bounds.height));
  const maximumLeft = bounds.left + bounds.width - width;
  const maximumTop = bounds.top + bounds.height - height;
  const hardRects = zones
    .filter((zone) => zone.kind === "hard")
    .map((zone) => inflateRect(zone.rect, hardGap));
  const softRects = zones.filter((zone) => zone.kind === "soft").map((zone) => zone.rect);
  const anchorCenter =
    anchor === undefined
      ? null
      : { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 };

  const evaluated = request.candidates.map((candidate, index) => {
    const left = clamp(candidate.left, bounds.left, maximumLeft);
    const top = clamp(candidate.top, bounds.top, maximumTop);
    const rect = { left, top, width, height };
    const center = { x: left + width / 2, y: top + height / 2 };
    return Object.freeze({
      index,
      left,
      top,
      reason: candidate.reason,
      hardOverlap: hardRects.reduce((total, hard) => total + intersectionArea(rect, hard), 0),
      softOverlap: softRects.reduce((total, soft) => total + intersectionArea(rect, soft), 0),
      clampDistance: Math.abs(candidate.left - left) + Math.abs(candidate.top - top),
      anchorDistance:
        anchorCenter === null
          ? 0
          : Math.hypot(center.x - anchorCenter.x, center.y - anchorCenter.y),
    });
  });

  const clean = evaluated.find(
    ({ hardOverlap, softOverlap }) => hardOverlap === 0 && softOverlap === 0,
  );
  const best =
    clean ??
    [...evaluated].sort(
      (first, second) =>
        first.hardOverlap - second.hardOverlap ||
        first.softOverlap - second.softOverlap ||
        first.clampDistance - second.clampDistance ||
        first.anchorDistance - second.anchorDistance ||
        first.index - second.index,
    )[0];
  if (best === undefined) {
    return Object.freeze({
      left: bounds.left,
      top: bounds.top,
      reason: "empty",
      hardOverlap: 0,
      softOverlap: 0,
      clampDistance: 0,
      anchorDistance: 0,
    });
  }
  return Object.freeze({
    left: best.left,
    top: best.top,
    reason: best.reason,
    hardOverlap: best.hardOverlap,
    softOverlap: best.softOverlap,
    clampDistance: best.clampDistance,
    anchorDistance: best.anchorDistance,
  });
}

/** The four positions immediately outside a rectangle, in reading order. */
export function candidatesAroundRect(
  rect: WorkspaceRect,
  surface: Readonly<{ width: number; height: number }>,
  gap: number,
  reasonPrefix: string,
): readonly PlacementCandidate[] {
  return Object.freeze([
    {
      left: rect.left + rect.width + gap,
      top: rect.top,
      reason: `${reasonPrefix}-right`,
    },
    {
      left: rect.left - gap - surface.width,
      top: rect.top,
      reason: `${reasonPrefix}-left`,
    },
    {
      left: rect.left + rect.width / 2 - surface.width / 2,
      top: rect.top + rect.height + gap,
      reason: `${reasonPrefix}-below`,
    },
    {
      left: rect.left + rect.width / 2 - surface.width / 2,
      top: rect.top - gap - surface.height,
      reason: `${reasonPrefix}-above`,
    },
  ]);
}

/** Deterministic last-resort positions spread across the usable workspace. */
export function workspaceFallbackCandidates(
  bounds: WorkspaceRect,
  surface: Readonly<{ width: number; height: number }>,
): readonly PlacementCandidate[] {
  const left = bounds.left;
  const right = bounds.left + bounds.width - surface.width;
  const top = bounds.top;
  const bottom = bounds.top + bounds.height - surface.height;
  const centerX = bounds.left + (bounds.width - surface.width) / 2;
  const centerY = bounds.top + (bounds.height - surface.height) / 2;
  return Object.freeze([
    { left: right, top, reason: "fallback-top-right" },
    { left, top, reason: "fallback-top-left" },
    { left: right, top: bottom, reason: "fallback-bottom-right" },
    { left, top: bottom, reason: "fallback-bottom-left" },
    { left: right, top: centerY, reason: "fallback-right" },
    { left, top: centerY, reason: "fallback-left" },
    { left: centerX, top, reason: "fallback-top" },
    { left: centerX, top: bottom, reason: "fallback-bottom" },
  ]);
}

export function unionRects(first: WorkspaceRect, second: WorkspaceRect): WorkspaceRect {
  const left = Math.min(first.left, second.left);
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.left + first.width, second.left + second.width);
  const bottom = Math.max(first.top + first.height, second.top + second.height);
  return Object.freeze({ left, top, width: right - left, height: bottom - top });
}

export function insetRect(rect: WorkspaceRect, amount: number): WorkspaceRect {
  return Object.freeze({
    left: rect.left + amount,
    top: rect.top + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  });
}

export function inflateRect(rect: WorkspaceRect, amount: number): WorkspaceRect {
  return Object.freeze({
    left: rect.left - amount,
    top: rect.top - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  });
}

export function intersectionArea(first: WorkspaceRect, second: WorkspaceRect): number {
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
