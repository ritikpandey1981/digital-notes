import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * A sheet of broad Pencil to look at, and a frame sequence across pointer-up.
 *
 * The seam and the handover are both settled by assertions elsewhere. This is
 * the other half of the evidence: images a person can hold up against the
 * complaint that started the work. Nothing here asserts anything about
 * appearance, because appearance is not something a number settles.
 *
 * Opt in with `FOLIO_PENCIL_SHEET=1`; it is skipped in the ordinary suite,
 * where it would only produce files nobody reads. Artifacts land in
 * `test-results/pencil-seam-sheet/`.
 */

const REPOSITORY_ROOT = process.cwd();
const OUTPUT = "test-results/pencil-seam-sheet";

async function launch() {
  return electron.launch({
    args: [path.join(REPOSITORY_ROOT, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      REPOSITORY_ROOT,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function selectZoomMenuItem(window: Page, name: string): Promise<void> {
  await window.getByRole("button", { name: /Zoom options/u }).click();
  await window.getByRole("menuitem", { name, exact: true }).click();
  await expect(window.getByRole("menu")).toHaveCount(0);
}

test("draws a broad Pencil sheet for inspection", async () => {
  test.skip(
    process.env.FOLIO_PENCIL_SHEET !== "1",
    "Set FOLIO_PENCIL_SHEET=1 to regenerate the inspection sheet.",
  );
  test.setTimeout(600_000);
  const app = await launch();
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');

    await openSlotToolOptions(window, "pencil");
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "26");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "92");
    await window.keyboard.press("Escape");
    await activateDockSlot(window, "pencil");

    const bounds = (await inkCanvas.boundingBox())!;
    const left = bounds.x + 140;
    const top = bounds.y + 140;
    let objects = 0;
    const stroke = async (points: readonly Readonly<{ x: number; y: number }>[]) => {
      const first = points[0];
      if (first === undefined) return;
      await window.mouse.move(first.x, first.y);
      await window.mouse.down();
      for (const point of points.slice(1)) await window.mouse.move(point.x, point.y, { steps: 8 });
      await window.mouse.up();
      objects += 1;
      await expect(surface).toHaveAttribute("data-document-object-count", String(objects));
    };

    // Horizontal, vertical, diagonal, and a dense scribble: four shapes whose
    // relationship to an axis-aligned tile lattice is different in each case.
    for (let index = 0; index < 4; index += 1) {
      const y = top + index * 16;
      await stroke([
        { x: left, y },
        { x: left + 760, y },
      ]);
    }
    for (let index = 0; index < 4; index += 1) {
      const x = left + 60 + index * 16;
      await stroke([
        { x, y: top + 110 },
        { x, y: top + 430 },
      ]);
    }
    for (let index = 0; index < 4; index += 1) {
      await stroke([
        { x: left + 220 + index * 18, y: top + 110 },
        { x: left + 520 + index * 18, y: top + 420 },
      ]);
    }
    let seed = 11;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let pass = 0; pass < 16; pass += 1) {
      const y = top + 470 + pass * 11 + random() * 6;
      const points = [{ x: left + 420, y }];
      for (let step = 1; step <= 7; step += 1) {
        points.push({ x: left + 420 + (step / 7) * 340, y: y + (random() - 0.5) * 22 });
      }
      await stroke(points);
    }

    for (const [name, item] of [
      ["100", "100% (Actual Size)"],
      ["200", "200%"],
      ["300", "300%"],
    ] as const) {
      await selectZoomMenuItem(window, item);
      await window.waitForTimeout(900);
      await window
        .locator('canvas[data-folio-layer="page"]')
        .screenshot({ path: `${OUTPUT}/sheet-${name}.png` });
    }

    // A magnified strip straddling one tile boundary, unfiltered. A one pixel
    // seam is invisible in a screenshot of the editor and unmistakable here.
    await selectZoomMenuItem(window, "200%");
    await window.waitForTimeout(700);
    const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const pageX = Number(await surface.getAttribute("data-viewport-page-x"));
    await window.evaluate(
      (input) => {
        const source = document.querySelector(
          'canvas[data-folio-layer="page"]',
        ) as HTMLCanvasElement | null;
        if (source === null) throw new Error("no page canvas");
        const rect = source.getBoundingClientRect();
        const sx = source.width / rect.width;
        let boundary = 0;
        for (let tile = 1; tile < 40; tile += 1) {
          const device = (input.pageX + tile * 64 * input.zoom) * sx;
          if (device > 340 && device < 900) {
            boundary = device;
            break;
          }
        }
        const SCALE = 6;
        const W = 44;
        const H = 90;
        const view = document.createElement("canvas");
        view.id = "seam-sheet-magnifier";
        view.width = W * SCALE;
        view.height = H * SCALE;
        view.style.cssText =
          "position:fixed;left:20px;top:20px;z-index:99999;image-rendering:pixelated;border:2px solid #f0f;background:#fff";
        const context = view.getContext("2d");
        if (context === null) throw new Error("no ctx");
        context.imageSmoothingEnabled = false;
        const originX = Math.round(boundary) - W / 2;
        context.drawImage(source, originX, 200, W, H, 0, 0, W * SCALE, H * SCALE);
        context.fillStyle = "#f0f";
        context.fillRect((Math.round(boundary) - originX) * SCALE, 0, 1, 12);
        context.fillRect((Math.round(boundary) - originX) * SCALE, H * SCALE - 12, 1, 12);
        document.body.append(view);
      },
      { zoom, pageX },
    );
    await window
      .locator("#seam-sheet-magnifier")
      .screenshot({ path: `${OUTPUT}/boundary-magnified-200.png` });
    await window.evaluate(() => document.getElementById("seam-sheet-magnifier")?.remove());

    // And the handover, frame by frame, as a strip of consecutive captures.
    await selectZoomMenuItem(window, "100% (Actual Size)");
    await window.waitForTimeout(500);
    const handoffY = bounds.y + 640;
    await window.mouse.move(bounds.x + 220, handoffY);
    await window.mouse.down();
    for (let step = 1; step <= 14; step += 1) {
      await window.mouse.move(bounds.x + 220 + step * 34, handoffY + Math.sin(step / 3) * 26, {
        steps: 3,
      });
    }
    await window.mouse.up();
    for (let frame = 0; frame < 4; frame += 1) {
      await window
        .locator('canvas[data-folio-layer="page"]')
        .screenshot({ path: `${OUTPUT}/handoff-frame-${String(frame)}.png` });
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});
