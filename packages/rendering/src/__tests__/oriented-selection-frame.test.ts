import { describe, expect, it } from "vitest";
import { orientedFrameGeometry, type SelectionOverlayOrientation } from "../index";

/**
 * M-013: a single selected object's frame follows its transform instead of
 * boxing the axis-aligned extent. The geometry is local rectangle corners put
 * through the object transform — never a hull fitted to stroke points.
 */
function orientation(
  overrides: Partial<SelectionOverlayOrientation> = {},
): SelectionOverlayOrientation {
  return {
    localBounds: { x: 0, y: 0, width: 100, height: 40 },
    pivot: { x: 50, y: 20 },
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    ...overrides,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe("oriented selection frame", () => {
  it("returns the padded local rectangle at 0°", () => {
    const frame = orientedFrameGeometry(orientation(), 4, 1);

    expect(frame.corners.map(({ x, y }) => [x, y])).toEqual([
      [-4, -4],
      [104, -4],
      [104, 44],
      [-4, 44],
    ]);
    expect(frame.topMidpoint).toEqual({ x: 50, y: -4 });
    expect(frame.rotationHandle).toEqual({ x: 50, y: -32 });
  });

  it.each([30, 90, 180])("rotates every corner about the pivot at %s°", (degrees) => {
    const rotation = (degrees * Math.PI) / 180;
    const frame = orientedFrameGeometry(orientation({ rotation }), 0, 1);
    const pivot = { x: 50, y: 20 };

    // A rotation preserves each corner's distance from the pivot exactly.
    const distances = frame.corners.map(({ x, y }) => round(Math.hypot(x - pivot.x, y - pivot.y)));
    expect(distances).toEqual([
      round(Math.hypot(50, 20)),
      round(Math.hypot(50, 20)),
      round(Math.hypot(50, 20)),
      round(Math.hypot(50, 20)),
    ]);
    // Opposite corners still straddle the pivot, so the frame stayed a rectangle.
    expect(round((frame.corners[0]!.x + frame.corners[2]!.x) / 2)).toBe(pivot.x);
    expect(round((frame.corners[0]!.y + frame.corners[2]!.y) / 2)).toBe(pivot.y);
  });

  it("puts the rotation handle above the frame in the frame's own direction", () => {
    const upright = orientedFrameGeometry(orientation(), 4, 1);
    const quarterTurn = orientedFrameGeometry(orientation({ rotation: Math.PI / 2 }), 4, 1);

    expect(upright.rotationHandle.y).toBeLessThan(upright.topMidpoint.y);
    // Screen y grows downward, so a positive quarter turn carries the frame's
    // "up" direction to the right of the top midpoint.
    expect(round(quarterTurn.rotationHandle.x)).toBeGreaterThan(round(quarterTurn.topMidpoint.x));
    expect(round(quarterTurn.rotationHandle.y)).toBe(round(quarterTurn.topMidpoint.y));
  });

  it("keeps padding and the handle offset screen-stable under scale and zoom", () => {
    const scaled = orientedFrameGeometry(orientation({ scale: 4 }), 4, 1);
    const zoomed = orientedFrameGeometry(orientation(), 4, 4);

    // Four screen pixels of padding at scale 4 is one page unit before scaling,
    // so the drawn frame sits 4 device pixels outside the artwork either way.
    expect(round(scaled.corners[0]!.x)).toBe(round(50 - (50 + 1) * 4));
    expect(round(zoomed.corners[0]!.x)).toBe(-1);
  });

  it("follows translation without changing the frame's shape", () => {
    const moved = orientedFrameGeometry(orientation({ translation: { x: 25, y: -10 } }), 0, 1);

    expect(moved.corners.map(({ x, y }) => [x, y])).toEqual([
      [25, -10],
      [125, -10],
      [125, 30],
      [25, 30],
    ]);
  });

  it("handles a tiny object without collapsing the handle onto the frame", () => {
    const tiny = orientedFrameGeometry(
      orientation({
        localBounds: { x: 0, y: 0, width: 0.2, height: 0.2 },
        pivot: { x: 0.1, y: 0.1 },
      }),
      4,
      1,
    );

    expect(tiny.rotationHandle.y).toBeLessThan(tiny.corners[0]!.y);
    expect(round(tiny.corners[1]!.x - tiny.corners[0]!.x)).toBe(8.2);
  });
});
