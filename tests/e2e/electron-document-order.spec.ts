import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("renders every PageObject in one creation-ordered document stack", async () => {
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
    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);
    const createdIds: string[] = [];

    for (const stroke of [
      {
        color: "#ef4444",
        points: [
          { x: 430, y: 500 },
          { x: 670, y: 500 },
        ],
      },
      {
        color: "#22c55e",
        points: [
          { x: 550, y: 380 },
          { x: 550, y: 620 },
        ],
      },
      {
        color: "#2563eb",
        points: [
          { x: 450, y: 400 },
          { x: 650, y: 600 },
        ],
      },
    ] as const) {
      await selectDrawingColor(window, stroke.color);
      await drawPath(window, pageToScreen, stroke.points);
      createdIds.push(await newestRenderedObjectId(surface, createdIds.length + 1));
    }

    for (const shape of [
      {
        type: "Rectangle",
        color: "#f97316",
        start: { x: 450, y: 400 },
        end: { x: 650, y: 600 },
      },
      {
        type: "Ellipse",
        color: "#9333ea",
        start: { x: 450, y: 400 },
        end: { x: 650, y: 600 },
      },
      {
        type: "Line",
        color: "#0891b2",
        start: { x: 430, y: 500 },
        end: { x: 670, y: 500 },
      },
    ] as const) {
      await selectDrawingColor(window, shape.color);
      await chooseShape(window, shape.type);
      await drawPath(window, pageToScreen, [shape.start, shape.end]);
      const objectId = await requiredAttribute(surface, "data-last-created-shape-id");
      createdIds.push(objectId);
      await expectRenderedOrder(surface, createdIds);
    }

    for (const stroke of [
      {
        color: "#db2777",
        points: [
          { x: 550, y: 370 },
          { x: 550, y: 630 },
        ],
      },
      {
        color: "#111111",
        points: [
          { x: 420, y: 490 },
          { x: 680, y: 510 },
        ],
      },
    ] as const) {
      await selectDrawingColor(window, stroke.color);
      await drawPath(window, pageToScreen, stroke.points);
      createdIds.push(await newestRenderedObjectId(surface, createdIds.length + 1));
    }

    await expectRenderedOrder(surface, createdIds);
    await expect(surface).toHaveAttribute("data-document-object-count", "8");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "5");
    await expect(inkCanvas).toHaveAttribute("data-ink-finalized-presentation", "external");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function selectDrawingColor(window: Page, color: string): Promise<void> {
  const penButton = window.getByRole("button", { name: "Pen", exact: true });
  const colorInput = window.getByLabel("Custom stroke color");
  await penButton.click();
  if (!(await colorInput.isVisible())) await penButton.click();
  await colorInput.fill(color);
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute("data-drawing-color", color);
  const host = window.getByTestId("canvas-host");
  const bounds = await host.boundingBox();
  if (bounds === null) throw new Error("Canvas host has no visible bounds.");
  await window.mouse.click(bounds.x + bounds.width - 24, bounds.y + 24);
  await expect(window.getByTestId("tool-options-widget")).toHaveCount(0);
}

async function chooseShape(window: Page, shape: "Line" | "Rectangle" | "Ellipse"): Promise<void> {
  const button = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await button.click();
  if (!(await widget.isVisible())) await button.click();
  await widget.getByRole("button", { name: shape }).click();
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
    await window.mouse.move(...pointTuple(pageToScreen(point.x, point.y)), { steps: 6 });
  }
  await window.mouse.up();
}

async function newestRenderedObjectId(surface: Locator, expectedCount: number): Promise<string> {
  await expect
    .poll(async () => renderedObjectOrder(surface).then(({ length }) => length))
    .toBe(expectedCount);
  const objectId = (await renderedObjectOrder(surface)).at(-1);
  if (objectId === undefined) throw new Error("Rendered object order is empty.");
  return objectId;
}

async function expectRenderedOrder(surface: Locator, expected: readonly string[]): Promise<void> {
  await expect.poll(() => renderedObjectOrder(surface)).toEqual(expected);
}

async function renderedObjectOrder(surface: Locator): Promise<readonly string[]> {
  return JSON.parse(
    (await surface.getAttribute("data-rendered-object-order")) ?? "[]",
  ) as readonly string[];
}

async function requiredAttribute(locator: Locator, name: string): Promise<string> {
  const value = await locator.getAttribute(name);
  if (value === null || value.length === 0) throw new Error(`${name} is unavailable.`);
  return value;
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

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}

interface Point {
  readonly x: number;
  readonly y: number;
}
