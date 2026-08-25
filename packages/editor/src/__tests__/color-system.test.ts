import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COLOR_PALETTES,
  DEFAULT_COLOR_PALETTE_ID,
  EDITOR_PRESET_COLORS,
  FAVORITE_COLOR_CAPACITY,
  RECENT_COLOR_CAPACITY,
  createEditorColorSystem,
} from "../index";

describe("workspace EditorColorSystem", () => {
  it("maintains exactly ten canonical MRU Recent colors deduplicated by Hex only", () => {
    const colors = createEditorColorSystem();
    for (let index = 0; index < RECENT_COLOR_CAPACITY + 2; index += 1) {
      colors.remember(`#${index.toString(16).padStart(6, "0")}`);
    }
    expect(colors.snapshot().recentColors).toHaveLength(RECENT_COLOR_CAPACITY);
    expect(colors.snapshot().recentColors[0]).toBe("#00000b");
    expect(colors.snapshot().recentColors.at(-1)).toBe("#000002");

    colors.remember({ hex: "#000005", opacity: 0.2 });
    colors.remember({ hex: "#000005", opacity: 0.9 });
    expect(colors.snapshot().recentColors[0]).toBe("#000005");
    expect(colors.snapshot().recentColors.filter((hex) => hex === "#000005")).toHaveLength(1);
  });

  it("canonicalizes Favorites, appends stably, ignores duplicates, and removes in place", () => {
    const colors = createEditorColorSystem();
    const recentBeforeFavorites = colors.snapshot().recentColors;
    colors.addFavorite("#FFF");
    colors.addFavorite("0EA5E9");
    colors.addFavorite("#ffffff");
    colors.addFavorite("#343434");
    expect(colors.snapshot().favoriteColors).toEqual(["#ffffff", "#0ea5e9", "#343434"]);
    expect(colors.snapshot().recentColors).toBe(recentBeforeFavorites);

    colors.remember("#ffffff");
    expect(colors.snapshot().favoriteColors).toEqual(["#ffffff", "#0ea5e9", "#343434"]);
    colors.removeFavorite("#0EA5E9");
    expect(colors.snapshot().favoriteColors).toEqual(["#ffffff", "#343434"]);
    expect(colors.snapshot().recentColors).toEqual(["#ffffff"]);
    expect(Object.isFrozen(colors.snapshot().favoriteColors)).toBe(true);
    expect(() => colors.addFavorite("red")).toThrow();
  });

  it("enforces a defensive Favorite maximum without making Favorites an MRU", () => {
    const initialFavorites = Array.from(
      { length: FAVORITE_COLOR_CAPACITY },
      (_, index) => `#${index.toString(16).padStart(6, "0")}`,
    );
    const colors = createEditorColorSystem({ initialFavorites });
    expect(() => colors.addFavorite("#ffffff")).toThrow(/cannot exceed/u);
    expect(colors.snapshot().favoriteColors).toEqual(initialFavorites);
  });

  it("switches active palettes without mutating the catalog or compatibility swatches", () => {
    const colors = createEditorColorSystem({ initialFavorites: ["#4f46e5"] });
    colors.remember("#0ea5e9");
    const before = colors.snapshot();
    const after = colors.setActivePalette("sketch");
    expect(before.activePaletteId).toBe(DEFAULT_COLOR_PALETTE_ID);
    expect(after.activePalette).toEqual(BUILT_IN_COLOR_PALETTES[1]);
    expect(after.presetColors).toBe(EDITOR_PRESET_COLORS);
    expect(after.palettes).toEqual(BUILT_IN_COLOR_PALETTES);
    expect(after.favoriteColors).toBe(before.favoriteColors);
    expect(after.recentColors).toBe(before.recentColors);
    expect(() => colors.setActivePalette("missing")).toThrow(/not registered/u);
    expect(colors.snapshot().activePaletteId).toBe("sketch");
  });

  it("supports immutable runtime user palettes and read-only lesson palettes", () => {
    const colors = createEditorColorSystem({
      palettes: [{ id: "lesson-one", name: "Lesson One", source: "lesson", colors: ["#123456"] }],
    });
    colors.addUserPalette({ id: "user-one", name: "User One", colors: ["#FFF", "#000"] });
    colors.setActivePalette("user-one");
    expect(colors.snapshot().activePalette.colors).toEqual(["#ffffff", "#000000"]);
    colors.replaceUserPalette({ id: "user-one", name: "Revised", colors: ["#0ea5e9"] });
    expect(colors.snapshot().activePalette).toMatchObject({
      id: "user-one",
      name: "Revised",
      colors: ["#0ea5e9"],
    });
    expect(() => colors.removeUserPalette("lesson-one")).toThrow(/read-only/u);
    expect(() => colors.replaceUserPalette({ id: "basic", name: "No", colors: ["#fff"] })).toThrow(
      /not registered/u,
    );
    colors.removeUserPalette("user-one");
    expect(colors.snapshot().activePaletteId).toBe(DEFAULT_COLOR_PALETTE_ID);
    expect(colors.snapshot().palettes.map(({ id }) => id)).toEqual([
      "basic",
      "sketch",
      "monochrome",
      "lesson-one",
    ]);
  });

  it("returns deeply immutable deterministic snapshots and clears only Recent usage", () => {
    const colors = createEditorColorSystem({ initialFavorites: ["#2563eb"] });
    colors.remember("#dc2626");
    const snapshot = colors.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.recentColors)).toBe(true);
    expect(Object.isFrozen(snapshot.palettes)).toBe(true);
    expect(colors.clearRecent()).toMatchObject({
      recentColors: [],
      favoriteColors: ["#2563eb"],
      activePaletteId: "basic",
    });
  });
});
