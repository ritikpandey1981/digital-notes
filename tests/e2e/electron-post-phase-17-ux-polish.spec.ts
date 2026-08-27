import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("validates the post-Phase-17 cursor, tooltip, preset, Shapes, and rotation polish", async ({
  browserName,
}, testInfo) => {
  void browserName;
  test.setTimeout(120_000);
  const repositoryRoot = process.cwd();
  const screenshotDirectory =
    process.env.FOLIO_SCREENSHOT_DIR ?? testInfo.outputPath("post-phase-17-ux-polish");
  mkdirSync(screenshotDirectory, { recursive: true });
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
    await window.setViewportSize({ width: 1200, height: 800 });
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const vectorCanvas = window.locator('canvas[data-folio-layer="vector-interaction"]');
    const brushCursor = window.getByTestId("brush-cursor");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    await expect(surface).toHaveAttribute("data-renderer-state", "ready");
    const mapping = await pageMapping(inkCanvas, surface);
    const insidePage = mapping.pageToScreen(397, 520);
    const outsidePage = {
      x: mapping.canvasBounds.x + 8,
      y: mapping.canvasBounds.y + mapping.canvasBounds.height / 2,
    };

    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await window.mouse.move(2, 2);
    await window.mouse.move(insidePage.x, insidePage.y);
    await expect(brushCursor).toHaveAttribute("data-visible", "true");
    await expect(inkCanvas).toHaveCSS("cursor", "none");
    await window.mouse.move(outsidePage.x, outsidePage.y);
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "default");
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).hover();
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "default");

    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    const palette = window.getByTestId("context-tool-palette");
    await expect(palette).toBeVisible();
    await palette.hover();
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await window.mouse.move(insidePage.x, insidePage.y);
    await expect(brushCursor).toHaveAttribute("data-visible", "true");
    await inkCanvas.dispatchEvent("pointermove", {
      clientX: insidePage.x,
      clientY: insidePage.y,
      pointerId: 93,
      pointerType: "touch",
    });
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "default");
    await window.mouse.move(insidePage.x, insidePage.y);
    await window.keyboard.down("Space");
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "grab");
    await window.keyboard.up("Space");

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.move(insidePage.x, insidePage.y);
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "default");
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await expect(palette).toBeVisible();

    const workspaceMenu = window.getByRole("button", { name: "Workspace menu" });
    await workspaceMenu.hover();
    const workspaceTooltip = window.getByRole("tooltip", { name: "Workspace menu" });
    await expect(workspaceTooltip).toBeVisible();
    const tooltipBounds = await workspaceTooltip.boundingBox();
    if (tooltipBounds === null) throw new Error("Workspace tooltip has no visible bounds.");
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(10);
    expect(tooltipBounds.y).toBeGreaterThanOrEqual(10);
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(1190);
    expect(tooltipBounds.y + tooltipBounds.height).toBeLessThanOrEqual(790);
    await workspaceMenu.click();
    await window.getByRole("menuitem", { name: "Appearance settings", exact: true }).click();
    const settingsDialog = window.getByRole("dialog", { name: "Appearance" });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog.hover();
    await expect(brushCursor).toHaveAttribute("data-visible", "false");
    await expect(inkCanvas).toHaveCSS("cursor", "default");
    await expect(workspaceTooltip).toBeHidden();
    await window.keyboard.press("Escape");
    await expect(settingsDialog).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pencil", exact: true }).click();
    await expect(palette).toBeVisible();

    const presetTrigger = window.getByRole("button", { name: "Pencil preset" });
    const colorBeforePreset = await surface.getAttribute("data-drawing-color");
    await presetTrigger.click();
    const presetMenu = window.getByTestId("brush-preset-menu");
    await expect(presetMenu).toBeVisible();
    const selectedPreset = presetMenu.locator('[data-preset-id="pencil-hb"]');
    await expect(selectedPreset).toHaveAttribute("aria-checked", "true");
    await window.keyboard.press("Escape");
    await presetTrigger.focus();
    await presetTrigger.press("ArrowDown");
    await expect(presetMenu).toBeVisible();
    await expect(selectedPreset).toBeFocused();
    await window.keyboard.press("ArrowDown");
    await expect(presetMenu.locator('[data-preset-id="pencil-2b"]')).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(presetTrigger).toHaveAttribute("data-active-preset-id", "pencil-2b");
    await expect(surface).toHaveAttribute("data-drawing-color", colorBeforePreset ?? "");
    await expect(surface).toHaveAttribute("data-drawing-width", "3");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.86");
    await expect(surface).toHaveAttribute("data-drawing-smoothing", "0.18");
    await expect(presetTrigger).toBeFocused();
    await presetTrigger.click();
    await window.keyboard.press("Escape");
    await expect(presetMenu).toHaveCount(0);
    await expect(presetTrigger).toBeFocused();
    await presetTrigger.click();
    await window.getByTestId("tool-options-title").click();
    await expect(presetMenu).toHaveCount(0);

    const shapesButton = toolDock.getByRole("button", { name: "Shapes", exact: true });
    await shapesButton.click();
    const shapesWidget = window.getByTestId("shapes-widget");
    const rectangleButton = shapesWidget.getByRole("button", { name: "Rectangle", exact: true });
    await expect(shapesWidget).toBeVisible();
    await expect(rectangleButton).toHaveAttribute("aria-pressed", "true");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await drawBox(window, mapping.pageToScreen(180, 180), mapping.pageToScreen(340, 290));
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-last-created-shape-type", "rectangle");

    await shapesButton.click();
    const ellipseButton = shapesWidget.getByRole("button", { name: "Ellipse", exact: true });
    await ellipseButton.click();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ellipse");
    await expect(window.getByText("Tip: Hold Shift → Draw a perfect circle")).toBeVisible();
    await drawBox(window, mapping.pageToScreen(390, 190), mapping.pageToScreen(530, 300));
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(surface).toHaveAttribute("data-last-created-shape-type", "ellipse");

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await shapesButton.click();
    await expect(shapesWidget).toBeVisible();
    await expect(ellipseButton).toHaveAttribute("aria-pressed", "true");
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ellipse");
    await shapesButton.click();
    await expect(shapesWidget).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-active-editor-tool", "ellipse");
    await drawBox(window, mapping.pageToScreen(300, 420), mapping.pageToScreen(480, 520));
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await expect(surface).toHaveAttribute("data-last-created-shape-type", "ellipse");

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await expect(surface).toHaveAttribute("data-selected-object-type", "ellipse");
    const frameBefore = await frameDiagnostics(vectorCanvas);
    const initialTopEdge = distance(frameBefore.corners[0]!, frameBefore.corners[1]!);
    const selectedBounds = await selectedBoundsFromSurface(surface);
    const center = {
      x: selectedBounds.x + selectedBounds.width / 2,
      y: selectedBounds.y + selectedBounds.height / 2,
    };
    const rotationHandle = mapping.pageToScreen(
      frameBefore.rotationHandle.x,
      frameBefore.rotationHandle.y,
    );
    await window.mouse.move(rotationHandle.x, rotationHandle.y);
    await expect(inkCanvas).toHaveAttribute("data-manipulation-cursor", "rotation");
    expect(await inkCanvas.evaluate((canvas) => canvas.style.cursor)).toContain("16 16");
    await window.mouse.down();
    await window.keyboard.down("Shift");
    const radius = distance(center, frameBefore.rotationHandle);
    const snappedTarget = mapping.pageToScreen(
      center.x + Math.cos(-Math.PI / 4) * radius,
      center.y + Math.sin(-Math.PI / 4) * radius,
    );
    await window.mouse.move(snappedTarget.x, snappedTarget.y, { steps: 5 });
    const angleIndicator = window.getByTestId("rotation-angle-indicator");
    await expect(surface).toHaveAttribute("data-rotation-snap-active", "true");
    await expect(angleIndicator).toHaveAttribute("data-rotation-indicator", "visible");
    await expect(angleIndicator).toHaveText("45°");
    await window.screenshot({
      path: path.join(screenshotDirectory, "01-oriented-rotation.png"),
      animations: "disabled",
    });
    // Electron screenshot capture may release browser pointer capture; repeat the same
    // fully asserted gesture before testing commit when that host-only interruption occurs.
    if ((await surface.getAttribute("data-manipulation-phase")) !== "dragging") {
      await window.mouse.up();
      await window.keyboard.up("Shift");
      await window.mouse.move(rotationHandle.x, rotationHandle.y);
      await expect(inkCanvas).toHaveAttribute("data-manipulation-cursor", "rotation");
      await window.mouse.down();
      await window.keyboard.down("Shift");
      await window.mouse.move(snappedTarget.x, snappedTarget.y, { steps: 5 });
      await expect(surface).toHaveAttribute("data-rotation-snap-active", "true");
      await expect(angleIndicator).toHaveAttribute("data-rotation-indicator", "visible");
      await expect(angleIndicator).toHaveText("45°");
    }
    await inkCanvas.dispatchEvent("pointerup", {
      button: 0,
      buttons: 0,
      clientX: snappedTarget.x,
      clientY: snappedTarget.y,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
      shiftKey: true,
    });
    await window.mouse.up();
    await window.keyboard.up("Shift");
    await expect(angleIndicator).toHaveAttribute("data-rotation-indicator", "hidden");
    await expect
      .poll(async () => Number(await surface.getAttribute("data-selected-object-rotation")))
      .toBeCloseTo(Math.PI / 4, 4);
    await expect(vectorCanvas).toHaveAttribute(
      "data-vector-selection-rotation",
      String(Math.PI / 4),
    );

    const frameAfter = await frameDiagnostics(vectorCanvas);
    expect(distance(frameAfter.corners[0]!, frameAfter.corners[1]!)).toBeCloseTo(initialTopEdge, 5);
    const rotatedCorner = mapping.pageToScreen(frameAfter.corners[0]!.x, frameAfter.corners[0]!.y);
    await window.mouse.move(rotatedCorner.x, rotatedCorner.y);
    await expect(inkCanvas).toHaveAttribute("data-manipulation-cursor", "nwse-resize");
    await window.mouse.down();
    const scaleTarget = mapping.pageToScreen(
      center.x + (frameAfter.corners[0]!.x - center.x) * 1.2,
      center.y + (frameAfter.corners[0]!.y - center.y) * 1.2,
    );
    await window.mouse.move(scaleTarget.x, scaleTarget.y, { steps: 4 });
    await window.mouse.up();
    expect(Number(await surface.getAttribute("data-selected-object-scale"))).toBeGreaterThan(1);
    await expect(window.getByTestId("shape-editing-toolbar")).toHaveAttribute(
      "data-toolbar-state",
      "visible",
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function pageMapping(inkCanvas: Locator, surface: Locator) {
  const canvasBounds = await inkCanvas.boundingBox();
  if (canvasBounds === null) throw new Error("Ink canvas has no visible bounds.");
  const viewportWidth = Number(await surface.getAttribute("data-viewport-width"));
  const viewportHeight = Number(await surface.getAttribute("data-viewport-height"));
  const pageX = Number(await surface.getAttribute("data-viewport-page-x"));
  const pageY = Number(await surface.getAttribute("data-viewport-page-y"));
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const scaleX = canvasBounds.width / viewportWidth;
  const scaleY = canvasBounds.height / viewportHeight;
  return {
    canvasBounds,
    pageToScreen: (x: number, y: number) => ({
      x: canvasBounds.x + (pageX + x * zoom) * scaleX,
      y: canvasBounds.y + (pageY + y * zoom) * scaleY,
    }),
  };
}

async function drawBox(
  window: Page,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
) {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 5 });
  await window.mouse.up();
}

async function frameDiagnostics(vectorCanvas: Locator) {
  await expect(vectorCanvas).toHaveAttribute("data-vector-selection-frame-corners", /^\[/u);
  const corners = JSON.parse(
    (await vectorCanvas.getAttribute("data-vector-selection-frame-corners")) ?? "[]",
  ) as readonly Readonly<{ x: number; y: number }>[];
  const rotationHandle = JSON.parse(
    (await vectorCanvas.getAttribute("data-vector-rotation-handle")) ?? "null",
  ) as Readonly<{ x: number; y: number }>;
  expect(corners).toHaveLength(4);
  return { corners, rotationHandle };
}

async function selectedBoundsFromSurface(surface: Locator) {
  return {
    x: Number(await surface.getAttribute("data-selected-object-bounds-x")),
    y: Number(await surface.getAttribute("data-selected-object-bounds-y")),
    width: Number(await surface.getAttribute("data-selected-object-bounds-width")),
    height: Number(await surface.getAttribute("data-selected-object-bounds-height")),
  };
}

function distance(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
