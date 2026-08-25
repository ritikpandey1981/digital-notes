const TOOLTIP_COLLISION_PADDING = 10;
const TOOLTIP_SIDE_GAP = 12;

export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: TooltipSide;
}

export function resolveTooltipPlacement(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height"> | null,
  tooltip: Readonly<{ width: number; height: number }>,
  preferredSide: TooltipSide,
  viewport: Readonly<{ width: number; height: number }>,
): TooltipPlacement {
  if (anchor === null || tooltip.width <= 0 || tooltip.height <= 0) {
    return Object.freeze({ left: 0, top: 0, side: preferredSide });
  }
  const opposite: Readonly<Record<TooltipSide, TooltipSide>> = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right",
  };
  const perpendicular: Readonly<Record<TooltipSide, readonly TooltipSide[]>> = {
    top: ["right", "left"],
    right: ["bottom", "top"],
    bottom: ["right", "left"],
    left: ["bottom", "top"],
  };
  const candidates = [preferredSide, opposite[preferredSide], ...perpendicular[preferredSide]];
  for (const side of candidates) {
    const candidate = tooltipCandidate(anchor, tooltip, side, viewport);
    if (insideTooltipViewport(candidate, tooltip, viewport)) return Object.freeze(candidate);
  }
  const fallback = tooltipCandidate(anchor, tooltip, preferredSide, viewport);
  return Object.freeze({
    left: clamp(
      fallback.left,
      TOOLTIP_COLLISION_PADDING,
      viewport.width - TOOLTIP_COLLISION_PADDING - tooltip.width,
    ),
    top: clamp(
      fallback.top,
      TOOLTIP_COLLISION_PADDING,
      viewport.height - TOOLTIP_COLLISION_PADDING - tooltip.height,
    ),
    side: fallback.side,
  });
}

function tooltipCandidate(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">,
  tooltip: Readonly<{ width: number; height: number }>,
  side: TooltipSide,
  viewport: Readonly<{ width: number; height: number }>,
): TooltipPlacement {
  const centeredLeft = clamp(
    anchor.left + anchor.width / 2 - tooltip.width / 2,
    TOOLTIP_COLLISION_PADDING,
    viewport.width - TOOLTIP_COLLISION_PADDING - tooltip.width,
  );
  const centeredTop = clamp(
    anchor.top + anchor.height / 2 - tooltip.height / 2,
    TOOLTIP_COLLISION_PADDING,
    viewport.height - TOOLTIP_COLLISION_PADDING - tooltip.height,
  );
  switch (side) {
    case "top":
      return { left: centeredLeft, top: anchor.top - TOOLTIP_SIDE_GAP - tooltip.height, side };
    case "bottom":
      return { left: centeredLeft, top: anchor.bottom + TOOLTIP_SIDE_GAP, side };
    case "left":
      return { left: anchor.left - TOOLTIP_SIDE_GAP - tooltip.width, top: centeredTop, side };
    case "right":
      return { left: anchor.right + TOOLTIP_SIDE_GAP, top: centeredTop, side };
  }
}

function insideTooltipViewport(
  candidate: TooltipPlacement,
  tooltip: Readonly<{ width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
): boolean {
  return (
    candidate.left >= TOOLTIP_COLLISION_PADDING &&
    candidate.top >= TOOLTIP_COLLISION_PADDING &&
    candidate.left + tooltip.width <= viewport.width - TOOLTIP_COLLISION_PADDING &&
    candidate.top + tooltip.height <= viewport.height - TOOLTIP_COLLISION_PADDING
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
