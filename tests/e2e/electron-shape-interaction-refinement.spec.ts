import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("refines overlap selection and line endpoint editing without changing the interaction model", async () => {
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
    const host = window.getByTestId("canvas-host");
    const surface = window.getByTestId("canvas-surface");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const interactionCanvas = host.locator("canvas[data-folio-layer='vector-interaction']");
    const measurement = host.locator('[aria-hidden="true"][data-shape-measurement]');
    const cursorHint = host.locator("[data-overlap-selection-hint]");
    const contextHint = window.getByTestId("context-hint");
    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);

    await chooseShape(window, "Rectangle");
    await drawShape(window, pageToScreen(200, 200), pageToScreen(400, 400));
    const rectangleId = await requiredAttribute(surface, "data-last-created-shape-id");
    await chooseShape(window, "Ellipse");
    await drawShape(window, pageToScreen(250, 250), pageToScreen(350, 350));
    const ellipseId = await requiredAttribute(surface, "data-last-created-shape-id");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await expect(contextHint).toHaveAttribute("data-context-hint-tool", "Select");
    await expect(contextHint).toContainText("Tip: Alt + Click → Select object beneath");
    await expect(cursorHint).toHaveCount(0);
    const overlap = pageToScreen(300, 300);
    await window.mouse.move(overlap.x, overlap.y);
    await expect(interactionCanvas).toHaveAttribute("data-hovered-object-id", ellipseId);
    await window.mouse.click(overlap.x, overlap.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", ellipseId);

    await window.keyboard.down("Alt");
    await expect(surface).toHaveAttribute("data-selected-object-id", ellipseId);
    await expect(surface).toHaveAttribute("data-overlap-candidate-count", "2");
    await expect(surface).toHaveAttribute("data-overlap-candidate-id", rectangleId);
    await expect(interactionCanvas).toHaveAttribute("data-hovered-object-id", rectangleId);
    await expect(interactionCanvas).toHaveAttribute("data-vector-hover-presentation", "candidate");
    await expect(cursorHint).toHaveCount(0);

    await window.mouse.click(overlap.x, overlap.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangleId);
    await expect(surface).toHaveAttribute("data-overlap-candidate-id", ellipseId);
    await window.mouse.click(overlap.x, overlap.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", ellipseId);
    await expect(surface).toHaveAttribute("data-overlap-candidate-id", rectangleId);
    await window.keyboard.up("Alt");
    await expect(cursorHint).toHaveCount(0);
    await expect(interactionCanvas).toHaveAttribute("data-hovered-object-id", ellipseId);
    await window.keyboard.down("Alt");
    await expect(cursorHint).toHaveCount(0);
    await window.keyboard.up("Alt");

    await chooseShape(window, "Line");
    const linePageStart = { x: 480, y: 620 };
    const linePageEnd = { x: 650, y: 690 };
    const linePageTarget = { x: 710, y: 790 };
    const lineStart = pageToScreen(linePageStart.x, linePageStart.y);
    const lineEnd = pageToScreen(linePageEnd.x, linePageEnd.y);
    await drawShape(window, lineStart, lineEnd);
    await expect(surface).toHaveAttribute("data-selected-object-type", "line");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    const historyBeforeEndpoint = Number(await surface.getAttribute("data-history-undo-depth"));
    await window.mouse.move(lineEnd.x, lineEnd.y);
    await expect(interactionCanvas).toHaveAttribute("data-line-handle-hover", "end");
    await expect(inkCanvas).toHaveCSS("cursor", "crosshair");

    const endpointTarget = pageToScreen(linePageTarget.x, linePageTarget.y);
    await window.mouse.down();
    await window.mouse.move(endpointTarget.x, endpointTarget.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-line-endpoint-interaction", "dragging");
    await expect(interactionCanvas).toHaveAttribute("data-active-line-endpoint", "end");
    await expect(measurement).toHaveAttribute("data-shape-measurement", "visible");
    await expect(measurement).toContainText("Length:");
    await expect(measurement).toContainText("Angle:");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-line-endpoint-interaction", "idle");
    await expect(measurement).toHaveAttribute("data-shape-measurement", "hidden");
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeEndpoint + 1),
    );

    const endpointTransform = await selectedTransform(surface);
    const endpointGeometry = transformedLine(linePageStart, linePageEnd, endpointTransform);
    expect(endpointGeometry.start.x).toBeCloseTo(linePageStart.x, 2);
    expect(endpointGeometry.start.y).toBeCloseTo(linePageStart.y, 2);
    expect(endpointGeometry.end.x).toBeCloseTo(linePageTarget.x, 2);
    expect(endpointGeometry.end.y).toBeCloseTo(linePageTarget.y, 2);

    await window.keyboard.press("Control+Z");
    expect(await selectedTransform(surface)).toEqual({ x: 0, y: 0, rotation: 0, scale: 1 });
    await window.keyboard.press("Control+Y");
    const restoredTransform = await selectedTransform(surface);
    expect(restoredTransform.x).toBeCloseTo(endpointTransform.x);
    expect(restoredTransform.y).toBeCloseTo(endpointTransform.y);
    expect(restoredTransform.rotation).toBeCloseTo(endpointTransform.rotation);
    expect(restoredTransform.scale).toBeCloseTo(endpointTransform.scale);

    const midpoint = {
      x: (endpointGeometry.start.x + endpointGeometry.end.x) / 2,
      y: (endpointGeometry.start.y + endpointGeometry.end.y) / 2,
    };
    const midpointScreen = pageToScreen(midpoint.x, midpoint.y);
    const midpointTarget = pageToScreen(midpoint.x + 40, midpoint.y + 25);
    await window.mouse.move(midpointScreen.x, midpointScreen.y);
    await expect(interactionCanvas).toHaveAttribute("data-line-handle-hover", "midpoint");
    await expect(inkCanvas).toHaveCSS("cursor", "grab");
    await window.mouse.down();
    await window.mouse.move(midpointTarget.x, midpointTarget.y, { steps: 6 });
    await window.mouse.up();
    const translatedGeometry = transformedLine(
      linePageStart,
      linePageEnd,
      await selectedTransform(surface),
    );
    expect(translatedGeometry.start.x - endpointGeometry.start.x).toBeCloseTo(40, 2);
    expect(translatedGeometry.start.y - endpointGeometry.start.y).toBeCloseTo(25, 2);
    expect(translatedGeometry.end.x - endpointGeometry.end.x).toBeCloseTo(40, 2);
    expect(translatedGeometry.end.y - endpointGeometry.end.y).toBeCloseTo(25, 2);
    expect(lineLength(translatedGeometry)).toBeCloseTo(lineLength(endpointGeometry), 5);
    expect(lineAngle(translatedGeometry)).toBeCloseTo(lineAngle(endpointGeometry), 5);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function chooseShape(window: Page, shape: "Line" | "Rectangle" | "Ellipse"): Promise<void> {
  await window.getByRole("button", { name: "Shapes", exact: true }).click();
  await window.getByTestId("shapes-widget").getByRole("button", { name: shape }).click();
}

async function drawShape(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 6 });
  await window.mouse.up();
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
  if (bounds === null) throw new Error("Canvas has no visible bounds.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return (x: number, y: number) => ({
    x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
    y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
  });
}

async function requiredAttribute(locator: Locator, name: string): Promise<string> {
  const value = await locator.getAttribute(name);
  if (value === null || value.length === 0) throw new Error(`${name} is unavailable.`);
  return value;
}

async function selectedTransform(surface: Locator): Promise<TransformDiagnostic> {
  return {
    x: Number(await surface.getAttribute("data-selected-object-translation-x")),
    y: Number(await surface.getAttribute("data-selected-object-translation-y")),
    rotation: Number(await surface.getAttribute("data-selected-object-rotation")),
    scale: Number(await surface.getAttribute("data-selected-object-scale")),
  };
}

function transformedLine(start: Point, end: Point, transform: TransformDiagnostic): LineDiagnostic {
  const pivot = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const apply = (point: Point): Point => {
    const localX = (point.x - pivot.x) * transform.scale;
    const localY = (point.y - pivot.y) * transform.scale;
    return {
      x:
        pivot.x +
        transform.x +
        localX * Math.cos(transform.rotation) -
        localY * Math.sin(transform.rotation),
      y:
        pivot.y +
        transform.y +
        localX * Math.sin(transform.rotation) +
        localY * Math.cos(transform.rotation),
    };
  };
  return { start: apply(start), end: apply(end) };
}

function lineLength(line: LineDiagnostic): number {
  return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
}

function lineAngle(line: LineDiagnostic): number {
  return Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TransformDiagnostic {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}

interface LineDiagnostic {
  readonly start: Point;
  readonly end: Point;
}
