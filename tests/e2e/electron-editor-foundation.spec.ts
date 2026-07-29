import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("switches tools without remounting and supports styled ink, highlighter, and eraser History", async () => {
  test.setTimeout(60_000);
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
    await expect(surface).toHaveAttribute("data-tool-registry-size", "8");
    await inkCanvas.evaluate((canvas) => {
      canvas.dataset.phase14LifecycleToken = "mounted-once";
    });

    for (let index = 0; index < 8; index += 1) {
      await window.getByRole("button", { name: "Pen", exact: true }).click();
      await window.getByRole("button", { name: "Highlighter", exact: true }).click();
      await window.getByRole("button", { name: "Eraser", exact: true }).click();
      await window.getByRole("button", { name: "Select", exact: true }).click();
    }
    await expect(inkCanvas).toHaveAttribute("data-phase14-lifecycle-token", "mounted-once");
    await expect(inkCanvas).toHaveAttribute("data-ink-path-build-count", "0");

    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);
    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await window.getByRole("button", { name: "Use color #2563eb" }).click();
    await window.getByRole("combobox", { name: "Stroke width" }).selectOption("8");
    await setRange(window.getByRole("slider", { name: "Stroke opacity" }), 0.8);
    await drawPath(window, pageToScreen, [
      { x: 120, y: 180 },
      { x: 190, y: 190 },
      { x: 260, y: 175 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect(await strokeStyles(surface)).toMatchObject([
      { color: "#2563eb", width: 8, opacity: 0.8, pressureEnabled: true },
    ]);

    await window.getByRole("button", { name: "Use color #dc2626" }).click();
    await window.getByRole("combobox", { name: "Stroke width" }).selectOption("4");
    await drawPath(window, pageToScreen, [
      { x: 120, y: 260 },
      { x: 190, y: 270 },
      { x: 260, y: 255 },
    ]);
    const penStyles = await strokeStyles(surface);
    expect(penStyles[0]).toMatchObject({ color: "#2563eb", width: 8, opacity: 0.8 });
    expect(penStyles[1]).toMatchObject({ color: "#dc2626", width: 4, opacity: 0.8 });

    await window.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "highlighter");
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.34");
    await drawPath(window, pageToScreen, [
      { x: 110, y: 340 },
      { x: 200, y: 340 },
      { x: 290, y: 340 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    expect((await strokeStyles(surface))[2]).toMatchObject({
      color: "#facc15",
      width: 12,
      opacity: 0.34,
      pressureEnabled: false,
    });
    expect(await attributeNumber(inkCanvas, "data-ink-path-build-count")).toBe(3);

    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(200, 340)));
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await window.mouse.move(...pointTuple(pageToScreen(190, 180)));
    await window.mouse.down();
    await window.mouse.move(...pointTuple(pageToScreen(190, 260)), { steps: 20 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    expect(await attributeNumber(inkCanvas, "data-ink-path-build-count")).toBe(3);
    await expect(inkCanvas).toHaveAttribute("data-ink-path-mode", "adaptive-error-fit-bezier");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

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
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
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

async function setRange(locator: Locator, value: number): Promise<void> {
  await locator.fill(String(value));
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface StrokeStyleDiagnostic {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly pressureEnabled: boolean;
}
