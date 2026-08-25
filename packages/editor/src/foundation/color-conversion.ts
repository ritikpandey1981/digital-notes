import { normalizeHexColor } from "@folio/document";

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

/** Canonical artwork-color boundary: lowercase, six-digit RGB Hex with a leading hash. */
export function normalizeArtworkHex(value: string): string {
  return normalizeHexColor(value);
}

export function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeArtworkHex(hex);
  return Object.freeze({
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  });
}

export function rgbToHex(rgb: RgbColor): string {
  const red = requireRgbChannel(rgb.red, "red");
  const green = requireRgbChannel(rgb.green, "green");
  const blue = requireRgbChannel(rgb.blue, "blue");
  const channel = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

export function rgbToHsv(rgb: RgbColor): HsvColor {
  const red = requireRgbChannel(rgb.red, "red") / 255;
  const green = requireRgbChannel(rgb.green, "green") / 255;
  const blue = requireRgbChannel(rgb.blue, "blue") / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * ((green - blue) / delta);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return Object.freeze({
    hue: normalizeHue(hue),
    saturation: maximum === 0 ? 0 : delta / maximum,
    value: maximum,
  });
}

export function hsvToRgb(hsv: HsvColor): RgbColor {
  const hue = normalizeHue(hsv.hue);
  const saturation = requireUnitInterval(hsv.saturation, "HSV saturation");
  const value = requireUnitInterval(hsv.value, "HSV value");
  const chroma = value * saturation;
  const sector = hue / 60;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = value - chroma;
  let channels: readonly [number, number, number];
  if (sector < 1) channels = [chroma, intermediate, 0];
  else if (sector < 2) channels = [intermediate, chroma, 0];
  else if (sector < 3) channels = [0, chroma, intermediate];
  else if (sector < 4) channels = [0, intermediate, chroma];
  else if (sector < 5) channels = [intermediate, 0, chroma];
  else channels = [chroma, 0, intermediate];
  return Object.freeze({
    red: Math.round((channels[0] + match) * 255),
    green: Math.round((channels[1] + match) * 255),
    blue: Math.round((channels[2] + match) * 255),
  });
}

export function hexToHsv(hex: string): HsvColor {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv: HsvColor): string {
  return rgbToHex(hsvToRgb(hsv));
}

function requireRgbChannel(value: number, name: keyof RgbColor): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`RGB ${name} must be an integer from 0 to 255.`);
  }
  return value;
}

function requireUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be finite and between zero and one.`);
  }
  return value;
}

function normalizeHue(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("HSV hue must be finite.");
  const normalized = ((value % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}
