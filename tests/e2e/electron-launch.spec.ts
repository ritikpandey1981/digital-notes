import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("launches the shell with the Phase 8 document object lifecycle", async () => {
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
    await expect(window).toHaveTitle("Folio");
    await expect(window.getByRole("toolbar", { name: "Notebook tools" })).toBeVisible();
    await expect(window.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await expect(window.getByLabel("Notebook workspace")).toBeVisible();
    const canvasHost = window.getByTestId("canvas-host");
    const canvasSurface = window.getByTestId("canvas-surface");
    await expect(canvasHost).toHaveAttribute("data-canvas-state", "ready");
    const canvas = canvasHost.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = canvasHost.locator("canvas[data-folio-layer='ink']");
    await expect(canvas).toBeVisible();
    await expect(inkCanvas).toBeVisible();
    await expect(canvasHost).toHaveAttribute("data-ink-state", "ready");
    await expect(canvasSurface).toHaveAttribute("data-document-state", "ready");
    await expect(canvas).toHaveAttribute("data-render-count", /[1-9]\d*/);
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-objects-immutable", "true");
    await canvas.evaluate((element) => element.setAttribute("data-mount-probe", "retained"));
    await inkCanvas.evaluate((element) => element.setAttribute("data-ink-mount-probe", "retained"));
    await expect(window.getByText("Page 1 of 12")).toBeVisible();

    const metrics = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        physicalWidth: canvasElement.width,
        physicalHeight: canvasElement.height,
        logicalWidth: Number(canvasElement.dataset.logicalWidth),
        logicalHeight: Number(canvasElement.dataset.logicalHeight),
        dpr: Number(canvasElement.dataset.devicePixelRatio),
        pageX: Number(canvasElement.dataset.pageX),
        pageY: Number(canvasElement.dataset.pageY),
        pageWidth: Number(canvasElement.dataset.pageWidth),
        pageHeight: Number(canvasElement.dataset.pageHeight),
      };
    });
    expect(metrics.physicalWidth).toBe(Math.round(metrics.logicalWidth * metrics.dpr));
    expect(metrics.physicalHeight).toBe(Math.round(metrics.logicalHeight * metrics.dpr));
    expect(metrics.pageX + metrics.pageWidth / 2).toBeCloseTo(metrics.logicalWidth / 2, 5);
    expect(metrics.pageY + metrics.pageHeight / 2).toBeCloseTo(metrics.logicalHeight / 2, 5);

    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    const scaleX = inkBounds.width / metrics.logicalWidth;
    const scaleY = inkBounds.height / metrics.logicalHeight;
    const start = {
      x: inkBounds.x + (metrics.pageX + metrics.pageWidth * 0.3) * scaleX,
      y: inkBounds.y + (metrics.pageY + metrics.pageHeight * 0.35) * scaleY,
    };
    const baseRenderBeforeInk = Number(await canvas.getAttribute("data-render-count"));
    const inkRenderBefore = Number(await inkCanvas.getAttribute("data-ink-render-count"));
    await window.mouse.move(start.x, start.y);
    await window.mouse.down();
    await window.mouse.move(start.x + 45, start.y + 20, { steps: 5 });
    await window.mouse.move(start.x + 95, start.y - 10, { steps: 5 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "1");
    await expect(canvasSurface).toHaveAttribute("data-document-object-count", "1");
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeInk);
    expect(Number(await inkCanvas.getAttribute("data-ink-render-count"))).toBeGreaterThan(
      inkRenderBefore,
    );
    expect(Number(await inkCanvas.getAttribute("data-ink-dirty-width"))).toBeLessThan(
      metrics.pageWidth,
    );
    expect(Number(await inkCanvas.getAttribute("data-ink-dirty-height"))).toBeLessThan(
      metrics.pageHeight,
    );
    await expect
      .poll(async () => {
        const before = Number(await inkCanvas.getAttribute("data-ink-render-count"));
        await window.waitForTimeout(250);
        const after = Number(await inkCanvas.getAttribute("data-ink-render-count"));
        return after - before;
      })
      .toBe(0);

    await window.mouse.move(start.x + 20, start.y + 70);
    await window.mouse.down();
    await window.mouse.move(start.x + 70, start.y + 90, { steps: 5 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-objects-immutable", "true");

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("contentinfo")).toContainText("Pen");

    await window.getByRole("button", { name: "Show notification preview" }).click();
    await expect(window.getByRole("status")).toContainText("Shell ready");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByRole("dialog")).toContainText("Appearance");
    await window.getByRole("button", { name: "Cancel" }).click();

    await window.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(canvas).toHaveAttribute("data-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");

    const beforeResize = Number(await canvas.getAttribute("data-render-count"));
    const inkBeforeResize = Number(await inkCanvas.getAttribute("data-ink-render-count"));
    await window.setViewportSize({ width: 1_200, height: 760 });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-render-count")))
      .toBeGreaterThan(beforeResize);
    await expect
      .poll(async () => {
        const before = Number(await canvas.getAttribute("data-render-count"));
        await window.waitForTimeout(250);
        const after = Number(await canvas.getAttribute("data-render-count"));
        return after - before;
      })
      .toBe(0);
    await expect(canvas).toHaveAttribute("data-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    await expect
      .poll(async () => Number(await inkCanvas.getAttribute("data-ink-render-count")))
      .toBeGreaterThan(inkBeforeResize);
    expect(consoleErrors).toEqual([]);

    await window.reload();
    const freshInkCanvas = window.locator("canvas[data-folio-layer='ink']");
    await expect(freshInkCanvas).toBeVisible();
    await expect(freshInkCanvas).toHaveAttribute("data-ink-stroke-count", "0");
    await expect(freshInkCanvas).toHaveAttribute("data-document-object-count", "0");
    await expect(freshInkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(window.getByText("Page 1 of 12")).toBeVisible();
  } finally {
    await electronApp.close();
  }
});
