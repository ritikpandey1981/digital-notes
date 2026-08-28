import { describe, expect, it } from "vitest";
import {
  gamutMapOklch,
  hexFromOklch,
  hueDistanceDegrees,
  linearFromSrgbChannel,
  linearSrgbFromOklab,
  maximumDisplayableChroma,
  oklabFromLinearSrgb,
  oklabFromOklch,
  oklabSquaredDistance,
  oklchFromHex,
  oklchFromOklab,
  srgbChannelFromLinear,
} from "../foundation/oklch-color";

/** The sRGB corners, whose OKLab coordinates are published reference values. */
const PRIMARIES = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#00ffff",
  "#ff00ff",
] as const;

describe("OKLab and OKLCH conversion", () => {
  it("matches the reference OKLab lightness of the sRGB primaries", () => {
    // Ottosson's published values, to three decimals.
    expect(oklchFromHex("#ffffff").lightness).toBeCloseTo(1, 3);
    expect(oklchFromHex("#000000").lightness).toBeCloseTo(0, 3);
    expect(oklchFromHex("#ff0000").lightness).toBeCloseTo(0.628, 3);
    expect(oklchFromHex("#00ff00").lightness).toBeCloseTo(0.866, 3);
    expect(oklchFromHex("#0000ff").lightness).toBeCloseTo(0.452, 3);
  });

  it.each(PRIMARIES)("round trips %s through OKLCH without drift", (hex) => {
    expect(hexFromOklch(oklchFromHex(hex))).toBe(hex);
  });

  it("round trips every sRGB grey exactly", () => {
    for (let level = 0; level <= 255; level += 1) {
      const channel = level.toString(16).padStart(2, "0");
      const hex = `#${channel}${channel}${channel}`;
      expect(hexFromOklch(oklchFromHex(hex))).toBe(hex);
    }
  });

  it("inverts its own transfer function and matrices", () => {
    // 0.04045 is the transfer function's own breakpoint, where the standard's
    // two branches disagree by about 3e-8. Six decimals is strict everywhere
    // else and does not encode that published discontinuity as a defect.
    for (const value of [0, 0.02, 0.04045, 0.2, 0.5, 0.9, 1]) {
      expect(srgbChannelFromLinear(linearFromSrgbChannel(value))).toBeCloseTo(value, 6);
    }
    // The published forward and inverse matrices are each rounded to ten
    // significant digits, so they invert to about 3e-8 rather than exactly.
    // That is four orders of magnitude below one 8-bit step.
    const lab = oklabFromLinearSrgb(0.21, 0.44, 0.77);
    const linear = linearSrgbFromOklab(lab);
    expect(linear.red).toBeCloseTo(0.21, 6);
    expect(linear.green).toBeCloseTo(0.44, 6);
    expect(linear.blue).toBeCloseTo(0.77, 6);
    expect(oklabFromOklch(oklchFromOklab(lab))).toMatchObject({
      lightness: expect.closeTo(lab.lightness, 10) as unknown as number,
    });
  });

  it("rejects anything that is not canonical hex", () => {
    expect(() => oklchFromHex("#FFF")).toThrow(RangeError);
    expect(() => oklchFromHex("not a color")).toThrow(RangeError);
  });
});

describe("gamut mapping", () => {
  it("reduces chroma while holding lightness and hue", () => {
    // Far outside sRGB at this lightness.
    const requested = { lightness: 0.62, chroma: 0.4, hue: 29 };
    const mapped = gamutMapOklch(requested);

    expect(mapped.lightness).toBe(requested.lightness);
    expect(mapped.hue).toBe(requested.hue);
    expect(mapped.chroma).toBeLessThan(requested.chroma);
    expect(mapped.chroma).toBeGreaterThan(0);
  });

  it("leaves an in-gamut colour untouched", () => {
    const inside = { lightness: 0.6, chroma: 0.05, hue: 200 };

    expect(gamutMapOklch(inside)).toEqual(inside);
  });

  it("produces canonical lowercase hex for aggressively out-of-gamut input", () => {
    for (let hue = 0; hue < 360; hue += 7) {
      for (const lightness of [0.05, 0.25, 0.5, 0.75, 0.95]) {
        const hex = hexFromOklch({ lightness, chroma: 0.5, hue });
        expect(hex).toMatch(/^#[\da-f]{6}$/u);
      }
    }
  });

  it("never yields NaN, overflow or malformed hex from hostile input", () => {
    const hostile = [
      { lightness: Number.NaN, chroma: 0.2, hue: 40 },
      { lightness: 0.5, chroma: Number.NaN, hue: 40 },
      { lightness: -5, chroma: 10, hue: -900 },
      { lightness: 12, chroma: -3, hue: 720 },
      { lightness: Number.POSITIVE_INFINITY, chroma: 0.1, hue: 0 },
    ];
    for (const color of hostile) {
      const hex = hexFromOklch(color);
      expect(hex).toMatch(/^#[\da-f]{6}$/u);
    }
    expect(() => hexFromOklch({ lightness: 0.5, chroma: 0.2, hue: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("is stable across repeated calls", () => {
    const color = { lightness: 0.72, chroma: 0.33, hue: 143 };
    const first = hexFromOklch(color);
    for (let attempt = 0; attempt < 25; attempt += 1) expect(hexFromOklch(color)).toBe(first);
  });

  it("reports a hue-dependent maximum chroma rather than one global value", () => {
    // sRGB simply holds far more chroma at a light yellow-green than at a
    // light red, which is why the palette scales chroma per hue.
    const lightRed = maximumDisplayableChroma(0.92, 29);
    const lightYellowGreen = maximumDisplayableChroma(0.92, 122);

    expect(lightRed).toBeGreaterThan(0);
    expect(lightYellowGreen).toBeGreaterThan(lightRed * 3);
    expect(maximumDisplayableChroma(0, 100)).toBe(0);
    expect(maximumDisplayableChroma(1, 100)).toBe(0);
  });

  it("keeps the reported maximum chroma inside sRGB", () => {
    for (let hue = 0; hue < 360; hue += 11) {
      for (const lightness of [0.2, 0.45, 0.7, 0.9]) {
        const chroma = maximumDisplayableChroma(lightness, hue);
        const linear = linearSrgbFromOklab(oklabFromOklch({ lightness, chroma, hue }));
        for (const channel of [linear.red, linear.green, linear.blue]) {
          expect(channel).toBeGreaterThanOrEqual(-1e-6);
          expect(channel).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
  });
});

describe("perceptual comparison helpers", () => {
  it("measures squared OKLab distance", () => {
    const black = oklabFromOklch(oklchFromHex("#000000"));
    const white = oklabFromOklch(oklchFromHex("#ffffff"));
    const grey = oklabFromOklch(oklchFromHex("#808080"));

    expect(oklabSquaredDistance(black, black)).toBe(0);
    expect(oklabSquaredDistance(black, grey)).toBeLessThan(oklabSquaredDistance(black, white));
  });

  it("measures the shorter way around the hue circle", () => {
    expect(hueDistanceDegrees(10, 350)).toBe(20);
    expect(hueDistanceDegrees(350, 10)).toBe(20);
    expect(hueDistanceDegrees(0, 180)).toBe(180);
    expect(hueDistanceDegrees(30, 30)).toBe(0);
  });
});
