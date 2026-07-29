export interface EditableRgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface EditableColor {
  readonly hex: string;
  readonly rgb: EditableRgbColor;
  readonly opacity: number;
}

export type EditableLineStyle = "solid" | "dashed" | "dotted";
export type EditableBlendMode = "normal" | "multiply";

export interface EditableShadow {
  readonly color: EditableColor;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
}

/**
 * Serialization-neutral appearance contract shared by editor tools and future PageObject types.
 * PageObject remains the sole canvas-object abstraction; this value carries appearance only.
 */
export interface EditableStyle {
  readonly strokeColor: EditableColor;
  readonly strokeWidth: number;
  readonly fillColor?: EditableColor;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineStyle?: EditableLineStyle;
  readonly shadow?: EditableShadow;
  readonly blendMode?: EditableBlendMode;
}

export interface EditableColorInput {
  readonly hex?: string;
  readonly rgb?: Readonly<Partial<EditableRgbColor>>;
  readonly opacity?: number;
}

export interface EditableStyleInput {
  readonly strokeColor?: EditableColor | EditableColorInput | string;
  readonly strokeWidth?: number;
  readonly fillColor?: EditableColor | EditableColorInput | string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineStyle?: EditableLineStyle;
  readonly shadow?: EditableShadow;
  readonly blendMode?: EditableBlendMode;
}

const HEX_COLOR = /^#?([\da-f]{3}|[\da-f]{6})$/iu;

export function createEditableColor(input: EditableColorInput | string = "#111111"): EditableColor {
  const colorInput = typeof input === "string" ? { hex: input } : input;
  const opacity = colorInput.opacity ?? 1;
  assertUnitInterval(opacity, "Color opacity");
  const rgb =
    colorInput.rgb === undefined
      ? rgbFromHex(colorInput.hex ?? "#111111")
      : freezeRgb(colorInput.rgb);
  const suppliedHex = colorInput.hex === undefined ? null : normalizeHexColor(colorInput.hex);
  const derivedHex = hexFromRgb(rgb);
  if (suppliedHex !== null && colorInput.rgb !== undefined && suppliedHex !== derivedHex) {
    throw new TypeError("Color hex and RGB values must describe the same color.");
  }
  return Object.freeze({ hex: suppliedHex ?? derivedHex, rgb, opacity });
}

export function normalizeHexColor(value: string): string {
  const match = HEX_COLOR.exec(value.trim());
  if (match === null) throw new TypeError("Color must be a three- or six-digit hexadecimal value.");
  const body = match[1]!.toLowerCase();
  const expanded =
    body.length === 3 ? [...body].map((character) => character.repeat(2)).join("") : body;
  return `#${expanded}`;
}

export function createEditableStyle(input: EditableStyleInput = {}): EditableStyle {
  const strokeWidth = input.strokeWidth ?? 2;
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    throw new RangeError("Stroke width must be positive and finite.");
  }
  const fontFamily = optionalNonEmpty(input.fontFamily, "Font family");
  if (input.fontSize !== undefined && (!Number.isFinite(input.fontSize) || input.fontSize <= 0)) {
    throw new RangeError("Font size must be positive and finite.");
  }
  const style: EditableStyle = {
    strokeColor: freezeColor(input.strokeColor ?? "#111111"),
    strokeWidth,
    ...(input.fillColor === undefined ? {} : { fillColor: freezeColor(input.fillColor) }),
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(input.fontSize === undefined ? {} : { fontSize: input.fontSize }),
    ...(input.lineStyle === undefined ? {} : { lineStyle: input.lineStyle }),
    ...(input.shadow === undefined ? {} : { shadow: freezeShadow(input.shadow) }),
    ...(input.blendMode === undefined ? {} : { blendMode: input.blendMode }),
  };
  return Object.freeze(style);
}

function freezeColor(value: EditableColor | EditableColorInput | string): EditableColor {
  if (typeof value === "string" || !("rgb" in value) || !("hex" in value)) {
    return createEditableColor(value);
  }
  return createEditableColor({
    hex: value.hex,
    rgb: value.rgb,
    ...(value.opacity === undefined ? {} : { opacity: value.opacity }),
  });
}

function freezeRgb(value: Readonly<Partial<EditableRgbColor>>): EditableRgbColor {
  const red = requireChannel(value.red, "red");
  const green = requireChannel(value.green, "green");
  const blue = requireChannel(value.blue, "blue");
  return Object.freeze({ red, green, blue });
}

function requireChannel(value: number | undefined, name: string): number {
  if (!Number.isInteger(value) || value === undefined || value < 0 || value > 255) {
    throw new RangeError(`RGB ${name} must be an integer from 0 to 255.`);
  }
  return value;
}

function rgbFromHex(hex: string): EditableRgbColor {
  const normalized = normalizeHexColor(hex);
  return Object.freeze({
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  });
}

function hexFromRgb(rgb: EditableRgbColor): string {
  const channel = (value: number): string => value.toString(16).padStart(2, "0");
  return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`;
}

function freezeShadow(shadow: EditableShadow): EditableShadow {
  for (const [name, value] of [
    ["offsetX", shadow.offsetX],
    ["offsetY", shadow.offsetY],
    ["blur", shadow.blur],
  ] as const) {
    if (!Number.isFinite(value) || (name === "blur" && value < 0)) {
      throw new RangeError(`Shadow ${name} is invalid.`);
    }
  }
  return Object.freeze({
    color: freezeColor(shadow.color),
    offsetX: shadow.offsetX,
    offsetY: shadow.offsetY,
    blur: shadow.blur,
  });
}

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
}

function optionalNonEmpty(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${label} must not be empty.`);
  return normalized;
}
