import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * Marker in the real application: the seeded Marker slot, drawn with,
 * committed, undone and erased.
 *
 * Unit tests settle what `marker@1` draws. What only the running app can settle
 * is that an oriented nib reaches the canvas through the ordinary slot, preset,
 * colour and input path; that the live renderer and the committed document both
 * name the new strategy; and that nothing in the editor had to learn what a nib
 * is.
 *
 * It does not judge the appearance. That is what the inspection sheet is for,
 * and the appearance is not frozen.
 */

const REPOSITORY_ROOT = process.cwd();

async function launch() {
  return electron.launch({
    args: [path.join(REPOSITORY_ROOT, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      REPOSITORY_ROOT,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
}

/**
 * Cells in a region the mark occupies.
 *
 * Two layers, two honest ways to ask. The page layer carries the paper, so ink
 * is what is meaningfully darker than the brightest thing in the region; the
 * ink layer is transparent except for the stroke being drawn, so there ink is
 * simply what is not transparent. A live stroke is on the second and a
 * committed one on the first, which is the whole reason this takes a layer.
 */
async function paintedCells(
  window: Page,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
  layer: "page" | "ink" = "page",
): Promise<number> {
  return window.locator(`canvas[data-folio-layer="${layer}"]`).evaluate((element, input) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Canvas context is unavailable.");
    const bounds = target.getBoundingClientRect();
    const scaleX = target.width / bounds.width;
    const scaleY = target.height / bounds.height;
    const pixels = context.getImageData(
      Math.round((input.x - bounds.left) * scaleX),
      Math.round((input.y - bounds.top) * scaleY),
      Math.max(1, Math.round(input.width * scaleX)),
      Math.max(1, Math.round(input.height * scaleY)),
    ).data;
    let opaque = 0;
    for (let pixel = 3; pixel < pixels.length; pixel += 4) {
      if ((pixels[pixel] ?? 0) > 24) opaque += 1;
    }
    // A layer that is mostly transparent is the ink layer, and there coverage
    // is alpha. Asking the paper question of it would compare the stroke
    // against itself.
    if (opaque * 4 < pixels.length) return opaque;
    let brightest = 0;
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const luminance =
        0.299 * (pixels[pixel] ?? 0) +
        0.587 * (pixels[pixel + 1] ?? 0) +
        0.114 * (pixels[pixel + 2] ?? 0);
      if (luminance > brightest) brightest = luminance;
    }
    let painted = 0;
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const luminance =
        0.299 * (pixels[pixel] ?? 0) +
        0.587 * (pixels[pixel + 1] ?? 0) +
        0.114 * (pixels[pixel + 2] ?? 0);
      if (luminance < brightest - 10) painted += 1;
    }
    return painted;
  }, region);
}

async function strokeBrushes(
  window: Page,
): Promise<readonly { presetId: string; rendererKind: string; family: string }[]> {
  return window.evaluate(() => {
    const raw =
      document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getAttribute("data-document-stroke-brushes") ?? "[]";
    return JSON.parse(raw) as { presetId: string; rendererKind: string; family: string }[];
  });
}

test("draws with Marker through the ordinary slot, colour and input path", async () => {
  test.setTimeout(180_000);
  const electronApp = await launch();
  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const markerSlot = dock.locator('button[data-dock-slot="marker"]');

    // 1. The seeded Marker slot holds the preset that moved onto the strategy,
    //    and still says Marker with the glyph it always had.
    await activateDockSlot(window, "marker");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "marker");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "marker-felt");
    await expect(markerSlot).toHaveAttribute("data-slot-glyph", "brush");

    // 2. Draw. The live renderer names the new strategy while the stroke is
    //    still in progress, which is the wiring this spec exists to prove.
    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 360;
    const originY = bounds.y + 260;
    await window.mouse.move(originX, originY);
    await window.mouse.down();
    await window.mouse.move(originX + 140, originY + 60, { steps: 12 });
    await window.mouse.move(originX + 280, originY - 20, { steps: 12 });
    await expect(inkCanvas).toHaveAttribute("data-ink-brush-strategy", "marker");
    const region = { x: originX - 20, y: originY - 60, width: 330, height: 150 };
    const live = await paintedCells(window, region, "ink");
    expect(live, "the live stroke is on the canvas").toBeGreaterThan(200);
    await window.mouse.up();

    // 3. Pointer-up changes the layer the mark lives on and not the mark. A
    //    shape, width or opacity jump at commit would show up here as a
    //    materially different amount of ink. The two counts come from two
    //    different canvases, so the tolerance is generous on purpose: what
    //    would fail is a nib that changed size or a cap that appeared, not a
    //    pixel of antialiasing.
    await window.waitForTimeout(300);
    const committed = await paintedCells(window, region);
    expect(committed).toBeGreaterThan(200);
    // Measured equal, cell for cell, on this machine. Five percent rather than
    // zero because two canvases and a device pixel ratio are involved; a nib
    // that changed size or a cap that appeared would be far outside it.
    expect(Math.abs(committed - live) / live, "no jump at pointer-up").toBeLessThan(0.05);

    // 4. One stroke, one History entry, carrying the new strategy durably.
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    const brushes = await strokeBrushes(window);
    expect(brushes).toHaveLength(1);
    expect(brushes[0]!.rendererKind).toBe("marker");
    expect(brushes[0]!.presetId).toBe("marker-felt");
    expect(brushes[0]!.family).toBe("marker");

    // 5. Undo and redo keep the strategy, so the document round-trips through
    //    History without reinterpreting what drew the mark.
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect((await strokeBrushes(window))[0]!.rendererKind).toBe("marker");
    await window.waitForTimeout(300);
    expect(await paintedCells(window, region)).toBeGreaterThan(200);

    // 6. A tap is a mark. A nib that vanished when the pointer did not move
    //    would be the easiest thing in the world to ship by accident.
    const tapX = bounds.x + 320;
    const tapY = bounds.y + 560;
    await window.mouse.move(tapX, tapY);
    await window.mouse.down();
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await window.waitForTimeout(250);
    const tapRegion = { x: tapX - 24, y: tapY - 24, width: 48, height: 48 };
    expect(await paintedCells(window, tapRegion), "a tap leaves an impression").toBeGreaterThan(20);

    // 7. Broad, through the control a person uses, read back before drawing.
    await openSlotToolOptions(window, "marker");
    const palette = window.getByTestId("context-tool-palette");
    const sizeField = palette.getByLabel("Size value");
    await sizeField.fill("28");
    await sizeField.press("Enter");
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(
      window
        .getByTestId("drawing-property-rail")
        .locator('button[data-property-key="strokeWidth"]'),
    ).toHaveAttribute("data-property-value", "28");

    const broadY = bounds.y + 700;
    await window.mouse.move(bounds.x + 320, broadY);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 600, broadY + 40, { steps: 16 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await window.waitForTimeout(300);
    const broadRegion = { x: bounds.x + 300, y: broadY - 40, width: 330, height: 130 };
    const broad = await paintedCells(window, broadRegion);
    expect(broad, "a broad marker covers more than a default one").toBeGreaterThan(committed);

    // 8. The eraser removes a Marker stroke whole, through the shared path.
    await dock.locator('button[data-dock-slot="eraser"]').click();
    await window.mouse.move(bounds.x + 360, broadY + 10);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 420, broadY + 25, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    expect(consoleErrors, "no console errors").toEqual([]);
  } finally {
    await electronApp.close();
  }
});
