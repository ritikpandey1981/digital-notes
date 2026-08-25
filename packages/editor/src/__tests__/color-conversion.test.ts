import { describe, expect, it } from "vitest";
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  hsvToRgb,
  normalizeArtworkHex,
  rgbToHex,
  rgbToHsv,
} from "../foundation/color-conversion";

const REPRESENTATIVE_COLORS = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#00ffff",
  "#ff00ff",
  "#ffff00",
  "#808080",
  "#343434",
  "#0ea5e9",
  "#8b5cf6",
  "#b82e7b",
] as const;

describe("artwork RGB, HSV, and Hex conversion", () => {
  it.each([
    ["#fff", "#ffffff"],
    ["FFFFFF", "#ffffff"],
    [" #AbC ", "#aabbcc"],
    ["0EA5E9", "#0ea5e9"],
  ])("normalizes %s through the Document artwork boundary", (input, expected) => {
    expect(normalizeArtworkHex(input)).toBe(expected);
  });

  it.each(REPRESENTATIVE_COLORS)("round-trips %s exactly through RGB", (hex) => {
    const rgb = hexToRgb(hex);
    expect(rgbToHex(rgb)).toBe(hex);
    expect(Object.isFrozen(rgb)).toBe(true);
    expect(Object.values(rgb).every(Number.isFinite)).toBe(true);
  });

  it.each(REPRESENTATIVE_COLORS)("round-trips %s through HSV with integer RGB parity", (hex) => {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb);
    expect(hsvToRgb(hsv)).toEqual(rgb);
    expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(Object.isFrozen(hsv)).toBe(true);
    expect(Object.values(hsv).every(Number.isFinite)).toBe(true);
  });

  it.each([
    [{ hue: 0, saturation: 1, value: 1 }, "#ff0000"],
    [{ hue: 60, saturation: 1, value: 1 }, "#ffff00"],
    [{ hue: 120, saturation: 1, value: 1 }, "#00ff00"],
    [{ hue: 180, saturation: 1, value: 1 }, "#00ffff"],
    [{ hue: 240, saturation: 1, value: 1 }, "#0000ff"],
    [{ hue: 300, saturation: 1, value: 1 }, "#ff00ff"],
    [{ hue: 360, saturation: 1, value: 1 }, "#ff0000"],
    [{ hue: 720, saturation: 1, value: 1 }, "#ff0000"],
    [{ hue: -120, saturation: 1, value: 1 }, "#0000ff"],
  ])("converts HSV boundary/wrapped value %# to %s", (hsv, expected) => {
    expect(hsvToHex(hsv)).toBe(expected);
  });

  it("uses hue zero deterministically for grayscale and preserves gray values", () => {
    expect(rgbToHsv({ red: 128, green: 128, blue: 128 })).toEqual({
      hue: 0,
      saturation: 0,
      value: 128 / 255,
    });
    expect(hsvToRgb({ hue: 275, saturation: 0, value: 0.5 })).toEqual({
      red: 128,
      green: 128,
      blue: 128,
    });
    expect(hsvToHex({ hue: 42, saturation: 1, value: 0 })).toBe("#000000");
  });

  it.each([
    () => rgbToHex({ red: -1, green: 0, blue: 0 }),
    () => rgbToHsv({ red: 0.5, green: 0, blue: 0 }),
    () => rgbToHex({ red: 0, green: 256, blue: 0 }),
    () => hsvToRgb({ hue: Number.NaN, saturation: 1, value: 1 }),
    () => hsvToRgb({ hue: Number.POSITIVE_INFINITY, saturation: 1, value: 1 }),
    () => hsvToRgb({ hue: 0, saturation: -0.01, value: 1 }),
    () => hsvToRgb({ hue: 0, saturation: 1.01, value: 1 }),
    () => hsvToRgb({ hue: 0, saturation: 1, value: Number.NaN }),
    () => normalizeArtworkHex("red"),
    () => normalizeArtworkHex("#abcd"),
  ])("rejects invalid public color input", (operation) => {
    expect(operation).toThrow();
  });

  it("always emits lowercase six-digit canonical Hex", () => {
    for (const hex of REPRESENTATIVE_COLORS) {
      expect(rgbToHex(hexToRgb(hex))).toMatch(/^#[\da-f]{6}$/u);
      expect(hsvToHex(hexToHsv(hex))).toMatch(/^#[\da-f]{6}$/u);
    }
  });
});
