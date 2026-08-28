import { rgbToHex, type RgbColor } from "./color-conversion";

/**
 * OKLab / OKLCH colour space, kept deliberately separate from
 * {@link ./color-conversion}.
 *
 * That module owns Folio's application colour space: hex, 8-bit sRGB and the
 * HSV the picker edits in. This module owns a *perceptual* space used only to
 * generate and compare systematic palettes. Keeping them apart is the point —
 * nothing about Folio's canonical colour state moves to OKLCH. The boundary is
 * one-directional and explicit:
 *
 *   systematic OKLCH definition → gamut-safe sRGB → canonical lowercase hex
 *
 * Math follows Björn Ottosson's OKLab derivation (2020), which defines the
 * linear-sRGB → LMS matrix, the cube-root non-linearity, and the LMS → Lab
 * matrix used below. Values are transcribed from that reference rather than
 * re-derived, and the inverse matrices are its published inverses.
 *
 * No dependency was added: the workspace carries no colour-science package,
 * and this is roughly sixty lines of matrix arithmetic plus one search.
 */

export interface OklabColor {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  readonly lightness: number;
  /** Green–red opponent axis. */
  readonly a: number;
  /** Blue–yellow opponent axis. */
  readonly b: number;
}

export interface OklchColor {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  readonly lightness: number;
  /** Chroma. Zero is achromatic; sRGB rarely exceeds roughly 0.37. */
  readonly chroma: number;
  /** Hue angle in degrees, 0 to 360. Meaningless as chroma approaches zero. */
  readonly hue: number;
}

/** Largest chroma the search will consider. sRGB never reaches it. */
const MAXIMUM_SEARCH_CHROMA = 0.45;
/** Halving 0.45 twenty-four times resolves chroma far below one 8-bit step. */
const CHROMA_SEARCH_STEPS = 24;
/** Absorbs floating-point noise when testing whether a channel is in gamut. */
const GAMUT_EPSILON = 1e-7;

export function linearFromSrgbChannel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function srgbChannelFromLinear(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Converts linear-light sRGB in [0,1] to OKLab. */
export function oklabFromLinearSrgb(red: number, green: number, blue: number): OklabColor {
  const longWave = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const mediumWave = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const shortWave = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const longRoot = Math.cbrt(longWave);
  const mediumRoot = Math.cbrt(mediumWave);
  const shortRoot = Math.cbrt(shortWave);
  return Object.freeze({
    lightness: 0.2104542553 * longRoot + 0.793617785 * mediumRoot - 0.0040720468 * shortRoot,
    a: 1.9779984951 * longRoot - 2.428592205 * mediumRoot + 0.4505937099 * shortRoot,
    b: 0.0259040371 * longRoot + 0.7827717662 * mediumRoot - 0.808675766 * shortRoot,
  });
}

/** Converts OKLab to linear-light sRGB. Channels may fall outside [0,1]. */
export function linearSrgbFromOklab(
  color: OklabColor,
): Readonly<{ red: number; green: number; blue: number }> {
  const longRoot = color.lightness + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const mediumRoot = color.lightness - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const shortRoot = color.lightness - 0.0894841775 * color.a - 1.291485548 * color.b;
  const longWave = longRoot ** 3;
  const mediumWave = mediumRoot ** 3;
  const shortWave = shortRoot ** 3;
  return Object.freeze({
    red: 4.0767416621 * longWave - 3.3077115913 * mediumWave + 0.2309699292 * shortWave,
    green: -1.2684380046 * longWave + 2.6097574011 * mediumWave - 0.3413193965 * shortWave,
    blue: -0.0041960863 * longWave - 0.7034186147 * mediumWave + 1.707614701 * shortWave,
  });
}

export function oklchFromOklab(color: OklabColor): OklchColor {
  const chroma = Math.hypot(color.a, color.b);
  const hue = (Math.atan2(color.b, color.a) * 180) / Math.PI;
  return Object.freeze({
    lightness: color.lightness,
    chroma,
    hue: normalizeDegrees(hue),
  });
}

export function oklabFromOklch(color: OklchColor): OklabColor {
  const radians = (normalizeDegrees(color.hue) * Math.PI) / 180;
  return Object.freeze({
    lightness: color.lightness,
    a: color.chroma * Math.cos(radians),
    b: color.chroma * Math.sin(radians),
  });
}

/** Reads any canonical Folio hex into the perceptual space. */
export function oklchFromHex(hex: string): OklchColor {
  const rgb = hexChannels(hex);
  return oklchFromOklab(
    oklabFromLinearSrgb(
      linearFromSrgbChannel(rgb.red / 255),
      linearFromSrgbChannel(rgb.green / 255),
      linearFromSrgbChannel(rgb.blue / 255),
    ),
  );
}

/**
 * Largest chroma that stays inside sRGB at this lightness and hue.
 *
 * This is what makes the palette hue-aware rather than pretending one chroma
 * value suits every hue: sRGB simply holds far more chroma at a light yellow
 * than at a light blue, and a systematic palette has to respect that.
 */
export function maximumDisplayableChroma(lightness: number, hue: number): number {
  const clampedLightness = clampUnit(lightness);
  if (clampedLightness <= 0 || clampedLightness >= 1) return 0;
  if (fitsSrgb({ lightness: clampedLightness, chroma: MAXIMUM_SEARCH_CHROMA, hue })) {
    return MAXIMUM_SEARCH_CHROMA;
  }
  // Chroma-only bisection: lightness and hue are held fixed, so the result is
  // the same colour the caller asked for, merely as saturated as sRGB allows.
  let low = 0;
  let high = MAXIMUM_SEARCH_CHROMA;
  for (let step = 0; step < CHROMA_SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (fitsSrgb({ lightness: clampedLightness, chroma: middle, hue })) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Maps one OKLCH colour into sRGB, reducing chroma only.
 *
 * Independent per-channel clamping is deliberately avoided: it shifts hue and
 * lightness together and turns an out-of-gamut vivid blue into a different
 * colour entirely. Holding hue and lightness and giving up chroma keeps the
 * colour recognisably the one that was asked for.
 */
export function gamutMapOklch(color: OklchColor): OklchColor {
  const lightness = clampUnit(color.lightness);
  const hue = normalizeDegrees(color.hue);
  const requested = Math.max(0, Number.isFinite(color.chroma) ? color.chroma : 0);
  if (requested === 0 || lightness <= 0 || lightness >= 1) {
    return Object.freeze({ lightness, chroma: 0, hue });
  }
  if (fitsSrgb({ lightness, chroma: requested, hue })) {
    return Object.freeze({ lightness, chroma: requested, hue });
  }
  return Object.freeze({
    lightness,
    chroma: Math.min(requested, maximumDisplayableChroma(lightness, hue)),
    hue,
  });
}

/** Gamut-maps, quantizes to 8-bit, and returns canonical lowercase hex. */
export function hexFromOklch(color: OklchColor): string {
  const mapped = gamutMapOklch(color);
  const linear = linearSrgbFromOklab(oklabFromOklch(mapped));
  return rgbFromLinearSrgb(linear);
}

/**
 * Squared Euclidean distance in OKLab.
 *
 * Squared because every caller only ranks candidates, and skipping the square
 * root keeps ordering identical while avoiding needless work.
 */
export function oklabSquaredDistance(first: OklabColor, second: OklabColor): number {
  const lightness = first.lightness - second.lightness;
  const a = first.a - second.a;
  const b = first.b - second.b;
  return lightness * lightness + a * a + b * b;
}

/** Shortest angular separation between two hues, 0 to 180 degrees. */
export function hueDistanceDegrees(first: number, second: number): number {
  const difference = Math.abs(normalizeDegrees(first) - normalizeDegrees(second));
  return difference > 180 ? 360 - difference : difference;
}

export function normalizeDegrees(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("A hue angle must be finite.");
  const normalized = ((value % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function fitsSrgb(color: OklchColor): boolean {
  const linear = linearSrgbFromOklab(oklabFromOklch(color));
  return inGamut(linear.red) && inGamut(linear.green) && inGamut(linear.blue);
}

function inGamut(channel: number): boolean {
  return Number.isFinite(channel) && channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON;
}

function rgbFromLinearSrgb(linear: Readonly<{ red: number; green: number; blue: number }>): string {
  return rgbToHex(
    Object.freeze({
      red: quantize(linear.red),
      green: quantize(linear.green),
      blue: quantize(linear.blue),
    }) satisfies RgbColor,
  );
}

/** Clamps residual search error before rounding, so no channel can overflow. */
function quantize(linearChannel: number): number {
  if (!Number.isFinite(linearChannel)) return 0;
  const encoded = srgbChannelFromLinear(clampUnit(linearChannel));
  return Math.min(255, Math.max(0, Math.round(clampUnit(encoded) * 255)));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function hexChannels(hex: string): RgbColor {
  const normalized = hex.trim().toLowerCase();
  if (!/^#[\da-f]{6}$/u.test(normalized)) {
    throw new RangeError("A perceptual conversion requires canonical #rrggbb hex.");
  }
  return Object.freeze({
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  });
}
