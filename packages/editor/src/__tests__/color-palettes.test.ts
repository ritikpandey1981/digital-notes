import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COLOR_PALETTES,
  DEFAULT_COLOR_PALETTE_ID,
  EDITOR_PRESET_COLORS,
  createColorPalette,
  freezePaletteCatalog,
} from "../foundation/color-palettes";

const EXPECTED_BUILT_INS = [
  {
    id: "basic",
    name: "Basic",
    source: "built-in",
    colors: [
      "#111111",
      "#4b5563",
      "#2563eb",
      "#4f46e5",
      "#9333ea",
      "#db2777",
      "#dc2626",
      "#ea580c",
      "#ca8a04",
      "#16a34a",
    ],
  },
  {
    id: "sketch",
    name: "Sketch",
    source: "built-in",
    colors: [
      "#343434",
      "#6b4f3a",
      "#8b5e3c",
      "#b08968",
      "#d4a373",
      "#c9ada7",
      "#6b705c",
      "#3f4e4f",
      "#5f6f94",
      "#9a8c98",
    ],
  },
  {
    id: "monochrome",
    name: "Monochrome",
    source: "built-in",
    colors: [
      "#000000",
      "#111111",
      "#343434",
      "#4b5563",
      "#6b7280",
      "#9ca3af",
      "#d1d5db",
      "#f3f4f6",
      "#ffffff",
    ],
  },
] as const;

describe("ColorPalette model", () => {
  it("publishes the exact small immutable V1 built-in catalog", () => {
    expect(BUILT_IN_COLOR_PALETTES).toEqual(EXPECTED_BUILT_INS);
    expect(BUILT_IN_COLOR_PALETTES.map(({ id }) => id)).toEqual(["basic", "sketch", "monochrome"]);
    expect(DEFAULT_COLOR_PALETTE_ID).toBe("basic");
    expect(EDITOR_PRESET_COLORS).toBe(BUILT_IN_COLOR_PALETTES[0]?.colors);
    expect(Object.isFrozen(BUILT_IN_COLOR_PALETTES)).toBe(true);
    for (const palette of BUILT_IN_COLOR_PALETTES) {
      expect(Object.isFrozen(palette)).toBe(true);
      expect(Object.isFrozen(palette.colors)).toBe(true);
      expect(palette.colors.every((color) => /^#[\da-f]{6}$/u.test(color))).toBe(true);
    }
  });

  it("canonicalizes runtime palette colors without changing deterministic order", () => {
    const palette = createColorPalette({
      id: " custom ",
      name: " Custom ",
      source: "user",
      colors: ["#FFF", "0EA5E9", "#343434"],
    });
    expect(palette).toEqual({
      id: "custom",
      name: "Custom",
      source: "user",
      colors: ["#ffffff", "#0ea5e9", "#343434"],
    });
  });

  it.each([
    { id: "", name: "Name", source: "user", colors: ["#ffffff"] },
    { id: "id", name: " ", source: "user", colors: ["#ffffff"] },
    { id: "id", name: "Name", source: "other", colors: ["#ffffff"] },
    { id: "id", name: "Name", source: "user", colors: [] },
    { id: "id", name: "Name", source: "user", colors: ["red"] },
    { id: "id", name: "Name", source: "user", colors: ["#fff", "#ffffff"] },
  ])("rejects malformed palette input %#", (input) => {
    expect(() => createColorPalette(input as never)).toThrow();
  });

  it("rejects duplicate catalog IDs", () => {
    expect(() =>
      freezePaletteCatalog([
        { id: "same", name: "First", source: "lesson", colors: ["#111111"] },
        { id: "same", name: "Second", source: "user", colors: ["#ffffff"] },
      ]),
    ).toThrow(/IDs must be unique/u);
  });
});
