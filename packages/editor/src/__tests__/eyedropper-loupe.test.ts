import { describe, expect, it } from "vitest";
import {
  LOUPE_DIAMETER,
  LOUPE_POINTER_GAP,
  LOUPE_SOURCE_PIXELS,
  resolveLoupeCenterIndicator,
  resolveLoupePlacement,
  resolveLoupeSourceRect,
} from "../EyedropperLoupe";

const WORKSPACE = { width: 1000, height: 700 };

describe("eyedropper loupe placement", () => {
  it("opens above and right of the pointer in open space", () => {
    const placement = resolveLoupePlacement({ x: 400, y: 400 }, WORKSPACE);

    expect(placement).toEqual({
      left: 400 + LOUPE_POINTER_GAP,
      top: 400 - LOUPE_DIAMETER - LOUPE_POINTER_GAP,
      flippedX: false,
      flippedY: false,
    });
  });

  it.each([
    ["top-left corner", { x: 4, y: 4 }, false, true],
    ["top edge", { x: 500, y: 6 }, false, true],
    ["right edge", { x: 996, y: 400 }, true, false],
    ["bottom-right corner", { x: 994, y: 694 }, true, false],
    ["left edge", { x: 6, y: 400 }, false, false],
    ["bottom edge", { x: 500, y: 696 }, false, false],
  ] as const)("flips inward at the %s", (_label, pointer, flippedX, flippedY) => {
    const placement = resolveLoupePlacement(pointer, WORKSPACE);

    expect(placement.flippedX).toBe(flippedX);
    expect(placement.flippedY).toBe(flippedY);
    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.left + LOUPE_DIAMETER).toBeLessThanOrEqual(WORKSPACE.width);
    expect(placement.top + LOUPE_DIAMETER).toBeLessThanOrEqual(WORKSPACE.height);
  });

  it("never covers the sampling hotspot", () => {
    for (let x = 0; x <= WORKSPACE.width; x += 50) {
      for (let y = 0; y <= WORKSPACE.height; y += 50) {
        const { left, top } = resolveLoupePlacement({ x, y }, WORKSPACE);
        const coversPointer =
          x >= left && x <= left + LOUPE_DIAMETER && y >= top && y <= top + LOUPE_DIAMETER;
        expect(coversPointer).toBe(false);
      }
    }
  });

  it("stays inside a workspace too small for any diagonal position", () => {
    const tiny = { width: 100, height: 100 };
    const placement = resolveLoupePlacement({ x: 50, y: 50 }, tiny);

    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.top).toBeGreaterThanOrEqual(0);
    expect(placement.left).toBeLessThanOrEqual(Math.max(0, tiny.width - LOUPE_DIAMETER));
  });
});

describe("eyedropper loupe source geometry", () => {
  it.each([1, 1.5, 2, 3])("scales the source window with a %sx device pixel ratio", (ratio) => {
    const backingSize = { width: 2000, height: 1400 };
    const source = resolveLoupeSourceRect({ x: 800, y: 600 }, backingSize, ratio);

    expect(source.width).toBe(Math.max(1, Math.round(LOUPE_SOURCE_PIXELS * ratio)) | 1);
    expect(source.width % 2).toBe(1);
    expect(source.height).toBe(source.width);
    // The sampled pixel stays centred inside the window.
    expect(Math.abs(source.x + source.width / 2 - 800)).toBeLessThanOrEqual(1);
    expect(Math.abs(source.y + source.height / 2 - 600)).toBeLessThanOrEqual(1);
  });

  it("clamps the source window to the backing store at a canvas edge", () => {
    const backingSize = { width: 400, height: 300 };
    const topLeft = resolveLoupeSourceRect({ x: 0, y: 0 }, backingSize, 2);
    const bottomRight = resolveLoupeSourceRect({ x: 399, y: 299 }, backingSize, 2);

    expect(topLeft.x).toBe(0);
    expect(topLeft.y).toBe(0);
    expect(bottomRight.x + bottomRight.width).toBe(backingSize.width);
    expect(bottomRight.y + bottomRight.height).toBe(backingSize.height);
  });

  it("refuses a non-finite device pixel ratio rather than drawing nonsense", () => {
    expect(() => resolveLoupeSourceRect({ x: 10, y: 10 }, { width: 100, height: 100 }, 0)).toThrow(
      RangeError,
    );
    expect(() =>
      resolveLoupeSourceRect({ x: 10, y: 10 }, { width: 100, height: 100 }, Number.NaN),
    ).toThrow(RangeError);
  });

  it("puts the centre indicator on the sampled pixel, clamped edges included", () => {
    const backingSize = { width: 2000, height: 1400 };
    const centred = resolveLoupeSourceRect({ x: 800, y: 600 }, backingSize, 2);
    const indicator = resolveLoupeCenterIndicator({ x: 800, y: 600 }, centred);

    // The sampled pixel's own box is centred in the magnifier.
    expect(indicator.left + indicator.size / 2).toBeCloseTo(LOUPE_DIAMETER / 2, 5);
    expect(indicator.top + indicator.size / 2).toBeCloseTo(LOUPE_DIAMETER / 2, 5);
    expect(indicator.size).toBeGreaterThan(1);

    const edgeSource = resolveLoupeSourceRect({ x: 0, y: 0 }, backingSize, 2);
    const edgeIndicator = resolveLoupeCenterIndicator({ x: 0, y: 0 }, edgeSource);

    // At the canvas corner the sampled pixel is no longer the middle one, and
    // the indicator follows it instead of pointing at the wrong pixel.
    expect(edgeIndicator.left).toBe(0);
    expect(edgeIndicator.top).toBe(0);
  });
});
