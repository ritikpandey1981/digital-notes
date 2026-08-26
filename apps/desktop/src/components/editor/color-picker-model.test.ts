import { describe, expect, it } from "vitest";
import {
  adjustSvWithKeyboard,
  completeHexDraft,
  favoriteCollectionDisplayPolicy,
  hsvFromSvPointer,
  isFavoriteColor,
  quickColorRailSupportsTool,
  quickColorRailSwatchCount,
  resolveColorPickerMaximumHeight,
  resolveColorPickerPlacement,
  resolveColorPickerUsableBounds,
  rgbDraftToHex,
  type PickerRect,
} from "./color-picker-model";

describe("Phase 18B color picker model", () => {
  it("keeps the Rail tool-scoped and reduces its deterministic no-scroll capacity", () => {
    expect(
      (["Pencil", "Pen", "Marker", "Highlighter", "Shapes"] as const).every(
        quickColorRailSupportsTool,
      ),
    ).toBe(true);
    expect((["Select", "Eraser"] as const).every((tool) => !quickColorRailSupportsTool(tool))).toBe(
      true,
    );
    expect([480, 560, 620, 690, 800].map(quickColorRailSwatchCount)).toEqual([3, 4, 5, 6, 7]);
  });

  it("prefers the inside edge for the Rail and clamps a short viewport", () => {
    expect(
      resolveColorPickerPlacement(
        { left: 900, top: 220, width: 36, height: 36 },
        { width: 332, height: 594 },
        { width: 1024, height: 700 },
        "quick-rail",
      ),
    ).toEqual({ left: 558, top: 12, side: "left" });
    const short = resolveColorPickerPlacement(
      { left: 80, top: 240, width: 36, height: 36 },
      { width: 332, height: 594 },
      { width: 720, height: 620 },
      "tool-settings",
    );
    expect(short.left).toBeGreaterThanOrEqual(12);
    expect(short.top).toBe(12);
  });

  it("bounds the minimum-window picker above workspace controls", () => {
    const workspace = { left: 0, top: 48, width: 960, height: 592 };
    const viewportControls = { left: 816, top: 592, width: 128, height: 32 };
    const rail = { left: 900, top: 170, width: 48, height: 300 };
    const toolDock = { left: 16, top: 196, width: 48, height: 296 };
    const maximumHeight = resolveColorPickerMaximumHeight(workspace, viewportControls);
    const usableBounds = resolveColorPickerUsableBounds(workspace, viewportControls, toolDock);
    const placement = resolveColorPickerPlacement(
      { left: 900, top: 250, width: 36, height: 36 },
      { width: 332, height: maximumHeight },
      { width: 960, height: 640 },
      "quick-rail",
      { bounds: usableBounds, occupiedRects: [viewportControls, rail, toolDock] },
    );
    const picker = { ...placement, width: 332, height: maximumHeight };

    expect(maximumHeight).toBe(520);
    expect(usableBounds).toEqual({ left: 74, top: 48, width: 886, height: 544 });
    expect(placement).toEqual({ left: 558, top: 60, side: "left" });
    expectInside(picker, { left: 12, top: 60, width: 936, height: 568 });
    expect(overlapArea(picker, viewportControls)).toBe(0);
    expect(overlapArea(picker, rail)).toBe(0);
  });

  it.each([
    ["center", { left: 420, top: 260, width: 120, height: 100 }, "fallback", true],
    ["near left", { left: 20, top: 250, width: 90, height: 100 }, "right", true],
    ["near right", { left: 890, top: 250, width: 90, height: 100 }, "fallback", true],
    ["near bottom", { left: 80, top: 590, width: 840, height: 70 }, "fallback", true],
    ["small", { left: 500, top: 330, width: 1, height: 1 }, "fallback", true],
    ["large", { left: 200, top: 80, width: 600, height: 540 }, "fallback", false],
    ["impossible", { left: 0, top: 0, width: 1000, height: 700 }, "fallback", false],
  ] as const)(
    "places a selected-vector picker deterministically for a %s avoid rect",
    (_label, avoidRect, expectedSide, avoidable) => {
      const placement = resolveColorPickerPlacement(
        { left: 450, top: 50, width: 100, height: 48 },
        { width: 332, height: 460 },
        { width: 1000, height: 700 },
        "selected-vector",
        { avoidRect },
      );
      const picker = { ...placement, width: 332, height: 460 };

      expect(placement.side).toBe(expectedSide);
      expectInside(picker, { left: 12, top: 12, width: 976, height: 676 });
      expect(overlapArea(picker, avoidRect) === 0).toBe(avoidable);
    },
  );

  it("maps pointer and keyboard SV input while retaining the supplied hue", () => {
    expect(hsvFromSvPointer({ left: 10, top: 20, width: 200, height: 100 }, 110, 45, 245)).toEqual({
      hue: 245,
      saturation: 0.5,
      value: 0.75,
    });
    expect(
      adjustSvWithKeyboard({ hue: 245, saturation: 0.5, value: 0.5 }, "ArrowRight", true),
    ).toEqual({ hue: 245, saturation: 0.6, value: 0.5 });
  });

  it("previews only complete Hex and finite integer RGB drafts", () => {
    expect(completeHexDraft("A1B2C3")).toBe("#a1b2c3");
    expect(completeHexDraft("#123")).toBeNull();
    expect(rgbDraftToHex({ red: "43", green: "123", blue: "227" })).toBe("#2b7be3");
    expect(rgbDraftToHex({ red: "43.5", green: "123", blue: "227" })).toBeNull();
    expect(rgbDraftToHex({ red: "256", green: "123", blue: "227" })).toBeNull();
  });

  it("derives canonical Favorite state and bounds large ordered collections", () => {
    const favorites = ["#4f46e5", "#0ea5e9"];
    expect(isFavoriteColor(favorites, "4F46E5")).toBe(true);
    expect(isFavoriteColor(favorites, "#dc2626")).toBe(false);
    expect(favoriteCollectionDisplayPolicy(20)).toBe("compact");
    expect(favoriteCollectionDisplayPolicy(21)).toBe("bounded-scroll");
    expect(favorites).toEqual(["#4f46e5", "#0ea5e9"]);
  });
});

function expectInside(rect: PickerRect, bounds: PickerRect): void {
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
  expect(rect.left + rect.width).toBeLessThanOrEqual(bounds.left + bounds.width);
  expect(rect.top + rect.height).toBeLessThanOrEqual(bounds.top + bounds.height);
}

function overlapArea(first: PickerRect, second: PickerRect): number {
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
