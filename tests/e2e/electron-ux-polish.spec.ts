import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("keeps a compact Tool Dock and active-tool Context Palette workflow", async () => {
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

    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const palette = window.getByTestId("context-tool-palette");
    const shapesWidget = window.getByTestId("shapes-widget");
    const contextHint = window.getByTestId("context-hint");
    const tooltipLayer = window.locator('[data-tooltip-layer="global"]');
    await expect(toolDock).toBeVisible();
    await expect(palette).toHaveCount(0);
    await expect(contextHint).toHaveAttribute("data-context-hint-tool", "Select");
    await expect(contextHint).toContainText("Tip: Alt + Click → Select object beneath");
    await expect(contextHint).toHaveAttribute("data-context-hint-motion", "fade-150ms");
    if (process.env.FOLIO_UI_CONSISTENCY_VISUAL_QA === "1") {
      await window.screenshot({
        path: path.join(repositoryRoot, "test-results/ui-consistency-context-hint.png"),
      });
    }
    await inkCanvas.evaluate((canvas) => {
      canvas.dataset.phase141LifecycleToken = "mounted-once";
    });

    const initialDock = await dockMetrics(toolDock);
    expect(initialDock.width).toBe(48);
    expect(initialDock.height).toBeLessThan(260);
    expect(initialDock.height).toBeGreaterThan(190);
    expect(initialDock.contentTopGap).toBeCloseTo(initialDock.contentBottomGap, 0);
    expect(initialDock.scrollHeight).toBeLessThanOrEqual(initialDock.clientHeight);
    expect(initialDock.overflowY).not.toBe("auto");
    expect(initialDock.overflowY).not.toBe("scroll");
    const selectButton = toolDock.getByRole("button", { name: "Select", exact: true });
    const penButton = toolDock.getByRole("button", { name: "Pen", exact: true });
    const selectButtonBounds = await selectButton.boundingBox();
    if (selectButtonBounds === null) throw new Error("Select button has no visible bounds.");
    await selectButton.hover();
    expect(await selectButton.boundingBox()).toEqual(selectButtonBounds);
    await selectButton.focus();
    expect(await selectButton.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
    expect(
      await selectButton.evaluate((button) => getComputedStyle(button).transitionDuration),
    ).toContain("0.1s");
    expect(
      await selectButton.evaluate((button) => getComputedStyle(button).transitionProperty),
    ).not.toContain("transform");
    const selectTooltip = window.getByRole("tooltip", { name: "Select", exact: true });
    await expect(selectTooltip).toBeVisible();
    await expect(selectTooltip).toHaveAttribute("data-tooltip-motion", "fade-120ms");
    await expect(selectTooltip).toHaveAttribute("data-tooltip-surface", "auxiliary-soft");
    await selectButton.click();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await selectButton.hover();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await window.mouse.move(500, 120);
    await selectButton.hover();
    await expect(selectTooltip).toBeVisible();
    await window.mouse.move(500, 120);
    await penButton.focus();
    await selectButton.focus();
    await expect(selectTooltip).toBeVisible();
    await selectButton.press("Enter");
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await penButton.focus();
    await selectButton.focus();
    await expect(selectTooltip).toBeVisible();
    expect(await toolDock.locator("button[title]").count()).toBe(0);
    expect(await toolDock.locator("svg[data-optical-alignment]").count()).toBe(5);
    await expect(selectButton.locator("svg")).toHaveAttribute(
      "data-optical-alignment",
      "down-right-1px",
    );
    expect(await inactiveIconColor(penButton)).not.toBe(await mutedTokenColor(window));

    await penButton.click();
    await expect(palette).toHaveCount(0);
    await penButton.click();
    await expect(palette).toBeVisible();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await expect(palette).toHaveAttribute("data-motion-profile", "professional");
    await expect(palette).toHaveAttribute("data-elevation", "temporary");
    await expect(toolDock).toHaveAttribute("data-elevation", "permanent");
    await expect(toolDock.getByRole("button", { name: "Pen", exact: true })).toHaveAttribute(
      "data-tool-active",
      "true",
    );
    await expect(selectButton).toHaveAttribute("data-tool-active", "false");
    await expect(contextHint).toHaveAttribute("data-context-hint-tool", "");
    await expect(contextHint).toContainText("Tip: Hold Space + Drag → Move canvas");
    await expect(inkCanvas).toHaveAttribute("data-desktop-tool-cursor", "pen");
    const penCursor = await inkCanvas.evaluate((canvas) => canvas.style.cursor);
    expect(penCursor).toContain("data:image/svg+xml");
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await window.mouse.move(500, 120);
    await penButton.hover();
    const penTooltip = window.getByRole("tooltip", { name: "Pen", exact: true });
    await expect(penTooltip).toBeVisible();
    await expect(tooltipLayer).toHaveCount(1);
    expect(await stackingLevel(tooltipLayer)).toBeGreaterThan(await parentStackingLevel(palette));
    expect(await rectanglesOverlap(penTooltip, palette)).toBe(true);
    if (process.env.FOLIO_UI_CONSISTENCY_VISUAL_QA === "1") {
      await window.screenshot({
        path: path.join(repositoryRoot, "test-results/ui-consistency-tooltip-layer.png"),
      });
    }
    await palette.evaluate((element) => {
      element.dataset.mountToken = "persistent-options-container";
    });
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(tooltipLayer).toHaveAttribute("aria-hidden", "true");
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Highlighter");
    await expect(inkCanvas).toHaveAttribute("data-desktop-tool-cursor", "highlighter");
    const highlighterCursor = await inkCanvas.evaluate((canvas) => canvas.style.cursor);
    expect(highlighterCursor).not.toBe(penCursor);
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await chooseColor(window, "#2563eb");
    const selectedColor = window.getByRole("button", { name: "Use color #2563eb" });
    await expect(selectedColor).toHaveAttribute("aria-pressed", "true");
    expect(
      await selectedColor.evaluate((button) => getComputedStyle(button).transitionProperty),
    ).toContain("box-shadow");
    await expectRecentlyUsedColor(window, "#2563eb", false);
    const customColor = window.getByLabel("Custom stroke color");
    await customColor.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setValue === undefined) throw new Error("Native color value setter is unavailable.");
      for (const color of ["#ef4444", "#22c55e", "#0ea5e9", "#8b5cf6"]) {
        setValue.call(input, color);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await expect(surface).toHaveAttribute("data-drawing-color", "#8b5cf6");
    await expect(window.getByText("#8b5cf6", { exact: true })).toBeVisible();
    await chooseColor(window, "#2563eb");
    await expect(surface).toHaveAttribute("data-drawing-color", "#2563eb");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "5.8");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "63");
    await expect(surface).toHaveAttribute("data-drawing-width", "5.8");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.63");
    const opacityInput = window.getByRole("spinbutton", { name: "Opacity value" });
    const opacitySlider = window.getByRole("slider", { name: "Opacity" });
    await opacityInput.focus();
    expect(
      await opacityInput.evaluate((input) =>
        input.parentElement === null ? "none" : getComputedStyle(input.parentElement).boxShadow,
      ),
    ).not.toBe("none");
    expect(await opacitySlider.evaluate((slider) => getComputedStyle(slider).height)).toBe("24px");
    await opacityInput.press("ArrowDown");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.62");
    await expect(opacitySlider).toHaveValue("0.62");
    await opacityInput.press("ArrowUp");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.63");
    await expect(opacitySlider).toHaveValue("0.63");
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-width",
      "5.8",
    );
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-opacity",
      "0.63",
    );
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-renderer",
      "canvas2d-bezier",
    );
    const previewScale = Number(
      await window
        .getByRole("img", { name: "Pen stroke preview" })
        .getAttribute("data-preview-render-scale"),
    );
    expect(
      Number(
        await window
          .getByRole("img", { name: "Pen stroke preview" })
          .getAttribute("data-preview-rendered-width"),
      ),
    ).toBeCloseTo(5.8 * previewScale);
    await expect(palette.locator("svg")).toHaveCount(0);
    const previewMetrics = await window
      .getByRole("img", { name: "Pen stroke preview" })
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return {
          physicalWidth: canvas.width,
          physicalHeight: canvas.height,
          dpr: window.devicePixelRatio,
        };
      });
    expect(previewMetrics.physicalWidth).toBe(Math.round(278 * previewMetrics.dpr));
    expect(previewMetrics.physicalHeight).toBe(Math.round(64 * previewMetrics.dpr));

    const widthSlider = window.getByRole("slider", { name: "Width" });
    await widthSlider.focus();
    await widthSlider.press("ArrowRight");
    await expect(surface).toHaveAttribute("data-drawing-width", "5.9");
    await widthSlider.press("Shift+ArrowRight");
    await expect(surface).toHaveAttribute("data-drawing-width", "6.9");
    await window
      .locator('[data-tool-option="strokeWidth"]')
      .dispatchEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    await expect(surface).toHaveAttribute("data-drawing-width", "7");
    const widthInput = window.getByRole("spinbutton", { name: "Width value" });
    await widthInput.focus();
    await widthInput.press("ArrowDown");
    await expect(surface).toHaveAttribute("data-drawing-width", "6.9");
    await expect(widthSlider).toHaveValue("6.9");
    await expect(window.locator('[data-tool-option="strokeWidth"]')).not.toHaveAttribute("title");
    await palette.getByText("Width", { exact: true }).dblclick();
    await expect(surface).toHaveAttribute("data-drawing-width", "6.9");
    await expect(widthSlider).toHaveValue("6.9");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "5.8");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "40");
    await expect(surface).toHaveAttribute("data-drawing-width", "40");
    await expect(widthSlider).toHaveValue("40");
    await expect(widthSlider).toHaveAttribute("max", "40");
    await expect(window.getByRole("img", { name: "Pen stroke preview" })).toHaveAttribute(
      "data-preview-width",
      "40",
    );
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "5.8");

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("12");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("72");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.34");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "13.7");
    await setNumericValue(window.getByRole("spinbutton", { name: "Opacity value" }), "100");
    await expect(surface).toHaveAttribute("data-drawing-width", "13.7");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "0.45");
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "40");
    await expect(surface).toHaveAttribute("data-drawing-width", "40");
    await expect(window.getByRole("slider", { name: "Width" })).toHaveAttribute("max", "40");
    await expect(window.getByRole("img", { name: "Highlighter stroke preview" })).toHaveAttribute(
      "data-preview-width",
      "40",
    );
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "13.7");
    await expect(window.getByRole("img", { name: "Highlighter stroke preview" })).toHaveAttribute(
      "data-preview-opacity",
      "0.45",
    );

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("5.8");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("63");

    const hostBounds = await host.boundingBox();
    if (hostBounds === null) throw new Error("Canvas host has no visible bounds.");
    const emptyWorkspacePoint = {
      x: hostBounds.x + hostBounds.width - 24,
      y: hostBounds.y + 24,
    };
    await window.mouse.click(emptyWorkspacePoint.x, emptyWorkspacePoint.y);
    await expect(palette).toHaveCount(0, { timeout: 1_000 });
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Highlighter");
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(shapesWidget).toBeVisible();
    await window.mouse.click(emptyWorkspacePoint.x, emptyWorkspacePoint.y);
    await expect(shapesWidget).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(shapesWidget).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(shapesWidget).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await expect(shapesWidget).toBeVisible();
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(shapesWidget).toHaveCount(0);
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await toolDock.getByRole("button", { name: "Eraser", exact: true }).click();
    await expect(inkCanvas).toHaveAttribute("data-desktop-tool-cursor", "eraser");
    const eraserCursor = await inkCanvas.evaluate((canvas) => canvas.style.cursor);
    expect(eraserCursor).not.toBe(penCursor);
    expect(eraserCursor).not.toBe(highlighterCursor);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("5.8");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("63");

    for (const futureTool of ["Pencil", "Marker", "Layers", "Reference", "AI"] as const) {
      await expect(toolDock.getByRole("button", { name: futureTool, exact: true })).toHaveCount(0);
    }
    await window.mouse.click(emptyWorkspacePoint.x, emptyWorkspacePoint.y);
    await expect(palette).toHaveCount(0, { timeout: 1_000 });
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();

    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);
    await drawPath(window, pageToScreen, [
      { x: 120, y: 180 },
      { x: 180, y: 190 },
      { x: 240, y: 180 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(palette).toHaveCount(0, { timeout: 1_000 });
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await expect(window.getByRole("spinbutton", { name: "Width value" })).toHaveValue("5.8");
    await expect(window.getByRole("spinbutton", { name: "Opacity value" })).toHaveValue("63");
    await expectRecentlyUsedColor(window, "#2563eb", true);

    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await drawPath(window, pageToScreen, [
      { x: 110, y: 280 },
      { x: 200, y: 280 },
      { x: 290, y: 280 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    expect((await strokeStyles(surface))[1]).toMatchObject({
      width: 13.7,
      opacity: 0.45,
      pressureEnabled: false,
    });

    await toolDock.getByRole("button", { name: "Select", exact: true }).click();
    await expect(palette).toHaveCount(0, { timeout: 1_000 });
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    for (let index = 0; index < 8; index += 1) {
      await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
      await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
      await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
      await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    }
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pen");
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");

    for (let index = 0; index < 4; index += 1) {
      await toolDock.getByRole("button", { name: "Select", exact: true }).click();
      await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    }
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(palette).toBeVisible();
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");
    expect(await dockMetrics(toolDock)).toEqual(initialDock);

    const objectCountBeforeReloadShortcut = await surface.getAttribute(
      "data-document-object-count",
    );
    await window.keyboard.press("Control+R");
    await window.waitForTimeout(300);
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      objectCountBeforeReloadShortcut ?? "",
    );

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "40");
    await drawPath(window, pageToScreen, [
      { x: 360, y: 380 },
      { x: 460, y: 380 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    expect((await strokeStyles(surface))[2]).toMatchObject({
      width: 40,
      pressureEnabled: true,
    });
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await setNumericValue(window.getByRole("spinbutton", { name: "Width value" }), "40");
    await drawPath(window, pageToScreen, [
      { x: 360, y: 480 },
      { x: 460, y: 480 },
    ]);
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    expect((await strokeStyles(surface))[3]).toMatchObject({
      width: 40,
      pressureEnabled: false,
    });
    await expect(palette).toHaveCount(0);
    await toolDock.getByRole("button", { name: "Highlighter", exact: true }).click();
    await expect(palette).toBeVisible();

    await window.setViewportSize({ width: 960, height: 720 });
    const compactDock = await dockMetrics(toolDock);
    expect(compactDock).toMatchObject({
      width: initialDock.width,
      height: initialDock.height,
      clientHeight: initialDock.clientHeight,
      scrollHeight: initialDock.scrollHeight,
      overflowY: initialDock.overflowY,
    });
    expect(compactDock.contentTopGap).toBeCloseTo(initialDock.contentTopGap, 2);
    expect(compactDock.contentBottomGap).toBeCloseTo(initialDock.contentBottomGap, 2);
    expect(compactDock.workspaceOffsetX).toBeCloseTo(initialDock.workspaceOffsetX, 3);
    expect(compactDock.workspaceCenterOffsetY).toBeCloseTo(initialDock.workspaceCenterOffsetY, 3);
    expect(compactDock.scrollHeight).toBeLessThanOrEqual(compactDock.clientHeight);
    await expect(palette).toBeVisible();
    await expect(inkCanvas).toHaveAttribute("data-phase141-lifecycle-token", "mounted-once");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function chooseColor(window: Page, color: string): Promise<void> {
  await window.getByRole("button", { name: `Use color ${color}` }).click();
}

async function expectRecentlyUsedColor(
  window: Page,
  color: string,
  expected: boolean,
): Promise<void> {
  const recentColor = window.getByRole("button", { name: `Use recent color ${color}` });
  if (expected) await expect(recentColor).toBeVisible();
  else await expect(recentColor).toHaveCount(0);
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

async function dockMetrics(toolDock: Locator): Promise<DockMetrics> {
  return toolDock.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const workspace = element.closest('[aria-label="Notebook workspace"]');
    if (workspace === null) throw new Error("Tool Dock is outside the editor workspace.");
    const workspaceBounds = workspace.getBoundingClientRect();
    const buttons = element.querySelectorAll("button");
    const firstButtonBounds = buttons.item(0).getBoundingClientRect();
    const lastButtonBounds = buttons.item(buttons.length - 1).getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: styles.overflowY,
      workspaceOffsetX: bounds.x - workspaceBounds.x,
      workspaceCenterOffsetY:
        bounds.y + bounds.height / 2 - (workspaceBounds.y + workspaceBounds.height / 2),
      contentTopGap: firstButtonBounds.top - bounds.top,
      contentBottomGap: bounds.bottom - lastButtonBounds.bottom,
    };
  });
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
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
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

async function stackingLevel(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number(getComputedStyle(element).zIndex));
}

async function parentStackingLevel(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    element.parentElement === null ? 0 : Number(getComputedStyle(element.parentElement).zIndex),
  );
}

async function rectanglesOverlap(first: Locator, second: Locator): Promise<boolean> {
  const firstBounds = await first.boundingBox();
  const secondBounds = await second.boundingBox();
  if (firstBounds === null || secondBounds === null) return false;
  return !(
    firstBounds.x + firstBounds.width <= secondBounds.x ||
    secondBounds.x + secondBounds.width <= firstBounds.x ||
    firstBounds.y + firstBounds.height <= secondBounds.y ||
    secondBounds.y + secondBounds.height <= firstBounds.y
  );
}

function pointTuple(point: Point): [number, number] {
  return [point.x, point.y];
}

interface DockMetrics {
  readonly width: number;
  readonly height: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly overflowY: string;
  readonly workspaceOffsetX: number;
  readonly workspaceCenterOffsetY: number;
  readonly contentTopGap: number;
  readonly contentBottomGap: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface StrokeStyleDiagnostic {
  readonly width: number;
  readonly opacity: number;
  readonly pressureEnabled: boolean;
}

async function inactiveIconColor(button: Locator): Promise<string> {
  return button.evaluate((element) => getComputedStyle(element).color);
}

async function mutedTokenColor(window: Page): Promise<string> {
  return window.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--folio-muted)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
}
