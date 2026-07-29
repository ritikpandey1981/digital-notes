import { describe, expect, it } from "vitest";
import { createEditableColor, createEditableStyle, normalizeHexColor } from "../index";

describe("editable style foundation", () => {
  it("normalizes hexadecimal and RGB colors into one immutable value", () => {
    expect(normalizeHexColor("09F")).toBe("#0099ff");
    const color = createEditableColor({ rgb: { red: 12, green: 34, blue: 56 }, opacity: 0.4 });
    expect(color).toEqual({
      hex: "#0c2238",
      rgb: { red: 12, green: 34, blue: 56 },
      opacity: 0.4,
    });
    expect(Object.isFrozen(color)).toBe(true);
    expect(Object.isFrozen(color.rgb)).toBe(true);
  });

  it("rejects inconsistent, invalid, and out-of-range colors", () => {
    expect(() => createEditableColor("red")).toThrow(TypeError);
    expect(() => createEditableColor({ rgb: { red: 256, green: 0, blue: 0 } })).toThrow(RangeError);
    expect(() =>
      createEditableColor({ hex: "#000000", rgb: { red: 255, green: 255, blue: 255 } }),
    ).toThrow(TypeError);
    expect(() => createEditableColor({ hex: "#000", opacity: 1.1 })).toThrow(RangeError);
  });

  it("creates a generic immutable style without changing PageObject data", () => {
    const style = createEditableStyle({
      strokeColor: { hex: "#336699", opacity: 0.75 },
      strokeWidth: 6,
      fillColor: "#ffffff",
      lineStyle: "dashed",
      blendMode: "multiply",
    });
    expect(style.strokeColor.opacity).toBe(0.75);
    expect(style.strokeWidth).toBe(6);
    expect(style.fillColor?.hex).toBe("#ffffff");
    expect(Object.isFrozen(style)).toBe(true);
  });

  it("validates generic style constraints", () => {
    expect(() => createEditableStyle({ strokeWidth: 0 })).toThrow(RangeError);
    expect(() => createEditableStyle({ fontFamily: " " })).toThrow(TypeError);
    expect(() => createEditableStyle({ fontSize: Number.NaN })).toThrow(RangeError);
  });
});
