import type { Rect, Size } from "@folio/rendering";

/**
 * Geometry for the Eyedropper's magnifier.
 *
 * The loupe is pure presentation over the same base-canvas readback the
 * sampler already performs — it magnifies what is about to be sampled and never
 * decides what the sample is. Everything here is a pure function so the edge
 * and device-pixel-ratio behaviour is testable without a compositor.
 */

/** Diameter of the magnifier circle, in CSS pixels. */
export const LOUPE_DIAMETER = 92;
/** How many logical page pixels span the magnifier, giving its magnification. */
export const LOUPE_SOURCE_PIXELS = 11;
/** Clearance between the pointer and the magnifier's nearest corner. */
export const LOUPE_POINTER_GAP = 18;

export interface LoupePlacement {
  readonly left: number;
  readonly top: number;
  readonly flippedX: boolean;
  readonly flippedY: boolean;
}

/**
 * Places the magnifier beside the pointer without ever covering it.
 *
 * The four diagonal positions are tried in a fixed order, so a pointer near an
 * edge flips the loupe inward rather than letting it hang off the workspace.
 * When the workspace is too small for any of them the first is clamped, which
 * still leaves the hotspot uncovered because the gap is preserved on the axis
 * that fits.
 */
export function resolveLoupePlacement(
  pointer: Readonly<{ x: number; y: number }>,
  workspace: Size,
  size: number = LOUPE_DIAMETER,
  gap: number = LOUPE_POINTER_GAP,
): LoupePlacement {
  const candidates: readonly LoupePlacement[] = [
    { left: pointer.x + gap, top: pointer.y - size - gap, flippedX: false, flippedY: false },
    { left: pointer.x - size - gap, top: pointer.y - size - gap, flippedX: true, flippedY: false },
    { left: pointer.x + gap, top: pointer.y + gap, flippedX: false, flippedY: true },
    { left: pointer.x - size - gap, top: pointer.y + gap, flippedX: true, flippedY: true },
  ];
  const fits = candidates.find(
    ({ left, top }) =>
      left >= 0 && top >= 0 && left + size <= workspace.width && top + size <= workspace.height,
  );
  if (fits !== undefined) return Object.freeze(fits);
  const first = candidates[0]!;
  return Object.freeze({
    left: clamp(first.left, 0, Math.max(0, workspace.width - size)),
    top: clamp(first.top, 0, Math.max(0, workspace.height - size)),
    flippedX: first.flippedX,
    flippedY: first.flippedY,
  });
}

/**
 * The backing-store rectangle the magnifier copies from.
 *
 * The sample point arrives in backing pixels, so the window scales with the
 * device pixel ratio and stays centred on the sampled pixel. It is clamped to
 * the canvas, which keeps a page-edge sample readable instead of drawing from
 * outside the backing store.
 */
export function resolveLoupeSourceRect(
  backingPoint: Readonly<{ x: number; y: number }>,
  backingSize: Size,
  devicePixelRatio: number,
  sourcePixels: number = LOUPE_SOURCE_PIXELS,
): Rect {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    throw new RangeError("Loupe magnification requires a positive finite device pixel ratio.");
  }
  // Forced odd so the window always has one exact middle pixel; an even window
  // leaves the sampled pixel half a pixel off centre, which reads as a
  // magnifier that is pointing slightly beside the cursor.
  const extent = Math.max(1, Math.round(sourcePixels * devicePixelRatio)) | 1;
  const half = (extent - 1) / 2;
  const maximumX = Math.max(0, backingSize.width - extent);
  const maximumY = Math.max(0, backingSize.height - extent);
  return Object.freeze({
    x: clamp(Math.round(backingPoint.x - half), 0, maximumX),
    y: clamp(Math.round(backingPoint.y - half), 0, maximumY),
    width: Math.min(extent, backingSize.width),
    height: Math.min(extent, backingSize.height),
  });
}

/**
 * Where the sampled pixel lands inside the magnifier, in CSS pixels.
 *
 * Clamping the source rectangle at a canvas edge moves the sampled pixel off
 * the magnifier's centre, so the indicator follows it rather than lying about
 * which pixel is under the cursor.
 */
export function resolveLoupeCenterIndicator(
  backingPoint: Readonly<{ x: number; y: number }>,
  source: Rect,
  size: number = LOUPE_DIAMETER,
): Readonly<{ left: number; top: number; size: number }> {
  const magnification = size / Math.max(source.width, 1);
  return Object.freeze({
    left: (Math.round(backingPoint.x) - source.x) * magnification,
    top: (Math.round(backingPoint.y) - source.y) * magnification,
    size: Math.max(1, magnification),
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
