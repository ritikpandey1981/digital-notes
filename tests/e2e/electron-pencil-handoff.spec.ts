import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * The two things a person sees rather than measures: whether broad Pencil shows
 * a grid, and whether a finished stroke flickers when the pencil is lifted.
 *
 * Both were reported from the running application and both are settled here in
 * the running application, because both are properties of the compositor rather
 * than of the material. The material suites already prove the graphite is
 * continuous across a tile boundary; what these check is that it *reaches the
 * screen* continuously, in space and in time.
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

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
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

async function selectBroadPencil(window: Page, size: string, opacity: string): Promise<void> {
  await openSlotToolOptions(window, "pencil");
  await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), size);
  await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), opacity);
  await window.keyboard.press("Escape");
  await activateDockSlot(window, "pencil");
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
    "data-drawing-brush-family",
    "pencil",
  );
}

/**
 * Folds the tone of a painted block onto every offset inside one tile.
 *
 * A seam makes the tile boundary the lightest of the sixteen offsets; paper
 * tooth makes none of them stand out. Comparing the boundary against fifteen
 * controls inside the same artwork is what makes this a test rather than a
 * threshold picked to pass: the controls come from the same graphite, the same
 * texture and the same measurement.
 */
async function boundaryRank(window: Page) {
  const surface = window.getByTestId("canvas-surface");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  return window.locator('canvas[data-folio-layer="page"]').evaluate(
    (element, input) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no context");
      const w = target.width;
      const h = target.height;
      const pixels = context.getImageData(0, 0, w, h).data;
      const lum = (i: number) =>
        0.299 * (pixels[i * 4] ?? 0) +
        0.587 * (pixels[i * 4 + 1] ?? 0) +
        0.114 * (pixels[i * 4 + 2] ?? 0);

      const rowDark: number[] = [];
      for (let y = 0; y < h; y += 1) {
        let dark = 0;
        for (let x = 0; x < w; x += 1) if (lum(y * w + x) < 190) dark += 1;
        rowDark.push(dark);
      }
      const widest = Math.max(...rowDark);
      if (widest < 120) return null;
      let yTop = -1;
      let yBottom = -1;
      for (let y = 0; y < h; y += 1) {
        if ((rowDark[y] ?? 0) > widest * 0.75) {
          if (yTop < 0) yTop = y;
          yBottom = y;
        }
      }
      // Averaging down the block is what separates a seam from paper: tooth is
      // uncorrelated between rows and averages away, a line does not.
      const profile: number[] = [];
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        for (let y = yTop; y <= yBottom; y += 1) sum += lum(y * w + x);
        profile.push(sum / (yBottom - yTop + 1));
      }
      let xLeft = -1;
      let xRight = -1;
      for (let x = 0; x < w; x += 1) {
        if ((profile[x] ?? 255) < 190) {
          if (xLeft < 0) xLeft = x;
          xRight = x;
        }
      }

      const bounds = target.getBoundingClientRect();
      const sx = target.width / bounds.width;
      const sy = target.height / bounds.height;
      const lift = (
        prof: readonly number[],
        toDevice: (page: number) => number,
        lo: number,
        hi: number,
        offset: number,
      ) => {
        const on: number[] = [];
        const beside: number[] = [];
        for (let tile = -40; tile <= 200; tile += 1) {
          const d = toDevice(tile * 64 + offset);
          if (d < lo + 8 || d > hi - 8) continue;
          for (const o of [-1, 0]) on.push(prof[Math.round(d) + o] ?? 0);
          for (const o of [-5, -4, 4, 5]) beside.push(prof[Math.round(d) + o] ?? 0);
        }
        if (on.length === 0) return 0;
        const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
        return mean(on) - mean(beside);
      };
      const toDeviceX = (page: number) => (input.pageX + page * input.zoom) * sx;
      const toDeviceY = (page: number) => (input.pageY + page * input.zoom) * sy;

      const vprofile: number[] = [];
      for (let y = 0; y < h; y += 1) {
        let sum = 0;
        for (let x = xLeft; x <= xRight; x += 1) sum += lum(y * w + x);
        vprofile.push(sum / Math.max(1, xRight - xLeft + 1));
      }

      const sweepV: number[] = [];
      const sweepH: number[] = [];
      for (let offset = 0; offset < 64; offset += 4) {
        sweepV.push(lift(profile, toDeviceX, xLeft, xRight, offset));
        sweepH.push(lift(vprofile, toDeviceY, yTop, yBottom, offset));
      }
      /**
       * How far the tile boundary stands out from the offsets inside the tile,
       * in units of their own spread.
       *
       * The controls are fifteen columns of the same artwork measured the same
       * way, so the spread is this block's own texture. A seam is an outlier
       * against it; what is left after the placement rule should not be.
       */
      const outlier = (sweep: readonly number[]) => {
        const boundary = sweep[0] ?? 0;
        const controls = sweep.slice(1);
        const mean = controls.reduce((a, b) => a + b, 0) / controls.length;
        const sd = Math.sqrt(controls.reduce((a, b) => a + (b - mean) ** 2, 0) / controls.length);
        return {
          boundary: Number(boundary.toFixed(2)),
          controlMean: Number(mean.toFixed(2)),
          controlSd: Number(sd.toFixed(2)),
          controlMax: Number(Math.max(...controls).toFixed(2)),
          sigma: Number((sd === 0 ? 0 : (boundary - mean) / sd).toFixed(2)),
          rank: sweep.filter((value) => value >= boundary).length,
        };
      };
      return { vertical: outlier(sweepV), horizontal: outlier(sweepH) };
    },
    { zoom, pageX, pageY },
  );
}

test("meets its tile boundaries without a seam, at every zoom", async () => {
  test.setTimeout(300_000);
  const app = await launch();
  try {
    const window = await app.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const surface = window.getByTestId("canvas-surface");
    await selectBroadPencil(window, "26", "95");

    // A dense scribble rather than parallel passes. Parallel passes impose
    // their own spacing on the image, and a measurement that folds on a period
    // cannot tell that apart from a seam.
    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 170;
    const originY = bounds.y + 180;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let pass = 0; pass < 30; pass += 1) {
      const y = originY + pass * 13 + random() * 9;
      await window.mouse.move(originX, y);
      await window.mouse.down();
      for (let step = 1; step <= 8; step += 1) {
        await window.mouse.move(originX + (step / 8) * 740, y + (random() - 0.5) * 26, {
          steps: 5,
        });
      }
      await window.mouse.up();
      await expect(surface).toHaveAttribute("data-document-object-count", String(pass + 1));
    }

    for (const label of ["100% (Actual Size)", "150%", "200%", "300%"] as const) {
      await selectZoomMenuItem(window, label);
      await window.waitForTimeout(600);
      const measured = await boundaryRank(window);
      expect(measured, `no artwork found at ${label}`).not.toBeNull();
      if (measured === null) continue;
      /**
       * The tile boundary must be no worse than the worst ordinary column
       * inside the tile.
       *
       * Stated against the artwork's own spread rather than an absolute tone,
       * because the quantity being bounded is "does this line stand out", and
       * the fifteen controls are the same graphite measured the same way. With
       * the placement rule removed the boundary exceeds the worst control by
       * about three tones; with it, by at most a tenth of one. The margin here
       * is far inside that gap at both ends.
       */
      const detail = JSON.stringify(measured);
      expect(
        measured.vertical.boundary,
        `vertical seam at ${label}: ${detail}`,
      ).toBeLessThanOrEqual(measured.vertical.controlMax + 1);
      expect(
        measured.horizontal.boundary,
        `horizontal seam at ${label}: ${detail}`,
      ).toBeLessThanOrEqual(measured.horizontal.controlMax + 1);
      console.log(`SEAM ${label} ${detail}`);
    }

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("hands a finished Pencil stroke over without a blank or partial frame", async () => {
  test.setTimeout(300_000);
  const app = await launch();
  try {
    const window = await app.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await selectBroadPencil(window, "26", "92");

    const bounds = (await inkCanvas.boundingBox())!;
    const startX = bounds.x + 200;
    const y = bounds.y + 400;
    await window.mouse.move(startX, y);
    await window.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await window.mouse.move(startX + step * 30, y + Math.sin(step / 3) * 40, { steps: 3 });
    }

    // Armed while the pencil is still down, so the frames either side of the
    // handover are in one record.
    await window.evaluate(
      (region) => {
        const ink = document.querySelector(
          'canvas[data-folio-layer="ink"]',
        ) as HTMLCanvasElement | null;
        const page = document.querySelector(
          'canvas[data-folio-layer="page"]',
        ) as HTMLCanvasElement | null;
        if (ink === null || page === null) throw new Error("layers missing");
        const inkContext = ink.getContext("2d", { willReadFrequently: true });
        const pageContext = page.getContext("2d", { willReadFrequently: true });
        if (inkContext === null || pageContext === null) throw new Error("contexts missing");
        const box = (canvas: HTMLCanvasElement) => {
          const rect = canvas.getBoundingClientRect();
          const sx = canvas.width / rect.width;
          const sy = canvas.height / rect.height;
          return {
            x: Math.round((region.x - rect.left) * sx),
            y: Math.round((region.y - rect.top) * sy),
            w: Math.max(1, Math.round(region.width * sx)),
            h: Math.max(1, Math.round(region.height * sy)),
          };
        };
        const inkBox = box(ink);
        const pageBox = box(page);
        const samples: { active: number; committed: number; state: string }[] = [];
        let left = 90;
        const tick = () => {
          // The ink layer is transparent except where the live mark is, so
          // alpha answers it. The compositor paints paper under the artwork and
          // is opaque, so there it has to be read as tone.
          const a = inkContext.getImageData(inkBox.x, inkBox.y, inkBox.w, inkBox.h).data;
          let active = 0;
          for (let p = 3; p < a.length; p += 32) if ((a[p] ?? 0) > 16) active += 1;
          const c = pageContext.getImageData(pageBox.x, pageBox.y, pageBox.w, pageBox.h).data;
          let committed = 0;
          for (let p = 0; p < c.length; p += 32) {
            const l = 0.299 * (c[p] ?? 0) + 0.587 * (c[p + 1] ?? 0) + 0.114 * (c[p + 2] ?? 0);
            if (l < 210) committed += 1;
          }
          const isActive = active > 4;
          const isCommitted = committed > 4;
          samples.push({
            active,
            committed,
            state:
              isActive && isCommitted
                ? "BOTH"
                : isActive
                  ? "ACTIVE"
                  : isCommitted
                    ? "COMMITTED"
                    : "NEITHER",
          });
          left -= 1;
          if (left > 0) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        (globalThis as unknown as { __handoffFrames?: unknown }).__handoffFrames = samples;
      },
      { x: startX - 20, y: y - 70, width: 660, height: 150 },
    );
    for (let step = 21; step <= 24; step += 1) {
      await window.mouse.move(startX + step * 30, y + Math.sin(step / 3) * 40, { steps: 3 });
    }
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.waitForTimeout(1200);

    const frames = await window.evaluate(
      () =>
        ((globalThis as unknown as { __handoffFrames?: unknown }).__handoffFrames ?? []) as {
          active: number;
          committed: number;
          state: string;
        }[],
    );
    expect(frames.length).toBeGreaterThan(20);
    const states = frames.map((frame) => frame.state);
    expect(states).toContain("ACTIVE");
    expect(states).toContain("COMMITTED");

    // The mark is on one surface or the other in every frame. A frame on
    // neither is the flicker, and was measured before this: one blank frame at
    // pointer-up.
    expect(states.filter((state) => state === "NEITHER")).toEqual([]);

    // The compositor's first frame carries the whole mark. Rationing its tiles
    // produced a first frame with 46% of it and the rest 20 ms later, which is
    // the same flicker by a different mechanism.
    const committed = frames.filter((frame) => frame.state === "COMMITTED");
    const first = committed[0];
    const settled = committed[committed.length - 1];
    expect(first).toBeDefined();
    expect(settled).toBeDefined();
    if (first === undefined || settled === undefined) return;
    expect(first.committed).toBeGreaterThan(settled.committed * 0.98);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("keeps pointer-cancel, Undo and Redo correct across the handover", async () => {
  test.setTimeout(300_000);
  const app = await launch();
  try {
    const window = await app.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await selectBroadPencil(window, "24", "90");

    const bounds = (await inkCanvas.boundingBox())!;
    const originX = bounds.x + 260;
    const originY = bounds.y + 300;

    // A cancelled gesture leaves nothing behind: pointerup preserves a mark
    // continuously, pointercancel removes it, and the handover must not have
    // blurred the difference.
    await inkCanvas.evaluate(
      (element, origin) => {
        const target = element as HTMLCanvasElement;
        const capture = target.setPointerCapture;
        const release = target.releasePointerCapture;
        target.setPointerCapture = () => undefined;
        target.releasePointerCapture = () => undefined;
        const dispatch = (type: string, x: number, y: number, buttons: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              pointerId: 77,
              pointerType: "pen",
              isPrimary: true,
              button: 0,
              buttons,
              pressure: 0.7,
            }),
          );
        dispatch("pointerdown", origin.x, origin.y, 1);
        dispatch("pointermove", origin.x + 120, origin.y + 20, 1);
        dispatch("pointermove", origin.x + 240, origin.y - 10, 1);
        dispatch("pointercancel", origin.x + 240, origin.y - 10, 0);
        target.setPointerCapture = capture;
        target.releasePointerCapture = release;
      },
      { x: originX, y: originY },
    );
    await expect(inkCanvas).toHaveAttribute("data-ink-live-point-count", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // A completed gesture keeps its mark.
    await window.mouse.move(originX, originY + 120);
    await window.mouse.down();
    await window.mouse.move(originX + 150, originY + 150, { steps: 12 });
    await window.mouse.move(originX + 300, originY + 110, { steps: 12 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    const region = { x: originX - 20, y: originY + 80, width: 340, height: 110 };
    const sample = async () =>
      window.locator('canvas[data-folio-layer="page"]').evaluate((element, input) => {
        const target = element as HTMLCanvasElement;
        const context = target.getContext("2d", { willReadFrequently: true });
        if (context === null) throw new Error("no context");
        const rect = target.getBoundingClientRect();
        const sx = target.width / rect.width;
        const sy = target.height / rect.height;
        const pixels = context.getImageData(
          Math.round((input.x - rect.left) * sx),
          Math.round((input.y - rect.top) * sy),
          Math.max(1, Math.round(input.width * sx)),
          Math.max(1, Math.round(input.height * sy)),
        ).data;
        let painted = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let p = 0; p < pixels.length; p += 4) {
          const l =
            0.299 * (pixels[p] ?? 0) + 0.587 * (pixels[p + 1] ?? 0) + 0.114 * (pixels[p + 2] ?? 0);
          if (l < 200) {
            painted += 1;
            red += pixels[p] ?? 0;
            green += pixels[p + 1] ?? 0;
            blue += pixels[p + 2] ?? 0;
          }
        }
        return {
          painted,
          red: painted === 0 ? 0 : red / painted,
          green: painted === 0 ? 0 : green / painted,
          blue: painted === 0 ? 0 : blue / painted,
        };
      }, region);

    const drawn = await sample();
    expect(drawn.painted).toBeGreaterThan(200);

    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    const undone = await sample();
    expect(undone.painted).toBeLessThan(drawn.painted / 4);

    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    const redone = await sample();
    // The same mark, not a darker one: a handover that left a second copy
    // behind would show here as extra graphite after Redo.
    expect(Math.abs(redone.painted - drawn.painted)).toBeLessThan(drawn.painted * 0.1);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
  }
});
