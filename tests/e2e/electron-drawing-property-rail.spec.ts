import path from "node:path";
import { expect, test, _electron as electron, type Locator } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

test("shows a contextual drawing property rail beside the drawing capsule", async () => {
  test.setTimeout(90_000);
  const repositoryRoot = process.cwd();
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const drawingCapsule = window.locator('[data-tool-dock-group="drawing"]');
    const utilityCapsule = window.locator('[data-tool-dock-group="utility"]');
    const rail = window.getByTestId("drawing-property-rail");
    const surface = window.getByTestId("canvas-surface");
    const palette = window.getByTestId("context-tool-palette");
    const picker = window.getByTestId("full-color-picker");
    const quickRail = window.getByTestId("quick-color-rail");

    // 1. Select is active at launch: no drawing properties are presented.
    await expect(dock).toBeVisible();
    await expect(rail).toHaveCount(0);

    // 2. A drawing preset brings the rail up with exactly four controls.
    await activateDockSlot(window, "pencil");
    await expect(rail).toBeVisible();
    await expect(rail.locator("button[data-property-key]")).toHaveCount(4);
    expect(
      await rail
        .locator("button[data-property-key]")
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.propertyKey)),
    ).toEqual(["strokeWidth", "opacity", "smoothing", "strokeColor"]);

    // 3. It reads canonical brush state, not a copy of it.
    const canonical = async () => ({
      width: await surface.getAttribute("data-drawing-width"),
      opacity: await surface.getAttribute("data-drawing-opacity"),
      smoothing: await surface.getAttribute("data-drawing-smoothing"),
    });
    const pencil = await canonical();
    expect(await propertyValue(rail, "strokeWidth")).toBe(pencil.width);
    expect(await propertyValue(rail, "opacity")).toBe(pencil.opacity);
    expect(await propertyValue(rail, "smoothing")).toBe(pencil.smoothing);

    // 4. Placement: inward of the drawing capsule, narrower than it, and clear
    //    of the utility capsule below.
    const capsuleBox = (await drawingCapsule.boundingBox())!;
    const utilityBox = (await utilityCapsule.boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    expect(railBox.width, "the relaxed rail width").toBe(46);
    expect(railBox.height, "three 2px icon/value gaps add 3px overall").toBeCloseTo(153.6, 1);
    expect(railBox.x, "inward of the dock").toBeGreaterThan(capsuleBox.x + capsuleBox.width);
    // The chosen 3px seam makes the two surfaces one visual instrument without
    // merging their independent hit regions.
    const seam = railBox.x - (capsuleBox.x + capsuleBox.width);
    expect(seam, "intentional Dock-to-Rail seam").toBeCloseTo(3, 1);
    expect(railBox.width, "narrower than the drawing capsule").toBeLessThan(capsuleBox.width);
    expect(railBox.y + railBox.height, "clear of the utility capsule").toBeLessThan(utilityBox.y);
    // Centred on the drawing capsule rather than on the whole dock.
    expect(
      Math.abs(railBox.y + railBox.height / 2 - (capsuleBox.y + capsuleBox.height / 2)),
    ).toBeLessThanOrEqual(1);
    const iconValueGaps = await rail.evaluate((element) =>
      [
        ...element.querySelectorAll(
          'button[data-property-key]:not([data-property-key="strokeColor"])',
        ),
      ]
        .map((button) => {
          const icon = button.querySelector("svg")?.getBoundingClientRect();
          const value = button.querySelector("span")?.getBoundingClientRect();
          return icon === undefined || value === undefined ? null : value.top - icon.bottom;
        })
        .filter((gap): gap is number => gap !== null),
    );
    expect(iconValueGaps, "icon-to-value spacing grows from 1px to 2px").toEqual([2, 2, 2]);
    const hierarchy = await rail.evaluate((element) => ({
      iconOpacities: [
        ...element.querySelectorAll<SVGElement>('svg[data-property-emphasis="secondary"]'),
      ].map((icon) => getComputedStyle(icon).opacity),
      valueWeights: [
        ...element.querySelectorAll<HTMLElement>('[data-property-emphasis="primary"]'),
      ].map((value) => getComputedStyle(value).fontWeight),
      swatchEmphasis: element
        .querySelector('[data-testid="drawing-property-color-swatch"]')
        ?.getAttribute("data-property-emphasis"),
    }));
    expect(hierarchy.iconOpacities, "icons remain legible secondary cues").toEqual([
      "0.8",
      "0.8",
      "0.8",
    ]);
    expect(hierarchy.valueWeights, "numeric values read first").toEqual(["600", "600", "600"]);
    expect(hierarchy.swatchEmphasis, "Color remains a standalone canonical swatch").toBe(
      "standalone",
    );

    // 4b. The parameter icons are fixed: their geometry must not depend on the
    //     value. Captured here at the Pencil's settings, compared later.
    const pencilGlyphs = await glyphGeometry(rail);
    // The opacity icon encodes no alpha at all, so it can never converge on a
    // solid disc and be mistaken for the colour swatch below it — the exact
    // confusion the earlier value-driven glyph caused at 100% on a dark ink.
    expect(pencilGlyphs.opacity).not.toMatch(/opacity/iu);
    expect(pencilGlyphs.strokeWidth).not.toMatch(/opacity/iu);
    const pencilPrinted = await printedValues(rail);
    expect(pencilPrinted.strokeWidth).toMatch(/^[\d.]+ px$/u);
    expect(pencilPrinted.opacity).toMatch(/^\d+%$/u);
    expect(pencilPrinted.smoothing).toMatch(/^\d+%$/u);

    // 5. Switching presets re-reads the newly active preset.
    await openSlotToolOptions(window, "brush-pen");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pen-brush");
    const brushPen = await canonical();
    expect(brushPen.width).not.toBe(pencil.width);
    expect(await propertyValue(rail, "strokeWidth")).toBe(brushPen.width);
    expect(await propertyValue(rail, "opacity")).toBe(brushPen.opacity);

    // 5b. The printed numbers changed with the preset — and the icons did not.
    const brushPenPrinted = await printedValues(rail);
    expect(brushPenPrinted.strokeWidth).not.toBe(pencilPrinted.strokeWidth);
    expect(await glyphGeometry(rail), "icons are value-independent").toEqual(pencilGlyphs);

    // 6. Smoothing is truthfully unavailable for the Highlighter, and prints no
    //    invented number. Its icons stay identical to every other tool's.
    await activateDockSlot(window, "highlighter");
    const smoothing = rail.locator('button[data-property-key="smoothing"]');
    await expect(smoothing).toBeDisabled();
    await expect(smoothing).toHaveAttribute("data-property-available", "false");
    const highlighterPrinted = await printedValues(rail);
    expect(highlighterPrinted.smoothing).not.toMatch(/\d/u);
    // Opacity at its remapped display scale, never the raw 0.34 model value.
    expect(highlighterPrinted.opacity).toMatch(/^\d+%$/u);
    expect(await glyphGeometry(rail), "icons are tool-independent").toEqual(pencilGlyphs);
    await activateDockSlot(window, "pencil");
    await expect(smoothing).toBeEnabled();

    // 7. The colour swatch shows the canonical creation colour, and the quick
    //    colour rail on the right still shows the very same value.
    const swatchColor = await propertyValue(rail, "strokeColor");
    expect(swatchColor).toMatch(/^#[0-9a-f]{6}$/u);
    await expect(quickRail).toBeVisible();
    const quickCurrentLabel = await window
      .getByTestId("quick-color-current")
      .getAttribute("aria-label");
    expect(quickCurrentLabel).toContain(swatchColor!);

    // 8. Each numeric control opens the existing tool options palette — the
    //    production adjustment path — for the active drawing tool.
    for (const key of ["strokeWidth", "opacity", "smoothing"] as const) {
      await expect(palette, key).toHaveCount(0);
      await rail.locator(`button[data-property-key="${key}"]`).click();
      await expect(palette, key).toBeVisible();
      await expect(palette, key).toHaveAttribute("data-tool-options-tool", "Pencil");
      await window.keyboard.press("Escape");
      await expect(palette, key).toHaveCount(0);
      await expect(rail, key).toBeVisible();
    }

    // 9. The palette is the expanded form of those same properties, so it takes
    //    the rail's own slot rather than being pushed further across the
    //    artwork. It fully covers the rail while open, and releases it on close.
    await rail.locator('button[data-property-key="strokeWidth"]').click();
    await expect(palette).toBeVisible();
    const paletteBox = (await palette.boundingBox())!;
    const railWithPalette = (await rail.boundingBox())!;
    // The palette keeps its own anchor, so the rail's tightened seam leaves a
    // few pixels of its left edge showing. It still covers the rail's controls
    // and full height, which is what keeps the two from reading as a collision.
    expect(paletteBox.x - railWithPalette.x, "palette starts at the rail").toBeLessThanOrEqual(8);
    expect(paletteBox.x + paletteBox.width).toBeGreaterThanOrEqual(
      railWithPalette.x + railWithPalette.width - 0.5,
    );
    expect(paletteBox.y).toBeLessThanOrEqual(railWithPalette.y + 0.5);
    expect(paletteBox.y + paletteBox.height).toBeGreaterThanOrEqual(
      railWithPalette.y + railWithPalette.height - 0.5,
    );
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(rail).toBeVisible();

    // 10. The colour control opens the existing full picker against the real
    //     creation target, and committing updates the swatch.
    await rail.locator('button[data-property-key="strokeColor"]').click();
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute("data-color-target-id", /^creation-/u);
    await expect(picker).toHaveAttribute("data-picker-source", "tool-settings");
    // The picker settles clear of the rail that opened it. The rail is not a
    // declared occupied zone: adding one starved the placement model badly
    // enough that the picker landed on the Layers panel instead.
    const pickerBox = (await picker.boundingBox())!;
    const railUnderPicker = (await rail.boundingBox())!;
    expect(rectsOverlap(pickerBox, railUnderPicker), "picker clear of the rail").toBe(false);
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // 11. None of this touches the document or its History.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 12. Every utility hides the rail cleanly.
    for (const utility of ["Select", "Eraser", "Shapes"] as const) {
      await dock.getByRole("button", { name: utility, exact: true }).click();
      await expect(rail, `${utility} hides the drawing property rail`).toHaveCount(0);
    }

    // 13. The dock itself is unchanged by all of this.
    await expect(drawingCapsule.locator("button[data-dock-slot]")).toHaveCount(5);
    await expect(utilityCapsule.locator("button[data-dock-slot]")).toHaveCount(3);
    expect((await drawingCapsule.boundingBox())!.x).toBe(capsuleBox.x);
    expect((await drawingCapsule.boundingBox())!.y).toBeCloseTo(capsuleBox.y, 1);

    // 14. The minimum window keeps the rail on screen and clear of the dock.
    await window.setViewportSize({ width: 960, height: 640 });
    await activateDockSlot(window, "pencil");
    await expect(rail).toBeVisible();
    const smallRail = (await rail.boundingBox())!;
    const smallCapsule = (await drawingCapsule.boundingBox())!;
    const smallUtility = (await utilityCapsule.boundingBox())!;
    expect(smallRail.x).toBeGreaterThan(smallCapsule.x + smallCapsule.width);
    expect(smallRail.y + smallRail.height).toBeLessThan(smallUtility.y);
    const offscreen = await rail.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.top < -0.5 ||
        rect.left < -0.5 ||
        rect.bottom > globalThis.innerHeight + 0.5 ||
        rect.right > globalThis.innerWidth + 0.5
      );
    });
    expect(offscreen, "rail fits the minimum window").toBe(false);
    for (const key of ["strokeWidth", "opacity", "smoothing", "strokeColor"] as const) {
      const box = await rail.locator(`button[data-property-key="${key}"]`).boundingBox();
      expect(box!.width, `${key} hit target`).toBeGreaterThanOrEqual(28);
      expect(box!.height, `${key} hit target`).toBeGreaterThanOrEqual(28);
    }

    // 15. Drawing still works with the rail present.
    await window.setViewportSize({ width: 1440, height: 900 });
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const bounds = (await inkCanvas.boundingBox())!;
    await window.mouse.move(bounds.x + 500, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 640, bounds.y + 360, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function rectsOverlap(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

/**
 * The raw SVG markup of each parameter icon.
 *
 * Fixed icons must serialise identically whatever the underlying value is, so
 * comparing these strings across presets and tools is what proves the glyphs no
 * longer encode their value.
 */
async function glyphGeometry(rail: Locator): Promise<Record<string, string>> {
  return rail.evaluate((element) => {
    const geometry: Record<string, string> = {};
    for (const button of element.querySelectorAll("button[data-property-key]")) {
      const key = button.getAttribute("data-property-key") ?? "";
      if (key === "strokeColor") continue;
      geometry[key] = button.querySelector("svg")?.innerHTML ?? "";
    }
    return geometry;
  });
}

/** The number printed beneath each parameter icon. */
async function printedValues(rail: Locator): Promise<Record<string, string>> {
  return rail.evaluate((element) => {
    const printed: Record<string, string> = {};
    for (const button of element.querySelectorAll("button[data-property-key]")) {
      const key = button.getAttribute("data-property-key") ?? "";
      printed[key] = button.getAttribute("data-property-display") ?? "";
    }
    return printed;
  });
}

async function propertyValue(rail: Locator, key: string): Promise<string | null> {
  return rail.locator(`button[data-property-key="${key}"]`).getAttribute("data-property-value");
}
