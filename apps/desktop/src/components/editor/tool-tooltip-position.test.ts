import { describe, expect, it } from "vitest";
import { resolveTooltipPlacement, type TooltipSide } from "./tooltip-position";

const VIEWPORT = Object.freeze({ width: 320, height: 240 });
const TOOLTIP = Object.freeze({ width: 96, height: 28 });

describe("global tooltip viewport collision", () => {
  it.each([
    ["top", rect(120, 2, 32, 24), "bottom"],
    ["bottom", rect(120, 214, 32, 24), "top"],
    ["left", rect(2, 100, 24, 32), "right"],
    ["right", rect(294, 100, 24, 32), "left"],
  ] as const)("flips at the %s edge", (preferred, anchor, expected) => {
    const placement = resolveTooltipPlacement(anchor, TOOLTIP, preferred, VIEWPORT);

    expect(placement.side).toBe(expected);
    expectInsideViewport(placement);
  });

  it("keeps the top-right Workspace tooltip completely visible with collision padding", () => {
    const placement = resolveTooltipPlacement(rect(284, 6, 28, 28), TOOLTIP, "bottom", VIEWPORT);

    expect(placement.side).toBe("bottom");
    expect(placement.left + TOOLTIP.width).toBeLessThanOrEqual(310);
    expectInsideViewport(placement);
  });
});

function rect(left: number, top: number, width: number, height: number) {
  return Object.freeze({ left, top, right: left + width, bottom: top + height, width, height });
}

function expectInsideViewport(
  placement: Readonly<{ left: number; top: number; side: TooltipSide }>,
) {
  expect(placement.left).toBeGreaterThanOrEqual(10);
  expect(placement.top).toBeGreaterThanOrEqual(10);
  expect(placement.left + TOOLTIP.width).toBeLessThanOrEqual(VIEWPORT.width - 10);
  expect(placement.top + TOOLTIP.height).toBeLessThanOrEqual(VIEWPORT.height - 10);
}
