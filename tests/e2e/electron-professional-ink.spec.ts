import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("renders handwriting, long curves, small writing, and rapid ink from cached paths", async () => {
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
    const host = window.getByTestId("canvas-host");
    const surface = window.getByTestId("canvas-surface");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const coordinates = await canvasCoordinates(baseCanvas, inkCanvas, surface);
    await window.locator('button[data-dock-slot="pen"]').click();

    const smallHandwriting = [
      { x: 70, y: 165 },
      { x: 71, y: 153 },
      { x: 72, y: 166 },
      { x: 76, y: 157 },
      { x: 80, y: 166 },
      { x: 84, y: 155 },
      { x: 88, y: 166 },
    ];
    const longCurve = Array.from({ length: 90 }, (_, index) => ({
      x: 120 + index * 4,
      y: 310 + Math.sin(index / 14) * 65,
    }));
    const rapidScribble = Array.from({ length: 100 }, (_, index) => ({
      x: 110 + index * 3,
      y: 445 + Math.sin(index * 0.9) * 22,
    }));
    const continuousLoop = Array.from({ length: 120 }, (_, index) => {
      const angle = (index / 119) * Math.PI * 2;
      return {
        x: 420 + Math.cos(angle) * 70,
        y: 555 + Math.sin(angle) * 45,
      };
    });
    const samples = [smallHandwriting, longCurve, rapidScribble, continuousLoop] as const;
    for (const sample of samples) await drawPagePath(window, coordinates.pageToScreen, sample);

    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    await expect(inkCanvas).toHaveAttribute("data-ink-path-mode", "adaptive-error-fit-bezier");
    const sourcePointCount = await attributeNumber(inkCanvas, "data-ink-source-point-count");
    const filteredPointCount = await attributeNumber(inkCanvas, "data-ink-filtered-point-count");
    expect(sourcePointCount).toBeGreaterThanOrEqual(filteredPointCount);
    expect(filteredPointCount).toBeGreaterThan(4);
    const curveSegmentCount = await attributeNumber(inkCanvas, "data-ink-curve-segment-count");
    expect(curveSegmentCount).toBeGreaterThan(0);
    expect(curveSegmentCount).toBeLessThan(filteredPointCount - 4);
    const pathBuildCount = await attributeNumber(inkCanvas, "data-ink-path-build-count");
    expect(pathBuildCount).toBe(4);

    for (const sample of samples) {
      expect(
        await hasInkNear(baseCanvas, coordinates.pageToScreen(sample[0]!.x, sample[0]!.y)),
      ).toBe(true);
      expect(
        await hasInkNear(baseCanvas, coordinates.pageToScreen(sample.at(-1)!.x, sample.at(-1)!.y)),
      ).toBe(true);
    }

    const settledRenderCount = await attributeNumber(inkCanvas, "data-ink-render-count");
    await window.waitForTimeout(250);
    expect(await attributeNumber(inkCanvas, "data-ink-render-count")).toBe(settledRenderCount);

    for (let index = 0; index < 3; index += 1) {
      await window.keyboard.press("Control+Z");
      await expect(surface).toHaveAttribute("data-document-object-count", "3");
      await window.keyboard.press("Control+Shift+Z");
      await expect(surface).toHaveAttribute("data-document-object-count", "4");
    }
    await window.setViewportSize({ width: 1320, height: 820 });
    await window.setViewportSize({ width: 1440, height: 900 });
    expect(await attributeNumber(inkCanvas, "data-ink-path-build-count")).toBe(pathBuildCount);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function canvasCoordinates(
  baseCanvas: Locator,
  inkCanvas: Locator,
  surface: Locator,
): Promise<Readonly<{ pageToScreen: (x: number, y: number) => Point }>> {
  await expect(baseCanvas).toBeVisible();
  await expect(inkCanvas).toBeVisible();
  await expect
    .poll(async () => {
      const canvas = await baseCanvas.evaluate((element) => {
        const value = element as HTMLCanvasElement;
        return {
          logicalWidth: Number(value.dataset.logicalWidth),
          logicalHeight: Number(value.dataset.logicalHeight),
          pageX: Number(value.dataset.pageX),
          pageY: Number(value.dataset.pageY),
        };
      });
      const bounds = await inkCanvas.boundingBox();
      const zoom = await attributeNumber(surface, "data-viewport-zoom");
      return (
        bounds !== null &&
        bounds.width > 0 &&
        canvas.logicalWidth > 0 &&
        canvas.logicalHeight > 0 &&
        Number.isFinite(canvas.pageX) &&
        Number.isFinite(canvas.pageY) &&
        zoom > 0
      );
    })
    .toBe(true);
  const metrics = await baseCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      logicalWidth: Number(canvas.dataset.logicalWidth),
      logicalHeight: Number(canvas.dataset.logicalHeight),
      pageX: Number(canvas.dataset.pageX),
      pageY: Number(canvas.dataset.pageY),
    };
  });
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  return Object.freeze({
    pageToScreen: (x: number, y: number) => ({
      x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
      y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
    }),
  });
}

async function drawPagePath(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  points: readonly Point[],
): Promise<void> {
  const first = points[0];
  if (first === undefined) return;
  await window.mouse.move(...pointTuple(pageToScreen(first.x, first.y)));
  await window.mouse.down();
  for (const point of points.slice(1)) {
    await window.mouse.move(...pointTuple(pageToScreen(point.x, point.y)));
  }
  await window.mouse.up();
}

async function hasInkNear(canvasLocator: Locator, point: Point): Promise<boolean> {
  return canvasLocator.evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) return false;
    const bounds = canvas.getBoundingClientRect();
    const scaleX = canvas.width / bounds.width;
    const scaleY = canvas.height / bounds.height;
    const centerX = Math.round((screenPoint.x - bounds.left) * scaleX);
    const centerY = Math.round((screenPoint.y - bounds.top) * scaleY);
    const radius = Math.max(4, Math.ceil(4 * Math.max(scaleX, scaleY)));
    const startX = Math.max(0, centerX - radius);
    const startY = Math.max(0, centerY - radius);
    const width = Math.min(canvas.width - startX, radius * 2 + 1);
    const height = Math.min(canvas.height - startY, radius * 2 + 1);
    const pixels = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 255;
      const green = pixels[index + 1] ?? 255;
      const blue = pixels[index + 2] ?? 255;
      const alpha = pixels[index + 3] ?? 0;
      if (alpha > 24 && (red < 200 || green < 200 || blue < 200)) return true;
    }
    return false;
  }, point);
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}

interface Point {
  readonly x: number;
  readonly y: number;
}
