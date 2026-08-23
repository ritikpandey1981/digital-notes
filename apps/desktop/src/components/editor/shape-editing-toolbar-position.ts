import type { ShapeEditingSnapshot } from "@folio/editor";

export interface ShapeEditingToolbarSize {
  readonly width: number;
  readonly height: number;
}

export interface ShapeEditingToolbarPlacement extends ShapeEditingToolbarSize {
  readonly left: number;
  readonly top: number;
  readonly side: "above" | "below" | "left" | "right" | "fallback";
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PlacementCandidate {
  readonly left: number;
  readonly top: number;
  readonly side: ShapeEditingToolbarPlacement["side"];
}

const VIEWPORT_MARGIN = 12;
const CONTROL_SAFETY_GAP = 12;
const TOOLBAR_FALLBACK_WIDTH = 326;
const TOOLBAR_FALLBACK_HEIGHT = 48;

// These mirror the editor's screen-stable selection interaction geometry.
const SELECTION_OUTLINE_PADDING = 4;
const SELECTION_HANDLE_HIT_RADIUS = 12;
const ROTATION_HANDLE_OFFSET = 28;
const LINE_HANDLE_HIT_RADIUS = 10;

/** Places the shape toolbar without intersecting the selected object's interaction controls. */
export function resolveShapeEditingToolbarPlacement(
  snapshot: ShapeEditingSnapshot,
  measuredSize: ShapeEditingToolbarSize,
): ShapeEditingToolbarPlacement {
  const viewport = snapshot.viewportSize;
  const width = Math.min(
    measuredSize.width > 0 ? measuredSize.width : TOOLBAR_FALLBACK_WIDTH,
    Math.max(0, viewport.width - VIEWPORT_MARGIN * 2),
  );
  const height = Math.min(
    measuredSize.height > 0 ? measuredSize.height : TOOLBAR_FALLBACK_HEIGHT,
    Math.max(0, viewport.height - VIEWPORT_MARGIN * 2),
  );
  const interactionBounds = selectionInteractionBounds(snapshot);
  const controlRects = selectionControlRects(snapshot);
  const centerX = snapshot.viewportBounds.x + snapshot.viewportBounds.width / 2;
  const centerY = snapshot.viewportBounds.y + snapshot.viewportBounds.height / 2;
  const candidates: readonly PlacementCandidate[] = [
    {
      left: clampHorizontal(centerX - width / 2, width, viewport.width),
      top: interactionBounds.y - CONTROL_SAFETY_GAP - height,
      side: "above",
    },
    {
      left: clampHorizontal(centerX - width / 2, width, viewport.width),
      top: interactionBounds.y + interactionBounds.height + CONTROL_SAFETY_GAP,
      side: "below",
    },
    {
      left: interactionBounds.x - CONTROL_SAFETY_GAP - width,
      top: clampVertical(centerY - height / 2, height, viewport.height),
      side: "left",
    },
    {
      left: interactionBounds.x + interactionBounds.width + CONTROL_SAFETY_GAP,
      top: clampVertical(centerY - height / 2, height, viewport.height),
      side: "right",
    },
  ];
  const preferred = candidates.find(
    (candidate) =>
      insideViewport(candidate, width, height, viewport.width, viewport.height) &&
      collisionFree(candidate, width, height, controlRects),
  );
  if (preferred !== undefined) return placement(preferred, width, height);

  const clampedCandidates = candidates.map((candidate) => ({
    ...candidate,
    left: clampHorizontal(candidate.left, width, viewport.width),
    top: clampVertical(candidate.top, height, viewport.height),
  }));
  const fallbackCandidates = [
    ...clampedCandidates,
    ...viewportFallbackCandidates(width, height, viewport.width, viewport.height),
  ];
  const safeFallback = fallbackCandidates.find((candidate) =>
    collisionFree(candidate, width, height, controlRects),
  );
  if (safeFallback !== undefined) return placement(safeFallback, width, height);

  const leastObstructive = [...fallbackCandidates].sort(
    (first, second) =>
      collisionArea(first, width, height, controlRects) -
      collisionArea(second, width, height, controlRects),
  )[0] ?? { left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, side: "fallback" as const };
  return placement(leastObstructive, width, height);
}

function selectionInteractionBounds(snapshot: ShapeEditingSnapshot): Rect {
  const bounds = snapshot.viewportBounds;
  if (snapshot.objectType === "line") {
    return expandRect(bounds, {
      top: LINE_HANDLE_HIT_RADIUS,
      right: LINE_HANDLE_HIT_RADIUS,
      bottom: LINE_HANDLE_HIT_RADIUS,
      left: LINE_HANDLE_HIT_RADIUS,
    });
  }
  const sideExtent = SELECTION_OUTLINE_PADDING + SELECTION_HANDLE_HIT_RADIUS;
  return expandRect(bounds, {
    top: SELECTION_OUTLINE_PADDING + ROTATION_HANDLE_OFFSET + SELECTION_HANDLE_HIT_RADIUS,
    right: sideExtent,
    bottom: sideExtent,
    left: sideExtent,
  });
}

function selectionControlRects(snapshot: ShapeEditingSnapshot): readonly Rect[] {
  const bounds = snapshot.viewportBounds;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  if (snapshot.objectType === "line") {
    return [
      controlRect(bounds.x, bounds.y, LINE_HANDLE_HIT_RADIUS),
      controlRect(bounds.x + bounds.width, bounds.y, LINE_HANDLE_HIT_RADIUS),
      controlRect(bounds.x, bounds.y + bounds.height, LINE_HANDLE_HIT_RADIUS),
      controlRect(bounds.x + bounds.width, bounds.y + bounds.height, LINE_HANDLE_HIT_RADIUS),
      controlRect(centerX, centerY, LINE_HANDLE_HIT_RADIUS),
    ];
  }
  const left = bounds.x - SELECTION_OUTLINE_PADDING;
  const right = bounds.x + bounds.width + SELECTION_OUTLINE_PADDING;
  const top = bounds.y - SELECTION_OUTLINE_PADDING;
  const bottom = bounds.y + bounds.height + SELECTION_OUTLINE_PADDING;
  const rotationY = top - ROTATION_HANDLE_OFFSET;
  return [
    controlRect(centerX, rotationY, SELECTION_HANDLE_HIT_RADIUS),
    {
      x: centerX - 1,
      y: rotationY,
      width: 2,
      height: top - rotationY,
    },
    controlRect(left, top, SELECTION_HANDLE_HIT_RADIUS),
    controlRect(right, top, SELECTION_HANDLE_HIT_RADIUS),
    controlRect(right, bottom, SELECTION_HANDLE_HIT_RADIUS),
    controlRect(left, bottom, SELECTION_HANDLE_HIT_RADIUS),
  ];
}

function viewportFallbackCandidates(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): readonly PlacementCandidate[] {
  const left = VIEWPORT_MARGIN;
  const right = Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width);
  const top = VIEWPORT_MARGIN;
  const bottom = Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - height);
  const centerX = clampHorizontal(viewportWidth / 2 - width / 2, width, viewportWidth);
  const centerY = clampVertical(viewportHeight / 2 - height / 2, height, viewportHeight);
  const quarterX = clampHorizontal(viewportWidth / 4 - width / 2, width, viewportWidth);
  const threeQuarterX = clampHorizontal((viewportWidth * 3) / 4 - width / 2, width, viewportWidth);
  return [
    { left: centerX, top, side: "fallback" },
    { left: centerX, top: bottom, side: "fallback" },
    { left: quarterX, top, side: "fallback" },
    { left: threeQuarterX, top, side: "fallback" },
    { left: quarterX, top: bottom, side: "fallback" },
    { left: threeQuarterX, top: bottom, side: "fallback" },
    { left, top, side: "fallback" },
    { left: right, top, side: "fallback" },
    { left, top: bottom, side: "fallback" },
    { left: right, top: bottom, side: "fallback" },
    { left, top: centerY, side: "fallback" },
    { left: right, top: centerY, side: "fallback" },
  ];
}

function collisionFree(
  candidate: PlacementCandidate,
  width: number,
  height: number,
  controls: readonly Rect[],
): boolean {
  const toolbar = { x: candidate.left, y: candidate.top, width, height };
  return controls.every(
    (control) => !rectsOverlap(toolbar, inflateRect(control, CONTROL_SAFETY_GAP)),
  );
}

function collisionArea(
  candidate: PlacementCandidate,
  width: number,
  height: number,
  controls: readonly Rect[],
): number {
  const toolbar = { x: candidate.left, y: candidate.top, width, height };
  return controls.reduce((total, control) => {
    const protectedControl = inflateRect(control, CONTROL_SAFETY_GAP);
    const widthOverlap = Math.max(
      0,
      Math.min(toolbar.x + toolbar.width, protectedControl.x + protectedControl.width) -
        Math.max(toolbar.x, protectedControl.x),
    );
    const heightOverlap = Math.max(
      0,
      Math.min(toolbar.y + toolbar.height, protectedControl.y + protectedControl.height) -
        Math.max(toolbar.y, protectedControl.y),
    );
    return total + widthOverlap * heightOverlap;
  }, 0);
}

function insideViewport(
  candidate: PlacementCandidate,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  return (
    candidate.left >= VIEWPORT_MARGIN &&
    candidate.top >= VIEWPORT_MARGIN &&
    candidate.left + width <= viewportWidth - VIEWPORT_MARGIN &&
    candidate.top + height <= viewportHeight - VIEWPORT_MARGIN
  );
}

function controlRect(x: number, y: number, radius: number): Rect {
  return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
}

function expandRect(
  rect: Rect,
  inset: Readonly<{ top: number; right: number; bottom: number; left: number }>,
): Rect {
  return {
    x: rect.x - inset.left,
    y: rect.y - inset.top,
    width: rect.width + inset.left + inset.right,
    height: rect.height + inset.top + inset.bottom,
  };
}

function inflateRect(rect: Rect, amount: number): Rect {
  return expandRect(rect, { top: amount, right: amount, bottom: amount, left: amount });
}

function rectsOverlap(first: Rect, second: Rect): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function clampHorizontal(left: number, width: number, viewportWidth: number): number {
  return clamp(left, VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width);
}

function clampVertical(top: number, height: number, viewportHeight: number): number {
  return clamp(top, VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - height);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function placement(
  candidate: PlacementCandidate,
  width: number,
  height: number,
): ShapeEditingToolbarPlacement {
  return Object.freeze({
    left: candidate.left,
    top: candidate.top,
    width,
    height,
    side: candidate.side,
  });
}
