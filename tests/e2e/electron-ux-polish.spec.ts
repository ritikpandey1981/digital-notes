import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("keeps a fixed Tool Dock and persistent professional Context Palette workflow", async () => {
  test.setTimeout(75_000);
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
    await window.setViewportSize({ width: 1_440, height: 900 });

    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const palette = window.getByTestId("context-tool-palette");
    await expect(toolDock).toBeVisible();
    await expect(palette).toHaveCount(0);
    await inkCanvas.evaluate((canvas) => {
      canvas.dataset.phase141LifecycleToken = "mounted-once";
    });

    const initialDock = await dockMetrics(toolDock);
    expect(initialDock.width).toBe(48);
    expect(initialDock.height).toBe(420);
    expect(initialDock.scrollHeight).toBeLessThanOrEqual(initialDock.clientHeight);
    expect(initialDock.overflowY).not.toBe("auto");
    expect(initialDock.overflowY).not.toBe("scroll");

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await palette.evaluate((element) => {
      element.dataset.mountToken = "persistent-options-container";
    });
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Highlighter");
    await expect(palette).toHaveAttribute("data-mount-token", "persistent-options-container");
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await chooseColor(window, "#2563eb");
    await expectRecentlyUsedColor(window, "#2563eb", false);
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "5.8");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "63");
    await expect(surface).toHaveAttribute("data-drawing-width", "5.8");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.63");
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-width",
      "5.8",
    );
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-opacity",
      "0.63",
    );
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-renderer",
      "canvas2d-bezier",
    );
    await expect(palette.locator("svg")).toHaveCount(0);
    const previewMetrics = await window
      .getByRole("img", { name: "Pen stroke preview" })
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return {
          physicalWidth: canvas.width,
          physicalHeight: canvas.height,
          dpr: window.devicePixelRatio,
        };
      });
    expect(previewMetrics.physicalWidth).toBe(Math.round(278 * previewMetrics.dpr));
    expect(previewMetrics.physicalHeight).toBe(Math.round(64 * previewMetrics.dpr));

    const widthSlider = window.getByRole("slider", { name: "Width" });
    await widthSlider.focus();
    await widthSlider.press("ArrowRight");
    await expect(surface).toHaveAttribute("data-drawing-width", "5.9");
    await widthSlider.press("Shift+ArrowRight");
    await expect(surface).toHaveAttribute("data-drawing-width", "6.9");
    await window
      .locator('[data-tool-option="strokeWidth"]')
      .dispatchEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    await expect(surface).toHaveAttribute("data-drawing-width", "7");
    await window.locator('[data-tool-option="strokeWidth"]').dblclick();
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "5.8");

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveAttribute("data-mount-token", "persistent-options-container");
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("12");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("34");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "13.7");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "100");
    await expect(surface).toHaveAttribute("data-drawing-width", "13.7");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.45");
    await expect(window.getByRole("img", { name: "Highlighter stroke preview" })).toHaveAttribute(
      "data-preview-opacity",
      "0.45",
    );

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("5.8");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("63");

    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);
    await drawPath(window, pageToScreen, [
      { x: 120, y: 180 },
      { x: 180, y: 190 },
      { x: 240, y: 180 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expectRecentlyUsedColor(window, "#2563eb", true);

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await drawPath(window, pageToScreen, [
      { x: 110, y: 280 },
      { x: 200, y: 280 },
      { x: 290, y: 280 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    expect((await strokeStyles(surface))[1]).toMatchObject({
      width: 13.7,
      opacity: 0.45,
      pressureEnabled: false,
    });

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await expect(palette).toHaveCount(1);
    await expect(palette).toHaveCount(0, { timeout: 1_000 });
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await palette.evaluate((element) => {
      element.dataset.secondMountToken = "stable-across-configurable-tools";
    });
    for (let index = 0; index < 8; index += 1) {
      await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
      await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    }
    await expect(palette).toHaveAttribute(
      "data-second-mount-token",
      "stable-across-configurable-tools",
    );
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");

    const objectCountBeforeReloadShortcut = await surface.getAttribute(
      "data-document-object-count",
    );
    await window.keyboard.press("Control+R");
    await window.waitForTimeout(300);
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      objectCountBeforeReloadShortcut ?? "",
    );

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    await window.setViewportSize({ width: 960, height: 720 });
    const compactDock = await dockMetrics(toolDock);
    expect(compactDock).toEqual(initialDock);
    expect(compactDock.scrollHeight).toBeLessThanOrEqual(compactDock.clientHeight);
    await expect(palette).toBeVisible();
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function chooseColor(window: Page, color: string): Promise<void> {
  await window.getByRole("button", { name: `Use color ${color}` }).click();
}

async function expectRecentlyUsedColor(
  window: Page,
  color: string,
  expected: boolean,
): Promise<void> {
  const recentColor = window.getByRole("button", { name: `Use recent color ${color}` });
  if (expected) await expect(recentColor).toBeVisible();
  else await expect(recentColor).toHaveCount(0);
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function dockMetrics(toolDock: Locator): Promise<DockMetrics> {
  return toolDock.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const workspace = element.closest('[aria-label="Notebook workspace"]');
    if (workspace === null) throw new Error("Tool Dock is outside the editor workspace.");
    const workspaceBounds = workspace.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: styles.overflowY,
      workspaceOffsetX: bounds.x - workspaceBounds.x,
      workspaceCenterOffsetY:
        bounds.y + bounds.height / 2 - (workspaceBounds.y + workspaceBounds.height / 2),
    };
  });
}

async function pageCoordinateMapper(
  baseCanvas: Locator,
  inkCanvas: Locator,
  surface: Locator,
): Promise<(x: number, y: number) => Point> {
  await expect(baseCanvas).toBeVisible();
  const metrics = await baseCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      logicalWidth: Number(canvas.dataset.logicalWidth),
      logicalHeight: Number(canvas.dataset.logicalHeight),
      pageX: Number(canvas.dataset.pageX),
      pageY: Number(canvas.dataset.pageY),
    };
  });
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return (x: number, y: number) => ({
    x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
    y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
  });
}

async function drawPath(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  points: readonly Point[],
): Promise<void> {
  const first = points[0];
  if (first === undefined) return;
  await window.mouse.move(...pointTuple(pageToScreen(first.x, first.y)));
  await window.mouse.down();
  for (const point of points.slice(1)) {
    await window.mouse.move(...pointTuple(pageToScreen(point.x, point.y)), { steps: 4 });
  }
  await window.mouse.up();
}

async function strokeStyles(locator: Locator): Promise<readonly StrokeStyleDiagnostic[]> {
  return JSON.parse(
    (await locator.getAttribute("data-document-stroke-styles")) ?? "[]",
  ) as readonly StrokeStyleDiagnostic[];
}

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}

interface DockMetrics {
  readonly width: number;
  readonly height: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly overflowY: string;
  readonly workspaceOffsetX: number;
  readonly workspaceCenterOffsetY: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface StrokeStyleDiagnostic {
  readonly width: number;
  readonly opacity: number;
  readonly pressureEnabled: boolean;
}
