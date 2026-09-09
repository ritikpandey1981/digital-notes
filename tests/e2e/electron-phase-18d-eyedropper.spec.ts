import path from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";
import { findEmptyWorkspacePoint } from "./workspace-geometry";

test("Phase 18D samples committed artwork through the shared picker without stealing document input", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(150_000);
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
    const durations: number[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const rail = window.getByTestId("quick-color-rail");
    const picker = window.getByTestId("full-color-picker");
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    const inkCanvas = host.locator('canvas[data-folio-layer="ink"]');
    const pageCanvas = host.locator('canvas[data-folio-layer="page"]');

    // Build deterministic committed sources: opaque Ink, overlapping Highlighter, and a vector.
    await activateDockSlot(window, "pen");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ink");
    await openSlotToolOptions(window, "pen");
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "24");
    await rail.getByRole("button", { name: "Use color #dc2626" }).click();
    await drawPageGesture(window, surface, inkCanvas, { x: 160, y: 200 }, { x: 380, y: 200 });
    await rail.getByRole("button", { name: "Use color #2563eb" }).click();
    await drawPageGesture(window, surface, inkCanvas, { x: 160, y: 260 }, { x: 380, y: 260 });
    await activateDockSlot(window, "highlighter");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "highlighter");
    await drawPageGesture(window, surface, inkCanvas, { x: 180, y: 140 }, { x: 180, y: 320 });
    await chooseRectangle(window);
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    const shapeDefault = (await surface.getAttribute("data-drawing-color")) ?? "#111111";
    await drawPageGesture(window, surface, inkCanvas, { x: 450, y: 160 }, { x: 620, y: 320 });
    await nextPaint(window);

    const rectangle = (await vectorStyles(surface)).at(-1);
    if (rectangle === undefined) throw new Error("Source rectangle was not committed.");
    const redPoint = await pageToScreen(surface, inkCanvas, { x: 220, y: 200 });
    const overlapPoint = await pageToScreen(surface, inkCanvas, { x: 180, y: 200 });
    const rectangleStrokePoint = await pageToScreen(surface, inkCanvas, { x: 535, y: 160 });
    const redPixel = await sampleBasePixel(pageCanvas, redPoint);
    const overlapPixel = await sampleBasePixel(pageCanvas, overlapPoint);
    const rectanglePixelBeforeSelection = await sampleBasePixel(pageCanvas, rectangleStrokePoint);
    expect(redPixel).toBe("#dc2626");
    expect(overlapPixel).not.toBe(redPixel);
    expect(rectanglePixelBeforeSelection).not.toBe("#fffdf8");

    await openSlotToolOptions(window, "pencil");
    await rail.getByRole("button", { name: "Use color #4f46e5" }).click();
    const originalPencilColor = "#4f46e5";
    const baselineHistory = await historyDepth(surface);
    const baselineObjectCount = await objectCount(surface);
    await rail.getByTestId("quick-color-more").click();
    const baselineRecent = await recentColors(picker);
    const baselineFavorites = await favoriteColors(picker);
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await expect(
      picker.getByRole("button", { name: `Previous color ${originalPencilColor}` }),
    ).toBeVisible();
    await capture(window, testInfo, "01-picker-eyedropper-inactive.png");

    const eyedropper = picker.getByRole("button", { name: "Pick color from canvas" });
    await eyedropper.click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await expect(eyedropper).toHaveAttribute("aria-pressed", "true");
    await nextPaint(window);
    await window.mouse.move(redPoint.x + 1, redPoint.y + 1);
    await window.mouse.move(redPoint.x, redPoint.y);
    // Sampling now shows a pipette cursor rather than a generic crosshair. The
    // resolved CSS is asserted, not just the diagnostic label: a custom cursor
    // image with an explicit hotspot and a standard keyword fallback.
    await expect(inkCanvas).toHaveAttribute("data-eyedropper-cursor", "pipette");
    const eyedropperCursorCss = await inkCanvas.evaluate((canvas) => canvas.style.cursor);
    expect(eyedropperCursorCss).toContain('url("data:image/svg+xml,');
    expect(eyedropperCursorCss).toMatch(/\)\s+3\s+23,\s*crosshair$/u);
    await capture(window, testInfo, "02-eyedropper-active-over-page.png");

    const outsidePoint = await workspacePointOutsidePage(surface, inkCanvas);
    const cameraBeforeClaimedInput = await camera(surface);
    await window.mouse.click(outsidePoint.x, outsidePoint.y);
    await expect(surface).toHaveAttribute("data-artwork-sample-status", "miss");
    await expect(surface).toHaveAttribute("data-artwork-sample-reason", "outside-page");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await window.mouse.move(outsidePoint.x, outsidePoint.y);
    await window.keyboard.down("Space");
    await window.mouse.down();
    await window.mouse.move(outsidePoint.x + 45, outsidePoint.y + 30, { steps: 4 });
    await window.mouse.up();
    await window.keyboard.up("Space");
    await window.mouse.wheel(35, 60);
    expect(await camera(surface)).toEqual(cameraBeforeClaimedInput);
    expect(await historyDepth(surface)).toBe(baselineHistory);
    expect(await objectCount(surface)).toBe(baselineObjectCount);
    await expect(surface).toHaveAttribute("data-drawing-color", originalPencilColor);

    await window.mouse.click(redPoint.x, redPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-color", redPixel);
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await expect(picker.getByRole("textbox", { name: "Hex color" })).toHaveValue("#DC2626");
    await expect(picker.getByRole("spinbutton", { name: "red channel" })).toHaveValue("220");
    await expect(picker.getByRole("spinbutton", { name: "green channel" })).toHaveValue("38");
    await expect(picker.getByRole("spinbutton", { name: "blue channel" })).toHaveValue("38");
    await expect(picker.getByLabel("Current color #dc2626")).toBeVisible();
    await expect(
      picker.getByRole("button", { name: `Previous color ${originalPencilColor}` }),
    ).toBeVisible();
    await expect(picker.getByRole("button", { name: "Use color #dc2626" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(picker.getByTestId("favorite-current-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(surface).toHaveAttribute("data-drawing-color", redPixel);
    await expect(eyedropper).toBeFocused();
    expect(await recentColors(picker)).toEqual(baselineRecent);
    expect(await favoriteColors(picker)).toEqual(baselineFavorites);
    expect(await historyDepth(surface)).toBe(baselineHistory);
    expect(await objectCount(surface)).toBe(baselineObjectCount);
    await capture(window, testInfo, "03-sampled-color-picker-sync.png");

    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-drawing-color", originalPencilColor);
    expect(await historyDepth(surface)).toBe(baselineHistory);

    await rail.getByTestId("quick-color-more").click();
    await picker.getByTestId("color-sv-field").focus();
    await window.keyboard.press("i");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await window.mouse.click(redPoint.x, redPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-drawing-color", redPixel);
    expect(await recentColors(picker)).toEqual(baselineRecent);
    await capture(window, testInfo, "04-pencil-target-after-sample.png");
    await dismissThroughEmptyWorkspace(window);
    await expect(picker).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-drawing-color", redPixel);
    expect(await historyDepth(surface)).toBe(baselineHistory);
    await drawPageGesture(window, surface, inkCanvas, { x: 170, y: 430 }, { x: 350, y: 430 });
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      String(baselineObjectCount + 1),
    );
    await rail.getByTestId("quick-color-more").click();
    expect((await recentColors(picker))[0]).toBe(redPixel);
    await window.keyboard.press("Escape");

    // Sampling stays correct after Fit Page and after a manual 100% pan.
    await selectZoomMenuItem(window, "Fit Page");
    await rail.getByTestId("quick-color-more").click();
    await picker.getByTestId("color-sv-field").press("i");
    const fitRedPoint = await pageToScreen(surface, inkCanvas, { x: 220, y: 200 });
    await window.mouse.click(fitRedPoint.x, fitRedPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-color", redPixel);
    await window.keyboard.press("Escape");
    await selectZoomMenuItem(window, "100% (Actual Size)");
    const panAnchor = await pageToScreen(surface, inkCanvas, { x: 360, y: 360 });
    await window.mouse.move(panAnchor.x, panAnchor.y);
    await window.mouse.wheel(28, 36);
    await rail.getByTestId("quick-color-more").click();
    await picker.getByTestId("color-sv-field").press("i");
    const pannedRedPoint = await pageToScreen(surface, inkCanvas, { x: 220, y: 200 });
    await window.mouse.click(pannedRedPoint.x, pannedRedPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-color", redPixel);
    await window.keyboard.press("Escape");

    // A selected vector continues to own one continuous color edit and no overlay pixels leak in.
    // A selected-vector picker parks in the workspace corner by design. On the
    // landscape default page that corner sits over artwork at 1440 wide, so
    // this section uses a wider window to keep the sampled strokes reachable.
    // Picker-versus-page placement is tracked separately as UX-033.
    await window.setViewportSize({ width: 1760, height: 900 });
    await selectZoomMenuItem(window, "Fit Page");
    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    const selectedRectanglePoint = await pageToScreen(surface, inkCanvas, { x: 450, y: 240 });
    const unselectedRectanglePixel = await sampleBasePixel(pageCanvas, selectedRectanglePoint);
    await window.mouse.click(selectedRectanglePoint.x, selectedRectanglePoint.y);
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangle.id);
    const selectedRectanglePixel = await sampleBasePixel(pageCanvas, selectedRectanglePoint);
    expect(selectedRectanglePixel).toBe(unselectedRectanglePixel);
    const selectedHistory = await historyDepth(surface);
    const selectedRecent = await openRecentForSelectedVector(shapeToolbar, picker);
    await eyedropper.click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await nextPaint(window);
    const selectedRedPoint = await pageToScreen(surface, inkCanvas, { x: 220, y: 200 });
    const selectedRedPixel = await sampleBasePixel(pageCanvas, selectedRedPoint);
    expect(await pointerTargetAt(window, selectedRedPoint)).toEqual({
      tag: "CANVAS",
      layer: "ink",
      testId: null,
    });
    await window.mouse.move(selectedRedPoint.x + 1, selectedRedPoint.y + 1);
    await window.mouse.move(selectedRedPoint.x, selectedRedPoint.y);
    await expect(inkCanvas).toHaveAttribute("data-eyedropper-cursor", "pipette");
    await capture(window, testInfo, "05-selected-rectangle-eyedropper.png");
    await window.mouse.click(selectedRedPoint.x, selectedRedPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-color", selectedRedPixel);
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangle.id);
    expect(await historyDepth(surface)).toBe(selectedHistory);
    expect(await recentColors(picker)).toEqual(selectedRecent);

    await eyedropper.click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await nextPaint(window);
    const selectedOverlapPoint = await pageToScreen(surface, inkCanvas, { x: 180, y: 200 });
    const selectedOverlapPixel = await sampleBasePixel(pageCanvas, selectedOverlapPoint);
    expect(await pointerTargetAt(window, selectedOverlapPoint)).toEqual({
      tag: "CANVAS",
      layer: "ink",
      testId: null,
    });
    await window.mouse.click(selectedOverlapPoint.x, selectedOverlapPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await expect(surface).toHaveAttribute("data-artwork-sample-color", selectedOverlapPixel);
    await expect(surface).toHaveAttribute("data-selected-object-id", rectangle.id);
    expect(await historyDepth(surface)).toBe(selectedHistory);
    expect(await recentColors(picker)).toEqual(selectedRecent);
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      selectedOverlapPixel,
    );
    await dismissThroughEmptyWorkspace(window);
    await expect(picker).toHaveCount(0);
    expect(await historyDepth(surface)).toBe(selectedHistory + 1);
    await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
    const recentAfterVectorCommit = await recentColors(picker);
    expect(recentAfterVectorCommit.filter((color) => color === selectedOverlapPixel)).toHaveLength(
      1,
    );
    await window.keyboard.press("Escape");
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      rectangle.color,
    );
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    expect((await vectorStyles(surface)).find(({ id }) => id === rectangle.id)?.color).toBe(
      selectedOverlapPixel,
    );
    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(surface).toHaveAttribute("data-drawing-color", shapeDefault);

    // Paper sampling follows the base compositor in both appearance themes.
    await activateDockSlot(window, "pencil");
    const initialTheme = await currentTheme(window);
    await rail.getByTestId("quick-color-more").click();
    await eyedropper.click();
    const lightPaperPoint = await pageToScreen(surface, inkCanvas, { x: 520, y: 520 });
    const lightPaper = await sampleBasePixel(pageCanvas, lightPaperPoint);
    await window.mouse.click(lightPaperPoint.x, lightPaperPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-color", lightPaper);
    expect(lightPaper).toBe("#fffdf8");
    await window.keyboard.press("Escape");
    await window.getByRole("button", { name: "Application menu" }).click();
    await window.getByRole("menuitem", { name: /Use (?:light|dark) appearance/u }).click();
    expect(await currentTheme(window)).toBe(initialTheme === "light" ? "dark" : "light");
    await nextPaint(window);
    await rail.getByTestId("quick-color-more").click();
    await eyedropper.click();
    const darkPaperPoint = await pageToScreen(surface, inkCanvas, { x: 520, y: 520 });
    const darkPaper = await sampleBasePixel(pageCanvas, darkPaperPoint);
    await window.mouse.click(darkPaperPoint.x, darkPaperPoint.y);
    durations.push(await sampleDuration(surface));
    expect(darkPaper).toBe(lightPaper);
    await expect(picker.getByRole("textbox", { name: "Hex color" })).toHaveValue("#FFFDF8");
    await capture(window, testInfo, "06-paper-sample-dark-theme.png");
    await window.keyboard.press("Escape");

    // Text fields retain I; palette Escape is topmost; mode and picker Escapes remain separate.
    await rail.getByTestId("quick-color-more").click();
    const hex = picker.getByRole("textbox", { name: "Hex color" });
    await hex.focus();
    await hex.press("i");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    const redChannel = picker.getByRole("spinbutton", { name: "red channel" });
    await redChannel.focus();
    await redChannel.press("i");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await eyedropper.focus();
    await window.keyboard.press("i");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await picker.getByTestId("color-palette-trigger").click();
    const paletteMenu = window.getByTestId("color-palette-menu");
    await expect(paletteMenu).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(paletteMenu).toHaveCount(0);
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await window.keyboard.press("Escape");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await expect(eyedropper).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await window.keyboard.press("i");
    await expect(surface).toHaveAttribute("data-artwork-sampling-state", "inactive");

    await window.setViewportSize({ width: 1024, height: 700 });
    await rail.getByTestId("quick-color-more").click();
    await eyedropper.click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await nextPaint(window);
    const shortHoverPoint = await pageToScreen(surface, inkCanvas, { x: 220, y: 200 });
    await window.mouse.move(shortHoverPoint.x + 1, shortHoverPoint.y + 1);
    await window.mouse.move(shortHoverPoint.x, shortHoverPoint.y);
    await expectPickerInsideViewport(picker, { width: 1024, height: 700 });
    await capture(window, testInfo, "07-short-window-eyedropper.png");
    await window.keyboard.press("Escape");
    await window.keyboard.press("Escape");
    await window.setViewportSize({ width: 1440, height: 900 });

    // Tainted-canvas behavior stays contained, visible, retryable, and mutation-free.
    await rail.getByTestId("quick-color-more").click();
    const failureColor = await surface.getAttribute("data-drawing-color");
    const failureHistory = await historyDepth(surface);
    const failureRecent = await recentColors(picker);
    const failureFavorites = await favoriteColors(picker);
    await eyedropper.click();
    await installSecurityErrorReadback(pageCanvas);
    const failedPoint = await pageToScreen(surface, inkCanvas, { x: 520, y: 520 });
    await window.mouse.click(failedPoint.x, failedPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-status", "error");
    await expect(surface).toHaveAttribute("data-artwork-sample-reason", "security");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await expect(picker.getByTestId("eyedropper-status")).toHaveText(
      "This color can't be sampled.",
    );
    await expect(surface).toHaveAttribute("data-drawing-color", failureColor ?? "");
    expect(await historyDepth(surface)).toBe(failureHistory);
    expect(await recentColors(picker)).toEqual(failureRecent);
    expect(await favoriteColors(picker)).toEqual(failureFavorites);
    await capture(window, testInfo, "08-security-error-status.png");
    await restoreReadback(pageCanvas);
    await window.mouse.click(failedPoint.x, failedPoint.y);
    durations.push(await sampleDuration(surface));
    await expect(surface).toHaveAttribute("data-artwork-sample-status", "success");
    await expect(picker).toHaveAttribute("data-eyedropper-state", "inactive");
    await expect(picker.getByTestId("eyedropper-status")).toHaveCount(0);
    await window.keyboard.press("Escape");

    const performanceSummary = {
      policy: "click-only 1x1 backing-pixel readback",
      samples: durations,
      minimumMs: Math.min(...durations),
      maximumMs: Math.max(...durations),
    };
    console.info("Phase 18D artwork readback observations (ms)", performanceSummary);
    await testInfo.attach("eyedropper-performance", {
      body: Buffer.from(JSON.stringify(performanceSummary, null, 2)),
      contentType: "application/json",
    });
    expect(durations.length).toBeGreaterThanOrEqual(9);
    expect(durations.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function chooseRectangle(window: Page): Promise<void> {
  const button = window.getByRole("button", { name: "Shapes", exact: true });
  const widget = window.getByTestId("shapes-widget");
  await button.click();
  if (!(await widget.isVisible())) await button.click();
  await widget.getByRole("button", { name: "Rectangle", exact: true }).click();
}

async function openRecentForSelectedVector(
  shapeToolbar: Locator,
  picker: Locator,
): Promise<readonly string[]> {
  await shapeToolbar.getByRole("button", { name: "Stroke color" }).click();
  await expect(picker).toHaveAttribute("data-picker-source", "selected-vector");
  return recentColors(picker);
}

async function selectZoomMenuItem(window: Page, label: string): Promise<void> {
  await window.getByRole("button", { name: /^Zoom options,/u }).click();
  await window.getByRole("menuitem", { name: label, exact: true }).click();
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function drawPageGesture(
  window: Page,
  surface: Locator,
  canvas: Locator,
  start: Point,
  end: Point,
): Promise<void> {
  const countBeforeGesture = await objectCount(surface);
  const startScreen = await pageToScreen(surface, canvas, start);
  const endScreen = await pageToScreen(surface, canvas, end);
  await window.mouse.move(startScreen.x, startScreen.y);
  await window.mouse.down();
  await window.mouse.move(endScreen.x, endScreen.y, { steps: 12 });
  await window.mouse.up();
  await expect(surface).toHaveAttribute(
    "data-document-object-count",
    String(countBeforeGesture + 1),
  );
  await nextPaint(window);
}

async function pageToScreen(surface: Locator, canvas: Locator, point: Point): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const metrics = await surface.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      pageX: Number(dataset.viewportPageX),
      pageY: Number(dataset.viewportPageY),
      zoom: Number(dataset.viewportZoom),
      viewportWidth: Number(dataset.viewportWidth),
      viewportHeight: Number(dataset.viewportHeight),
    };
  });
  return {
    x: bounds.x + (metrics.pageX + point.x * metrics.zoom) * (bounds.width / metrics.viewportWidth),
    y:
      bounds.y +
      (metrics.pageY + point.y * metrics.zoom) * (bounds.height / metrics.viewportHeight),
  };
}

async function workspacePointOutsidePage(surface: Locator, canvas: Locator): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const page = await surface.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      x: Number(dataset.viewportPageX),
      y: Number(dataset.viewportPageY),
      width: Number(dataset.viewportPageWidth),
      height: Number(dataset.viewportPageHeight),
      viewportWidth: Number(dataset.viewportWidth),
      viewportHeight: Number(dataset.viewportHeight),
    };
  });
  const candidates = [
    { x: 12, y: 12 },
    { x: bounds.width - 12, y: 12 },
    { x: 12, y: bounds.height - 12 },
  ];
  const candidate = candidates.find(({ x, y }) => {
    const logicalX = x * (page.viewportWidth / bounds.width);
    const logicalY = y * (page.viewportHeight / bounds.height);
    return (
      logicalX < page.x ||
      logicalX >= page.x + page.width ||
      logicalY < page.y ||
      logicalY >= page.y + page.height
    );
  });
  if (candidate === undefined) throw new Error("No neutral workspace point is visible.");
  return { x: bounds.x + candidate.x, y: bounds.y + candidate.y };
}

async function sampleBasePixel(canvas: Locator, point: Point): Promise<string> {
  return canvas.evaluate((element, clientPoint) => {
    const target = element as HTMLCanvasElement;
    const bounds = target.getBoundingClientRect();
    const x = Math.floor((clientPoint.x - bounds.left) * (target.width / bounds.width));
    const y = Math.floor((clientPoint.y - bounds.top) * (target.height / bounds.height));
    const pixel = target.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (pixel === undefined) throw new Error("Page canvas is unreadable.");
    return `#${[pixel[0], pixel[1], pixel[2]]
      .map((channel) => channel!.toString(16).padStart(2, "0"))
      .join("")}`;
  }, point);
}

async function pointerTargetAt(window: Page, point: Point) {
  return window.evaluate((clientPoint) => {
    const target = document.elementFromPoint(clientPoint.x, clientPoint.y);
    return {
      tag: target?.tagName ?? null,
      layer: target?.getAttribute("data-folio-layer") ?? null,
      testId: target?.getAttribute("data-testid") ?? null,
    };
  }, point);
}

async function currentTheme(window: Page): Promise<"light" | "dark"> {
  const theme = await window.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== "light" && theme !== "dark") throw new Error("Theme state is unavailable.");
  return theme;
}

async function installSecurityErrorReadback(canvas: Locator): Promise<void> {
  await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext("2d");
    if (context === null) throw new Error("Page context unavailable.");
    const state = window as typeof window & { __folioRestoreGetImageData?: () => void };
    const original = context.getImageData.bind(context);
    state.__folioRestoreGetImageData = () => {
      context.getImageData = original;
      delete state.__folioRestoreGetImageData;
    };
    context.getImageData = () => {
      throw new DOMException("Canvas is tainted.", "SecurityError");
    };
  });
}

async function restoreReadback(canvas: Locator): Promise<void> {
  await canvas.evaluate(() => {
    const state = window as typeof window & { __folioRestoreGetImageData?: () => void };
    state.__folioRestoreGetImageData?.();
  });
}

async function recentColors(picker: Locator): Promise<readonly string[]> {
  return picker
    .getByRole("button", { name: /Use recent color/u })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.split(" ").at(-1) ?? ""),
    );
}

async function favoriteColors(picker: Locator): Promise<readonly string[]> {
  return picker
    .getByRole("button", { name: /Use favorite color/u })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.split(" ").at(-1) ?? ""),
    );
}

async function historyDepth(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-history-undo-depth"));
}

async function objectCount(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-document-object-count"));
}

async function sampleDuration(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-artwork-sample-duration-ms"));
}

async function camera(surface: Locator): Promise<Readonly<{ x: number; y: number; zoom: number }>> {
  return {
    x: Number(await surface.getAttribute("data-viewport-camera-x")),
    y: Number(await surface.getAttribute("data-viewport-camera-y")),
    zoom: Number(await surface.getAttribute("data-viewport-zoom")),
  };
}

interface VectorStyleDiagnostic {
  readonly id: string;
  readonly color: string;
}

async function vectorStyles(surface: Locator): Promise<readonly VectorStyleDiagnostic[]> {
  return JSON.parse(
    (await surface.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as readonly VectorStyleDiagnostic[];
}

async function expectPickerInsideViewport(
  picker: Locator,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const bounds = await picker.boundingBox();
  if (bounds === null) throw new Error("Color picker is not measurable.");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
}

async function capture(window: Page, testInfo: TestInfo, name: string): Promise<void> {
  await window.screenshot({ path: testInfo.outputPath(name) });
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

/**
 * Dismisses a floating surface by pressing bare workspace.
 *
 * The corner of the workspace box used to be empty canvas surround; the
 * workspace now reaches the top of the window and its corner holds chrome, so
 * ask the running app where the surround actually is.
 */
async function dismissThroughEmptyWorkspace(window: Page): Promise<void> {
  const point = await findEmptyWorkspacePoint(window);
  await window.mouse.click(point.x, point.y);
}
