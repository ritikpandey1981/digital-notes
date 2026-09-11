import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";
import { clearOfWorkspaceSurfaces } from "./workspace-geometry";

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
    await expect(surface).toHaveAttribute("data-tool-registry-size", "11");
    await expect(window.locator('button[data-dock-slot="pencil"]')).toBeVisible();
    await expect(window.locator('button[data-dock-slot="marker"]')).toBeVisible();
    await inkCanvas.evaluate((canvas) => {
      canvas.dataset.phase14LifecycleToken = "mounted-once";
    });

    for (let index = 0; index < 8; index += 1) {
      await activateDockSlot(window, "pen");
      await activateDockSlot(window, "highlighter");
      await window.getByRole("button", { name: "Eraser", exact: true }).click();
      await window.getByRole("button", { name: "Select", exact: true }).click();
    }
    await expect(inkCanvas).toHaveAttribute("data-phase14-lifecycle-token", "mounted-once");
    await expect(inkCanvas).toHaveAttribute("data-ink-path-build-count", "0");

    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);
    await openSlotToolOptions(window, "pen");
    await window.getByRole("button", { name: "Use color #2563eb" }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "8");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "80");
    // Every gesture below moves together by one derived offset, so the strokes
    // stay where the eraser later has to cross them. The offset exists because
    // the open Tool Options palette covers part of the page, and how much of
    // it depends on the window: these page coordinates used to clear the
    // palette by a few pixels and no longer do at a taller workspace.
    const gesturePoints = [
      { x: 120, y: 180 },
      { x: 260, y: 175 },
      { x: 120, y: 260 },
      { x: 260, y: 255 },
      { x: 110, y: 340 },
      { x: 290, y: 340 },
      { x: 190, y: 180 },
      { x: 190, y: 260 },
    ] as const;
    const cleared = await clearOfWorkspaceSurfaces(window, pageToScreen, gesturePoints);
    const shift = cleared[0]!.x - gesturePoints[0]!.x;
    const at = (x: number, y: number): Point => pageToScreen(x + shift, y);

    await drawPath(window, at, [
      { x: 120, y: 180 },
      { x: 190, y: 190 },
      { x: 260, y: 175 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect(await strokeStyles(surface)).toMatchObject([
      { color: "#2563eb", width: 8, opacity: 0.8, pressureEnabled: false },
    ]);
    expect(await strokeBrushes(surface)).toMatchObject([
      {
        presetId: "pen-fineliner",
        presetVersion: 1,
        family: "pen",
        rendererKind: "centerline",
        pointerType: "mouse",
        size: 8,
        opacity: 0.8,
      },
    ]);

    // Exercise real workspace rerenders after artwork exists: the supplied session
    // and its History must survive, along with the already-mounted canvas stack.
    const rendersBefore = await attributeNumber(host, "data-render-count");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await activateDockSlot(window, "pen");
    expect(await attributeNumber(host, "data-render-count")).toBeGreaterThan(rendersBefore);
    await expect(inkCanvas).toHaveAttribute("data-phase14-lifecycle-token", "mounted-once");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    await openSlotToolOptions(window, "pen");
    await window.getByRole("button", { name: "Use color #dc2626" }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "4");
    await drawPath(window, at, [
      { x: 120, y: 260 },
      { x: 190, y: 270 },
      { x: 260, y: 255 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    const penStyles = await strokeStyles(surface);
    expect(penStyles[0]).toMatchObject({ color: "#2563eb", width: 8, opacity: 0.8 });
    expect(penStyles[1]).toMatchObject({ color: "#dc2626", width: 4, opacity: 0.8 });
    expect(await strokeBrushes(surface)).toMatchObject([
      { presetId: "pen-fineliner", family: "pen", size: 8, opacity: 0.8 },
      { presetId: "pen-fineliner", family: "pen", size: 4, opacity: 0.8 },
    ]);

    await activateDockSlot(window, "highlighter");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "highlighter");
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.34");
    await drawPath(window, at, [
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
    expect((await strokeBrushes(surface))[2]).toMatchObject({
      presetId: "highlighter-default",
      presetVersion: 1,
      family: "highlighter",
      rendererKind: "centerline",
      size: 12,
      opacity: 0.34,
    });
    expect(await attributeNumber(inkCanvas, "data-ink-path-build-count")).toBe(3);

    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.click(...pointTuple(at(200, 340)));
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "4");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await window.mouse.move(...pointTuple(at(190, 180)));
    await window.mouse.down();
    await window.mouse.move(...pointTuple(at(190, 260)), { steps: 20 });
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

async function strokeBrushes(locator: Locator): Promise<readonly StrokeBrushDiagnostic[]> {
  return JSON.parse(
    (await locator.getAttribute("data-document-stroke-brushes")) ?? "[]",
  ) as readonly StrokeBrushDiagnostic[];
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
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

interface StrokeBrushDiagnostic {
  readonly presetId: string;
  readonly presetVersion: number;
  readonly family: "pencil" | "pen" | "marker" | "highlighter";
  readonly rendererKind: "centerline" | "outline";
  readonly size: number;
  readonly opacity: number;
}
