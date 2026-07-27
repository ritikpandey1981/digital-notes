import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("launches the shell with the Phase 6 canvas lifecycle", async () => {
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
    await expect(window).toHaveTitle("Folio");
    await expect(window.getByRole("toolbar", { name: "Notebook tools" })).toBeVisible();
    await expect(window.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await expect(window.getByLabel("Notebook workspace")).toBeVisible();
    const canvasHost = window.getByTestId("canvas-host");
    await expect(canvasHost).toHaveAttribute("data-canvas-state", "ready");
    const canvas = canvasHost.locator("canvas[data-folio-renderer='true']");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-render-count", /[1-9]\d*/);
    await canvas.evaluate((element) => element.setAttribute("data-mount-probe", "retained"));
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

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("contentinfo")).toContainText("Pen");

    await window.getByRole("button", { name: "Show notification preview" }).click();
    await expect(window.getByRole("status")).toContainText("Shell ready");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByRole("dialog")).toContainText("Appearance");
    await window.getByRole("button", { name: "Cancel" }).click();

    await window.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(canvas).toHaveAttribute("data-mount-probe", "retained");

    const beforeResize = Number(await canvas.getAttribute("data-render-count"));
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
  } finally {
    await electronApp.close();
  }
});
