import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("provides manipulation cursors and grouped move, scale, and rotate interactions", async () => {
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
    const selectionCanvas = host.locator("canvas[data-folio-layer='selection']");
    const coordinates = await canvasCoordinates(baseCanvas, inkCanvas, surface);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await drawStroke(window, coordinates.pageToScreen(160, 220), { x: 90, y: 0 });
    await drawStroke(window, coordinates.pageToScreen(430, 390), { x: 70, y: 0 });
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-ink-path-mode", "adaptive-error-fit-bezier");
    expect(await attributeNumber(inkCanvas, "data-ink-curve-segment-count")).toBeGreaterThan(0);
    expect(await attributeNumber(inkCanvas, "data-ink-source-point-count")).toBeGreaterThanOrEqual(
      await attributeNumber(inkCanvas, "data-ink-filtered-point-count"),
    );
    const pathBuildCount = await attributeNumber(inkCanvas, "data-ink-path-build-count");
    expect(pathBuildCount).toBe(2);
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.keyboard.press("Control+A");
    await expect(surface).toHaveAttribute("data-selection-group-state", "group");
    await expect(surface).toHaveAttribute("data-selected-object-count", "2");
    await expect(selectionCanvas).toHaveAttribute("data-selection-handles", "visible");

    const initialHistoryDepth = await attributeNumber(surface, "data-history-undo-depth");
    const initialGroup = await selectedGroupBounds(surface);
    const initialTransforms = await selectedTransforms(surface);
    const initialThickness = await renderedThickness(
      baseCanvas,
      coordinates.pageToScreen(...centerTuple(initialTransforms[0]!.bounds)),
    );
    const hoverTargets = [
      {
        point: coordinates.pageToScreen(
          initialGroup.x - 4 / coordinates.zoom,
          initialGroup.y - 4 / coordinates.zoom,
        ),
        cursor: "nwse-resize",
        css: "nwse-resize",
      },
      {
        point: coordinates.pageToScreen(
          initialGroup.x + initialGroup.width + 4 / coordinates.zoom,
          initialGroup.y - 4 / coordinates.zoom,
        ),
        cursor: "nesw-resize",
        css: "nesw-resize",
      },
      {
        point: coordinates.pageToScreen(
          initialGroup.x - 4 / coordinates.zoom,
          initialGroup.y + initialGroup.height + 4 / coordinates.zoom,
        ),
        cursor: "nesw-resize",
        css: "nesw-resize",
      },
      {
        point: coordinates.pageToScreen(
          initialGroup.x + initialGroup.width + 4 / coordinates.zoom,
          initialGroup.y + initialGroup.height + 4 / coordinates.zoom,
        ),
        cursor: "nwse-resize",
        css: "nwse-resize",
      },
      {
        point: coordinates.pageToScreen(
          initialGroup.x + initialGroup.width / 2,
          initialGroup.y - 32 / coordinates.zoom,
        ),
        cursor: "rotation",
        css: /^url\("data:image\/svg\+xml,.+"\) 16 16, crosshair$/u,
      },
      {
        point: coordinates.pageToScreen(
          initialGroup.x + initialGroup.width / 2,
          initialGroup.y + initialGroup.height / 2,
        ),
        cursor: "grab",
        css: "grab",
      },
    ] as const;
    for (const target of hoverTargets) {
      await hoverForCursor(window, inkCanvas, target.point, target.cursor);
      await expect(inkCanvas).toHaveCSS("cursor", target.css);
    }
    const outside = coordinates.pageToScreen(
      Math.max(10, initialGroup.x - 100),
      Math.max(10, initialGroup.y - 100),
    );
    await hoverForCursor(window, inkCanvas, outside, "default");
    await expect(inkCanvas).toHaveCSS("cursor", "default");
    expect(await attributeNumber(surface, "data-history-undo-depth")).toBe(initialHistoryDepth);

    const moveStart = coordinates.pageToScreen(
      initialGroup.x + initialGroup.width / 2,
      initialGroup.y + initialGroup.height / 2,
    );
    await hoverForCursor(window, inkCanvas, moveStart, "grab");
    await expect(inkCanvas).toHaveCSS("cursor", "grab");
    await window.mouse.down();
    await expect(inkCanvas).toHaveCSS("cursor", "grabbing");
    await expect(inkCanvas).toHaveAttribute("data-manipulation-cursor", "grabbing");
    await window.mouse.move(moveStart.x + 70, moveStart.y + 35, { steps: 8 });
    await expect(inkCanvas).toHaveCSS("cursor", "grabbing");
    await window.mouse.up();
    await expect(inkCanvas).toHaveCSS("cursor", "grab");
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(initialHistoryDepth + 1),
    );
    const movedTransforms = await selectedTransforms(surface);
    const moveDeltas = movedTransforms.map((object, index) => ({
      x: object.translation.x - initialTransforms[index]!.translation.x,
      y: object.translation.y - initialTransforms[index]!.translation.y,
    }));
    expect(moveDeltas[0]!.x).toBeCloseTo(moveDeltas[1]!.x);
    expect(moveDeltas[0]!.y).toBeCloseTo(moveDeltas[1]!.y);
    expect(relativeVector(movedTransforms).x).toBeCloseTo(relativeVector(initialTransforms).x, 5);
    expect(relativeVector(movedTransforms).y).toBeCloseTo(relativeVector(initialTransforms).y, 5);
    await window.keyboard.press("Control+Z");
    expect(await selectedTransforms(surface)).toEqual(initialTransforms);
    await window.keyboard.press("Control+Shift+Z");
    expect(await selectedTransforms(surface)).toEqual(movedTransforms);

    const beforeScale = await selectedTransforms(surface);
    const scaleBounds = await selectedGroupBounds(surface);
    const scaleCenter = center(scaleBounds);
    const scaleStartPage = {
      x: scaleBounds.x + scaleBounds.width + 11 / coordinates.zoom,
      y: scaleBounds.y + scaleBounds.height + 4 / coordinates.zoom,
    };
    const scaleStart = coordinates.pageToScreen(scaleStartPage.x, scaleStartPage.y);
    const scaleFactor = 1.5;
    const scaleEnd = coordinates.pageToScreen(
      scaleCenter.x + (scaleStartPage.x - scaleCenter.x) * scaleFactor,
      scaleCenter.y + (scaleStartPage.y - scaleCenter.y) * scaleFactor,
    );
    await hoverForCursor(window, inkCanvas, scaleStart, "nwse-resize");
    await dragTo(window, scaleStart, scaleEnd);
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(initialHistoryDepth + 2),
    );
    const scaledTransforms = await selectedTransforms(surface);
    expect(scaledTransforms[0]!.scale).toBeCloseTo(scaleFactor, 5);
    expect(scaledTransforms[1]!.scale).toBeCloseTo(scaleFactor, 5);
    expect(scaledTransforms.map(({ strokeWidth }) => strokeWidth)).toEqual(
      beforeScale.map(({ strokeWidth }) => strokeWidth),
    );
    expect(distanceBetweenCenters(scaledTransforms)).toBeCloseTo(
      distanceBetweenCenters(beforeScale) * scaleFactor,
      3,
    );
    const scaledThickness = await renderedThickness(
      baseCanvas,
      coordinates.pageToScreen(...centerTuple(scaledTransforms[0]!.bounds)),
    );
    expect(scaledThickness).toBeGreaterThan(0);
    expect(Math.abs(scaledThickness - initialThickness)).toBeLessThanOrEqual(1);
    await window.keyboard.press("Control+Z");
    expect((await selectedTransforms(surface)).map(({ scale }) => scale)).toEqual([1, 1]);
    await window.keyboard.press("Control+Y");
    const redoneScale = await selectedTransforms(surface);
    expect(redoneScale[0]!.scale).toBeCloseTo(scaleFactor, 5);
    expect(redoneScale[1]!.scale).toBeCloseTo(scaleFactor, 5);

    const beforeRotation = await selectedTransforms(surface);
    const rotationBounds = await selectedGroupBounds(surface);
    const rotationCenter = center(rotationBounds);
    const rotationStartPage = {
      x: rotationCenter.x,
      y: rotationBounds.y - 32 / coordinates.zoom,
    };
    const radius = rotationCenter.y - rotationStartPage.y;
    const rotationStart = coordinates.pageToScreen(rotationStartPage.x, rotationStartPage.y);
    const rotationEnd = coordinates.pageToScreen(rotationCenter.x + radius, rotationCenter.y);
    await hoverForCursor(window, inkCanvas, rotationStart, "rotation");
    await dragTo(window, rotationStart, rotationEnd);
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(initialHistoryDepth + 3),
    );
    const rotatedTransforms = await selectedTransforms(surface);
    const rotationDelta = rotatedTransforms[0]!.rotation - beforeRotation[0]!.rotation;
    expect(Math.abs(rotationDelta)).toBeCloseTo(Math.PI / 2, 1);
    expect(rotatedTransforms[1]!.rotation - beforeRotation[1]!.rotation).toBeCloseTo(
      rotationDelta,
      5,
    );
    expect(distanceBetweenCenters(rotatedTransforms)).toBeCloseTo(
      distanceBetweenCenters(beforeRotation),
      4,
    );
    const beforeVector = relativeVector(beforeRotation);
    const afterVector = relativeVector(rotatedTransforms);
    expect(Math.abs(beforeVector.x * afterVector.x + beforeVector.y * afterVector.y)).toBeLessThan(
      distanceBetweenCenters(beforeRotation) ** 2 * 0.08,
    );
    await window.keyboard.press("Control+Z");
    expect((await selectedTransforms(surface)).map(({ rotation }) => rotation)).toEqual(
      beforeRotation.map(({ rotation }) => rotation),
    );
    await window.keyboard.press("Control+Shift+Z");
    expect((await selectedTransforms(surface)).map(({ rotation }) => rotation)).toEqual(
      rotatedTransforms.map(({ rotation }) => rotation),
    );
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
): Promise<Readonly<{ zoom: number; pageToScreen: (x: number, y: number) => Point }>> {
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
        bounds.height > 0 &&
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
    zoom,
    pageToScreen: (x: number, y: number) => ({
      x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
      y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
    }),
  });
}

async function selectedGroupBounds(surface: Locator): Promise<Bounds> {
  return {
    x: await attributeNumber(surface, "data-selected-object-bounds-x"),
    y: await attributeNumber(surface, "data-selected-object-bounds-y"),
    width: await attributeNumber(surface, "data-selected-object-bounds-width"),
    height: await attributeNumber(surface, "data-selected-object-bounds-height"),
  };
}

async function selectedTransforms(surface: Locator): Promise<readonly SelectedTransform[]> {
  const value = await surface.getAttribute("data-selected-object-transforms");
  return JSON.parse(value ?? "[]") as readonly SelectedTransform[];
}

async function renderedThickness(inkCanvas: Locator, point: Point): Promise<number> {
  return inkCanvas.evaluate((element, screenPoint) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) return 0;
    const bounds = canvas.getBoundingClientRect();
    const pixelX = Math.round((screenPoint.x - bounds.left) * (canvas.width / bounds.width));
    const pixelY = Math.round((screenPoint.y - bounds.top) * (canvas.height / bounds.height));
    const radius = 20;
    const startY = Math.max(0, pixelY - radius);
    const height = Math.min(canvas.height - startY, radius * 2 + 1);
    const pixels = context.getImageData(pixelX, startY, 1, height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) > 24) count += 1;
    }
    return count;
  }, point);
}

async function drawStroke(window: Page, start: Point, delta: Point): Promise<void> {
  await drag(window, start, delta, 8);
}

async function drag(window: Page, start: Point, delta: Point, steps = 8): Promise<void> {
  await dragTo(window, start, { x: start.x + delta.x, y: start.y + delta.y }, steps);
}

async function dragTo(window: Page, start: Point, end: Point, steps = 8): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps });
  await window.mouse.up();
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function hoverForCursor(
  window: Page,
  canvas: Locator,
  point: Point,
  cursor: string,
): Promise<void> {
  await expect
    .poll(async () => {
      await window.mouse.move(point.x + 0.5, point.y);
      await window.mouse.move(point.x, point.y);
      return canvas.getAttribute("data-manipulation-cursor");
    })
    .toBe(cursor);
}

function center(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function centerTuple(bounds: Bounds): [number, number] {
  const point = center(bounds);
  return [point.x, point.y];
}

function relativeVector(objects: readonly SelectedTransform[]): Point {
  const first = center(objects[0]!.bounds);
  const second = center(objects[1]!.bounds);
  return { x: second.x - first.x, y: second.y - first.y };
}

function distanceBetweenCenters(objects: readonly SelectedTransform[]): number {
  const vector = relativeVector(objects);
  return Math.hypot(vector.x, vector.y);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds extends Point {
  readonly width: number;
  readonly height: number;
}

interface SelectedTransform {
  readonly id: string;
  readonly bounds: Bounds;
  readonly translation: Point;
  readonly rotation: number;
  readonly scale: number;
  readonly strokeWidth: number;
}
