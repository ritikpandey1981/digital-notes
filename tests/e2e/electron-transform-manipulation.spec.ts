import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("keeps active transform previews clean while preserving History", async () => {
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
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const selectionCanvas = host.locator("canvas[data-folio-layer='selection']");
    const previewCanvas = host.locator("canvas[data-folio-layer='manipulation-preview']");
    await expect(surface).toHaveAttribute("data-history-capability", "ready");

    const metrics = await baseCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return {
        logicalWidth: Number(canvas.dataset.logicalWidth),
        logicalHeight: Number(canvas.dataset.logicalHeight),
        pageX: Number(canvas.dataset.pageX),
        pageY: Number(canvas.dataset.pageY),
        pageWidth: Number(canvas.dataset.pageWidth),
        pageHeight: Number(canvas.dataset.pageHeight),
      };
    });
    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    const scaleX = inkBounds.width / metrics.logicalWidth;
    const scaleY = inkBounds.height / metrics.logicalHeight;
    const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const pageToScreen = (x: number, y: number) => ({
      x: inkBounds.x + (metrics.pageX + x * zoom) * scaleX,
      y: inkBounds.y + (metrics.pageY + y * zoom) * scaleY,
    });
    const strokeStartPage = {
      x: (metrics.pageWidth / zoom) * 0.3,
      y: (metrics.pageHeight / zoom) * 0.35,
    };
    const strokeStart = pageToScreen(strokeStartPage.x, strokeStartPage.y);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "30");
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("context-tool-palette")).toBeHidden();
    await window.mouse.move(strokeStart.x, strokeStart.y);
    await window.mouse.down();
    await window.mouse.move(strokeStart.x + 100, strokeStart.y + 100, { steps: 8 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    expect(
      (
        JSON.parse((await surface.getAttribute("data-document-stroke-brushes")) ?? "[]") as Array<{
          rendererKind?: string;
          pointerType?: string;
        }>
      )[0],
    ).toMatchObject({ rendererKind: "centerline", pointerType: "mouse" });

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(strokeStart.x + 75, strokeStart.y + 20);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    await expect(selectionCanvas).toHaveAttribute("data-selection-handles", "visible");
    const selectedObjectId = await selectionCanvas.getAttribute("data-selected-object-id");

    const selectedGeometry = async () => ({
      x: Number(await surface.getAttribute("data-selected-object-bounds-x")),
      y: Number(await surface.getAttribute("data-selected-object-bounds-y")),
      width: Number(await surface.getAttribute("data-selected-object-bounds-width")),
      height: Number(await surface.getAttribute("data-selected-object-bounds-height")),
    });

    const initial = await selectedGeometry();
    const center = {
      x: initial.x + initial.width / 2,
      y: initial.y + initial.height / 2,
    };
    const rotationStartPage = { x: center.x, y: initial.y - 32 / zoom };
    const rotationRadius = center.y - rotationStartPage.y;
    const rotationStart = pageToScreen(rotationStartPage.x, rotationStartPage.y);
    const rotationEnd = pageToScreen(center.x + rotationRadius, center.y);
    const inkRenderBeforeRotation = Number(await inkCanvas.getAttribute("data-ink-render-count"));

    await expect(window.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await hoverForCursor(window, inkCanvas, rotationStart, "rotation");
    await window.mouse.down();
    await window.mouse.move(rotationEnd.x, rotationEnd.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "rotation");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await expect(surface).not.toHaveAttribute("data-selected-object-rotation", "0");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");
    await expect
      .poll(async () => Number(await inkCanvas.getAttribute("data-ink-render-count")))
      .toBeGreaterThan(inkRenderBeforeRotation);
    const committedRotation = await surface.getAttribute("data-selected-object-rotation");

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-selected-object-rotation", "0");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await window.keyboard.press("Control+Shift+Z");
    await expect(surface).toHaveAttribute("data-selected-object-rotation", committedRotation ?? "");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");

    const rotated = await selectedGeometry();
    const rotatedCenter = {
      x: rotated.x + rotated.width / 2,
      y: rotated.y + rotated.height / 2,
    };
    const scaleStartPage = {
      x: rotated.x + rotated.width + 4 / zoom,
      y: rotated.y + rotated.height + 4 / zoom,
    };
    const scaleVector = {
      x: scaleStartPage.x - rotatedCenter.x,
      y: scaleStartPage.y - rotatedCenter.y,
    };
    const scaleStart = pageToScreen(scaleStartPage.x, scaleStartPage.y);
    const scaleLarge = pageToScreen(
      rotatedCenter.x + scaleVector.x * 1.35,
      rotatedCenter.y + scaleVector.y * 1.35,
    );
    const scaleEnd = pageToScreen(
      rotatedCenter.x + scaleVector.x * 0.2,
      rotatedCenter.y + scaleVector.y * 0.2,
    );
    const previewRenderBeforeScale = Number(
      await previewCanvas.getAttribute("data-manipulation-render-count"),
    );

    await hoverForCursor(window, inkCanvas, scaleStart, "nwse-resize");
    await window.mouse.down();
    await window.mouse.move(scaleLarge.x, scaleLarge.y, { steps: 4 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "scale");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await expect
      .poll(async () => Number(await previewCanvas.getAttribute("data-manipulation-render-count")))
      .toBeGreaterThan(previewRenderBeforeScale);
    const largePreview = await nonTransparentPixelBounds(previewCanvas);
    expect(largePreview.count).toBeGreaterThan(0);
    const largePreviewRenderCount = Number(
      await previewCanvas.getAttribute("data-manipulation-render-count"),
    );

    await window.mouse.move(scaleEnd.x, scaleEnd.y, { steps: 8 });
    await expect
      .poll(async () => Number(await previewCanvas.getAttribute("data-manipulation-render-count")))
      .toBeGreaterThan(largePreviewRenderCount);
    const smallPreview = await nonTransparentPixelBounds(previewCanvas);
    expect(smallPreview.count).toBeGreaterThan(0);
    expect(smallPreview.width).toBeLessThan(largePreview.width * 0.6);
    expect(smallPreview.height).toBeLessThan(largePreview.height * 0.6);
    if (process.env.FOLIO_FOLLOWUP_VISUAL_QA === "1") {
      await window.screenshot({
        path: path.join(repositoryRoot, "test-results", "followup-live-transform-preview.png"),
      });
    }
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(surface).not.toHaveAttribute("data-selected-object-scale", "1");
    const committedScale = await surface.getAttribute("data-selected-object-scale");
    await expect.poll(() => nonTransparentPixelCount(previewCanvas)).toBe(0);

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-selected-object-scale", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-selected-object-scale", committedScale ?? "");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    expect(await nonTransparentPixelCount(previewCanvas)).toBe(0);
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function hoverForCursor(
  window: Page,
  canvas: Locator,
  point: Readonly<{ x: number; y: number }>,
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

async function nonTransparentPixelCount(canvas: Locator): Promise<number> {
  return (await nonTransparentPixelBounds(canvas)).count;
}

async function nonTransparentPixelBounds(canvas: Locator): Promise<PixelBounds> {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (context === null) throw new Error("Preview canvas context is unavailable.");
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let count = 0;
    let minimumX = target.width;
    let minimumY = target.height;
    let maximumX = -1;
    let maximumY = -1;
    for (let index = 3; index < pixels.length; index += 4) {
      if ((pixels[index] ?? 0) === 0) continue;
      const pixelIndex = (index - 3) / 4;
      const x = pixelIndex % target.width;
      const y = Math.floor(pixelIndex / target.width);
      count += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
    return {
      count,
      x: count === 0 ? 0 : minimumX,
      y: count === 0 ? 0 : minimumY,
      width: count === 0 ? 0 : maximumX - minimumX + 1,
      height: count === 0 ? 0 : maximumY - minimumY + 1,
    };
  });
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

interface PixelBounds {
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
