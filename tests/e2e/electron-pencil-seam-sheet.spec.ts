import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

const REPOSITORY_ROOT = process.cwd();
const LABEL = process.env.SEAM_LABEL ?? "current";
const OUT = "test-results/e42e";

async function launch() {
  return electron.launch({
    args: [path.join(REPOSITORY_ROOT, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      REPOSITORY_ROOT,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function setZoom(window: Page, target: number, anchor: { x: number; y: number }) {
  const surface = window.getByTestId("canvas-surface");
  for (let step = 0; step < 90; step += 1) {
    const zoom = await attributeNumber(surface, "data-viewport-zoom");
    if (Math.abs(zoom - target) / target < 0.03) break;
    await window.mouse.move(anchor.x, anchor.y);
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, zoom < target ? -30 : 30);
    await window.keyboard.up("Control");
    await window.waitForTimeout(40);
  }
  await window.waitForTimeout(500);
  return attributeNumber(surface, "data-viewport-zoom");
}

/** A magnified, unfiltered strip straddling a tile boundary or corner. */
async function magnify(
  window: Page,
  layer: "ink" | "page",
  kind: "edge" | "corner",
  zoom: number,
  pageX: number,
  pageY: number,
) {
  return window.evaluate(
    (input) => {
      const source = document.querySelector(
        `canvas[data-folio-layer="${input.layer}"]`,
      ) as HTMLCanvasElement | null;
      if (source === null) throw new Error("no canvas");
      const rect = source.getBoundingClientRect();
      const sx = source.width / rect.width;
      const sy = source.height / rect.height;
      let bx = 0;
      for (let tile = -40; tile < 200; tile += 1) {
        const device = (input.pageX + tile * 64 * input.zoom) * sx;
        if (device > 320 && device < source.width - 320) {
          bx = device;
          break;
        }
      }
      let by = 0;
      for (let tile = -40; tile < 200; tile += 1) {
        const device = (input.pageY + tile * 64 * input.zoom) * sy;
        if (device > 160 && device < source.height - 160) {
          by = device;
          break;
        }
      }
      const SCALE = 5;
      const W = input.kind === "corner" ? 70 : 48;
      const H = input.kind === "corner" ? 70 : 120;
      const left = Math.round(bx) - Math.floor(W / 2);
      const top =
        input.kind === "corner" ? Math.round(by) - Math.floor(H / 2) : Math.round(by) + 20;
      const existing = document.getElementById("e42e-magnifier");
      if (existing !== null) existing.remove();
      const view = document.createElement("canvas");
      view.id = "e42e-magnifier";
      view.width = W * SCALE;
      view.height = H * SCALE;
      view.style.cssText =
        "position:fixed;left:16px;top:16px;z-index:99999;image-rendering:pixelated;border:2px solid #f0f;background:#fff";
      const cx = view.getContext("2d");
      if (cx === null) throw new Error("no ctx");
      cx.fillStyle = "#ffffff";
      cx.fillRect(0, 0, view.width, view.height);
      cx.imageSmoothingEnabled = false;
      cx.drawImage(source, left, top, W, H, 0, 0, W * SCALE, H * SCALE);
      // Ticks outside the artwork marking where the lattice actually falls.
      cx.fillStyle = "#f0f";
      cx.fillRect((Math.round(bx) - left) * SCALE, 0, 1, 10);
      cx.fillRect((Math.round(bx) - left) * SCALE, H * SCALE - 10, 1, 10);
      if (input.kind === "corner") {
        cx.fillRect(0, (Math.round(by) - top) * SCALE, 10, 1);
        cx.fillRect(W * SCALE - 10, (Math.round(by) - top) * SCALE, 10, 1);
      }
      document.body.append(view);
      return { boundaryX: Number(bx.toFixed(2)), boundaryY: Number(by.toFixed(2)) };
    },
    { layer, kind, zoom, pageX, pageY },
  );
}

/**
 * A sheet of broad Pencil to look at, magnified where the lattice falls.
 *
 * Everything about seams is settled by assertions elsewhere. This is the other
 * half of the evidence: images a person can hold against the complaint that
 * started the work, at the zoom it was reported at. Nothing here asserts
 * anything about appearance, because appearance is not something a number
 * settles -- and the numbers that do settle it could not see the committed
 * case at all, which is exactly why the pictures are kept.
 *
 * Opt in with `FOLIO_PENCIL_SHEET=1`, and set `SEAM_LABEL` to name the run so
 * two builds can be compared. Artifacts land in `test-results/e42e/`.
 */
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
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "78");
    await window.keyboard.press("Escape");
    await activateDockSlot(window, "pencil");

    const bounds = (await inkCanvas.boundingBox())!;
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

    // A block broad enough to cross several tiles in both directions.
    let objects = 0;
    let seed = 5;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let pass = 0; pass < 34; pass += 1) {
      const y = bounds.y + 150 + pass * 14 + random() * 7;
      await window.mouse.move(bounds.x + 150, y);
      await window.mouse.down();
      for (let step = 1; step <= 8; step += 1) {
        await window.mouse.move(bounds.x + 150 + (step / 8) * 800, y + (random() - 0.5) * 24, {
          steps: 5,
        });
      }
      await window.mouse.up();
      objects += 1;
      await expect(surface).toHaveAttribute("data-document-object-count", String(objects));
    }

    for (const [name, target] of [
      ["100", 1],
      ["200", 2],
      ["300", 3],
      ["664", 6.64],
    ] as const) {
      const zoom = await setZoom(window, target, centre);
      const pageX = await attributeNumber(surface, "data-viewport-page-x");
      const pageY = await attributeNumber(surface, "data-viewport-page-y");
      await window
        .locator('canvas[data-folio-layer="page"]')
        .screenshot({ path: `${OUT}/${LABEL}-sheet-${name}.png` });
      await magnify(window, "page", "edge", zoom, pageX, pageY);
      await window
        .locator("#e42e-magnifier")
        .screenshot({ path: `${OUT}/${LABEL}-edge-${name}.png` });
      await magnify(window, "page", "corner", zoom, pageX, pageY);
      await window
        .locator("#e42e-magnifier")
        .screenshot({ path: `${OUT}/${LABEL}-corner-${name}.png` });
      await window.evaluate(() => document.getElementById("e42e-magnifier")?.remove());
      console.log(`ARTIFACT ${LABEL} ${name} zoom=${zoom.toFixed(3)}`);
    }

    // Active, mid-stroke, at the zoom the defect was reported at.
    const zoom = await setZoom(window, 6.64, centre);
    const pageX = await attributeNumber(surface, "data-viewport-page-x");
    const pageY = await attributeNumber(surface, "data-viewport-page-y");
    const y = bounds.y + 500;
    await window.mouse.move(bounds.x + 120, y);
    await window.mouse.down();
    for (let step = 1; step <= 14; step += 1) {
      await window.mouse.move(bounds.x + 120 + step * 85, y + Math.sin(step / 4) * 14, {
        steps: 4,
      });
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (let step = 14; step >= 1; step -= 1) {
        await window.mouse.move(bounds.x + 120 + step * 85, y + pass * 14 + 10, { steps: 3 });
      }
    }
    await window.waitForTimeout(400);
    await magnify(window, "ink", "edge", zoom, pageX, pageY);
    await window.locator("#e42e-magnifier").screenshot({ path: `${OUT}/${LABEL}-active-664.png` });
    await window.evaluate(() => document.getElementById("e42e-magnifier")?.remove());
    await window.mouse.up();
    await window.waitForTimeout(900);
    await magnify(window, "page", "edge", zoom, pageX, pageY);
    await window
      .locator("#e42e-magnifier")
      .screenshot({ path: `${OUT}/${LABEL}-committed-664.png` });
    await window.evaluate(() => document.getElementById("e42e-magnifier")?.remove());
    console.log(`ARTIFACT ${LABEL} active/committed zoom=${zoom.toFixed(3)}`);
  } finally {
    await app.close().catch(() => undefined);
  }
});
