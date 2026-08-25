import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

const SCREENSHOT_NAMES = [
  "01-pencil-active.png",
  "02-pencil-settings.png",
  "03-brush-pen-settings.png",
  "04-marker-settings.png",
  "05-highlighter-settings.png",
  "06-all-families-strokes.png",
  "07-small-cursor-100.png",
  "08-large-cursor-200.png",
] as const;

test("delivers the Phase 17C professional brush catalog, lifecycle, strokes, and cursor", async () => {
  test.setTimeout(90_000);
  const repositoryRoot = process.cwd();
  const screenshotDirectory = path.join(repositoryRoot, "docs/interaction/screenshots/phase-17c");
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
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const palette = window.getByTestId("context-tool-palette");
    const cursor = window.getByTestId("brush-cursor");

    await expect(toolDock).toBeVisible();
    await expect(toolDock.locator("button[aria-label]")).toHaveCount(7);
    expect(
      await toolDock
        .locator("button[aria-label]")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ).toEqual(["Select", "Pencil", "Pen", "Marker", "Highlighter", "Eraser", "Shapes"]);

    await selectInactiveBrush(window, "Pencil");
    await expect(palette).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pencil-hb");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[0]);

    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pencil");
    await expect(window.getByRole("button", { name: "Pencil preset" })).toHaveAttribute(
      "data-active-preset-id",
      "pencil-hb",
    );
    await expect(window.getByRole("slider", { name: "Smoothing" })).toBeVisible();
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[1]);

    await selectInactiveBrush(window, "Pen");
    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await selectPreset(window, "Pen preset", "pen-brush");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pen-brush");
    await expect(surface).toHaveAttribute("data-drawing-width", "6");
    await expect(surface).toHaveAttribute("data-drawing-smoothing", "0.18");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[2]);

    await selectInactiveBrush(window, "Marker");
    await window.getByRole("button", { name: "Marker", exact: true }).click();
    await selectPreset(window, "Marker preset", "marker-broad");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "marker-broad");
    await expect(surface).toHaveAttribute("data-drawing-width", "16");
    await expect(surface).toHaveAttribute("data-drawing-smoothing", "0.25");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[3]);

    await selectInactiveBrush(window, "Highlighter");
    await window.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Highlighter");
    await expect(window.getByRole("button", { name: "Highlighter preset" })).toHaveCount(0);
    await expect(window.getByRole("slider", { name: "Smoothing" })).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-drawing-smoothing", "0");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[4]);

    const pageToScreen = await pageCoordinateMapper(inkCanvas, surface);
    await window.getByRole("button", { name: "Highlighter", exact: true }).click();
    await drawPath(window, pageToScreen, 420);
    await selectInactiveBrush(window, "Pencil");
    await drawPath(window, pageToScreen, 180);
    await selectInactiveBrush(window, "Pen");
    await drawPath(window, pageToScreen, 260);
    await selectInactiveBrush(window, "Marker");
    await drawPath(window, pageToScreen, 340);
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    expect(await strokeBrushFamilies(surface)).toEqual(["highlighter", "pencil", "pen", "marker"]);
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[5]);

    await selectInactiveBrush(window, "Pencil");
    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "1");
    await setNumericValue(window.getByRole("spinbutton", { name: "Smoothing value" }), "65");
    await expect(surface).toHaveAttribute("data-drawing-smoothing", "0.65");
    await selectZoomMenuItem(window, "100% (Actual Size)");
    await moveToPageCenter(window, inkCanvas, surface);
    await expect(cursor).toHaveAttribute("data-visible", "true");
    await expect(cursor).toHaveCSS("width", "7px");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[6]);

    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "20");
    await selectZoomMenuItem(window, "200%");
    await moveToPageCenter(window, inkCanvas, surface);
    await expect(cursor).toHaveAttribute("data-visible", "true");
    await expect(cursor).toHaveCSS("width", "40px");
    await capture(window, screenshotDirectory, SCREENSHOT_NAMES[7]);

    await window.mouse.move(2, 2);
    await expect(cursor).toHaveAttribute("data-visible", "false");
    await inkCanvas.dispatchEvent("pointermove", {
      clientX: 500,
      clientY: 400,
      pointerId: 91,
      pointerType: "touch",
    });
    await expect(cursor).toHaveAttribute("data-visible", "false");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function selectInactiveBrush(window: Page, tool: string): Promise<void> {
  await window.getByRole("button", { name: tool, exact: true }).click();
  await expect(window.getByRole("button", { name: tool, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function selectPreset(window: Page, triggerName: string, presetId: string): Promise<void> {
  const trigger = window.getByRole("button", { name: triggerName });
  await trigger.click();
  await window.locator(`[role="menuitemradio"][data-preset-id="${presetId}"]`).click();
  await expect(trigger).toHaveAttribute("data-active-preset-id", presetId);
}

async function capture(window: Page, directory: string, name: string): Promise<void> {
  await window.screenshot({ path: path.join(directory, name), animations: "disabled" });
}

async function drawPath(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  y: number,
): Promise<void> {
  const start = pageToScreen(140, y);
  const middle = pageToScreen(300, y + 24);
  const end = pageToScreen(500, y);
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(middle.x, middle.y, { steps: 8 });
  await window.mouse.move(end.x, end.y, { steps: 8 });
  await window.mouse.up();
}

async function pageCoordinateMapper(
  inkCanvas: Locator,
  surface: Locator,
): Promise<(x: number, y: number) => Point> {
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  const xScale = bounds.width / viewportWidth;
  const yScale = bounds.height / viewportHeight;
  return (x: number, y: number) => ({
    x: bounds.x + (pageX + x * zoom) * xScale,
    y: bounds.y + (pageY + y * zoom) * yScale,
  });
}

async function moveToPageCenter(window: Page, inkCanvas: Locator, surface: Locator): Promise<void> {
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  const pageWidth = await attributeNumber(surface, "data-viewport-page-width");
  const pageHeight = await attributeNumber(surface, "data-viewport-page-height");
  await window.mouse.move(
    bounds.x + (pageX + pageWidth / 2) * (bounds.width / viewportWidth),
    bounds.y + (pageY + pageHeight / 2) * (bounds.height / viewportHeight),
  );
}

async function selectZoomMenuItem(window: Page, name: string): Promise<void> {
  await window.getByRole("button", { name: /Zoom options/u }).click();
  await window.getByRole("menuitem", { name, exact: true }).click();
  await expect(window.getByRole("menu")).toHaveCount(0);
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function strokeBrushFamilies(locator: Locator): Promise<readonly string[]> {
  const brushes = JSON.parse(
    (await locator.getAttribute("data-document-stroke-brushes")) ?? "[]",
  ) as readonly Readonly<{ family: string }>[];
  return brushes.map(({ family }) => family);
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

interface Point {
  readonly x: number;
  readonly y: number;
}
