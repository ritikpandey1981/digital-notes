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
    const pageToScreen = (x: number, y: number) => ({
      x: inkBounds.x + (metrics.pageX + x) * scaleX,
      y: inkBounds.y + (metrics.pageY + y) * scaleY,
    });
    const strokeStartPage = {
      x: metrics.pageWidth * 0.3,
      y: metrics.pageHeight * 0.35,
    };
    const strokeStart = pageToScreen(strokeStartPage.x, strokeStartPage.y);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await window.mouse.move(strokeStart.x, strokeStart.y);
    await window.mouse.down();
    await window.mouse.move(strokeStart.x + 100, strokeStart.y, { steps: 8 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(strokeStart.x + 40, strokeStart.y);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
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
    const rotationRadius = Math.max(initial.width, initial.height, 30);
    const rotationStart = pageToScreen(center.x + rotationRadius, center.y);
    const rotationEnd = pageToScreen(center.x, center.y + rotationRadius);
    const inkRenderBeforeRotation = Number(await inkCanvas.getAttribute("data-ink-render-count"));

    await window.getByRole("button", { name: "Rotate", exact: true }).click();
    await window.mouse.move(rotationStart.x, rotationStart.y);
    await window.mouse.down();
    await window.mouse.move(rotationEnd.x, rotationEnd.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "rotation");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await expect(surface).not.toHaveAttribute("data-selected-object-rotation", "0");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");
    await expect
      .poll(async () => Number(await inkCanvas.getAttribute("data-ink-render-count")))
      .toBeGreaterThan(inkRenderBeforeRotation);
    const committedRotation = await surface.getAttribute("data-selected-object-rotation");

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-selected-object-rotation", "0");
    await window.keyboard.press("Control+Shift+Z");
    await expect(surface).toHaveAttribute("data-selected-object-rotation", committedRotation ?? "");

    const rotated = await selectedGeometry();
    const rotatedCenter = {
      x: rotated.x + rotated.width / 2,
      y: rotated.y + rotated.height / 2,
    };
    const scaleRadius = Math.max(rotated.width, rotated.height, 30);
    const scaleStart = pageToScreen(rotatedCenter.x + scaleRadius, rotatedCenter.y);
    const scaleEnd = pageToScreen(rotatedCenter.x + scaleRadius * 1.5, rotatedCenter.y);

    await window.getByRole("button", { name: "Scale", exact: true }).click();
    await window.mouse.move(scaleStart.x, scaleStart.y);
    await window.mouse.down();
    await window.mouse.move(scaleEnd.x, scaleEnd.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "scale");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await expect(surface).not.toHaveAttribute("data-selected-object-scale", "1");
    const committedScale = await surface.getAttribute("data-selected-object-scale");

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-selected-object-scale", "1");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-selected-object-scale", committedScale ?? "");
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
