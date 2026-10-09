import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

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
 * Whether a stroke made of tiles reaches the screen as one piece.
 *
 * Two different questions, answered two different ways. The compositor fixture
 * asks whether the tiled path renders what a single contiguous raster of the
 * same material would -- a direct comparison against a reference, which is the
 * only measurement that sees a *texture* discontinuity, because clamping at a
 * tile's edge preserves average tone and breaks only continuity. The mounted
 * test then asks the same of the real editor, on the live layer and on the
 * compositor, with the boundary held against fifteen ordinary columns of the
 * same graphite.
 */

/**
 * The contiguous-raster reference.
 *
 * One deterministic material field, genuinely continuous across tile
 * boundaries, rendered two ways: as separate per-tile presentations the way the
 * painter does it, and as one contiguous raster tinted and drawn once. The
 * material is identical, so every difference is the compositor's.
 *
 * Deliberately a *varying* field. The E4.2D experiment used uniform tiles,
 * which cannot reveal edge sampling at all -- clamping a constant returns the
 * same constant -- and that is why it reported the tiled path pixel-perfect.
 */
async function compare(window: Page) {
  return window.evaluate(() => {
    const TILE = 128;
    const PAGE = 64;
    const TILES = 6;

    // A graphite-like field addressed in GLOBAL cell coordinates, so tiles are
    // continuous across their boundaries by construction.
    const field = (gx: number, gy: number) => {
      let h = Math.imul(gx | 0, 374761393) ^ Math.imul(gy | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const n = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      // Smooth large-scale structure plus grain, which is what makes edge
      // sampling visible: a flat field hides it.
      const smooth = 0.5 + 0.5 * Math.sin(gx / 11) * Math.cos(gy / 13);
      return Math.max(0, Math.min(255, Math.round(255 * (0.45 * smooth + 0.55 * n))));
    };

    const tint = (canvas: HTMLCanvasElement, alpha: Uint8ClampedArray) => {
      const cx = canvas.getContext("2d");
      if (cx === null) throw new Error("no ctx");
      const image = cx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < alpha.length; i += 1) image.data[i * 4 + 3] = alpha[i] ?? 0;
      cx.putImageData(image, 0, 0);
      cx.globalCompositeOperation = "source-in";
      cx.fillStyle = "#343434";
      cx.fillRect(0, 0, canvas.width, canvas.height);
      cx.globalCompositeOperation = "source-over";
      return canvas;
    };

    const tileCanvas = (tx: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = TILE;
      canvas.height = TILE;
      const alpha = new Uint8ClampedArray(TILE * TILE);
      for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE; x += 1) alpha[y * TILE + x] = field(tx * TILE + x, y);
      }
      return tint(canvas, alpha);
    };

    const wholeCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = TILE * TILES;
      canvas.height = TILE;
      const alpha = new Uint8ClampedArray(TILE * TILES * TILE);
      for (let y = 0; y < TILE; y += 1) {
        for (let x = 0; x < TILE * TILES; x += 1) alpha[y * TILE * TILES + x] = field(x, y);
      }
      return tint(canvas, alpha);
    };

    // The same tile, plus a ring of its neighbours' real cells, so the sampler
    // has somewhere true to interpolate towards at the edge.
    const gutterCanvas = (tx: number, g: number) => {
      const size = TILE + g * 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const alpha = new Uint8ClampedArray(size * size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const gx = tx * TILE + x - g;
          const gy = y - g;
          // Outside the field vertically there is genuinely nothing.
          alpha[y * size + x] = gy < 0 || gy >= TILE ? 0 : field(gx, gy);
        }
      }
      return tint(canvas, alpha);
    };

    const tiles = Array.from({ length: TILES }, (_, tx) => tileCanvas(tx));
    const gutter1 = Array.from({ length: TILES }, (_, tx) => gutterCanvas(tx, 1));
    const whole = wholeCanvas();

    const render = (zoom: number, pan: number, mode: "tiled" | "gutter" | "contiguous") => {
      const width = Math.ceil(PAGE * TILES * zoom + pan) + 8;
      const height = Math.ceil(PAGE * zoom) + 8;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const cx = canvas.getContext("2d", { willReadFrequently: true });
      if (cx === null) throw new Error("no ctx");
      cx.fillStyle = "#ffffff";
      cx.fillRect(0, 0, width, height);
      // Bilinear, as the painter uses. Turning it off removes the seam by
      // replacing the whole resampling with nearest neighbour, which is a
      // different and worse picture rather than a fix.
      cx.imageSmoothingEnabled = true;
      const edge = (t: number) => Math.round(t * PAGE * zoom + pan);
      const top = Math.round(pan);
      const bottom = Math.round(PAGE * zoom + pan);
      if (mode === "contiguous") {
        cx.drawImage(whole, edge(0), top, edge(TILES) - edge(0), bottom - top);
      } else if (mode === "gutter") {
        const g = 1;
        const source = gutter1;
        for (let t = 0; t < TILES; t += 1) {
          const tile = source[t];
          if (tile === undefined) continue;
          const dx = edge(t);
          const dw = edge(t + 1) - dx;
          const dh = bottom - top;
          // The gutter is drawn *through*: ask for the inner square and let
          // the filter reach into the ring. Nothing overlaps, so nothing
          // composites twice.
          cx.drawImage(tile, g, g, TILE, TILE, dx, top, dw, dh);
        }
      } else {
        for (let t = 0; t < TILES; t += 1) {
          const tile = tiles[t];
          if (tile === undefined) continue;
          cx.drawImage(tile, edge(t), top, edge(t + 1) - edge(t), bottom - top);
        }
      }
      return { canvas, cx, edge, top, bottom };
    };

    const measure = (zoom: number, pan: number) => {
      const reference = render(zoom, pan, "contiguous");
      const out: Record<string, unknown> = { zoom, pan };
      for (const mode of ["tiled", "gutter"] as const) {
        const got = render(zoom, pan, mode);
        const y0 = got.top + 4;
        const y1 = got.bottom - 4;
        const x0 = got.edge(0) + 4;
        const x1 = got.edge(6) - 4;
        const w = x1 - x0;
        const h = y1 - y0;
        const a = got.cx.getImageData(x0, y0, w, h).data;
        const b = reference.cx.getImageData(x0, y0, w, h).data;
        // Difference as a function of distance from the nearest tile boundary.
        const boundaries: number[] = [];
        for (let t = 1; t < 6; t += 1) boundaries.push(got.edge(t));
        const byDistance = new Map<number, { sum: number; n: number; max: number }>();
        let worst = 0;
        let worstAt = -1;
        for (let x = 0; x < w; x += 1) {
          let nearest = 99;
          for (const bx of boundaries) nearest = Math.min(nearest, Math.abs(x0 + x - bx));
          const bucket = Math.min(nearest, 8);
          let sum = 0;
          for (let y = 0; y < h; y += 1) {
            const i = (y * w + x) * 4;
            sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
          }
          const mean = sum / h;
          const slot = byDistance.get(bucket) ?? { sum: 0, n: 0, max: 0 };
          slot.sum += mean;
          slot.n += 1;
          slot.max = Math.max(slot.max, mean);
          byDistance.set(bucket, slot);
          if (mean > worst) {
            worst = mean;
            worstAt = nearest;
          }
        }
        const profile: Record<string, number> = {};
        for (const [distance, slot] of [...byDistance].sort((p, q) => p[0] - q[0])) {
          profile[`d${String(distance)}`] = Number((slot.sum / slot.n).toFixed(2));
        }
        out[mode] = {
          worstColumnDelta: Number(worst.toFixed(2)),
          worstAtDistance: worstAt,
          meanDeltaByDistanceFromBoundary: profile,
        };
      }
      return out;
    };

    const results: unknown[] = [];
    for (const zoom of [1, 3, 6.64]) {
      for (const pan of [0, 0.37]) results.push(measure(zoom, pan));
    }
    return results;
  });
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

/** Drives the camera to roughly a target zoom the way a person would. */
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
  await window.waitForTimeout(400);
  return attributeNumber(surface, "data-viewport-zoom");
}

/**
 * Boundary statistics on a named layer.
 *
 * The ink layer carries the live mark and is transparent elsewhere; the page
 * compositor carries committed artwork over opaque paper. Both are read as
 * tone, and both are folded onto sixteen offsets inside a tile so the boundary
 * can be compared with ordinary columns of the same graphite.
 */
async function boundaryStats(window: Page, layer: "ink" | "page") {
  const surface = window.getByTestId("canvas-surface");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  return window.locator(`canvas[data-folio-layer="${layer}"]`).evaluate(
    (element, input) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext("2d", { willReadFrequently: true });
      if (context === null) throw new Error("no context");
      const w = target.width;
      const h = target.height;
      const data = context.getImageData(0, 0, w, h).data;
      const opaque = input.layer === "page";
      // On the ink layer "painted" is alpha; on the compositor it is tone over
      // paper. Both reduce to one number per pixel that is larger where there
      // is more graphite.
      const load = (i: number) =>
        opaque
          ? 255 -
            (0.299 * (data[i * 4] ?? 0) +
              0.587 * (data[i * 4 + 1] ?? 0) +
              0.114 * (data[i * 4 + 2] ?? 0))
          : (data[i * 4 + 3] ?? 0);

      const rowLoad: number[] = [];
      for (let y = 0; y < h; y += 1) {
        let count = 0;
        for (let x = 0; x < w; x += 1) if (load(y * w + x) > 40) count += 1;
        rowLoad.push(count);
      }
      const widest = Math.max(...rowLoad);
      if (widest < 60) return null;
      let yTop = -1;
      let yBottom = -1;
      for (let y = 0; y < h; y += 1) {
        if ((rowLoad[y] ?? 0) > widest * 0.7) {
          if (yTop < 0) yTop = y;
          yBottom = y;
        }
      }
      const profile: number[] = [];
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        for (let y = yTop; y <= yBottom; y += 1) sum += load(y * w + x);
        profile.push(sum / (yBottom - yTop + 1));
      }
      let xLeft = -1;
      let xRight = -1;
      for (let x = 0; x < w; x += 1) {
        if ((profile[x] ?? 0) > 40) {
          if (xLeft < 0) xLeft = x;
          xRight = x;
        }
      }
      const bounds = target.getBoundingClientRect();
      const sx = target.width / bounds.width;
      const toDevice = (page: number) => (input.pageX + page * input.zoom) * sx;

      // Graphite load at the boundary relative to just beside it. Negative
      // means the boundary carries less graphite than its neighbourhood: a
      // pale line.
      const lift = (offset: number) => {
        const on: number[] = [];
        const beside: number[] = [];
        let samples = 0;
        for (let tile = -60; tile <= 260; tile += 1) {
          const d = toDevice(tile * 64 + offset);
          if (d < xLeft + 10 || d > xRight - 10) continue;
          samples += 1;
          for (const o of [-1, 0]) on.push(profile[Math.round(d) + o] ?? 0);
          for (const o of [-6, -5, 5, 6]) beside.push(profile[Math.round(d) + o] ?? 0);
        }
        if (samples === 0) return { samples: 0, delta: 0 };
        const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
        return { samples, delta: Number((mean(on) - mean(beside)).toFixed(2)) };
      };
      /**
       * How much the tone changes from one device pixel to the next.
       *
       * Clamping at a tile's own edge repeats the edge cell instead of carrying
       * on into the neighbour's, so the texture goes *flat* across the
       * boundary. That is invisible to a measurement of average tone -- the
       * mean is preserved -- and obvious here, because a flat strip has no
       * gradient.
       */
      const gradient = (offset: number) => {
        const on: number[] = [];
        const beside: number[] = [];
        for (let tile = -60; tile <= 260; tile += 1) {
          const d = toDevice(tile * 64 + offset);
          if (d < xLeft + 12 || d > xRight - 12) continue;
          const at = Math.round(d);
          for (const o of [-2, -1, 0, 1]) {
            on.push(Math.abs((profile[at + o + 1] ?? 0) - (profile[at + o] ?? 0)));
          }
          for (const o of [-8, -7, -6, 6, 7, 8]) {
            beside.push(Math.abs((profile[at + o + 1] ?? 0) - (profile[at + o] ?? 0)));
          }
        }
        if (on.length === 0) return { mean: 0, step: 0 };
        const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
        return {
          mean: Number((mean(on) / Math.max(1e-6, mean(beside))).toFixed(3)),
          // The single sharpest change. Clamping puts a whole cell's worth of
          // difference into one pixel where interpolation would spread it over
          // a ramp, so the step is what a texture break actually is -- and an
          // average over the window hides it between the flats either side.
          step: Number((Math.max(...on) / Math.max(1e-6, Math.max(...beside))).toFixed(3)),
        };
      };
      const gradientSweep: number[] = [];
      const stepSweep: number[] = [];
      for (let offset = 0; offset < 64; offset += 4) {
        const measured = gradient(offset);
        gradientSweep.push(measured.mean);
        stepSweep.push(measured.step);
      }

      const sweep: number[] = [];
      for (let offset = 0; offset < 64; offset += 4) sweep.push(lift(offset).delta);
      const boundary = sweep[0] ?? 0;
      const controls = sweep.slice(1);
      const mean = controls.reduce((a, b) => a + b, 0) / controls.length;
      const sd = Math.sqrt(controls.reduce((a, b) => a + (b - mean) ** 2, 0) / controls.length);
      return {
        layer: input.layer,
        samples: lift(0).samples,
        boundary: Number(boundary.toFixed(2)),
        controlMean: Number(mean.toFixed(2)),
        controlMin: Number(Math.min(...controls).toFixed(2)),
        controlSd: Number(sd.toFixed(2)),
        sigma: Number((sd === 0 ? 0 : (boundary - mean) / sd).toFixed(2)),
        gradientRatio: gradientSweep[0] ?? 0,
        stepRatio: stepSweep[0] ?? 0,
        stepControlMax: Number(Math.max(...stepSweep.slice(1)).toFixed(3)),
        stepControlMean: Number(
          (stepSweep.slice(1).reduce((a, b) => a + b, 0) / (stepSweep.length - 1)).toFixed(3),
        ),
        gradientControlMin: Number(Math.min(...gradientSweep.slice(1)).toFixed(3)),
        gradientControlMean: Number(
          (gradientSweep.slice(1).reduce((a, b) => a + b, 0) / (gradientSweep.length - 1)).toFixed(
            3,
          ),
        ),
        span: { xLeft, xRight, yTop, yBottom },
      };
    },
    { zoom, pageX, pageY, layer },
  );
}

/**
 * This one is about Canvas, not about Folio.
 *
 * It renders its own tiles both ways and compares them, so it cannot fail
 * because the painter changed -- the mounted test below is what guards that.
 * What it guards is the contract the fix rests on: that a bilinear filter
 * reaches outside an explicit source rectangle into the padding, and that one
 * cell of padding is enough. If a future Chrome clamped strictly to the source
 * rectangle instead, gutters would quietly stop working and the grid would come
 * back; this says so immediately, and says which half of the assumption broke.
 */
test("renders a tiled stroke the way one contiguous raster would", async () => {
  test.setTimeout(180_000);
  const app = await launch();
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await window.getByTestId("canvas-surface").waitFor();
    const results = (await compare(window)) as {
      zoom: number;
      pan: number;
      tiled: { worstColumnDelta: number; meanDeltaByDistanceFromBoundary: Record<string, number> };
      gutter: { worstColumnDelta: number; meanDeltaByDistanceFromBoundary: Record<string, number> };
    }[];
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const where = `zoom ${String(result.zoom)}, pan ${String(result.pan)}`;
      const detail = JSON.stringify(result);
      // A tile carrying its neighbours' cells renders what the contiguous
      // raster renders, everywhere, the boundary column included.
      for (let distance = 0; distance <= 3; distance += 1) {
        const got = result.gutter.meanDeltaByDistanceFromBoundary[`d${String(distance)}`] ?? 0;
        expect(
          got,
          `gutter differs ${String(distance)}px from a boundary at ${where}: ${detail}`,
        ).toBeLessThan(0.5);
      }
      // And without one it does not, in a way confined to the boundary. This
      // is the defect itself, asserted so that losing the gutter fails here
      // rather than only in somebody's eyes.
      if (result.zoom > 2) {
        expect(
          result.tiled.meanDeltaByDistanceFromBoundary.d0 ?? 0,
          `expected a measurable clamp without a gutter at ${where}`,
        ).toBeGreaterThan(2);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});

test("shows no tile boundary at high zoom, drawing or drawn", async () => {
  test.setTimeout(400_000);
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

    await openSlotToolOptions(window, "pencil");
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "26");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "78");
    await window.keyboard.press("Escape");
    await activateDockSlot(window, "pencil");

    const bounds = (await inkCanvas.boundingBox())!;
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    for (const target of [3, 6.64]) {
      await setZoom(window, target, centre);
      // A fractional pan, so nothing here rests on the camera happening to sit
      // on a whole pixel.
      await window.mouse.move(centre.x, centre.y);
      await window.mouse.wheel(7, 3);
      await window.waitForTimeout(300);
      const zoom = Number(await surface.getAttribute("data-viewport-zoom"));

      const y = bounds.y + 420;
      await window.mouse.move(bounds.x + 120, y);
      await window.mouse.down();
      for (let step = 1; step <= 16; step += 1) {
        await window.mouse.move(bounds.x + 120 + step * 75, y + Math.sin(step / 4) * 10, {
          steps: 4,
        });
      }
      for (let pass = 0; pass < 3; pass += 1) {
        for (let step = 16; step >= 1; step -= 1) {
          await window.mouse.move(bounds.x + 120 + step * 75, y + pass * 9 + 6, { steps: 3 });
        }
        for (let step = 1; step <= 16; step += 1) {
          await window.mouse.move(bounds.x + 120 + step * 75, y + pass * 9 + 12, { steps: 3 });
        }
      }
      await window.waitForTimeout(400);
      const active = await boundaryStats(window, "ink");
      await window.mouse.up();
      await window.waitForTimeout(900);
      const committed = await boundaryStats(window, "page");

      for (const [name, measured] of [
        ["active", active],
        ["committed", committed],
      ] as const) {
        expect(measured, `no artwork on the ${name} layer at ${String(zoom)}`).not.toBeNull();
        if (measured === null) continue;
        const detail = `${name} at zoom ${zoom.toFixed(2)}: ${JSON.stringify(measured)}`;
        // Graphite load along the boundary, against fifteen ordinary columns of
        // the same mark. An unsnapped clear left the live layer thirty-two
        // units short here, nine standard deviations out.
        expect(Math.abs(measured.sigma), `tone seam, ${detail}`).toBeLessThan(2.5);
        // And the texture across it, as the sharpest single change rather than
        // an average: a break puts a whole cell's difference into one pixel
        // where a ramp would spread it, and averaging hides that between the
        // flat runs either side. Measured at forty times ordinary graphite on
        // the live layer at 664% before this, against a control maximum of 1.4.
        expect(measured.stepRatio, `texture break, ${detail}`).toBeLessThan(3);
      }
      await window.keyboard.press("Control+z");
      await window.waitForTimeout(400);
    }
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
  }
});
