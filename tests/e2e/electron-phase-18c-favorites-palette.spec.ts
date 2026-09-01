import path from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

test("Phase 18C keeps Favorites deliberate, ordered, target-safe, and separate from palettes and Recent", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  expect(_browserName).toBe("chromium");
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
    const workspace = window.getByTestId("editor-workspace");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const rail = window.getByTestId("quick-color-rail");
    const picker = window.getByTestId("full-color-picker");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    const rendererCanvas = host.locator('canvas[data-folio-renderer="true"]');
    const pageToScreen = await pageCoordinateMapper(surface, host);

    await activateDockSlot(window, "pencil");
    await rail.getByTestId("quick-color-more").click();
    await expect(picker.getByTestId("favorites-empty-state")).toHaveText("No favorites yet");
    await capture(window, testInfo, "01-picker-empty-favorites.png");

    const historyBeforeFavorites = await historyDepth(surface);
    const recentBeforeFavorites = await recentColors(picker);
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await hex.fill("#4f46e5");
    await nextPaint(window);
    const rendererBeforeFavorites = await rendererCanvas.getAttribute("data-render-count");
    const addFirst = picker.getByRole("button", { name: "Add #4f46e5 to favorites" });
    await addFirst.focus();
    await addFirst.press("Enter");
    await expect(picker.getByTestId("favorite-current-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await favoriteValues(picker)).toEqual(["#4f46e5"]);
    expect(await historyDepth(surface)).toBe(historyBeforeFavorites);
    expect(await recentColors(picker)).toEqual(recentBeforeFavorites);
    await nextPaint(window);
    expect(await rendererCanvas.getAttribute("data-render-count")).toBe(rendererBeforeFavorites);
    await capture(window, testInfo, "02-current-color-favorited.png");

    await hex.fill("#0ea5e9");
    await picker.getByRole("button", { name: "Add #0ea5e9 to favorites" }).click();
    expect(await favoriteValues(picker)).toEqual(["#4f46e5", "#0ea5e9"]);
    await capture(window, testInfo, "03-multiple-favorites.png");

    const firstFavorite = picker.getByRole("button", { name: "Use favorite color #4f46e5" });
    await firstFavorite.focus();
    await firstFavorite.press("Enter");
    await expect(surface).toHaveAttribute("data-drawing-color", "#4f46e5");
    await expect(hex).toHaveValue("#4F46E5");
    expect(await favoriteValues(picker)).toEqual(["#4f46e5", "#0ea5e9"]);
    expect(await recentColors(picker)).toEqual([]);
    await capture(window, testInfo, "04-favorite-selected.png");

    await capture(window, testInfo, "05-basic-palette.png");
    const currentBeforePaletteSwitch = await surface.getAttribute("data-drawing-color");
    const previousBeforePaletteSwitch = await previousColor(picker);
    const historyBeforePaletteSwitch = await historyDepth(surface);
    const rendererBeforePaletteSwitch = await rendererCanvas.getAttribute("data-render-count");
    await selectPaletteWithKeyboard(picker, "Basic", "Sketch");
    await expect(rail).toHaveAttribute("data-palette-id", "sketch");
    await expect(surface).toHaveAttribute("data-drawing-color", currentBeforePaletteSwitch ?? "");
    expect(await previousColor(picker)).toBe(previousBeforePaletteSwitch);
    expect(await favoriteValues(picker)).toEqual(["#4f46e5", "#0ea5e9"]);
    expect(await recentColors(picker)).toEqual([]);
    expect(await historyDepth(surface)).toBe(historyBeforePaletteSwitch);
    await nextPaint(window);
    expect(await rendererCanvas.getAttribute("data-render-count")).toBe(
      rendererBeforePaletteSwitch,
    );
    await capture(window, testInfo, "06-sketch-palette.png");

    await selectPaletteWithKeyboard(picker, "Sketch", "Monochrome");
    await expect(rail).toHaveAttribute("data-palette-id", "monochrome");
    await expect(surface).toHaveAttribute("data-drawing-color", currentBeforePaletteSwitch ?? "");
    expect(await previousColor(picker)).toBe(previousBeforePaletteSwitch);
    expect(await favoriteValues(picker)).toEqual(["#4f46e5", "#0ea5e9"]);
    expect(await recentColors(picker)).toEqual([]);
    expect(await historyDepth(surface)).toBe(historyBeforePaletteSwitch);
    await capture(window, testInfo, "07-monochrome-palette.png");

    const rendererBeforeRemoval = await rendererCanvas.getAttribute("data-render-count");
    await picker.getByRole("button", { name: "Remove #4f46e5 from favorites" }).click();
    expect(await favoriteValues(picker)).toEqual(["#0ea5e9"]);
    await expect(surface).toHaveAttribute("data-drawing-color", "#4f46e5");
    expect(await recentColors(picker)).toEqual([]);
    expect(await historyDepth(surface)).toBe(historyBeforePaletteSwitch);
    await nextPaint(window);
    expect(await rendererCanvas.getAttribute("data-render-count")).toBe(rendererBeforeRemoval);

    await workspace.click({ position: { x: 420, y: 28 } });
    await expect(picker).toHaveCount(0);
    await drawGesture(window, pageToScreen(150, 150), pageToScreen(310, 175));
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await rail.getByTestId("quick-color-more").click();
    await expect(picker.getByRole("button", { name: "Use recent color #4f46e5" })).toBeVisible();
    expect(await favoriteValues(picker)).toEqual(["#0ea5e9"]);
    await window.keyboard.press("Escape");

    await chooseRectangle(window);
    const shapeDefault = (await surface.getAttribute("data-drawing-color")) ?? "#111111";
    await drawGesture(window, pageToScreen(250, 240), pageToScreen(390, 350));
    const rectangle = (await vectorStyles(surface)).at(-1);
    if (rectangle === undefined) throw new Error("Rectangle was not created.");
    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(320, 295)));
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangle.id);
    const historyBeforeVectorFavorite = await historyDepth(surface);
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await picker.getByRole("button", { name: "Use favorite color #0ea5e9" }).click();
    expect(await favoriteValues(picker)).toEqual(["#0ea5e9"]);
    await workspace.click({ position: { x: 420, y: 28 } });
    await expect(picker).toHaveCount(0);
    expect(await historyDepth(surface)).toBe(historyBeforeVectorFavorite + 1);
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      "#0ea5e9",
    );
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      rectangle.color,
    );
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      "#0ea5e9",
    );

    const historyBeforeCancel = await historyDepth(surface);
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#dc2626");
    await picker.getByRole("button", { name: "Add #dc2626 to favorites" }).click();
    expect(await favoriteValues(picker)).toEqual(["#0ea5e9", "#dc2626"]);
    await capture(window, testInfo, "08-selected-rectangle-favorites.png");
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    expect(await historyDepth(surface)).toBe(historyBeforeCancel);
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      "#0ea5e9",
    );

    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", shapeDefault);
    await activateDockSlot(window, "pencil");
    await rail.getByTestId("quick-color-more").click();
    expect(await favoriteValues(picker)).toEqual(["#0ea5e9", "#dc2626"]);
    await expect(picker.getByRole("button", { name: "Use recent color #0ea5e9" })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Use recent color #dc2626" })).toHaveCount(0);

    const historyBeforeSketchColor = await historyDepth(surface);
    await picker.getByTestId("color-palette-trigger").click();
    await window
      .getByTestId("color-palette-menu")
      .getByRole("menuitemradio", {
        name: "Sketch",
      })
      .click();
    await expect(rail).toHaveAttribute("data-palette-id", "sketch");
    expect(await historyDepth(surface)).toBe(historyBeforeSketchColor);
    await picker.getByRole("button", { name: "Use color #6b4f3a" }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", "#6b4f3a");
    await expect(picker.getByRole("button", { name: "Use recent color #6b4f3a" })).toHaveCount(0);
    await workspace.click({ position: { x: 420, y: 28 } });
    await drawGesture(window, pageToScreen(430, 150), pageToScreen(560, 180));
    await rail.getByTestId("quick-color-more").click();
    await expect(picker.getByRole("button", { name: "Use recent color #6b4f3a" })).toBeVisible();

    await window.setViewportSize({ width: 1024, height: 700 });
    await expectPickerInsideViewport(picker, { width: 1024, height: 700 });
    await capture(window, testInfo, "09-short-window-picker-favorites.png");

    await window.setViewportSize({ width: 1920, height: 1080 });
    await expectPickerInsideViewport(picker, { width: 1920, height: 1080 });
    await window.setViewportSize({ width: 960, height: 640 });
    await expectPickerInsideViewport(picker, { width: 960, height: 640 });

    await expect(window.getByRole("button", { name: /New Palette|Eyedropper/u })).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function selectPaletteWithKeyboard(
  picker: Locator,
  currentName: string,
  nextName: string,
): Promise<void> {
  const trigger = picker.getByTestId("color-palette-trigger");
  await trigger.focus();
  await trigger.press("Enter");
  const menu = picker.page().getByTestId("color-palette-menu");
  const current = menu.getByRole("menuitemradio", { name: currentName });
  await current.focus();
  await current.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: nextName })).toBeFocused();
  await picker.page().keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText(nextName);
}

async function chooseRectangle(window: Page): Promise<void> {
  const button = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await button.click();
  if (!(await widget.isVisible())) await button.click();
  await widget.getByRole("button", { name: "Rectangle", exact: true }).click();
}

async function favoriteValues(picker: Locator): Promise<readonly string[]> {
  return picker
    .getByTestId("favorite-colors")
    .getByRole("button", { name: /Use favorite color/u })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.split(" ").at(-1) ?? ""),
    );
}

async function recentColors(picker: Locator): Promise<readonly string[]> {
  return picker
    .getByRole("button", { name: /Use recent color/u })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.split(" ").at(-1) ?? ""),
    );
}

async function previousColor(picker: Locator): Promise<string> {
  const label = await picker
    .getByRole("button", { name: /Previous color/u })
    .getAttribute("aria-label");
  return label?.split(" ").at(-1) ?? "";
}

async function capture(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  await window.screenshot({ path: testInfo.outputPath(name) });
}

async function nextPaint(window: Page): Promise<void> {
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function historyDepth(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-history-undo-depth"));
}

interface VectorStyleDiagnostic {
  readonly id: string;
  readonly color: string;
}

async function vectorStyles(surface: Locator): Promise<readonly VectorStyleDiagnostic[]> {
  return JSON.parse(
    (await surface.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as readonly VectorStyleDiagnostic[];
}

async function drawGesture(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 10 });
  await window.mouse.up();
}

async function expectPickerInsideViewport(
  picker: Locator,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const bounds = await picker.boundingBox();
  if (bounds === null) throw new Error("Color picker is not measurable.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
}

async function pageCoordinateMapper(surface: Locator, host: Locator) {
  const canvas = host.locator("canvas[data-folio-layer='ink']");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const metrics = await surface.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      pageX: Number(dataset.viewportPageX),
      pageY: Number(dataset.viewportPageY),
      zoom: Number(dataset.viewportZoom),
      viewportWidth: Number(dataset.viewportWidth),
      viewportHeight: Number(dataset.viewportHeight),
    };
  });
  return (x: number, y: number): Point => ({
    x: bounds.x + (metrics.pageX + x * metrics.zoom) * (bounds.width / metrics.viewportWidth),
    y: bounds.y + (metrics.pageY + y * metrics.zoom) * (bounds.height / metrics.viewportHeight),
  });
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}
