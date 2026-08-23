import path from "node:path";
import { expect, test, _electron as electron, type Locator } from "@playwright/test";

test("creates and edits Line, Rectangle, and Ellipse PageObjects through existing editor systems", async () => {
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
    const previewCanvas = host.locator("canvas[data-folio-layer='shape-preview']");
    const selectionCanvas = host.locator("canvas[data-folio-layer='selection']");
    const vectorInteractionCanvas = host.locator("canvas[data-folio-layer='vector-interaction']");
    const measurement = host.locator("[aria-hidden][data-shape-measurement]");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const shapesWidget = window.getByTestId("shapes-widget");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    await expect(surface).toHaveAttribute("data-shape-creation-capability", "ready");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-mounted", "true");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "hidden");
    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);

    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(shapesWidget).toBeVisible();
    const shapesWidgetMetrics = await shapesWidget.evaluate((element) => {
      const firstButton = element.querySelector("button");
      if (!(firstButton instanceof HTMLElement)) throw new Error("Shapes Widget button missing.");
      return {
        width: (element as HTMLElement).offsetWidth,
        height: (element as HTMLElement).offsetHeight,
        buttonSize: firstButton.offsetWidth,
        iconSize: firstButton.querySelector("svg")?.getBoundingClientRect().width,
      };
    });
    expect(shapesWidgetMetrics).toEqual({ width: 52, height: 122, buttonSize: 36, iconSize: 15 });
    const shapesDockButton = toolDock.getByRole("button", { name: "Shapes", exact: true });
    await expect
      .poll(async () => {
        const [widgetBounds, dockBounds] = await Promise.all([
          shapesWidget.boundingBox(),
          toolDock.boundingBox(),
        ]);
        if (widgetBounds === null || dockBounds === null) return null;
        return widgetBounds.x - (dockBounds.x + dockBounds.width);
      })
      .toBeCloseTo(12, 0);
    await expect
      .poll(async () => {
        const [widgetBounds, shapesButtonBounds] = await Promise.all([
          shapesWidget.boundingBox(),
          shapesDockButton.boundingBox(),
        ]);
        if (widgetBounds === null || shapesButtonBounds === null) return null;
        return (
          widgetBounds.y +
          widgetBounds.height / 2 -
          (shapesButtonBounds.y + shapesButtonBounds.height / 2)
        );
      })
      .toBeCloseTo(0, 0);
    const lineButton = shapesWidget.getByRole("button", { name: "Line", exact: true });
    await lineButton.hover();
    const lineTooltip = window.getByRole("tooltip", { name: "Line", exact: true });
    await expect(lineTooltip).toBeVisible();
    await expect(lineTooltip).toHaveAttribute("data-tooltip-motion", "fade-120ms");
    expect(
      await lineTooltip.evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toContain("0.12s");
    expect(
      await lineTooltip.evaluate((element) => getComputedStyle(element, "::before").content),
    ).not.toBe("none");
    const floatingStyle = await floatingSurfaceStyle(toolDock);
    expect(await floatingSurfaceStyle(shapesWidget)).toEqual(floatingStyle);
    expect(await floatingSurfaceStyle(lineTooltip)).not.toEqual(floatingStyle);
    await expect(lineTooltip).toHaveAttribute("data-tooltip-surface", "auxiliary-soft");
    await expect(window.getByTestId("context-tool-palette")).toHaveCount(0);
    await expect(inkCanvas).toHaveAttribute("data-desktop-cursor-phase", "fallback");
    expect(await inkCanvas.evaluate((canvas) => canvas.style.cursor)).toContain(
      "data:image/svg+xml",
    );
    await lineButton.click();
    const lineStart = pageToScreen(100, 160);
    const lineEnd = pageToScreen(240, 230);
    await window.mouse.move(lineStart.x, lineStart.y);
    await expect(inkCanvas).toHaveAttribute("data-desktop-cursor-phase", "adaptive");
    await expect(inkCanvas).toHaveCSS("cursor", "crosshair");
    await window.mouse.down();
    await window.keyboard.down("Shift");
    await window.mouse.move(lineEnd.x, lineEnd.y, { steps: 6 });
    await window.mouse.move(...pointTuple(pageToScreen(245, 210)), { steps: 3 });
    await expect(measurement).toHaveAttribute("data-shape-measurement", "visible");
    await expect(measurement).toContainText("Length:");
    await expect(measurement).toHaveText(/(?:0|45|90|135|180|225|270|315)\u00b0$/u);
    await window.mouse.up();
    await window.keyboard.up("Shift");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await expect(surface).toHaveAttribute("data-selected-object-type", "line");
    await expect(selectionCanvas).toHaveAttribute("data-selection-handles", "hidden");
    await expect(vectorInteractionCanvas).toHaveAttribute(
      "data-vector-selection-style",
      "line-handles",
    );
    await expect(vectorInteractionCanvas).toHaveAttribute(
      "data-vector-selection-presentation",
      "soft",
    );
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    await expect(shapeToolbar).toHaveAttribute("data-selected-shape-type", "line");
    expect(await floatingSurfaceStyle(shapeToolbar)).toEqual(floatingStyle);
    await shapeToolbar.evaluate((element) => {
      element.dataset.persistenceToken = "same-toolbar";
    });
    await expect(measurement).toHaveAttribute("data-shape-measurement", "hidden");
    await expect(previewCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");

    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await shapesWidget.getByRole("button", { name: "Rectangle", exact: true }).click();
    const cancelledStart = pageToScreen(320, 160);
    const cancelledEnd = pageToScreen(430, 230);
    await window.mouse.move(cancelledStart.x, cancelledStart.y);
    await window.mouse.down();
    await window.mouse.move(cancelledEnd.x, cancelledEnd.y, { steps: 4 });
    await expect(surface).toHaveAttribute("data-shape-creation-state", "dragging");
    expect(
      await window.evaluate(() => {
        const shift = new KeyboardEvent("keydown", {
          key: "Shift",
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(shift);
        return shift.defaultPrevented;
      }),
    ).toBe(true);
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-shape-creation-state", "idle");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(
      shapesWidget.getByRole("button", { name: "Rectangle", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    const rectangleStart = pageToScreen(310, 170);
    const rectangleEnd = pageToScreen(430, 230);
    await window.mouse.move(rectangleStart.x, rectangleStart.y);
    await window.mouse.down();
    await window.mouse.move(...pointTuple(pageToScreen(360, 200)), { steps: 2 });
    await window.keyboard.down("Shift");
    await window.mouse.move(rectangleEnd.x, rectangleEnd.y, { steps: 6 });
    await expect(measurement).toHaveAttribute("data-shape-measurement", "visible");
    const constrainedRectangleMeasurement = await measurement.textContent();
    expect(constrainedRectangleMeasurement).toMatch(/^Width: (\d+) px \u00b7 Height: \1 px$/u);
    await window.mouse.up();
    await window.keyboard.up("Shift");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "2");
    await expect(surface).toHaveAttribute("data-selected-object-type", "rectangle");
    await expect(shapeToolbar).toHaveAttribute("data-persistence-token", "same-toolbar");
    await expect(shapeToolbar).toHaveAttribute("data-selected-shape-type", "rectangle");

    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await shapesWidget.getByRole("button", { name: "Ellipse", exact: true }).click();
    const ellipseStart = pageToScreen(180, 390);
    const ellipseEnd = pageToScreen(300, 470);
    await window.mouse.move(ellipseStart.x, ellipseStart.y);
    await window.mouse.down();
    await window.keyboard.down("Shift");
    await window.mouse.move(ellipseEnd.x, ellipseEnd.y, { steps: 6 });
    await expect(measurement).toHaveAttribute("data-shape-measurement", "visible");
    const constrainedEllipseMeasurement = await measurement.textContent();
    expect(constrainedEllipseMeasurement).toMatch(/^Radius: (\d+) px \u00b7 Diameter: (\d+) px$/u);
    const circleParts = constrainedEllipseMeasurement?.match(/\d+/gu)?.map(Number) ?? [];
    expect(circleParts[1]).toBe((circleParts[0] ?? 0) * 2);
    await window.mouse.up();
    await window.keyboard.up("Shift");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");
    await expect(surface).toHaveAttribute("data-selected-object-type", "ellipse");
    await expect(selectionCanvas).toHaveAttribute("data-selection-handles", "visible");
    await expect(selectionCanvas).toHaveAttribute("data-selection-presentation", "soft");
    await expect(shapeToolbar).toHaveAttribute("data-persistence-token", "same-toolbar");
    await expect(shapeToolbar).toHaveAttribute("data-selected-shape-type", "ellipse");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-sizing", "content");
    const compactToolbar = await toolbarMetrics(shapeToolbar);
    expect(compactToolbar.width).toBeLessThan(430);
    expect(compactToolbar.leadingGap).toBeCloseTo(compactToolbar.trailingGap, 1);
    expect(compactToolbar.trailingGap).toBeGreaterThanOrEqual(6);
    expect(compactToolbar.trailingGap).toBeLessThanOrEqual(12);
    await expectToolbarInsideWorkspace(shapeToolbar, host);
    await expectToolbarAvoidsSelection(
      shapeToolbar,
      pageToScreen(180, 390),
      pageToScreen(300, 510),
    );

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "2");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "3");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.move(...pointTuple(pageToScreen(370, 230)));
    await expect(vectorInteractionCanvas).toHaveAttribute("data-vector-hover-state", "hovered");
    await window.mouse.click(...pointTuple(pageToScreen(370, 230)));
    await expect(surface).toHaveAttribute("data-selected-object-type", "rectangle");
    await expect(shapeToolbar).toHaveAttribute("data-persistence-token", "same-toolbar");
    await window.mouse.click(...pointTuple(pageToScreen(240, 450)));
    await expect(surface).toHaveAttribute("data-selected-object-type", "ellipse");
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    const historyBeforeStyle = Number(await surface.getAttribute("data-history-undo-depth"));
    await shapeToolbar.getByLabel("Shape stroke color").fill("#2563eb");
    await window.waitForTimeout(180);
    const toolbarBeforeExpansion = await shapeToolbar.boundingBox();
    await shapeToolbar.getByRole("button", { name: "Shape stroke width" }).click();
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-expanded-section", "strokeWidth");
    const widthPanel = shapeToolbar.getByRole("group", { name: "Width options" });
    await expect(widthPanel).toBeVisible();
    await expect(widthPanel).toHaveAttribute("data-toolbar-expansion-mechanism", "shared");
    expect(await floatingSurfaceStyle(widthPanel)).toEqual(floatingStyle);
    await expect(widthPanel.locator('[data-tool-option="strokeWidth"]')).toHaveCount(1);
    const toolbarAfterExpansion = await shapeToolbar.boundingBox();
    expect(toolbarAfterExpansion?.width).toBeCloseTo(toolbarBeforeExpansion?.width ?? 0, 1);
    expect(toolbarAfterExpansion?.height).toBeCloseTo(toolbarBeforeExpansion?.height ?? 0, 1);
    expect(toolbarAfterExpansion?.x).toBeCloseTo(toolbarBeforeExpansion?.x ?? 0, 1);
    expect(toolbarAfterExpansion?.y).toBeCloseTo(toolbarBeforeExpansion?.y ?? 0, 1);
    await expectPanelInsideWorkspace(widthPanel, host);
    const shapeWidthSlider = widthPanel.getByRole("slider", { name: "Width" });
    for (const width of ["0.5", "7", "30", "8.3"]) {
      await shapeWidthSlider.fill(width);
      await expect(widthPanel.getByRole("spinbutton", { name: "Width value" })).toHaveValue(width);
      await expect
        .poll(
          async () => (await vectorStyles(surface)).find(({ type }) => type === "ellipse")?.width,
        )
        .toBe(Number(width));
      await expectToolbarGeometry(shapeToolbar, toolbarAfterExpansion);
    }
    await verifyReservedSummaryCapacity(shapeToolbar, [
      "0.5 px",
      "7 px",
      "30 px",
      "125 px",
      "1000 px",
      "1000.0 px",
    ]);
    await shapeToolbar.getByRole("button", { name: "Shape stroke opacity" }).click();
    const opacityPanel = shapeToolbar.getByRole("group", { name: "Opacity options" });
    await expect(opacityPanel).toBeVisible();
    await expect(opacityPanel).toHaveAttribute("data-toolbar-expansion-mechanism", "shared");
    await expect(opacityPanel.locator('[data-tool-option="opacity"]')).toHaveCount(1);
    await expect(widthPanel).toHaveCount(0);
    const shapeOpacitySlider = opacityPanel.getByRole("slider", { name: "Opacity" });
    await shapeOpacitySlider.fill("0.5");
    await expect(opacityPanel.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("50");
    await expectToolbarGeometry(shapeToolbar, toolbarAfterExpansion);
    await expect
      .poll(async () => (await vectorStyles(surface)).find(({ type }) => type === "ellipse"))
      .toMatchObject({ color: "#2563eb", width: 8.3, opacity: 0.5 });
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeStyle + 6),
    );
    await window.keyboard.press("Escape");
    await expect(opacityPanel).toHaveCount(0);
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-expanded-section", "");
    await shapeToolbar.getByRole("button", { name: "Shape stroke width" }).click();
    await expect(shapeToolbar.getByRole("group", { name: "Width options" })).toBeVisible();
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await expect(shapeToolbar.getByRole("group", { name: "Width options" })).toHaveCount(0);
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "visible");
    await shapeToolbar.getByRole("button", { name: "Duplicate shape" }).focus();
    await window.keyboard.press("Control+Z");
    await expect
      .poll(
        async () => (await vectorStyles(surface)).find(({ type }) => type === "ellipse")?.opacity,
      )
      .toBe(1);
    await window.keyboard.press("Control+Shift+Z");
    await expect
      .poll(
        async () => (await vectorStyles(surface)).find(({ type }) => type === "ellipse")?.opacity,
      )
      .toBe(0.5);
    const initialTranslationX = Number(
      await surface.getAttribute("data-selected-object-translation-x"),
    );
    const initialTranslationY = Number(
      await surface.getAttribute("data-selected-object-translation-y"),
    );
    const center = pageToScreen(240, 450);
    await window.mouse.click(center.x, center.y);
    await expect(surface).toHaveAttribute("data-selected-object-type", "ellipse");
    await window.mouse.move(center.x, center.y);
    await window.mouse.down();
    await window.mouse.move(center.x + 45, center.y + 25, { steps: 6 });
    await window.mouse.up();
    expect(
      Number(await surface.getAttribute("data-selected-object-translation-x")),
    ).toBeGreaterThan(initialTranslationX);
    expect(
      Number(await surface.getAttribute("data-selected-object-translation-y")),
    ).toBeGreaterThan(initialTranslationY);

    await window.keyboard.press("Control+C");
    await window.keyboard.press("Control+V");
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "4");
    await shapeToolbar.getByRole("button", { name: "Duplicate shape" }).click();
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "5");
    await shapeToolbar.getByRole("button", { name: "Delete shape" }).click();
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "4");

    const historyBeforeRapidCreation = Number(
      await surface.getAttribute("data-history-undo-depth"),
    );
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await shapesWidget.getByRole("button", { name: "Line", exact: true }).click();
    for (let index = 0; index < 3; index += 1) {
      const start = pageToScreen(470, 170 + index * 45);
      const end = pageToScreen(560, 195 + index * 45);
      await window.mouse.move(start.x, start.y);
      await window.mouse.down();
      await window.mouse.move(end.x, end.y, { steps: 2 });
      await window.mouse.up();
    }
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "7");
    await expect(surface).toHaveAttribute(
      "data-history-undo-depth",
      String(historyBeforeRapidCreation + 3),
    );
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(...pointTuple(pageToScreen(700, 700)));
    await expect(shapeToolbar).toHaveAttribute("data-toolbar-state", "hidden");

    const renderCount = Number(await baseCanvas.getAttribute("data-render-count"));
    await window.setViewportSize({ width: 1280, height: 780 });
    await expect
      .poll(async () => Number(await baseCanvas.getAttribute("data-render-count")))
      .toBeGreaterThan(renderCount);
    await expect(surface).toHaveAttribute("data-document-vector-object-count", "7");
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
  if (bounds === null) throw new Error("Canvas has no visible bounds.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return (x: number, y: number) => ({
    x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
    y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
  });
}

async function expectToolbarInsideWorkspace(toolbar: Locator, host: Locator): Promise<void> {
  const [toolbarBounds, hostBounds] = await Promise.all([
    toolbar.boundingBox(),
    host.boundingBox(),
  ]);
  if (toolbarBounds === null || hostBounds === null) throw new Error("Toolbar bounds unavailable.");
  expect(toolbarBounds.x).toBeGreaterThanOrEqual(hostBounds.x);
  expect(toolbarBounds.y).toBeGreaterThanOrEqual(hostBounds.y);
  expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(
    hostBounds.x + hostBounds.width + 0.01,
  );
  expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(
    hostBounds.y + hostBounds.height + 0.01,
  );
}

async function expectPanelInsideWorkspace(panel: Locator, host: Locator): Promise<void> {
  const [panelBounds, hostBounds] = await Promise.all([panel.boundingBox(), host.boundingBox()]);
  if (panelBounds === null || hostBounds === null) throw new Error("Panel bounds unavailable.");
  expect(panelBounds.x).toBeGreaterThanOrEqual(hostBounds.x);
  expect(panelBounds.y).toBeGreaterThanOrEqual(hostBounds.y);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(
    hostBounds.x + hostBounds.width + 0.01,
  );
  expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(
    hostBounds.y + hostBounds.height + 0.01,
  );
}

async function toolbarMetrics(toolbar: Locator): Promise<ToolbarMetrics> {
  return toolbar.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const firstControl = element.querySelector('input[aria-label="Shape stroke color"]');
    const lastButton = element.querySelector('button[aria-label="More shape options"]');
    if (!(firstControl instanceof HTMLElement) || !(lastButton instanceof HTMLElement)) {
      throw new Error("Toolbar edge controls are missing.");
    }
    const firstControlBounds = firstControl.parentElement?.getBoundingClientRect();
    if (firstControlBounds === undefined) throw new Error("Toolbar first control is missing.");
    const lastButtonBounds = lastButton.getBoundingClientRect();
    return {
      width: bounds.width,
      leadingGap: firstControlBounds.left - bounds.left,
      trailingGap: bounds.right - lastButtonBounds.right,
    };
  });
}

async function expectToolbarGeometry(
  toolbar: Locator,
  expected: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null,
): Promise<void> {
  if (expected === null) throw new Error("Expected toolbar bounds unavailable.");
  const actual = await toolbar.boundingBox();
  expect(actual?.x).toBeCloseTo(expected.x, 1);
  expect(actual?.y).toBeCloseTo(expected.y, 1);
  expect(actual?.width).toBeCloseTo(expected.width, 1);
  expect(actual?.height).toBeCloseTo(expected.height, 1);
}

async function verifyReservedSummaryCapacity(
  toolbar: Locator,
  formattedValues: readonly string[],
): Promise<void> {
  const measurements = await toolbar.evaluate((element, values) => {
    const summary = element.querySelector(
      '[data-toolbar-expansion-trigger="strokeWidth"] [data-toolbar-numeric-summary="reserved"]',
    );
    if (!(summary instanceof HTMLElement)) throw new Error("Reserved width summary is missing.");
    const original = summary.textContent;
    const results = values.map((value) => {
      summary.textContent = value;
      const toolbarBounds = element.getBoundingClientRect();
      return {
        value,
        toolbarX: toolbarBounds.x,
        toolbarWidth: toolbarBounds.width,
        summaryClientWidth: summary.clientWidth,
        summaryScrollWidth: summary.scrollWidth,
      };
    });
    summary.textContent = original;
    return results;
  }, formattedValues);
  const baseline = measurements[0];
  if (baseline === undefined) throw new Error("No toolbar capacity measurements were produced.");
  for (const measurement of measurements) {
    expect(measurement.toolbarX, measurement.value).toBeCloseTo(baseline.toolbarX, 2);
    expect(measurement.toolbarWidth, measurement.value).toBeCloseTo(baseline.toolbarWidth, 2);
    expect(measurement.summaryScrollWidth, measurement.value).toBeLessThanOrEqual(
      measurement.summaryClientWidth,
    );
  }
}

async function expectToolbarAvoidsSelection(
  toolbar: Locator,
  selectionTopLeft: Point,
  selectionBottomRight: Point,
): Promise<void> {
  const bounds = await toolbar.boundingBox();
  if (bounds === null) throw new Error("Toolbar bounds unavailable.");
  const overlaps = !(
    bounds.x + bounds.width <= selectionTopLeft.x ||
    bounds.x >= selectionBottomRight.x ||
    bounds.y + bounds.height <= selectionTopLeft.y ||
    bounds.y >= selectionBottomRight.y
  );
  expect(overlaps).toBe(false);
}

async function vectorStyles(locator: Locator): Promise<readonly VectorStyleDiagnostic[]> {
  return JSON.parse(
    (await locator.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as readonly VectorStyleDiagnostic[];
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

interface ToolbarMetrics {
  readonly width: number;
  readonly leadingGap: number;
  readonly trailingGap: number;
}

async function floatingSurfaceStyle(locator: Locator): Promise<FloatingSurfaceStyle> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
    };
  });
}

interface FloatingSurfaceStyle {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
}
