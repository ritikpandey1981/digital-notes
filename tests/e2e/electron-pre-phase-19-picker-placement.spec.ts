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

test("keeps the responsive color picker clear of minimum-window chrome and selected artwork", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(90_000);
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
    await window.setViewportSize({ width: 960, height: 640 });

    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const workspace = window.getByTestId("editor-workspace");
    const topBar = window.getByTestId("sketchbook-top-bar");
    const viewportControls = window.getByTestId("viewport-controls");
    const rail = window.getByTestId("quick-color-rail");
    const picker = window.getByTestId("full-color-picker");

    await activateDockSlot(window, "pencil");
    await rail.getByTestId("quick-color-more").click();
    await expect(picker).toHaveAttribute("data-picker-source", "quick-rail");
    await expectMinimumWindowPlacement(picker, workspace, topBar, viewportControls, rail);

    const scrollRegion = picker.getByTestId("full-color-picker-scroll-region");
    const scrollMetrics = await scrollRegion.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await expect(picker.getByTestId("color-sv-field")).toBeVisible();
    await expect(picker.getByRole("slider", { name: /Hue/u })).toBeVisible();
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await expect(hex).toBeVisible();

    await hex.focus();
    for (let index = 0; index < 4; index += 1) await window.keyboard.press("Tab");
    const paletteTrigger = picker.getByTestId("color-palette-trigger");
    await expect(paletteTrigger).toBeFocused();
    const paletteSwatches = picker.getByRole("button", { name: /^Use color #/u });
    const paletteSwatchCount = await paletteSwatches.count();
    expect(paletteSwatchCount).toBeGreaterThan(0);
    for (let index = 0; index < paletteSwatchCount; index += 1) {
      await window.keyboard.press("Tab");
    }
    await expect(paletteSwatches.last()).toBeFocused();
    expect(await scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await capture(window, testInfo, "01-minimum-window-picker.png");
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await chooseRectangle(window);
    const rectangleStart = await pageToScreen(surface, host, { x: 230, y: 260 });
    const rectangleEnd = await pageToScreen(surface, host, { x: 570, y: 500 });
    await drawGesture(window, rectangleStart, rectangleEnd);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    const historyBeforePreview = Number(await surface.getAttribute("data-history-undo-depth"));
    const originalColor = await selectedVectorColor(surface);

    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    await expect(picker).toHaveAttribute("data-picker-source", "selected-vector");
    await expectSelectedArtworkAvoidance(window, picker);
    expect(overlapArea(await requiredBox(picker), await requiredBox(rail))).toBe(0);

    await picker.getByTestId("color-sv-field").click({ position: { x: 190, y: 70 } });
    await expect.poll(() => selectedVectorColor(surface)).not.toBe(originalColor);
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(
      historyBeforePreview,
    );
    await expectSelectedArtworkAvoidance(window, picker);
    await capture(window, testInfo, "02-selected-rectangle-avoidance.png");

    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect.poll(() => selectedVectorColor(surface)).toBe(originalColor);
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(
      historyBeforePreview,
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function expectMinimumWindowPlacement(
  picker: Locator,
  workspace: Locator,
  topBar: Locator,
  viewportControls: Locator,
  rail: Locator,
): Promise<void> {
  const [pickerBox, workspaceBox, topBarBox, viewportControlsBox, railBox] = await Promise.all([
    requiredBox(picker),
    requiredBox(workspace),
    requiredBox(topBar),
    requiredBox(viewportControls),
    requiredBox(rail),
  ]);
  expectInside(pickerBox, workspaceBox);
  expect(overlapArea(pickerBox, topBarBox)).toBe(0);
  expect(overlapArea(pickerBox, viewportControlsBox)).toBe(0);
  expect(overlapArea(pickerBox, railBox)).toBe(0);
  expect(await picker.getAttribute("data-picker-maximum-height")).not.toBeNull();
}

async function expectSelectedArtworkAvoidance(window: Page, picker: Locator): Promise<void> {
  const pickerBox = await requiredBox(picker);
  const avoidRect = await picker.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      x: Number(data.pickerAvoidLeft),
      y: Number(data.pickerAvoidTop),
      width: Number(data.pickerAvoidWidth),
      height: Number(data.pickerAvoidHeight),
    };
  });
  expect(Object.values(avoidRect).every(Number.isFinite)).toBe(true);
  expect(overlapArea(pickerBox, avoidRect)).toBe(0);
  expect(
    await window.evaluate(
      ({ x, y }) => {
        return (
          document.elementFromPoint(x, y)?.closest('[data-testid="full-color-picker"]') === null
        );
      },
      {
        x: avoidRect.x + avoidRect.width / 2,
        y: avoidRect.y + avoidRect.height / 2,
      },
    ),
  ).toBe(true);
}

async function chooseRectangle(window: Page): Promise<void> {
  const shapes = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await shapes.click();
  if (!(await widget.isVisible())) await shapes.click();
  await widget.getByRole("button", { name: "Rectangle", exact: true }).click();
}

async function pageToScreen(
  surface: Locator,
  host: Locator,
  point: Readonly<{ x: number; y: number }>,
) {
  const canvas = host.locator("canvas[data-folio-layer='ink']");
  const bounds = await requiredBox(canvas);
  const metrics = await surface.evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      pageX: Number(data.viewportPageX),
      pageY: Number(data.viewportPageY),
      zoom: Number(data.viewportZoom),
      viewportWidth: Number(data.viewportWidth),
      viewportHeight: Number(data.viewportHeight),
    };
  });
  return {
    x: bounds.x + (metrics.pageX + point.x * metrics.zoom) * (bounds.width / metrics.viewportWidth),
    y:
      bounds.y +
      (metrics.pageY + point.y * metrics.zoom) * (bounds.height / metrics.viewportHeight),
  };
}

async function drawGesture(
  window: Page,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 12 });
  await window.mouse.up();
}

async function selectedVectorColor(surface: Locator): Promise<string | undefined> {
  const styles = JSON.parse(
    (await surface.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as readonly { color: string }[];
  return styles[0]?.color;
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected a measurable element.");
  return box;
}

function expectInside(
  inner: Readonly<{ x: number; y: number; width: number; height: number }>,
  outer: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
}

function overlapArea(
  first: Readonly<{ x: number; y: number; width: number; height: number }>,
  second: Readonly<{ x: number; y: number; width: number; height: number }>,
): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

async function capture(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  await window.screenshot({ path: testInfo.outputPath(name) });
}
