import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

test("captures the Phase 16.5 sketchbook workspace states", async ({ browserName }, testInfo) => {
  void browserName;
  test.setTimeout(60_000);
  const repositoryRoot = process.cwd();
  const screenshotDirectory =
    process.env.FOLIO_SCREENSHOT_DIR ?? testInfo.outputPath("phase-16-5-sketchbook");
  mkdirSync(screenshotDirectory, { recursive: true });
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1_440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const palette = window.getByTestId("context-tool-palette");
    const shapesWidget = window.getByTestId("shapes-widget");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");

    await expect(surface).toHaveAttribute("data-document-state", "ready");
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(window.getByTestId("sketchbook-top-bar")).toBeVisible();
    await expect(window.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
    expect(await presentationColors(window)).toMatchObject({
      workspace: "#f1f1ef",
      page: "#fffdf8",
      surface: "#fff",
    });
    await capture(window, screenshotDirectory, "phase-16-5-default-workspace.png");
    await activateDockSlot(window, "pen");
    await expect(palette).toBeHidden();
    await openSlotToolOptions(window, "pen");
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await capture(window, screenshotDirectory, "phase-16-5-pen-settings.png");
    await window.keyboard.press("Escape");
    await activateDockSlot(window, "highlighter");
    await expect(palette).toBeHidden();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "highlighter");
    await openSlotToolOptions(window, "highlighter");
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Highlighter");
    await window.keyboard.press("Escape");

    const shapesButton = toolDock.getByRole("button", { name: "Shapes", exact: true });
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await expect(window.getByTestId("context-hint")).toContainText("perfect square");
    await expect(window.getByTestId("context-hint")).not.toContainText("perfect circle");
    await capture(window, screenshotDirectory, "phase-16-5-shapes-rectangle-armed.png");

    await drawGesture(
      window,
      await livePageToScreen(surface, inkCanvas, { x: 180, y: 180 }),
      await livePageToScreen(surface, inkCanvas, { x: 320, y: 280 }),
    );
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await expect(shapesWidget).toBeHidden();

    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(shapesWidget).toBeHidden();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await expect(window.getByTestId("context-hint")).toContainText(
      "Tip: Hold Shift → Draw a perfect square",
    );
    await drawGesture(
      window,
      await livePageToScreen(surface, inkCanvas, { x: 260, y: 180 }),
      await livePageToScreen(surface, inkCanvas, { x: 420, y: 300 }),
    );
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "2");
    await expect(surface).toHaveAttribute("data-selected-object-type", "rectangle");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    await capture(window, screenshotDirectory, "phase-16-5-rectangle-selected.png");

    await activateDockSlot(window, "pen");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ink");
    await expect(palette).toBeHidden();
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await drawGesture(
      window,
      await livePageToScreen(surface, inkCanvas, { x: 480, y: 180 }),
      await livePageToScreen(surface, inkCanvas, { x: 620, y: 300 }),
    );
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await shapesWidget.getByRole("button", { name: "Ellipse", exact: true }).click();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ellipse");
    await expect(window.getByTestId("context-hint")).toContainText(
      "Tip: Hold Shift → Draw a perfect circle",
    );

    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await shapesButton.click();
    await expect(shapesWidget).toBeHidden();
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(shapesWidget).toBeHidden();
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await window.mouse.click(520, 24);
    await expect(shapesWidget).toBeHidden();

    await window.getByRole("button", { name: /^Zoom options,/u }).click();
    await expect(window.getByRole("menu")).toBeVisible();
    await expect(window.getByTestId("viewport-navigation-shortcuts")).toBeVisible();
    await capture(window, screenshotDirectory, "phase-16-5-viewport-menu.png");
    await window.keyboard.press("Escape");
  } finally {
    await electronApp.close();
  }
});

async function capture(window: Page, directory: string, fileName: string): Promise<void> {
  await window.screenshot({
    path: path.join(directory, fileName),
    animations: "disabled",
  });
}

async function presentationColors(window: Page): Promise<PresentationColors> {
  return window.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      workspace: styles.getPropertyValue("--folio-workspace").trim(),
      page: styles.getPropertyValue("--folio-page").trim(),
      surface: styles.getPropertyValue("--folio-surface").trim(),
    };
  });
}

async function drawGesture(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 8 });
  await window.mouse.up();
}

async function livePageToScreen(surface: Locator, canvas: Locator, point: Point): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas has no visible bounds.");
  const metrics = await surface.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      viewportWidth: Number(dataset.viewportWidth),
      viewportHeight: Number(dataset.viewportHeight),
      pageX: Number(dataset.viewportPageX),
      pageY: Number(dataset.viewportPageY),
      zoom: Number(dataset.viewportZoom),
    };
  });
  return {
    x: bounds.x + (metrics.pageX + point.x * metrics.zoom) * (bounds.width / metrics.viewportWidth),
    y:
      bounds.y +
      (metrics.pageY + point.y * metrics.zoom) * (bounds.height / metrics.viewportHeight),
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PresentationColors {
  readonly workspace: string;
  readonly page: string;
  readonly surface: string;
}
