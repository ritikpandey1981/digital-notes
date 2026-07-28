import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("rotates and scales one selected object through History", async () => {
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
    await window.mouse.move(strokeStart.x, strokeStart.y);
    await window.mouse.down();
    await window.mouse.move(strokeStart.x + 100, strokeStart.y + 100, { steps: 8 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

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
    await window.mouse.move(rotationStart.x, rotationStart.y);
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
    const scaleEnd = pageToScreen(
      rotatedCenter.x + scaleVector.x * 1.5,
      rotatedCenter.y + scaleVector.y * 1.5,
    );

    await window.mouse.move(scaleStart.x, scaleStart.y);
    await window.mouse.down();
    await window.mouse.move(scaleEnd.x, scaleEnd.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "scale");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(surface).not.toHaveAttribute("data-selected-object-scale", "1");
    const committedScale = await surface.getAttribute("data-selected-object-scale");

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-selected-object-scale", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-selected-object-scale", committedScale ?? "");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
