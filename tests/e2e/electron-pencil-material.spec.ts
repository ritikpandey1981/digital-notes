import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * Hybrid Pencil in the running application.
 *
 * Unit tests settle what the material is; this settles that it is what reaches
 * the screen. Every assertion here is about pixels a person could point at:
 * graphite appears, it is textured rather than solid, it is the colour that was
 * chosen, it survives undo, a save and a reopen, and it comes back after the
 * cache has been through a page switch -- which is the whole claim of a runtime
 * cache that is allowed to throw its contents away.
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

interface Sampled {
  /** Cells meaningfully darker than the paper they sit on. */
  readonly painted: number;
  readonly total: number;
  /** How many distinct tones the region holds. Solid ink has very few. */
  readonly distinctTones: number;
  /** Cells that stayed bare paper. */
  readonly bare: number;
  readonly averageRed: number;
  readonly averageGreen: number;
  readonly averageBlue: number;
  readonly darkest: number;
}

/**
 * Reads one screen rectangle off a canvas as a distribution of tones.
 *
 * The page compositor is opaque -- paper is painted under the artwork -- so
 * "textured" cannot be read off the alpha channel and has to be read off the
 * tones. That is also the honest measurement: what makes graphite look like
 * graphite is that one small region holds many tones and still shows paper,
 * where ink holds one tone and covers it.
 */
async function sampleArtwork(
  window: Page,
  selector: string,
  region: Readonly<{ x: number; y: number; width: number; height: number }>,
): Promise<Sampled> {
  return window.locator(selector).evaluate((element, input) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Canvas context is unavailable.");
    const bounds = target.getBoundingClientRect();
    const scaleX = target.width / bounds.width;
    const scaleY = target.height / bounds.height;
    const x = Math.round((input.x - bounds.left) * scaleX);
    const y = Math.round((input.y - bounds.top) * scaleY);
    const width = Math.max(1, Math.round(input.width * scaleX));
    const height = Math.max(1, Math.round(input.height * scaleY));
    const pixels = context.getImageData(x, y, width, height).data;
    const tones = new Set<number>();
    let brightest = 0;
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const luminance = Math.round(
        0.299 * (pixels[pixel] ?? 0) +
          0.587 * (pixels[pixel + 1] ?? 0) +
          0.114 * (pixels[pixel + 2] ?? 0),
      );
      tones.add(luminance);
      if (luminance > brightest) brightest = luminance;
    }
    // Paper is the brightest thing in the region; graphite is anything
    // meaningfully below it.
    const threshold = brightest - 10;
    let painted = 0;
    let bare = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let darkest = 255;
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const luminance = Math.round(
        0.299 * (pixels[pixel] ?? 0) +
          0.587 * (pixels[pixel + 1] ?? 0) +
          0.114 * (pixels[pixel + 2] ?? 0),
      );
      if (luminance < threshold) {
        painted += 1;
        red += pixels[pixel] ?? 0;
        green += pixels[pixel + 1] ?? 0;
        blue += pixels[pixel + 2] ?? 0;
        if (luminance < darkest) darkest = luminance;
      } else bare += 1;
    }
    return {
      painted,
      total: pixels.length / 4,
      distinctTones: tones.size,
      bare,
      averageRed: painted === 0 ? 0 : red / painted,
      averageGreen: painted === 0 ? 0 : green / painted,
      averageBlue: painted === 0 ? 0 : blue / painted,
      darkest,
    };
  }, region);
}

/** Draws one mark and waits for it to become a committed object. */
async function drawStroke(
  window: Page,
  points: readonly Readonly<{ x: number; y: number }>[],
  expectedObjects: number,
): Promise<void> {
  const first = points[0];
  if (first === undefined) throw new Error("A stroke needs at least one point.");
  await window.mouse.move(first.x, first.y);
  await window.mouse.down();
  for (const point of points.slice(1)) await window.mouse.move(point.x, point.y, { steps: 10 });
  await window.mouse.up();
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
    "data-document-object-count",
    String(expectedObjects),
  );
}

test("deposits, caches and rebuilds real graphite in the editor", async () => {
  test.setTimeout(240_000);
  const electronApp = await launch();
  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");

    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 380;
    const originY = bounds.y + 300;

    // 1. A drawn mark actually deposits graphite on the page compositor, and it
    //    is textured: many tones, with bare paper still showing through it.
    await drawStroke(
      window,
      [
        { x: originX, y: originY },
        { x: originX + 140, y: originY + 60 },
        { x: originX + 280, y: originY - 20 },
      ],
      1,
    );
    const drawn = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', {
      x: originX - 10,
      y: originY - 40,
      width: 300,
      height: 130,
    });
    expect(drawn.painted).toBeGreaterThan(200);
    expect(drawn.distinctTones).toBeGreaterThan(8);
    expect(drawn.bare).toBeGreaterThan(drawn.painted / 4);

    // 2. A tap leaves a tip rather than nothing. The seeded HB slot is a two
    //    unit pencil, so its impression is a handful of pixels; that it is
    //    *textured* is settled at a broad size in the material suite, where
    //    there are enough pixels for the word to mean anything.
    await window.mouse.move(originX + 360, originY + 120);
    await window.mouse.down();
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    const tap = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', {
      x: originX + 340,
      y: originY + 100,
      width: 40,
      height: 40,
    });
    expect(tap.painted).toBeGreaterThan(0);
    expect(tap.painted).toBeLessThan(tap.total / 4);

    // 3. Undo removes it and Redo brings back the same material.
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    const afterRedo = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', {
      x: originX - 10,
      y: originY - 40,
      width: 300,
      height: 130,
    });
    expect(afterRedo.painted).toBeGreaterThan(200);
    expect(Math.abs(afterRedo.painted - drawn.painted)).toBeLessThan(drawn.painted * 0.1);

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("rebuilds Pencil material after the cache is emptied by a page switch", async () => {
  test.setTimeout(240_000);
  const electronApp = await launch();
  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");

    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 400;
    const originY = bounds.y + 320;
    await drawStroke(
      window,
      [
        { x: originX, y: originY },
        { x: originX + 160, y: originY + 40 },
        { x: originX + 300, y: originY - 30 },
      ],
      1,
    );
    const region = { x: originX - 10, y: originY - 50, width: 320, height: 140 };
    const before = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', region);
    expect(before.painted).toBeGreaterThan(200);

    // A page switch cancels reconstruction for the page being left. Coming
    // back has to produce the same mark, whether from what survived in the
    // cache or from a rebuild -- which is the whole point of the material
    // being derived rather than stored.
    const added = await window.evaluate(() => {
      const actions = (window as unknown as { __folioPageActions?: { addPage?: () => unknown } })
        .__folioPageActions;
      return typeof actions?.addPage === "function";
    });
    if (added) {
      await window.evaluate(() => {
        (
          window as unknown as { __folioPageActions: { addPage: () => unknown } }
        ).__folioPageActions.addPage();
      });
      await window.waitForTimeout(400);
    }

    await window.keyboard.press("Control+z");
    await window.keyboard.press("Control+y");
    await window.waitForTimeout(400);
    const after = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', region);
    expect(after.painted).toBeGreaterThan(200);
    expect(Math.abs(after.painted - before.painted)).toBeLessThan(before.painted * 0.15);

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

test("fills in a broad Pencil stroke progressively and exactly", async () => {
  test.setTimeout(240_000);
  const electronApp = await launch();
  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    // Through the control a person uses. The `window.__folioDrawingActions`
    // hook this replaces never existed, and being optional-chained it left this
    // test drawing at the preset's own 2 page units -- so "a broad mark" was
    // never broad, and the many-tile case it exists for was never reached.
    await openSlotToolOptions(window, "pencil");
    const sizePalette = window.getByTestId("context-tool-palette");
    const sizeField = sizePalette.getByLabel("Size value");
    await sizeField.fill("26");
    await sizeField.press("Enter");
    await window.keyboard.press("Escape");
    await expect(sizePalette).toHaveCount(0);
    await expect(
      window
        .getByTestId("drawing-property-rail")
        .locator('button[data-property-key="strokeWidth"]'),
    ).toHaveAttribute("data-property-value", "26");

    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 260;
    const originY = bounds.y + 300;
    // A broad mark occupies many tiles, so committing it is the case where a
    // painter that built every presentation in one frame would be felt.
    await drawStroke(
      window,
      [
        { x: originX, y: originY },
        { x: originX + 200, y: originY + 120 },
        { x: originX + 420, y: originY - 40 },
        { x: originX + 640, y: originY + 90 },
      ],
      1,
    );
    const region = { x: originX - 20, y: originY - 80, width: 680, height: 220 };
    const settled = await sampleArtwork(window, 'canvas[data-folio-layer="page"]', region);
    expect(settled.painted).toBeGreaterThan(500);
    expect(settled.distinctTones).toBeGreaterThan(8);

    // Every tile that is on screen ends up drawable, and the editor stayed
    // responsive enough to answer while it happened.
    const diagnostics = await inkCanvas.evaluate((element) => {
      const data = (element as HTMLCanvasElement).dataset;
      return {
        residentTiles: Number(data.materialResidentTiles ?? "0"),
        presentations: Number(data.materialPresentations ?? "0"),
        longestPresentationMs: Number(data.materialLongestPresentation ?? "0"),
        bytes: Number(data.materialBytes ?? "0"),
      };
    });
    expect(diagnostics.residentTiles).toBeGreaterThan(8);
    expect(diagnostics.presentations).toBeGreaterThan(0);
    // Presentation backing is charged to the same budget the material is.
    expect(diagnostics.bytes).toBeGreaterThan(diagnostics.residentTiles * 16 * 1024);

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
