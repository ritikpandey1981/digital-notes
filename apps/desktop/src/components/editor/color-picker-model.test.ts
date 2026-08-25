import { describe, expect, it } from "vitest";
import {
  adjustSvWithKeyboard,
  completeHexDraft,
  favoriteCollectionDisplayPolicy,
  hsvFromSvPointer,
  isFavoriteColor,
  quickColorRailSupportsTool,
  quickColorRailSwatchCount,
  resolveColorPickerPlacement,
  rgbDraftToHex,
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
