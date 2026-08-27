import path from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

test("Phase 18B shares one responsive color workflow across creation tools and selected vectors", async ({
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
    const pageToScreen = await pageCoordinateMapper(surface, host);

    await expect(rail).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute("data-active-color-target", "creation-pencil");
    await expect(rail).toHaveAttribute("data-visible-swatch-count", "7");
    await capture(window, testInfo, "01-pencil-quick-color-rail.png");

    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(rail).toHaveAttribute("data-active-color-target", "creation-shape-rectangle");
    await capture(window, testInfo, "02-shapes-quick-color-rail.png");
    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await expect(rail).toHaveCount(0);
    await expect(window.getByTestId("shapes-widget")).toHaveCount(0);
    await capture(window, testInfo, "03-select-rail-hidden.png");

    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    const historyBeforeRail = await historyDepth(surface);
    await rail.getByRole("button", { name: "Use color #2563eb" }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", "#2563eb");
    expect(await historyDepth(surface)).toBe(historyBeforeRail);
    await drawGesture(window, pageToScreen(160, 150), pageToScreen(310, 170));
    await expect(surface).toHaveAttribute("data-history-undo-depth", String(historyBeforeRail + 1));

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(surface).not.toHaveAttribute("data-drawing-color", "#2563eb");
    const penOriginal = (await surface.getAttribute("data-drawing-color")) ?? "#111111";
    await rail.getByTestId("quick-color-current").focus();
    await rail.getByTestId("quick-color-current").press("End");
    await expect(rail.getByTestId("quick-color-more")).toBeFocused();
    await rail.getByTestId("quick-color-more").press("Home");
    await expect(rail.getByTestId("quick-color-current")).toBeFocused();
    await rail.getByTestId("quick-color-current").press("Space");
    await expect(picker).toHaveAttribute("data-color-target-label", "Pen Color");
    await window.keyboard.press("Escape");
    await expect(rail.getByTestId("quick-color-current")).toBeFocused();
    await rail.getByTestId("quick-color-more").press("Enter");
    await expect(picker).toHaveAttribute("data-color-target-label", "Pen Color");
    await expect(picker.locator('input[type="color"]')).toHaveCount(0);
    await expect(picker.getByTestId("color-sv-field")).toBeVisible();
    await expect(picker.getByRole("slider", { name: /Hue/u })).toBeVisible();
    await expect(picker.getByRole("textbox", { name: "Hex color" })).toHaveValue(
      penOriginal.toUpperCase(),
    );
    await capture(window, testInfo, "04-full-picker-from-rail.png");

    const pickerHistory = await historyDepth(surface);
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await hex.fill("#123");
    await expect(surface).toHaveAttribute("data-drawing-color", penOriginal);
    await hex.press("Tab");
    await expect(hex).toHaveValue(penOriginal.toUpperCase());
    await hex.fill("#123456");
    await expect(surface).toHaveAttribute("data-drawing-color", "#123456");
    await expect(picker.getByRole("spinbutton", { name: "red channel" })).toHaveValue("18");
    await expect(picker.getByRole("spinbutton", { name: "green channel" })).toHaveValue("52");
    await expect(picker.getByRole("spinbutton", { name: "blue channel" })).toHaveValue("86");
    await picker.getByRole("spinbutton", { name: "red channel" }).fill("43");
    await picker.getByRole("spinbutton", { name: "green channel" }).fill("123");
    await picker.getByRole("spinbutton", { name: "blue channel" }).fill("227");
    await expect(surface).toHaveAttribute("data-drawing-color", "#2b7be3");
    await expect(hex).toHaveValue("#2B7BE3");
    await expect(picker.getByText("Previous").locator("..")).toContainText(penOriginal);
    await picker.getByRole("button", { name: `Previous color ${penOriginal}` }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", penOriginal);
    await expect(hex).toHaveValue(penOriginal.toUpperCase());
    const hue = picker.getByRole("slider", { name: /Hue/u });
    await hue.fill("180");
    await expect(hue).toHaveValue("180");
    await hex.fill("#808080");
    await expect(hue).toHaveValue("180");
    await picker.getByTestId("color-sv-field").click({ position: { x: 185, y: 46 } });
    await expectRawSvCoalescing(window, workspace, picker);
    expect(await historyDepth(surface)).toBe(pickerHistory);
    await expect(picker.getByRole("button", { name: "Use recent color #2563eb" })).toBeVisible();
    await capture(window, testInfo, "05-full-picker-hex-rgb.png");

    await picker.getByTestId("color-palette-trigger").click();
    const paletteMenu = window.getByTestId("color-palette-menu");
    await expect(paletteMenu.getByRole("menuitemradio")).toHaveCount(3);
    await capture(window, testInfo, "06-built-in-palette-dropdown.png");
    await window.keyboard.press("Escape");
    await expect(paletteMenu).toHaveCount(0);
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("color-palette-trigger")).toBeFocused();
    const colorBeforePaletteSwitch = await surface.getAttribute("data-drawing-color");
    const previousBeforePaletteSwitch = await picker
      .getByText("Previous")
      .locator("..")
      .textContent();
    await picker.getByTestId("color-palette-trigger").click();
    await paletteMenu.getByRole("menuitemradio", { name: "Sketch" }).click();
    await expect(picker.getByTestId("color-palette-trigger")).toContainText("Sketch");
    await expect(surface).toHaveAttribute("data-drawing-color", colorBeforePaletteSwitch ?? "");
    expect(await picker.getByText("Previous").locator("..").textContent()).toBe(
      previousBeforePaletteSwitch,
    );
    await expect(picker.getByLabel("Sketch colors").getByRole("button")).toHaveCount(10);
    await picker.getByLabel("Sketch colors").getByRole("button").nth(5).click();
    await workspace.click({ position: { x: 420, y: 28 } });
    await expect(picker).toHaveCount(0);

    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    const toolSettings = window.getByTestId("context-tool-palette");
    await toolSettings.getByTestId("tool-options-color-trigger").click();
    await expect(picker).toHaveAttribute("data-picker-source", "tool-settings");
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#8b5cf6");
    await expect(toolSettings).toBeVisible();
    await capture(window, testInfo, "07-picker-from-pencil-settings.png");
    await toolSettings.click({ position: { x: 12, y: 12 } });
    await expect(picker).toHaveCount(0);
    await expect(toolSettings.getByTestId("tool-options-color-trigger")).toContainText("#8b5cf6");
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", "#8b5cf6");

    await window.setViewportSize({ width: 960, height: 700 });
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute("data-visible-swatch-count", "5");
    const [shortRailBounds, viewportControlBounds] = await Promise.all([
      rail.boundingBox(),
      window.getByTestId("viewport-controls").boundingBox(),
    ]);
    if (shortRailBounds === null || viewportControlBounds === null) {
      throw new Error("Short-window controls are not measurable.");
    }
    expect(shortRailBounds.y + shortRailBounds.height).toBeLessThan(viewportControlBounds.y);
    await capture(window, testInfo, "09-short-window-rail-placement.png");
    await window.setViewportSize({ width: 1440, height: 900 });

    await chooseRectangle(window);
    await drawGesture(window, pageToScreen(230, 230), pageToScreen(360, 330));
    await drawGesture(window, pageToScreen(500, 320), pageToScreen(630, 420));
    const created = await vectorStyles(surface);
    const rectangleA = created.at(-2);
    const rectangleB = created.at(-1);
    if (rectangleA === undefined || rectangleB === undefined)
      throw new Error("Rectangles missing.");
    const shapeDefault = (await surface.getAttribute("data-drawing-color")) ?? "#111111";

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(290, 280)));
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangleA.id);
    const selectedHistory = await historyDepth(surface);
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await expect(picker).toHaveAttribute("data-picker-source", "selected-vector");
    await expectRawSvCoalescing(window, workspace, picker);
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#dc2626");
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#16a34a");
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#9333ea");
    expect(await historyDepth(surface)).toBe(selectedHistory);
    await capture(window, testInfo, "08-picker-from-selected-rectangle.png");

    // One outside click both commits the edit and reaches the canvas beneath.
    // The picker now opens beside the control that launched it rather than in
    // a fixed corner, so the point is chosen from its live box: any part of
    // rectangle B the picker is not covering will do.
    const dismissalPoint = await firstUncoveredPagePoint(window, picker, pageToScreen, {
      left: 500,
      top: 320,
      right: 630,
      bottom: 420,
    });
    await window.mouse.click(dismissalPoint.x, dismissalPoint.y);
    await expect(picker).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangleB.id);
    expect(await historyDepth(surface)).toBe(selectedHistory + 1);
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangleA.id)?.color).toBe(
      "#9333ea",
    );
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangleB.id)?.color).toBe(
      rectangleB.color,
    );

    await window.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangleA.id)?.color).toBe(
      rectangleA.color,
    );
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangleA.id)?.color).toBe(
      "#9333ea",
    );
    await window.mouse.click(...pointTuple(pageToScreen(290, 280)));
    const cancelDepth = await historyDepth(surface);
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#2563eb");
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    expect(await historyDepth(surface)).toBe(cancelDepth);
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangleA.id)?.color).toBe(
      "#9333ea",
    );

    await window.mouse.click(...pointTuple(pageToScreen(565, 370)));
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await expect(picker.getByRole("button", { name: "Use recent color #9333ea" })).toBeVisible();
    await window.keyboard.press("Escape");

    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", shapeDefault);
    await expect(rail).toHaveAttribute("data-palette-id", "sketch");
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await drawGesture(window, pageToScreen(180, 520), pageToScreen(360, 545));
    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(270, 532)));
    await expect(surface).toHaveAttribute("data-selected-object-type", "ink");
    await capture(window, testInfo, "10-selected-ink-semantic-selection.png");

    await toolDock.getByRole("button", { name: "Eraser", exact: true }).click();
    await expect(rail).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function chooseRectangle(window: Page): Promise<void> {
  const button = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await button.click();
  if (!(await widget.isVisible())) await button.click();
  await widget.getByRole("button", { name: "Rectangle", exact: true }).click();
}

async function capture(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  await window.screenshot({ path: testInfo.outputPath(name) });
}

async function expectRawSvCoalescing(
  window: Page,
  workspace: Locator,
  picker: Locator,
): Promise<void> {
  const field = picker.getByTestId("color-sv-field");
  const bounds = await field.boundingBox();
  if (bounds === null) throw new Error("SV field is not measurable.");
  await window.mouse.move(bounds.x + 20, bounds.y + 20);
  await window.mouse.down();
  await nextPaint(window);
  const renderCountBeforeRaw = Number(await workspace.getAttribute("data-render-count"));
  const renderCountAfterRawTask = await field.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (let index = 0; index < 120; index += 1) {
      element.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          pointerId: 1,
          clientX: bounds.left + 1 + (index % Math.max(1, Math.floor(bounds.width - 2))),
          clientY: bounds.top + 1 + (index % Math.max(1, Math.floor(bounds.height - 2))),
        }),
      );
    }
    return Number(
      element.closest<HTMLElement>('[data-testid="editor-workspace"]')?.dataset.renderCount,
    );
  });
  expect(renderCountAfterRawTask).toBe(renderCountBeforeRaw);
  await nextPaint(window);
  expect(Number(await workspace.getAttribute("data-render-count"))).toBeLessThanOrEqual(
    renderCountBeforeRaw + 1,
  );
  await window.mouse.up();
  await nextPaint(window);
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

/**
 * A screen point inside the given page rectangle that a floating surface is
 * not covering, so an outside click lands on the artwork it is aimed at.
 */
async function firstUncoveredPagePoint(
  window: Page,
  surface: Locator,
  pageToScreen: (x: number, y: number) => { x: number; y: number },
  rect: Readonly<{ left: number; top: number; right: number; bottom: number }>,
): Promise<{ x: number; y: number }> {
  const covered = await surface.boundingBox();
  const steps = 8;
  for (let row = 1; row < steps; row += 1) {
    for (let column = 1; column < steps; column += 1) {
      const point = pageToScreen(
        rect.left + ((rect.right - rect.left) * column) / steps,
        rect.top + ((rect.bottom - rect.top) * row) / steps,
      );
      if (
        covered === null ||
        point.x < covered.x ||
        point.y < covered.y ||
        point.x > covered.x + covered.width ||
        point.y > covered.y + covered.height
      ) {
        return point;
      }
    }
  }
  throw new Error("The floating surface covers the whole target rectangle.");
}
