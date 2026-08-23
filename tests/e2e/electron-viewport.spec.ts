import path from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";

test("provides live zoom controls, anchored zoom, transient pan, and mode-aware resize", async () => {
  test.setTimeout(90_000);
  const { electronApp, window } = await launchFolio();

  try {
    await window.setViewportSize({ width: 1_440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const controls = window.getByTestId("viewport-controls");
    const inkCanvas = window.locator("canvas[data-folio-layer='ink']");
    const contextHint = window.getByTestId("context-hint");
    await expect(controls).toBeVisible();
    await expect
      .poll(async () => Number(await controls.getAttribute("data-viewport-zoom")))
      .toBeGreaterThan(0.25);
    expect(await controls.textContent()).toContain(
      `${Math.round((await attributeNumber(surface, "data-viewport-zoom")) * 100)}%`,
    );
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");

    const zoomMenuTrigger = window.getByRole("button", { name: /^Zoom options,/ });
    await zoomMenuTrigger.click();
    const navigationShortcuts = window.getByTestId("viewport-navigation-shortcuts");
    await expect(navigationShortcuts).toContainText("Move canvas");
    await expect(navigationShortcuts).toContainText("Space + Drag");
    await expect(navigationShortcuts).not.toContainText("Middle Drag");
    await expect(navigationShortcuts).toContainText("Ctrl + Wheel");
    await expect(navigationShortcuts).toContainText("Wheel / Trackpad");
    if (process.env.FOLIO_FOLLOWUP_VISUAL_QA === "1") {
      await window.screenshot({
        path: path.join(process.cwd(), "test-results", "followup-viewport-menu.png"),
      });
    }
    await window.keyboard.press("Escape");
    await expect(window.getByRole("menu")).toHaveCount(0);
    await expect(zoomMenuTrigger).toBeFocused();
    await zoomMenuTrigger.click();
    await expect(window.getByRole("menu")).toBeVisible();
    await zoomMenuTrigger.click();
    await expect(window.getByRole("menu")).toHaveCount(0);

    const initialInkBounds = await inkCanvas.boundingBox();
    if (initialInkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    await zoomMenuTrigger.press("Enter");
    await expect(window.getByRole("menu")).toBeVisible();
    await window.mouse.click(initialInkBounds.x + 20, initialInkBounds.y + 20);
    await expect(window.getByRole("menu")).toHaveCount(0);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    const pageDismissPoint = await pageToScreen(surface, inkCanvas, { x: 100, y: 100 });
    await zoomMenuTrigger.click();
    await expect(window.getByRole("menu")).toBeVisible();
    await window.mouse.move(pageDismissPoint.x, pageDismissPoint.y);
    await window.mouse.down();
    await expect(window.getByRole("menu")).toHaveCount(0);
    await window.mouse.move(pageDismissPoint.x + 35, pageDismissPoint.y + 20, { steps: 3 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");

    const zoomBeforePlus = await attributeNumber(surface, "data-viewport-zoom");
    await window.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(() => attributeNumber(surface, "data-viewport-zoom"))
      .toBeGreaterThan(zoomBeforePlus);
    const zoomBeforeMinus = await attributeNumber(surface, "data-viewport-zoom");
    await window.getByRole("button", { name: "Zoom out" }).click();
    await expect
      .poll(() => attributeNumber(surface, "data-viewport-zoom"))
      .toBeLessThan(zoomBeforeMinus);

    await selectZoomMenuItem(window, "100% (Actual Size)");
    await expect(surface).toHaveAttribute("data-viewport-zoom", "1");
    await expect(surface).toHaveAttribute("data-viewport-mode", "manual");

    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    const anchor = { x: inkBounds.x + inkBounds.width * 0.62, y: inkBounds.y + 280 };
    await window.mouse.move(anchor.x, anchor.y);
    const worldBeforeZoom = await worldAtScreenPoint(surface, inkCanvas, anchor);
    const anchoredZoomBefore = await attributeNumber(surface, "data-viewport-zoom");
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, -120);
    await window.keyboard.up("Control");
    await expect
      .poll(() => attributeNumber(surface, "data-viewport-zoom"))
      .toBeGreaterThan(anchoredZoomBefore);
    const worldAfterZoom = await worldAtScreenPoint(surface, inkCanvas, anchor);
    expect(Math.abs(worldAfterZoom.x - worldBeforeZoom.x)).toBeLessThan(0.5);
    expect(Math.abs(worldAfterZoom.y - worldBeforeZoom.y)).toBeLessThan(0.5);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Hold Space + Drag → Move canvas");
    const objectCountBeforePan = await attributeNumber(surface, "data-document-object-count");
    const cameraBeforeSpacePan = await cameraPosition(surface);
    await window.mouse.move(anchor.x, anchor.y);
    await window.keyboard.down("Space");
    await expect(inkCanvas).toHaveAttribute("data-viewport-pan-state", "grab");
    await expect(inkCanvas).toHaveCSS("cursor", "grab");
    await expect(window.getByRole("menu")).toHaveCount(0);
    await window.mouse.down();
    await expect(inkCanvas).toHaveAttribute("data-viewport-pan-state", "grabbing");
    await window.mouse.move(anchor.x + 90, anchor.y + 55, { steps: 6 });
    await expect(surface).toHaveAttribute("data-navigation-teaching-learned", "true");
    await expect(contextHint).toHaveText("");
    await window.mouse.up();
    await window.keyboard.up("Space");
    await expect(inkCanvas).toHaveAttribute("data-viewport-pan-state", "idle");
    expect(await cameraPosition(surface)).not.toEqual(cameraBeforeSpacePan);
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      String(objectCountBeforePan),
    );

    const cameraBeforeMiddlePan = await cameraPosition(surface);
    await window.mouse.move(anchor.x, anchor.y);
    await window.mouse.down({ button: "middle" });
    await expect(inkCanvas).toHaveAttribute("data-viewport-pan-state", "grabbing");
    await window.mouse.move(anchor.x - 65, anchor.y + 35, { steps: 5 });
    await window.mouse.up({ button: "middle" });
    await expect(inkCanvas).toHaveAttribute("data-viewport-pan-state", "idle");
    expect(await cameraPosition(surface)).not.toEqual(cameraBeforeMiddlePan);
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      String(objectCountBeforePan),
    );

    const cameraBeforeWheelPan = await cameraPosition(surface);
    await window.mouse.wheel(45, 80);
    await expect.poll(() => cameraPosition(surface)).not.toEqual(cameraBeforeWheelPan);
    await assertPageRecoverable(surface);
    const manualCamera = await cameraPosition(surface);
    await window.setViewportSize({ width: 1_280, height: 780 });
    await expect(surface).toHaveAttribute("data-viewport-mode", "manual");
    await expect.poll(() => cameraPosition(surface)).toEqual(manualCamera);

    await selectZoomMenuItem(window, "Fit Page");
    await expect(surface).toHaveAttribute("data-viewport-mode", "fit-page");
    await assertFitPage(surface);
    const fitPageZoom = await attributeNumber(surface, "data-viewport-zoom");
    await window.setViewportSize({ width: 1_420, height: 860 });
    await expect(surface).toHaveAttribute("data-viewport-mode", "fit-page");
    await expect.poll(() => attributeNumber(surface, "data-viewport-zoom")).not.toBe(fitPageZoom);
    await assertFitPage(surface);

    await selectZoomMenuItem(window, "Fit Width");
    await expect(surface).toHaveAttribute("data-viewport-mode", "fit-width");
    await assertFitWidth(surface);
    const fitWidthZoom = await attributeNumber(surface, "data-viewport-zoom");
    await window.setViewportSize({ width: 1_300, height: 820 });
    await expect(surface).toHaveAttribute("data-viewport-mode", "fit-width");
    await expect.poll(() => attributeNumber(surface, "data-viewport-zoom")).not.toBe(fitWidthZoom);
    await assertFitWidth(surface);
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Alt + Click → Select object beneath");

    await selectZoomMenuItem(window, "100% (Actual Size)");
    await window.mouse.move(anchor.x, anchor.y);
    await window.mouse.wheel(1_000_000, 1_000_000);
    await assertPageRecoverable(surface);
    await window.mouse.wheel(-1_000_000, -1_000_000);
    await assertPageRecoverable(surface);
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
  } finally {
    await electronApp.close();
  }
});

test("keeps drawing, constraints, selection, overlap, overlays, and erasing page-correct", async () => {
  test.setTimeout(90_000);
  const { electronApp, window } = await launchFolio();

  try {
    await window.setViewportSize({ width: 1_440, height: 900 });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator("canvas[data-folio-layer='ink']");
    const selectionCanvas = window.locator("canvas[data-folio-layer='selection']");
    const vectorCanvas = window.locator("canvas[data-folio-layer='vector-interaction']");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    await selectZoomMenuItem(window, "125%");
    const pageCenter = await pageToScreen(surface, inkCanvas, { x: 397, y: 480 });
    await window.mouse.move(pageCenter.x, pageCenter.y);
    await window.mouse.wheel(-35, -70);
    await expect(surface).toHaveAttribute("data-viewport-mode", "manual");

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    const penStart = await pageToScreen(surface, inkCanvas, { x: 250, y: 300 });
    const penEnd = await pageToScreen(surface, inkCanvas, { x: 360, y: 300 });
    await drawGesture(window, penStart, penEnd);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(window.getByTestId("context-tool-palette")).toBeHidden();

    const firstRectangleId = await createConstrainedShape(
      window,
      surface,
      inkCanvas,
      "Rectangle",
      { x: 230, y: 260 },
      { x: 370, y: 350 },
    );
    const firstRectangleBounds = await selectedBounds(surface);
    expect(firstRectangleBounds.width).toBeCloseTo(firstRectangleBounds.height, 6);
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    await expect(window.getByTestId("shapes-widget")).toBeHidden();

    const secondRectangleId = await createShape(
      window,
      surface,
      inkCanvas,
      "Rectangle",
      { x: 270, y: 290 },
      { x: 410, y: 410 },
    );
    const ellipseId = await createConstrainedShape(
      window,
      surface,
      inkCanvas,
      "Ellipse",
      { x: 470, y: 300 },
      { x: 570, y: 365 },
    );
    const ellipseBounds = await selectedBounds(surface);
    expect(ellipseBounds.width).toBeCloseTo(ellipseBounds.height, 6);
    expect(ellipseId).not.toBe(secondRectangleId);

    await window.getByRole("button", { name: "Select", exact: true }).click();
    const overlap = await pageToScreen(surface, inkCanvas, { x: 300, y: 320 });
    await window.mouse.click(overlap.x, overlap.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", secondRectangleId);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    await expect(selectionCanvas).toHaveAttribute("data-selection-handles", "visible");
    await window.keyboard.down("Alt");
    await expect(surface).toHaveAttribute("data-overlap-candidate-count", "2");
    await expect(surface).toHaveAttribute("data-overlap-candidate-id", firstRectangleId);
    await window.mouse.click(overlap.x, overlap.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", firstRectangleId);
    await window.keyboard.up("Alt");

    const objectStateBeforeViewport = await requiredAttribute(
      surface,
      "data-selected-object-transforms",
    );
    const historyBeforeViewport = await attributeNumber(surface, "data-history-undo-depth");
    await window.getByRole("button", { name: "Zoom in" }).click();
    const selectedCenter = await pageToScreen(surface, inkCanvas, { x: 300, y: 320 });
    await window.mouse.move(selectedCenter.x, selectedCenter.y);
    await window.mouse.wheel(25, -40);
    await expect(surface).toHaveAttribute("data-selected-object-id", firstRectangleId);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    expect(await requiredAttribute(surface, "data-selected-object-transforms")).toBe(
      objectStateBeforeViewport,
    );
    await expect(surface).toHaveAttribute("data-history-undo-depth", String(historyBeforeViewport));

    const boundsBeforeMove = await selectedBounds(surface);
    const moveStart = await pageToScreen(surface, inkCanvas, {
      x: boundsBeforeMove.x + boundsBeforeMove.width / 2,
      y: boundsBeforeMove.y + boundsBeforeMove.height / 2,
    });
    await drawGesture(window, moveStart, { x: moveStart.x + 45, y: moveStart.y + 30 });
    await expect
      .poll(async () => (await selectedBounds(surface)).x)
      .toBeGreaterThan(boundsBeforeMove.x);
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeViewport + 1),
    );

    const lineStartPage = { x: 470, y: 500 };
    const lineEndPage = { x: 620, y: 560 };
    await createShape(window, surface, inkCanvas, "Line", lineStartPage, lineEndPage);
    await window.getByRole("button", { name: "Select", exact: true }).click();
    const lineEnd = await pageToScreen(surface, inkCanvas, lineEndPage);
    await window.mouse.move(lineEnd.x, lineEnd.y);
    await expect(vectorCanvas).toHaveAttribute("data-line-handle-hover", "end");
    await expect(vectorCanvas).toHaveAttribute("data-vector-selection-style", "line-handles");

    const vectorsBeforeErase = await attributeNumber(surface, "data-document-vector-object-count");
    const inkBeforeErase = await attributeNumber(inkCanvas, "data-document-ink-object-count");
    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    const erasePoint = await pageToScreen(surface, inkCanvas, { x: 300, y: 300 });
    await window.mouse.click(erasePoint.x, erasePoint.y);
    await expect(inkCanvas).toHaveAttribute(
      "data-document-ink-object-count",
      String(inkBeforeErase - 1),
    );
    await expect(surface).toHaveAttribute(
      "data-document-vector-object-count",
      String(vectorsBeforeErase),
    );
  } finally {
    await electronApp.close();
  }
});

async function launchFolio(): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const repositoryRoot = process.cwd();
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
  return { electronApp, window: await electronApp.firstWindow() };
}

async function selectZoomMenuItem(window: Page, name: string): Promise<void> {
  await window.getByRole("button", { name: /Zoom options/u }).click();
  await window.getByRole("menuitem", { name, exact: true }).click();
  await expect(window.getByRole("menu")).toHaveCount(0);
}

async function worldAtScreenPoint(surface: Locator, canvas: Locator, point: Point): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  const camera = await cameraPosition(surface);
  const viewportPoint = {
    x: (point.x - bounds.x) * (viewportWidth / bounds.width),
    y: (point.y - bounds.y) * (viewportHeight / bounds.height),
  };
  return {
    x: camera.x + (viewportPoint.x - viewportWidth / 2) / zoom,
    y: camera.y + (viewportPoint.y - viewportHeight / 2) / zoom,
  };
}

async function pageToScreen(surface: Locator, canvas: Locator, point: Point): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  return {
    x: bounds.x + (pageX + point.x * zoom) * (bounds.width / viewportWidth),
    y: bounds.y + (pageY + point.y * zoom) * (bounds.height / viewportHeight),
  };
}

async function createConstrainedShape(
  window: Page,
  surface: Locator,
  canvas: Locator,
  name: "Rectangle" | "Ellipse",
  start: Point,
  end: Point,
): Promise<string> {
  await chooseShape(window, name);
  await window.keyboard.down("Shift");
  await drawGesture(
    window,
    await pageToScreen(surface, canvas, start),
    await pageToScreen(surface, canvas, end),
  );
  await window.keyboard.up("Shift");
  return requiredAttribute(surface, "data-last-created-shape-id");
}

async function createShape(
  window: Page,
  surface: Locator,
  canvas: Locator,
  name: "Line" | "Rectangle" | "Ellipse",
  start: Point,
  end: Point,
): Promise<string> {
  await chooseShape(window, name);
  await drawGesture(
    window,
    await pageToScreen(surface, canvas, start),
    await pageToScreen(surface, canvas, end),
  );
  return requiredAttribute(surface, "data-last-created-shape-id");
}

async function chooseShape(window: Page, name: "Line" | "Rectangle" | "Ellipse"): Promise<void> {
  const button = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await button.click();
  if (!(await widget.isVisible())) await button.click();
  await widget.getByRole("button", { name, exact: true }).click();
}

async function drawGesture(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 8 });
  await window.mouse.up();
}

async function assertFitPage(surface: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const width = await attributeNumber(surface, "data-viewport-width");
      const height = await attributeNumber(surface, "data-viewport-height");
      const x = await attributeNumber(surface, "data-viewport-page-x");
      const y = await attributeNumber(surface, "data-viewport-page-y");
      const pageWidth = await attributeNumber(surface, "data-viewport-page-width");
      const pageHeight = await attributeNumber(surface, "data-viewport-page-height");
      return (
        x >= 0 &&
        y >= 0 &&
        x + pageWidth <= width + 0.001 &&
        y + pageHeight <= height + 0.001 &&
        Math.abs(x + pageWidth / 2 - width / 2) < 0.001 &&
        Math.abs(y + pageHeight / 2 - height / 2) < 0.001
      );
    })
    .toBe(true);
}

async function assertFitWidth(surface: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const x = await attributeNumber(surface, "data-viewport-page-x");
      const y = await attributeNumber(surface, "data-viewport-page-y");
      return Math.abs(x - 56) < 0.001 && Math.abs(y - 88) < 0.001;
    })
    .toBe(true);
}

async function assertPageRecoverable(surface: Locator): Promise<void> {
  const extent = await surface.evaluate((element) => {
    const pageX = Number((element as HTMLElement).dataset.viewportPageX);
    const pageY = Number((element as HTMLElement).dataset.viewportPageY);
    const pageWidth = Number((element as HTMLElement).dataset.viewportPageWidth);
    const pageHeight = Number((element as HTMLElement).dataset.viewportPageHeight);
    const viewportWidth = Number((element as HTMLElement).dataset.viewportWidth);
    const viewportHeight = Number((element as HTMLElement).dataset.viewportHeight);
    return {
      width: Math.max(0, Math.min(pageX + pageWidth, viewportWidth) - Math.max(pageX, 0)),
      height: Math.max(0, Math.min(pageY + pageHeight, viewportHeight) - Math.max(pageY, 0)),
    };
  });
  expect(extent.width).toBeGreaterThanOrEqual(63.99);
  expect(extent.height).toBeGreaterThanOrEqual(63.99);
}

async function cameraPosition(surface: Locator): Promise<Point> {
  return {
    x: await attributeNumber(surface, "data-viewport-camera-x"),
    y: await attributeNumber(surface, "data-viewport-camera-y"),
  };
}

async function selectedBounds(surface: Locator): Promise<Rect> {
  return {
    x: await attributeNumber(surface, "data-selected-object-bounds-x"),
    y: await attributeNumber(surface, "data-selected-object-bounds-y"),
    width: await attributeNumber(surface, "data-selected-object-bounds-width"),
    height: await attributeNumber(surface, "data-selected-object-bounds-height"),
  };
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function requiredAttribute(locator: Locator, name: string): Promise<string> {
  const value = await locator.getAttribute(name);
  if (value === null || value === "") throw new Error(`Missing required ${name} diagnostic.`);
  return value;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Rect extends Point {
  readonly width: number;
  readonly height: number;
}
