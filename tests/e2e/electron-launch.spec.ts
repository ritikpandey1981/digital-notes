import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("launches the shell with the Phase 11 History-backed manipulation lifecycle", async () => {
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
    await expect(window).toHaveTitle("Folio");
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    await expect(toolDock).toBeVisible();
    for (const obsoleteTool of ["Move", "Rotate", "Scale"] as const) {
      await expect(toolDock.getByRole("button", { name: obsoleteTool, exact: true })).toHaveCount(
        0,
      );
    }
    for (const retainedTool of [
      "Select",
      "Pen",
      "Highlighter",
      "Eraser",
      "Shape",
      "Text",
      "Image",
      "Duplicate selected object",
      "Delete selected object",
      "More tools",
    ] as const) {
      await expect(toolDock.getByRole("button", { name: retainedTool, exact: true })).toBeVisible();
    }
    const moreTools = toolDock.getByRole("button", { name: "More tools" });
    await moreTools.click();
    for (const action of ["Table", "Sticky Note"] as const) {
      await expect(window.getByRole("menuitem", { name: action, exact: true })).toBeVisible();
    }
    await window.keyboard.press("Escape");
    await expect(window.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await expect(window.getByLabel("Notebook workspace")).toBeVisible();
    const canvasHost = window.getByTestId("canvas-host");
    const canvasSurface = window.getByTestId("canvas-surface");
    await expect(canvasHost).toHaveAttribute("data-canvas-state", "ready");
    const canvas = canvasHost.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = canvasHost.locator("canvas[data-folio-layer='ink']");
    const selectionCanvas = canvasHost.locator("canvas[data-folio-layer='selection']");
    const manipulationCanvas = canvasHost.locator(
      "canvas[data-folio-layer='manipulation-preview']",
    );
    await expect(canvas).toBeVisible();
    await expect(inkCanvas).toBeVisible();
    await expect(selectionCanvas).toBeVisible();
    await expect(manipulationCanvas).toBeVisible();
    await expect(canvasHost).toHaveAttribute("data-ink-state", "ready");
    await expect(canvasSurface).toHaveAttribute("data-document-state", "ready");
    await expect(canvasSurface).toHaveAttribute("data-selection-capability", "ready");
    await expect(canvasSurface).toHaveAttribute("data-manipulation-capability", "ready");
    await expect(canvasSurface).toHaveAttribute("data-history-capability", "ready");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "0");
    await expect(canvasSurface).toHaveAttribute("data-history-can-undo", "false");
    await expect(canvasSurface).toHaveAttribute("data-history-can-redo", "false");
    await expect(canvas).toHaveAttribute("data-render-count", /[1-9]\d*/);
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(inkCanvas).toHaveAttribute("data-document-objects-immutable", "true");
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await expect(selectionCanvas).toHaveAttribute("data-selection-version", "0");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");
    await canvas.evaluate((element) => element.setAttribute("data-mount-probe", "retained"));
    await inkCanvas.evaluate((element) => element.setAttribute("data-ink-mount-probe", "retained"));
    await selectionCanvas.evaluate((element) =>
      element.setAttribute("data-selection-mount-probe", "retained"),
    );
    await manipulationCanvas.evaluate((element) =>
      element.setAttribute("data-manipulation-mount-probe", "retained"),
    );
    await expect(window.getByText("Page 1 of 12")).toBeVisible();

    const metrics = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        physicalWidth: canvasElement.width,
        physicalHeight: canvasElement.height,
        logicalWidth: Number(canvasElement.dataset.logicalWidth),
        logicalHeight: Number(canvasElement.dataset.logicalHeight),
        dpr: Number(canvasElement.dataset.devicePixelRatio),
        pageX: Number(canvasElement.dataset.pageX),
        pageY: Number(canvasElement.dataset.pageY),
        pageWidth: Number(canvasElement.dataset.pageWidth),
        pageHeight: Number(canvasElement.dataset.pageHeight),
      };
    });
    expect(metrics.physicalWidth).toBe(Math.round(metrics.logicalWidth * metrics.dpr));
    expect(metrics.physicalHeight).toBe(Math.round(metrics.logicalHeight * metrics.dpr));
    expect(metrics.pageX + metrics.pageWidth / 2).toBeCloseTo(metrics.logicalWidth / 2, 5);
    expect(metrics.pageY + metrics.pageHeight / 2).toBeCloseTo(metrics.logicalHeight / 2, 5);

    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    const scaleX = inkBounds.width / metrics.logicalWidth;
    const scaleY = inkBounds.height / metrics.logicalHeight;
    const zoom = Number(await canvasSurface.getAttribute("data-viewport-zoom"));
    const pageToScreen = (x: number, y: number) => ({
      x: inkBounds.x + (metrics.pageX + x * zoom) * scaleX,
      y: inkBounds.y + (metrics.pageY + y * zoom) * scaleY,
    });
    const start = pageToScreen(
      (metrics.pageWidth / zoom) * 0.3,
      (metrics.pageHeight / zoom) * 0.35,
    );
    const baseRenderBeforeInk = Number(await canvas.getAttribute("data-render-count"));
    const inkRenderBefore = Number(await inkCanvas.getAttribute("data-ink-render-count"));
    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("contentinfo")).toContainText("Pen");
    await window.mouse.move(start.x, start.y);
    await window.mouse.down();
    await window.mouse.move(start.x + 45, start.y + 20, { steps: 5 });
    await window.mouse.move(start.x + 95, start.y - 10, { steps: 5 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "1");
    await expect(canvasSurface).toHaveAttribute("data-document-object-count", "1");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "1");
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeInk);
    expect(Number(await inkCanvas.getAttribute("data-ink-render-count"))).toBeGreaterThan(
      inkRenderBefore,
    );
    expect(Number(await inkCanvas.getAttribute("data-ink-dirty-width"))).toBeLessThan(
      metrics.pageWidth,
    );
    expect(Number(await inkCanvas.getAttribute("data-ink-dirty-height"))).toBeLessThan(
      metrics.pageHeight,
    );
    await expect
      .poll(async () => {
        const before = Number(await inkCanvas.getAttribute("data-ink-render-count"));
        await window.waitForTimeout(250);
        const after = Number(await inkCanvas.getAttribute("data-ink-render-count"));
        return after - before;
      })
      .toBe(0);

    await window.mouse.move(start.x + 20, start.y + 70);
    await window.mouse.down();
    await window.mouse.move(start.x + 70, start.y + 90, { steps: 5 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-ink-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-objects-immutable", "true");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "2");

    const baseRenderBeforeSelection = Number(await canvas.getAttribute("data-render-count"));
    const selectionRenderBefore = Number(
      await selectionCanvas.getAttribute("data-selection-render-count"),
    );
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await expect(window.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await window.mouse.click(start.x, start.y);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    await expect(canvasSurface).toHaveAttribute("data-selection-state", "selected");
    await expect(selectionCanvas).toHaveAttribute("data-selected-object-id", /.+/);
    await expect(selectionCanvas).toHaveAttribute("data-selected-object-type", "ink");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeSelection);
    await expect
      .poll(async () => Number(await selectionCanvas.getAttribute("data-selection-render-count")))
      .toBeGreaterThan(selectionRenderBefore);

    const selectedObjectId = await selectionCanvas.getAttribute("data-selected-object-id");
    const selectionVersion = await selectionCanvas.getAttribute("data-selection-version");
    const selectionRenderAfterClick = await selectionCanvas.getAttribute(
      "data-selection-render-count",
    );
    await window.mouse.click(start.x, start.y);
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    await expect(selectionCanvas).toHaveAttribute("data-selection-version", selectionVersion ?? "");
    await expect(selectionCanvas).toHaveAttribute(
      "data-selection-render-count",
      selectionRenderAfterClick ?? "",
    );

    const objectCountBeforeMove = await inkCanvas.getAttribute("data-document-object-count");
    const baseRenderBeforeMove = Number(await canvas.getAttribute("data-render-count"));
    const inkRenderBeforeMove = Number(await inkCanvas.getAttribute("data-ink-render-count"));
    const previewRenderBeforeMove = Number(
      await manipulationCanvas.getAttribute("data-manipulation-render-count"),
    );
    const historyVersionBeforeMove = Number(
      await canvasSurface.getAttribute("data-history-version"),
    );
    const historyExecutionCountBeforeMove = Number(
      await canvasSurface.getAttribute("data-history-execution-count"),
    );
    const boundsXBeforeMove = Number(
      await canvasSurface.getAttribute("data-selected-object-bounds-x"),
    );
    const boundsYBeforeMove = Number(
      await canvasSurface.getAttribute("data-selected-object-bounds-y"),
    );
    const boundsWidthBeforeMove = Number(
      await canvasSurface.getAttribute("data-selected-object-bounds-width"),
    );
    const boundsHeightBeforeMove = Number(
      await canvasSurface.getAttribute("data-selected-object-bounds-height"),
    );
    const moveStart = pageToScreen(
      boundsXBeforeMove + boundsWidthBeforeMove / 2,
      boundsYBeforeMove + boundsHeightBeforeMove / 2,
    );
    await expect(window.getByRole("button", { name: "Select", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await hoverForCursor(window, inkCanvas, moveStart, "grab");
    await window.mouse.down();
    await window.mouse.move(moveStart.x + 60, moveStart.y + 40, { steps: 6 });
    await expect(canvasSurface).toHaveAttribute("data-manipulation-phase", "dragging");
    await expect(canvasSurface).toHaveAttribute("data-manipulation-pointer-capture", "captured");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    await expect(manipulationCanvas).toHaveAttribute(
      "data-manipulation-object-id",
      selectedObjectId ?? "",
    );
    await expect
      .poll(async () =>
        Number(await manipulationCanvas.getAttribute("data-manipulation-render-count")),
      )
      .toBeGreaterThan(previewRenderBeforeMove);
    const translationBeforeLeavingCanvas = await canvasSurface.getAttribute(
      "data-manipulation-translation-x",
    );
    await window.mouse.move(inkBounds.x - 8, moveStart.y + 40, { steps: 3 });
    await expect(canvasSurface).toHaveAttribute("data-manipulation-phase", "dragging");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-preview-state", "active");
    expect(await canvasSurface.getAttribute("data-manipulation-translation-x")).not.toBe(
      translationBeforeLeavingCanvas,
    );
    await window.mouse.move(moveStart.x + 60, moveStart.y + 40, { steps: 3 });
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeMove);
    await window.mouse.up();
    await expect(canvasSurface).toHaveAttribute("data-manipulation-phase", "idle");
    await expect(canvasSurface).toHaveAttribute("data-manipulation-pointer-capture", "released");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    await expect(selectionCanvas).toHaveAttribute("data-selection-version", selectionVersion ?? "");
    await expect(inkCanvas).toHaveAttribute(
      "data-document-object-count",
      objectCountBeforeMove ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-document-object-count",
      objectCountBeforeMove ?? "",
    );
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "0");
    await expect(canvasSurface).toHaveAttribute("data-history-can-undo", "true");
    await expect(canvasSurface).toHaveAttribute("data-history-can-redo", "false");
    await expect(canvasSurface).toHaveAttribute("data-history-last-command-id", /.+/);
    expect(Number(await canvasSurface.getAttribute("data-history-version"))).toBe(
      historyVersionBeforeMove + 1,
    );
    expect(Number(await canvasSurface.getAttribute("data-history-execution-count"))).toBe(
      historyExecutionCountBeforeMove + 1,
    );
    expect(
      Number(await canvasSurface.getAttribute("data-selected-object-bounds-x")),
    ).toBeGreaterThan(boundsXBeforeMove);
    expect(
      Number(await canvasSurface.getAttribute("data-selected-object-bounds-y")),
    ).toBeGreaterThan(boundsYBeforeMove);
    expect(
      Number(await canvasSurface.getAttribute("data-selected-object-translation-x")),
    ).toBeGreaterThan(0);
    expect(
      Number(await canvasSurface.getAttribute("data-selected-object-translation-y")),
    ).toBeGreaterThan(0);
    expect(Number(await inkCanvas.getAttribute("data-ink-render-count"))).toBeGreaterThan(
      inkRenderBeforeMove,
    );
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeMove);
    await expect
      .poll(async () => {
        const before = Number(
          await manipulationCanvas.getAttribute("data-manipulation-render-count"),
        );
        await window.waitForTimeout(250);
        const after = Number(
          await manipulationCanvas.getAttribute("data-manipulation-render-count"),
        );
        return after - before;
      })
      .toBe(0);

    const committedBoundsX = await canvasSurface.getAttribute("data-selected-object-bounds-x");
    const committedBoundsY = await canvasSurface.getAttribute("data-selected-object-bounds-y");
    const committedTranslationX = await canvasSurface.getAttribute(
      "data-selected-object-translation-x",
    );
    const committedTranslationY = await canvasSurface.getAttribute(
      "data-selected-object-translation-y",
    );
    const inkRenderBeforeShortcutUndo = Number(
      await inkCanvas.getAttribute("data-ink-render-count"),
    );

    await window.keyboard.press("Control+Z");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "2");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "1");
    await expect(canvasSurface).toHaveAttribute("data-history-can-undo", "true");
    await expect(canvasSurface).toHaveAttribute("data-history-can-redo", "true");
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-x",
      String(boundsXBeforeMove),
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-y",
      String(boundsYBeforeMove),
    );
    await expect(canvasSurface).toHaveAttribute("data-selected-object-translation-x", "0");
    await expect(canvasSurface).toHaveAttribute("data-selected-object-translation-y", "0");
    await expect
      .poll(async () => Number(await inkCanvas.getAttribute("data-ink-render-count")))
      .toBeGreaterThan(inkRenderBeforeShortcutUndo);
    expect(Number(await canvas.getAttribute("data-render-count"))).toBe(baseRenderBeforeMove);

    await window.keyboard.press("Control+Shift+Z");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "0");
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-translation-x",
      committedTranslationX ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-translation-y",
      committedTranslationY ?? "",
    );

    await window.keyboard.press("Control+Z");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "2");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "1");
    await window.keyboard.press("Control+Y");
    await expect(canvasSurface).toHaveAttribute("data-history-undo-depth", "3");
    await expect(canvasSurface).toHaveAttribute("data-history-redo-depth", "0");
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-x",
      committedBoundsX ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-y",
      committedBoundsY ?? "",
    );

    const historyDepthAfterCommit = await canvasSurface.getAttribute("data-history-undo-depth");
    const historyVersionAfterCommit = await canvasSurface.getAttribute("data-history-version");
    await hoverForCursor(window, inkCanvas, { x: moveStart.x + 60, y: moveStart.y + 40 }, "grab");
    await window.mouse.down();
    await window.mouse.move(moveStart.x + 80, moveStart.y + 60, { steps: 4 });
    await expect(canvasSurface).toHaveAttribute("data-manipulation-phase", "dragging");
    await expect(canvasSurface).toHaveAttribute("data-manipulation-pointer-capture", "captured");
    await window
      .getByRole("button", { name: "Eraser", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(canvasSurface).toHaveAttribute("data-manipulation-phase", "idle");
    await expect(canvasSurface).toHaveAttribute("data-manipulation-pointer-capture", "released");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-preview-state", "empty");
    await expect(selectionCanvas).toHaveAttribute(
      "data-selected-object-id",
      selectedObjectId ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-x",
      committedBoundsX ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-bounds-y",
      committedBoundsY ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-translation-x",
      committedTranslationX ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-selected-object-translation-y",
      committedTranslationY ?? "",
    );
    await expect(inkCanvas).toHaveAttribute(
      "data-document-object-count",
      objectCountBeforeMove ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-history-undo-depth",
      historyDepthAfterCommit ?? "",
    );
    await expect(canvasSurface).toHaveAttribute(
      "data-history-version",
      historyVersionAfterCommit ?? "",
    );
    await window.mouse.up();
    await window.getByRole("button", { name: "Select", exact: true }).click();

    await window.getByRole("button", { name: "Show notification preview" }).click();
    await expect(window.getByRole("status")).toContainText("Shell ready");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByRole("dialog")).toContainText("Appearance");
    await window.getByRole("button", { name: "Cancel" }).click();

    await window.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(canvas).toHaveAttribute("data-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-mount-probe", "retained");
    await expect(selectionCanvas).toHaveAttribute("data-selection-mount-probe", "retained");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    await expect(canvasSurface).toHaveAttribute(
      "data-history-undo-depth",
      historyDepthAfterCommit ?? "",
    );

    const beforeResize = Number(await canvas.getAttribute("data-render-count"));
    const inkBeforeResize = Number(await inkCanvas.getAttribute("data-ink-render-count"));
    await window.setViewportSize({ width: 1_200, height: 760 });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-render-count")))
      .toBeGreaterThan(beforeResize);
    await expect
      .poll(async () => {
        const before = Number(await canvas.getAttribute("data-render-count"));
        await window.waitForTimeout(250);
        const after = Number(await canvas.getAttribute("data-render-count"));
        return after - before;
      })
      .toBe(0);
    await expect(canvas).toHaveAttribute("data-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-mount-probe", "retained");
    await expect(selectionCanvas).toHaveAttribute("data-selection-mount-probe", "retained");
    await expect(manipulationCanvas).toHaveAttribute("data-manipulation-mount-probe", "retained");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    await expect
      .poll(async () => Number(await inkCanvas.getAttribute("data-ink-render-count")))
      .toBeGreaterThan(inkBeforeResize);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");

    const resizedMetrics = await canvas.evaluate((element) => {
      const canvasElement = element as HTMLCanvasElement;
      return {
        logicalWidth: Number(canvasElement.dataset.logicalWidth),
        logicalHeight: Number(canvasElement.dataset.logicalHeight),
        pageX: Number(canvasElement.dataset.pageX),
        pageY: Number(canvasElement.dataset.pageY),
        pageWidth: Number(canvasElement.dataset.pageWidth),
        pageHeight: Number(canvasElement.dataset.pageHeight),
      };
    });
    const resizedInkBounds = await inkCanvas.boundingBox();
    if (resizedInkBounds === null) throw new Error("Resized ink canvas has no visible bounds.");
    const emptyPoint = {
      x:
        resizedInkBounds.x +
        (resizedMetrics.pageX + resizedMetrics.pageWidth * 0.85) *
          (resizedInkBounds.width / resizedMetrics.logicalWidth),
      y:
        resizedInkBounds.y +
        (resizedMetrics.pageY + resizedMetrics.pageHeight * 0.85) *
          (resizedInkBounds.height / resizedMetrics.logicalHeight),
    };
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(emptyPoint.x, emptyPoint.y);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await expect(selectionCanvas).toHaveAttribute("data-selected-object-id", "");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-document-object-count", "2");
    expect(consoleErrors).toEqual([]);

    await window.reload();
    const freshInkCanvas = window.locator("canvas[data-folio-layer='ink']");
    const freshSelectionCanvas = window.locator("canvas[data-folio-layer='selection']");
    const freshManipulationCanvas = window.locator(
      "canvas[data-folio-layer='manipulation-preview']",
    );
    await expect(freshInkCanvas).toBeVisible();
    await expect(freshSelectionCanvas).toBeVisible();
    await expect(freshManipulationCanvas).toBeVisible();
    await expect(freshInkCanvas).toHaveAttribute("data-ink-stroke-count", "0");
    await expect(freshInkCanvas).toHaveAttribute("data-document-object-count", "0");
    await expect(freshInkCanvas).toHaveAttribute("data-document-ink-object-count", "0");
    await expect(freshSelectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await expect(freshSelectionCanvas).toHaveAttribute("data-selection-version", "0");
    await expect(freshManipulationCanvas).toHaveAttribute(
      "data-manipulation-preview-state",
      "empty",
    );
    await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
      "data-history-capability",
      "ready",
    );
    await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
      "data-history-undo-depth",
      "0",
    );
    await expect(window.getByText("Page 1 of 12")).toBeVisible();
  } finally {
    await electronApp.close();
  }
});

async function hoverForCursor(
  window: Page,
  canvas: Locator,
  point: Readonly<{ x: number; y: number }>,
  cursor: string,
): Promise<void> {
  await expect
    .poll(async () => {
      await window.mouse.move(point.x + 0.5, point.y);
      await window.mouse.move(point.x, point.y);
      return canvas.getAttribute("data-manipulation-cursor");
    })
    .toBe(cursor);
}
