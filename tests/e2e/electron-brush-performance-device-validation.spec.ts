import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

test("validates Phase 17D brush hot paths, stress lifecycles, and console cleanliness", async () => {
  test.setTimeout(120_000);
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
    const workspace = window.getByTestId("editor-workspace");
    const host = window.getByTestId("canvas-host");
    const surface = window.getByTestId("canvas-surface");
    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const cursor = window.getByTestId("brush-cursor");

    await openSlotToolOptions(window, "pencil");
    const palette = window.getByTestId("context-tool-palette");
    await expect(palette).toBeVisible();
    await nextPaint(window);

    const renderTargets = [workspace, host, surface, dock, palette] as const;
    const rendersBeforeMovement = await renderCounts(renderTargets);
    const canvasBounds = await inkCanvas.boundingBox();
    if (canvasBounds === null) throw new Error("Ink canvas has no visible bounds.");
    await host.evaluate((element) => {
      const target = element as HTMLElement & { __phase17dBoundsReads?: number };
      const original = target.getBoundingClientRect.bind(target);
      target.__phase17dBoundsReads = 0;
      target.getBoundingClientRect = () => {
        target.__phase17dBoundsReads = (target.__phase17dBoundsReads ?? 0) + 1;
        return original();
      };
    });
    await inkCanvas.evaluate((element, bounds) => {
      for (let index = 0; index < 240; index += 1) {
        element.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: bounds.x + bounds.width / 2 + (index % 8),
            clientY: bounds.y + bounds.height / 2,
            pointerId: 41,
            pointerType: "mouse",
            buttons: 0,
          }),
        );
      }
    }, canvasBounds);
    await window.mouse.move(
      canvasBounds.x + canvasBounds.width / 2,
      canvasBounds.y + canvasBounds.height / 2,
    );
    await nextPaint(window);

    expect(await renderCounts(renderTargets)).toEqual(rendersBeforeMovement);
    expect(
      await host.evaluate(
        (element) =>
          (element as HTMLElement & { __phase17dBoundsReads?: number }).__phase17dBoundsReads,
      ),
    ).toBeLessThanOrEqual(2);
    await expect(cursor).toHaveAttribute("data-visible", "true");

    await activateDockSlot(window, "pencil");
    // Selecting a tool no longer closes an open settings panel; the dock's
    // options affordance and Escape own that. Close it explicitly so the
    // render-count measurements below observe a bare canvas.
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    const pageToScreen = await pageCoordinateMapper(inkCanvas, surface);
    const renderCountsBeforeDrawing = await renderCounts([workspace, host, surface, dock]);
    const activeStart = pageToScreen(120, 90);
    const activeMiddle = pageToScreen(300, 102);
    await window.mouse.move(activeStart.x, activeStart.y);
    await window.mouse.down();
    await window.mouse.move(activeMiddle.x, activeMiddle.y, { steps: 40 });
    await nextPaint(window);
    expect(await renderCounts([workspace, host, surface, dock])).toEqual(renderCountsBeforeDrawing);
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    const families = ["Pencil", "Pen", "Marker", "Highlighter"] as const;
    let strokeCount = 1;
    for (const [familyIndex, family] of families.entries()) {
      if (family !== "Pencil") {
        await window.locator(`button[data-dock-slot="${family.toLowerCase()}"]`).click();
        await nextPaint(window);
      }
      for (let index = 0; index < 5; index += 1) {
        const y = 115 + familyIndex * 145 + index * 20;
        await drawPath(window, pageToScreen, y, index);
        strokeCount += 1;
        await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));
      }
    }
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));

    await activateDockSlot(window, "pen");
    await dispatchCancelledPenStroke(inkCanvas, pageToScreen);
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));
    await expect(inkCanvas).toHaveAttribute("data-ink-live-point-count", "0");
    await drawPath(window, pageToScreen, 690, 2);
    strokeCount += 1;
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));

    const historicalBrushes = await surface.getAttribute("data-document-stroke-brushes");
    const historyDepth = await surface.getAttribute("data-history-undo-depth");
    await openSlotToolOptions(window, "pen");
    await palette.getByTestId("tool-options-color-trigger").click();
    const hexInput = window.getByRole("textbox", { name: "Hex color" });
    await hexInput.fill("#2f6fed");
    await nextPaint(window);
    await expect(surface).toHaveAttribute("data-drawing-color", "#2f6fed");
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "9");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "72");
    await setNumericValue(window.getByRole("spinbutton", { name: "Smoothing value" }), "55");
    expect(await surface.getAttribute("data-document-stroke-brushes")).toBe(historicalBrushes);
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyDepth);

    await window.keyboard.press("Escape");
    const committedBrushes = await surface.getAttribute("data-document-stroke-brushes");
    for (let index = 0; index < 10; index += 1) await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount - 10));
    for (let index = 0; index < 10; index += 1) await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));
    expect(await surface.getAttribute("data-document-stroke-brushes")).toBe(committedBrushes);

    for (const zoom of ["25%", "50%", "100% (Actual Size)", "200%", "400%", "800%"] as const) {
      await selectZoomMenuItem(window, zoom);
      const expected = zoom === "100% (Actual Size)" ? "1" : String(Number.parseInt(zoom) / 100);
      await expect(surface).toHaveAttribute("data-viewport-zoom", expected);
    }
    await selectZoomMenuItem(window, "100% (Actual Size)");

    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    const actualPageToScreen = await pageCoordinateMapper(inkCanvas, surface);
    const eraseStart = actualPageToScreen(300, 180);
    const eraseEnd = actualPageToScreen(300, 720);
    await window.mouse.move(eraseStart.x, eraseStart.y);
    await window.mouse.down();
    await window.mouse.move(eraseEnd.x, eraseEnd.y, { steps: 60 });
    await window.mouse.up();
    await expect
      .poll(async () => Number(await surface.getAttribute("data-document-object-count")))
      .toBeLessThan(strokeCount);
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", String(strokeCount));
    expect(await surface.getAttribute("data-document-stroke-brushes")).toBe(committedBrushes);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function renderCounts(locators: readonly Locator[]): Promise<readonly number[]> {
  return Promise.all(
    locators.map(async (locator) => Number(await locator.getAttribute("data-render-count"))),
  );
}

async function drawPath(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  y: number,
  variation: number,
): Promise<void> {
  const start = pageToScreen(120, y);
  const middle = pageToScreen(300, y + (variation % 2 === 0 ? 12 : -12));
  const end = pageToScreen(500, y);
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(middle.x, middle.y, { steps: 4 });
  await window.mouse.move(end.x, end.y, { steps: 4 });
  await window.mouse.up();
  await nextPaint(window);
}

async function dispatchCancelledPenStroke(
  inkCanvas: Locator,
  pageToScreen: (x: number, y: number) => Point,
): Promise<void> {
  const samples = [pageToScreen(140, 680), pageToScreen(250, 670), pageToScreen(360, 680)];
  await inkCanvas.evaluate((element, points) => {
    const target = element as HTMLCanvasElement;
    const originalCapture = target.setPointerCapture;
    const originalRelease = target.releasePointerCapture;
    target.setPointerCapture = () => undefined;
    target.releasePointerCapture = () => undefined;
    const dispatch = (type: string, point: Point, buttons: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          pointerId: 91,
          pointerType: "pen",
          isPrimary: true,
          button: 0,
          buttons,
          pressure: 0.6,
        }),
      );
    dispatch("pointerdown", points[0]!, 1);
    dispatch("pointermove", points[1]!, 1);
    dispatch("pointermove", points[2]!, 1);
    dispatch("pointercancel", points[2]!, 0);
    target.setPointerCapture = originalCapture;
    target.releasePointerCapture = originalRelease;
  }, samples);
  await expect(inkCanvas).toHaveAttribute("data-ink-live-point-count", "0");
}

async function pageCoordinateMapper(
  inkCanvas: Locator,
  surface: Locator,
): Promise<(x: number, y: number) => Point> {
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  const pageX = await attributeNumber(surface, "data-viewport-page-x");
  const pageY = await attributeNumber(surface, "data-viewport-page-y");
  const zoom = await attributeNumber(surface, "data-viewport-zoom");
  return (x, y) => ({
    x: bounds.x + (pageX + x * zoom) * (bounds.width / viewportWidth),
    y: bounds.y + (pageY + y * zoom) * (bounds.height / viewportHeight),
  });
}

async function selectZoomMenuItem(window: Page, name: string): Promise<void> {
  await window.getByRole("button", { name: /Zoom options/u }).click();
  await window.getByRole("menuitem", { name, exact: true }).click();
  await expect(window.getByRole("menu")).toHaveCount(0);
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function attributeNumber(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function nextPaint(window: Page): Promise<void> {
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

interface Point {
  readonly x: number;
  readonly y: number;
}
