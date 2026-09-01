import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

test("supports session clipboard workflows, multi-object History, shortcuts, and context menu", async () => {
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
    await expect(surface).toHaveAttribute("data-clipboard-capability", "ready");
    await expect(surface).toHaveAttribute("data-context-menu-capability", "ready");

    const points = await pagePoints(baseCanvas, inkCanvas);
    await activateDockSlot(window, "pen");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ink");
    await drawStroke(window, points.first, { x: 70, y: 15 });
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await drawStroke(window, points.second, { x: 55, y: 25 });
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.keyboard.press("Control+A");
    await expect(surface).toHaveAttribute("data-selected-object-count", "2");
    await window.keyboard.press("Control+C");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "2");
    await expect(surface).toHaveAttribute("data-selected-object-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");

    await window.keyboard.press("Control+V");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    await expect(surface).toHaveAttribute("data-selected-object-count", "2");
    await expect(surface).toHaveAttribute("data-selected-object-translation-x", "20");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await window.keyboard.press("Control+V");
    await expect(surface).toHaveAttribute("data-document-object-count", "6");
    await expect(surface).toHaveAttribute("data-selected-object-translation-x", "40");
    await expect(surface).toHaveAttribute("data-clipboard-paste-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await window.keyboard.press("Control+Shift+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "6");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");

    await window.keyboard.press("Control+A");
    await window.keyboard.press("Control+X");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(surface).toHaveAttribute("data-selected-object-count", "0");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "4");
    await window.keyboard.press("Control+Shift+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");

    await window.keyboard.press("Control+A");
    await window.keyboard.press("Control+D");
    await expect(surface).toHaveAttribute("data-document-object-count", "8");
    await expect(surface).toHaveAttribute("data-selected-object-count", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");

    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    await window.mouse.click(inkBounds.x + 5, inkBounds.y + 5, { button: "right" });
    const blankMenu = window.getByRole("menu", { name: "Editor context menu" });
    await expect(blankMenu).toBeVisible();
    await expect(blankMenu.getByRole("menuitem", { name: /Copy/u })).toBeDisabled();
    await expect(blankMenu.getByRole("menuitem", { name: /Paste/u })).toBeEnabled();
    await blankMenu.getByRole("menuitem", { name: /Select All/u }).click();
    await expect(surface).toHaveAttribute("data-selected-object-count", "4");
    await expect(surface).toHaveAttribute("data-selection-group-state", "group");

    await window.mouse.click(points.first.x + 20, points.first.y + 5, { button: "right" });
    const selectionMenu = window.getByRole("menu", { name: "Editor context menu" });
    await expect(selectionMenu.getByRole("menuitem", { name: /Delete/u })).toBeEnabled();
    await selectionMenu.getByRole("menuitem", { name: /Delete/u }).click();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function pagePoints(
  baseCanvas: ReturnType<Page["locator"]>,
  inkCanvas: ReturnType<Page["locator"]>,
): Promise<Readonly<{ first: Point; second: Point }>> {
  await expect(baseCanvas).toBeVisible();
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
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const toScreen = (pageX: number, pageY: number): Point => ({
    x: bounds.x + (metrics.pageX + pageX) * (bounds.width / metrics.logicalWidth),
    y: bounds.y + (metrics.pageY + pageY) * (bounds.height / metrics.logicalHeight),
  });
  return Object.freeze({
    first: toScreen(metrics.pageWidth * 0.25, metrics.pageHeight * 0.35),
    second: toScreen(metrics.pageWidth * 0.55, metrics.pageHeight * 0.55),
  });
}

async function drawStroke(window: Page, start: Point, delta: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 8 });
  await window.mouse.up();
}

interface Point {
  readonly x: number;
  readonly y: number;
}
