import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

test("preserves independent Shape state, contextual hints, modal stacking, and ink-only erasing", async () => {
  test.setTimeout(90_000);
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
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const palette = window.getByTestId("context-tool-palette");
    const shapesWidget = window.getByTestId("shapes-widget");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    const contextHint = window.getByTestId("context-hint");
    const tooltipLayer = window.locator('[data-tooltip-layer="global"]');
    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);

    await expect(contextHint).toContainText("Tip: Alt + Click → Select object beneath");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await activateDockSlot(window, "pencil");
    await expect(palette).toBeHidden();
    await expect(surface).toHaveAttribute("data-drawing-color", "#343434");
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.78");

    const penButton = toolDock.locator('button[data-dock-slot="pen"]');
    await activateDockSlot(window, "pen");
    await expect(palette).toBeHidden();
    await openSlotToolOptions(window, "pen");
    await expect(palette).toBeVisible();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await window.mouse.move(500, 120);
    await penButton.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    expect(await stackingLevel(tooltipLayer)).toBeGreaterThan(await parentStackingLevel(palette));
    await window.getByRole("button", { name: "Use color #2563eb" }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "8");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "80");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await activateDockSlot(window, "marker");
    await expect(palette).toBeHidden();
    await expect(surface).toHaveAttribute("data-drawing-color", "#1f2937");
    // Twelve since the Marker preset was tuned, and the change does this
    // assertion a favour: the Pen slot was just set to eight a few lines above,
    // so while Marker's own default was also eight, state leaking across slots
    // would have passed here unnoticed. It cannot now.
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.9");

    const highlighterButton = toolDock.locator('button[data-dock-slot="highlighter"]');
    await activateDockSlot(window, "highlighter");
    await expect(palette).toBeHidden();
    await openSlotToolOptions(window, "highlighter");
    await expect(palette).toBeVisible();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await window.mouse.move(500, 120);
    await highlighterButton.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    expect(await stackingLevel(tooltipLayer)).toBeGreaterThan(await parentStackingLevel(palette));
    await expect(surface).toHaveAttribute("data-drawing-color", "#facc15");
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.34");

    const shapesButton = toolDock.getByRole("button", { name: "Shapes", exact: true });
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await expect(inkCanvas).toHaveAttribute(
      "data-desktop-cursor-phase",
      /^(?:fallback|adaptive)$/u,
    );
    expect(await inkCanvas.evaluate((canvas) => canvas.style.cursor)).toContain(
      "data:image/svg+xml",
    );
    await window.mouse.move(500, 120);
    await shapesButton.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    expect(await stackingLevel(tooltipLayer)).toBeGreaterThan(
      await parentStackingLevel(shapesWidget),
    );
    await expect(surface).toHaveAttribute("data-drawing-color", "#111111");
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "1");

    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Hold Shift → Draw a perfect square");
    await expect(inkCanvas).toHaveAttribute(
      "data-desktop-cursor-phase",
      /^(?:fallback|adaptive)$/u,
    );
    await shapesButton.click();
    await shapesWidget.getByRole("button", { name: "Ellipse", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Hold Shift → Draw a perfect circle");
    await expect(inkCanvas).toHaveAttribute(
      "data-desktop-cursor-phase",
      /^(?:fallback|adaptive)$/u,
    );
    await shapesButton.click();
    await shapesWidget.getByRole("button", { name: "Line", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Hold Space + Drag → Move canvas");
    await expect(inkCanvas).toHaveAttribute(
      "data-desktop-cursor-phase",
      /^(?:fallback|adaptive)$/u,
    );
    await shapesButton.click();
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Hold Shift → Draw a perfect square");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");

    await drawGesture(window, pageToScreen(250, 160), pageToScreen(390, 260));
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "1");
    expect((await vectorStyles(surface))[0]).toMatchObject({
      type: "rectangle",
      color: "#111111",
      width: 2,
      opacity: 1,
    });
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    const duplicateShape = shapeToolbar.getByRole("button", { name: "Duplicate" });
    await duplicateShape.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    expect(await stackingLevel(tooltipLayer)).toBeGreaterThan(await stackingLevel(shapeToolbar));

    const historyBeforeShapeStyle = await attributeNumber(surface, "data-history-undo-depth");
    await shapeToolbar.getByLabel("Stroke color").click();
    await window.getByRole("textbox", { name: "Hex color" }).fill("#dc2626");
    // On a landscape page the picker can overlay the selection toolbar, so it
    // is committed and dismissed from empty workspace before the toolbar is
    // used. Picker/toolbar placement is tracked separately as UX-034.
    await window.mouse.click(4, 60);
    await expect(window.getByTestId("full-color-picker")).toHaveCount(0);
    await shapeToolbar.getByRole("button", { name: "Stroke width" }).click();
    await shapeToolbar.getByRole("group", { name: "Width options" }).getByRole("slider").fill("6");
    await shapeToolbar.getByRole("button", { name: "Stroke opacity" }).click();
    await shapeToolbar
      .getByRole("group", { name: "Opacity options" })
      .getByRole("slider")
      .fill("0.55");
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeShapeStyle + 3),
    );
    expect((await vectorStyles(surface))[0]).toMatchObject({
      color: "#dc2626",
      width: 6,
      opacity: 0.55,
    });
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await vectorStyles(surface))[0]).toMatchObject({
      color: "#dc2626",
      width: 6,
      opacity: 1,
    });
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await vectorStyles(surface))[0]).toMatchObject({
      color: "#dc2626",
      width: 6,
      opacity: 0.55,
    });
    await window.keyboard.press("Escape");

    await activateDockSlot(window, "pencil");
    await expect(surface).toHaveAttribute("data-drawing-color", "#343434");
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.78");
    await activateDockSlot(window, "pen");
    await expect(surface).toHaveAttribute("data-drawing-color", "#2563eb");
    await expect(surface).toHaveAttribute("data-drawing-width", "8");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.8");
    await activateDockSlot(window, "marker");
    await expect(surface).toHaveAttribute("data-drawing-color", "#1f2937");
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.9");
    await activateDockSlot(window, "highlighter");
    await expect(surface).toHaveAttribute("data-drawing-color", "#facc15");
    await expect(surface).toHaveAttribute("data-drawing-width", "12");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.34");
    await shapesButton.click();
    await expect(surface).toHaveAttribute("data-drawing-color", "#111111");
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "1");
    await expect(shapesWidget).toBeVisible();
    await expect(
      shapesWidget.getByRole("button", { name: "Rectangle", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();

    await drawGesture(window, pageToScreen(440, 160), pageToScreen(580, 260));
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "2");
    expect((await vectorStyles(surface))[1]).toMatchObject({
      type: "rectangle",
      color: "#111111",
      width: 2,
      opacity: 1,
    });

    const historyBeforeRecentInspection = await attributeNumber(surface, "data-history-undo-depth");
    await activateDockSlot(window, "pen");
    await openSlotToolOptions(window, "pen");
    await expect(palette).toBeVisible();
    await palette.getByTestId("tool-options-color-trigger").click();
    const recentColorButtons = window
      .getByTestId("full-color-picker")
      .getByLabel("Recent")
      .getByRole("button");
    await expect(recentColorButtons).toHaveCount(2);
    expect(
      await recentColorButtons.evaluateAll((buttons) => buttons.map((button) => button.ariaLabel)),
    ).toEqual(["Use recent color #111111", "Use recent color #dc2626"]);
    expect(await attributeNumber(surface, "data-history-undo-depth")).toBe(
      historyBeforeRecentInspection,
    );

    await shapesButton.click();
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    await window.getByRole("button", { name: "Application menu", exact: true }).click();
    await window.getByRole("menuitem", { name: "Appearance settings", exact: true }).click();
    const dialog = window.getByRole("dialog", { name: "Appearance" });
    const dialogOverlay = window.locator('[data-folio-modal-layer="overlay"]');
    await expect(dialog).toBeVisible();
    expect(await stackingLevel(dialog)).toBeGreaterThan(await stackingLevel(tooltipLayer));
    expect(await stackingLevel(dialogOverlay)).toBeGreaterThan(await stackingLevel(tooltipLayer));
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await shapesButton.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "false");
    await expect(tooltipLayer.getByRole("tooltip")).toHaveText("Shapes");
    await expect(tooltipLayer).toHaveCSS("pointer-events", "none");
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();

    await activateDockSlot(window, "pen");
    await drawGesture(window, pageToScreen(280, 500), pageToScreen(440, 500));
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "1");
    await shapesButton.click();
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();
    await drawGesture(window, pageToScreen(260, 450), pageToScreen(460, 550));
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");

    const historyBeforeErase = await attributeNumber(surface, "data-history-undo-depth");
    await toolDock.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(360, 500)));
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeErase + 1),
    );

    await window.keyboard.press("Control+Z");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "1");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await window.keyboard.press("Control+Y");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await expect(contextHint).toContainText("Tip: Alt + Click → Select object beneath");
    await window.mouse.click(...pointTuple(pageToScreen(360, 500)));
    await expect(surface).toHaveAttribute("data-selected-object-type", "rectangle");
    await window.keyboard.press("Delete");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "2");
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

async function drawGesture(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(...pointTuple(start));
  await window.mouse.down();
  await window.mouse.move(...pointTuple(end), { steps: 8 });
  await window.mouse.up();
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function vectorStyles(locator: Locator): Promise<readonly VectorStyleDiagnostic[]> {
  return JSON.parse(
    (await locator.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as readonly VectorStyleDiagnostic[];
}

async function stackingLevel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number(getComputedStyle(element).zIndex));
}

async function parentStackingLevel(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    element.parentElement === null ? 0 : Number(getComputedStyle(element.parentElement).zIndex),
  );
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

interface VectorStyleDiagnostic {
  readonly type: "line" | "rectangle" | "ellipse";
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}
