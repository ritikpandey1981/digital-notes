import path from "node:path";
import fs from "node:fs";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

async function launch(): Promise<{
  app: Awaited<ReturnType<typeof electron.launch>>;
  window: Page;
}> {
  const root = process.cwd();
  const app = await electron.launch({
    args: [path.join(root, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe"),
  });
  const window = await app.firstWindow();
  await window.setViewportSize({ width: 1440, height: 900 });
  await expect(window.locator('canvas[data-folio-renderer="true"]')).toHaveAttribute(
    "data-render-count",
    /[1-9]\d*/u,
  );
  return { app, window };
}

async function stroke(window: Page, originY: number): Promise<void> {
  await window.mouse.move(560, originY);
  await window.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await window.mouse.move(560 + step * 15, originY + Math.sin(step / 3) * 18);
  }
  await window.mouse.up();
  await window.waitForTimeout(60);
}

const depth = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-history-undo-depth"));
const objects = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-document-object-count"));
const pageCount = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-page-count"));
const pageOrder = async (surface: Locator): Promise<readonly string[]> =>
  JSON.parse((await surface.getAttribute("data-page-order")) ?? "[]") as string[];
const activePage = async (surface: Locator): Promise<string> =>
  (await surface.getAttribute("data-active-page-id")) ?? "";

async function renderedPaperColor(window: Page): Promise<string> {
  return window.locator('canvas[data-folio-renderer="true"]').evaluate((canvas) => {
    const target = canvas as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (context === null) throw new Error("Canvas context is unavailable.");
    const logicalWidth = Number(target.dataset.logicalWidth);
    const logicalHeight = Number(target.dataset.logicalHeight);
    const pageX = Number(target.dataset.pageX);
    const pageY = Number(target.dataset.pageY);
    const pageWidth = Number(target.dataset.pageWidth);
    const pageHeight = Number(target.dataset.pageHeight);
    const x = Math.round((pageX + pageWidth * 0.43) * (target.width / logicalWidth));
    const y = Math.round((pageY + pageHeight * 0.41) * (target.height / logicalHeight));
    const [red = 0, green = 0, blue = 0] = context.getImageData(x, y, 1, 1).data;
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  });
}

function overlaps(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  );
}

test("Phase 21 delivers multi-page sketchbook pages, geometry, and paper", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // 1. Launch defaults to a single A4 landscape blank page.
    await expect(surface).toHaveAttribute("data-page-count", "1");
    await expect(surface).toHaveAttribute("data-page-width", "1123");
    await expect(surface).toHaveAttribute("data-page-height", "794");
    await expect(surface).toHaveAttribute("data-page-orientation", "landscape");
    await expect(surface).toHaveAttribute("data-page-paper-type", "blank");
    await expect(surface).toHaveAttribute("data-layer-count", "1");
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);

    // 2-3. Navigator and Page Settings open from discoverable controls.
    await window.getByTestId("pages-toggle").click();
    const navigator = window.getByTestId("page-navigator");
    await expect(navigator).toBeVisible();
    const firstPageId = await activePage(surface);
    await navigator.getByTestId(`page-actions-${firstPageId}`).click();
    await window.getByTestId(`page-settings-${firstPageId}`).click();
    const settings = window.getByTestId("page-settings");
    await expect(settings).toBeVisible();

    // 4-6. Orientation, presets, and custom dimensions all commit once each.
    const historyBeforeGeometry = await depth(surface);
    await settings.getByTestId("page-orientation-portrait").click();
    await expect(surface).toHaveAttribute("data-page-width", "794");
    await expect(surface).toHaveAttribute("data-page-orientation", "portrait");
    expect(await depth(surface)).toBe(historyBeforeGeometry + 1);
    await settings.getByTestId("page-orientation-landscape").click();
    await expect(surface).toHaveAttribute("data-page-width", "1123");
    await expect(surface).toHaveAttribute("data-page-orientation", "landscape");

    await settings.getByTestId("page-orientation-portrait").click();
    await settings.getByTestId("page-preset").selectOption("a5");
    await expect(surface).toHaveAttribute("data-page-width", "559");
    await settings.getByTestId("page-preset").selectOption("letter");
    await expect(surface).toHaveAttribute("data-page-width", "816");
    await settings.getByTestId("page-preset").selectOption("square");
    await expect(surface).toHaveAttribute("data-page-orientation", "square");

    // Typing a dimension is draft state; only Enter commits.
    const historyBeforeCustom = await depth(surface);
    const widthField = settings.getByTestId("page-width");
    await widthField.click();
    await widthField.fill("1400");
    expect(await depth(surface)).toBe(historyBeforeCustom);
    await widthField.press("Enter");
    await expect(surface).toHaveAttribute("data-page-width", "1400");
    expect(await depth(surface)).toBe(historyBeforeCustom + 1);
    await expect(settings.getByTestId("page-preset")).toHaveValue("custom");

    // Fit Page must recover an extreme custom page.
    await window.getByRole("button", { name: /Zoom options/i }).click();
    await window.getByRole("menuitem", { name: "Fit Page" }).click();
    const extremeFit = await window.evaluate(() => {
      const canvas = document.querySelector('canvas[data-folio-renderer="true"]');
      return {
        pageX: Number((canvas as HTMLElement)?.dataset.pageX),
        pageWidth: Number((canvas as HTMLElement)?.dataset.pageWidth),
        logicalWidth: Number((canvas as HTMLElement)?.dataset.logicalWidth),
      };
    });
    expect(extremeFit.pageX).toBeGreaterThanOrEqual(0);
    expect(extremeFit.pageX + extremeFit.pageWidth).toBeLessThanOrEqual(
      extremeFit.logicalWidth + 1,
    );

    // Choosing a preset while landscape keeps the landscape orientation.
    await settings.getByTestId("page-preset").selectOption("a4");
    await expect(surface).toHaveAttribute("data-page-width", "1123");
    await settings.getByTestId("page-orientation-portrait").click();
    await expect(surface).toHaveAttribute("data-page-width", "794");

    // 7-11. Every paper type commits once, and paper color is independent.
    for (const paper of ["ruled", "grid", "dotted", "isometric", "blank"] as const) {
      const before = await depth(surface);
      await settings.getByTestId(`paper-type-${paper}`).click();
      await expect(surface).toHaveAttribute("data-page-paper-type", paper);
      expect(await depth(surface)).toBe(before + 1);
    }
    const baseCanvas = window.locator('canvas[data-folio-renderer="true"]');
    const historyBeforePaperColor = await depth(surface);
    const renderBeforePaperColor = Number(await baseCanvas.getAttribute("data-render-count"));
    await settings.getByTestId("paper-color-fbf3e0").click();
    await expect(surface).toHaveAttribute("data-page-paper-color", "#fbf3e0");
    await expect.poll(() => renderedPaperColor(window)).toBe("#fbf3e0");
    expect(await depth(surface)).toBe(historyBeforePaperColor + 1);
    // Paper color must not touch the artwork color system.
    const brushColor = await surface.getAttribute("data-drawing-color");
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-paper-color", "#fffdf8");
    await expect(surface).toHaveAttribute("data-drawing-color", brushColor ?? "");
    await expect.poll(() => renderedPaperColor(window)).toBe("#fffdf8");
    expect(Number(await baseCanvas.getAttribute("data-render-count"))).toBeGreaterThan(
      renderBeforePaperColor,
    );
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-page-paper-color", "#fbf3e0");
    await expect.poll(() => renderedPaperColor(window)).toBe("#fbf3e0");

    // Paper type Undo/Redo follows the same compositor synchronization path.
    await settings.getByTestId("paper-type-grid").click();
    await expect(surface).toHaveAttribute("data-page-paper-type", "grid");
    const renderBeforePaperTypeUndo = Number(await baseCanvas.getAttribute("data-render-count"));
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-paper-type", "blank");
    expect(Number(await baseCanvas.getAttribute("data-render-count"))).toBeGreaterThan(
      renderBeforePaperTypeUndo,
    );
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-page-paper-type", "grid");

    // Geometry restored by History also reaches the compositor without a Page switch.
    const pageViewportWidth = async (): Promise<number> =>
      Number(await surface.getAttribute("data-viewport-page-width"));
    const viewportWidthBeforeGeometryUndo = await pageViewportWidth();
    await settings.getByTestId("page-width").fill("900");
    await settings.getByTestId("page-width").press("Enter");
    await expect(surface).toHaveAttribute("data-page-width", "900");
    await expect.poll(pageViewportWidth).not.toBe(viewportWidthBeforeGeometryUndo);
    await settings.getByTestId("page-settings-close").focus();
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-width", "794");
    await expect.poll(pageViewportWidth).toBeCloseTo(viewportWidthBeforeGeometryUndo, 4);
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-page-width", "900");
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-width", "794");

    // 12-13. Draw on page 1 across two layers.
    await activateDockSlot(window, "pencil");
    await stroke(window, 300);
    await window.getByTestId("layers-toggle").click();
    await window.getByTestId("layers-add").click();
    await expect(surface).toHaveAttribute("data-layer-count", "2");
    const firstPageLayer = (await surface.getAttribute("data-active-layer-id")) ?? "";
    await stroke(window, 380);
    await window.getByTestId("layers-toggle").click();
    expect(await objects(surface)).toBe(2);

    // 14-15. Add Page inherits geometry but starts with default blank paper.
    const historyBeforeAdd = await depth(surface);
    await navigator.getByTestId("page-add").click();
    expect(await pageCount(surface)).toBe(2);
    expect(await depth(surface)).toBe(historyBeforeAdd + 1);
    const secondPageId = await activePage(surface);
    expect(secondPageId).not.toBe(firstPageId);
    expect(await objects(surface)).toBe(0);
    await expect(surface).toHaveAttribute("data-page-paper-type", "blank");
    await expect(surface).toHaveAttribute("data-page-paper-color", "#fffdf8");
    await expect(surface).toHaveAttribute("data-page-width", "794");
    await expect(surface).toHaveAttribute("data-layer-count", "1");
    // Switching pages must not leave stale selection or toolbar state.
    await expect(window.getByTestId("shape-editing-toolbar")).toHaveAttribute(
      "data-toolbar-state",
      "hidden",
    );

    // 16. Different content on page 2.
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await window.getByRole("button", { name: "Rectangle", exact: true }).click();
    await window.mouse.move(600, 300);
    await window.mouse.down();
    await window.mouse.move(800, 430, { steps: 6 });
    await window.mouse.up();
    expect(await objects(surface)).toBe(1);

    // 17-18. Page switching is exact, isolated, and records zero History.
    const historyBeforeSwitch = await depth(surface);
    await navigator.getByTestId(`page-select-${firstPageId}`).click();
    expect(await activePage(surface)).toBe(firstPageId);
    expect(await objects(surface)).toBe(2);
    await expect(surface).toHaveAttribute("data-layer-count", "2");
    await expect(surface).toHaveAttribute("data-page-paper-type", "grid");
    await expect(surface).toHaveAttribute("data-page-paper-color", "#fbf3e0");
    await expect(surface).toHaveAttribute("data-page-width", "794");
    // Each page remembers its own active layer.
    await expect(surface).toHaveAttribute("data-active-layer-id", firstPageLayer);

    await navigator.getByTestId(`page-select-${secondPageId}`).click();
    expect(await objects(surface)).toBe(1);
    await expect(surface).toHaveAttribute("data-layer-count", "1");
    expect(await depth(surface)).toBe(historyBeforeSwitch);

    // 19-20. Duplicating a populated page is one action with independent content.
    await navigator.getByTestId(`page-select-${firstPageId}`).click();
    const historyBeforeDuplicate = await depth(surface);
    await navigator.getByTestId(`page-actions-${firstPageId}`).click();
    await window.getByTestId(`page-duplicate-${firstPageId}`).click();
    expect(await pageCount(surface)).toBe(3);
    expect(await depth(surface)).toBe(historyBeforeDuplicate + 1);
    const duplicateId = await activePage(surface);
    expect(duplicateId).not.toBe(firstPageId);
    expect(await objects(surface)).toBe(2);
    await expect(surface).toHaveAttribute("data-layer-count", "2");

    await activateDockSlot(window, "pencil");
    await stroke(window, 460);
    expect(await objects(surface)).toBe(3);
    await expect(navigator).toHaveCount(0);
    await window.getByTestId("pages-toggle").click();
    await expect(navigator).toBeVisible();
    await navigator.getByTestId(`page-select-${firstPageId}`).click();
    // Editing the duplicate must never reach the source page.
    expect(await objects(surface)).toBe(2);
    await navigator.getByTestId(`page-select-${duplicateId}`).click();
    await window.keyboard.press("Control+z");
    expect(await objects(surface)).toBe(2);

    // 21-22. Reordering follows identity and undoes exactly.
    const orderBefore = await pageOrder(surface);
    expect(orderBefore).toEqual([firstPageId, duplicateId, secondPageId]);
    await navigator.getByTestId(`page-actions-${duplicateId}`).click();
    await window.getByTestId(`page-move-next-${duplicateId}`).click();
    expect(await pageOrder(surface)).toEqual([firstPageId, secondPageId, duplicateId]);
    expect(await activePage(surface)).toBe(duplicateId);
    await window.keyboard.press("Control+z");
    expect(await pageOrder(surface)).toEqual(orderBefore);
    await window.keyboard.press("Control+y");
    expect(await pageOrder(surface)).toEqual([firstPageId, secondPageId, duplicateId]);
    await window.keyboard.press("Control+z");

    // 23-24. Deleting a populated page falls back deterministically and undoes exactly.
    await navigator.getByTestId(`page-select-${duplicateId}`).click();
    const historyBeforeDelete = await depth(surface);
    const orderBeforeDelete = await pageOrder(surface);
    await navigator.getByTestId(`page-actions-${duplicateId}`).click();
    await window.getByTestId(`page-delete-${duplicateId}`).click();
    expect(await pageCount(surface)).toBe(2);
    expect(await depth(surface)).toBe(historyBeforeDelete + 1);
    // The next page becomes active.
    expect(await activePage(surface)).toBe(secondPageId);
    expect(await objects(surface)).toBe(1);

    await window.keyboard.press("Control+z");
    expect(await pageOrder(surface)).toEqual(orderBeforeDelete);
    await navigator.getByTestId(`page-select-${duplicateId}`).click();
    expect(await objects(surface)).toBe(2);
    await expect(surface).toHaveAttribute("data-layer-count", "2");

    // 26. Page switching remains zero History throughout.
    const historyFinal = await depth(surface);
    await navigator.getByTestId(`page-select-${firstPageId}`).click();
    await navigator.getByTestId(`page-select-${secondPageId}`).click();
    await navigator.getByTestId(`page-select-${firstPageId}`).click();
    expect(await depth(surface)).toBe(historyFinal);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Phase 21 keeps page surfaces usable and collision-free", async ({
  browserName,
}, testInfo) => {
  void browserName;
  test.setTimeout(200_000);
  const screenshotDirectory =
    process.env.FOLIO_SCREENSHOT_DIR ?? testInfo.outputPath("phase-21-pages");
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    await window.getByTestId("pages-toggle").click();
    const navigator = window.getByTestId("page-navigator");
    await expect(navigator).toBeVisible();

    // A canvas gesture dismisses the drawer without swallowing the stroke.
    await activateDockSlot(window, "pencil");
    await stroke(window, 320);
    await expect(navigator).toHaveCount(0);
    await window.getByTestId("pages-toggle").click();
    await expect(navigator).toBeVisible();

    // Many pages stay usable and the active page scrolls into view.
    for (let index = 0; index < 19; index += 1) {
      await navigator.getByTestId("page-add").click();
    }
    expect(await pageCount(surface)).toBe(20);
    const lastPageId = await activePage(surface);
    const listBounds = await window.evaluate(() => {
      const list = document.querySelector('[data-testid="page-list"]');
      const workspace = document.querySelector('[data-testid="editor-workspace"]');
      const navigatorElement = document.querySelector('[data-testid="page-navigator"]');
      if (list === null || workspace === null || navigatorElement === null) return null;
      return {
        listScrollWidth: list.scrollWidth,
        listClientWidth: list.clientWidth,
        navigatorRight: navigatorElement.getBoundingClientRect().right,
        workspaceRight: workspace.getBoundingClientRect().right,
      };
    });
    expect(listBounds).not.toBeNull();
    // The list scrolls rather than growing past the workspace.
    expect(listBounds!.listScrollWidth).toBeGreaterThan(listBounds!.listClientWidth);
    expect(listBounds!.navigatorRight).toBeLessThanOrEqual(listBounds!.workspaceRight);
    await expect(navigator.getByTestId(`page-select-${lastPageId}`)).toBeInViewport();

    await window.screenshot({
      path: path.join(screenshotDirectory, "01-many-pages-1440.png"),
      animations: "disabled",
    });

    // Page Settings and the Picker remain collision-free in their supported
    // pairing. Layers intentionally owns the same slot and is checked next.
    await navigator.getByTestId(`page-actions-${lastPageId}`).click();
    await window.getByTestId(`page-settings-${lastPageId}`).click();
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await window.getByTestId("quick-color-current").click();
    const picker = window.getByTestId("full-color-picker");
    await expect(picker).toBeVisible();
    expect(
      overlaps(
        (await picker.boundingBox())!,
        (await window.getByTestId("page-settings").boundingBox())!,
      ),
    ).toBe(false);
    await window.keyboard.press("Escape");
    await window.getByTestId("page-settings-close").click();
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await window.getByTestId("quick-color-current").click();
    await expect(picker).toBeVisible();

    for (const [width, height] of [
      [1440, 900],
      [960, 640],
    ] as const) {
      await window.setViewportSize({ width, height });
      await window.waitForTimeout(400);
      const layout = await window.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector(selector);
          if (element === null) return null;
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          };
        };
        return {
          navigator: rect('[data-testid="page-navigator"]'),
          layers: rect('[data-testid="layers-panel"]'),
          picker: rect('[data-testid="full-color-picker"]'),
          utilityRail: rect('[data-testid="workspace-utility-rail"]'),
          quickRail: rect('[data-testid="quick-color-rail"]'),
          viewportControls: rect('[data-testid="viewport-controls"]'),
          hint: rect('[data-testid="context-hint"]'),
          workspace: rect('[data-testid="editor-workspace"]'),
          canvas: rect('canvas[data-folio-renderer="true"]'),
        };
      });
      expect(layout.layers).not.toBeNull();
      expect(layout.picker).not.toBeNull();
      if (width === 960) {
        // At the impossible minimum arrangement the lower-priority filmstrip
        // yields, rather than leaving a narrow actionable overlap.
        expect(layout.navigator).toBeNull();
      } else {
        expect(layout.navigator).not.toBeNull();
        expect(overlaps(layout.navigator!, layout.viewportControls!)).toBe(false);
        expect(overlaps(layout.navigator!, layout.hint!)).toBe(false);
        expect(overlaps(layout.navigator!, layout.picker!)).toBe(false);
      }
      expect(overlaps(layout.layers!, layout.picker!)).toBe(false);
      expect(overlaps(layout.utilityRail!, layout.picker!)).toBe(false);
      expect(overlaps(layout.quickRail!, layout.picker!)).toBe(false);
      expect(overlaps(layout.picker!, layout.viewportControls!)).toBe(false);
      if (layout.navigator !== null) expect(layout.navigator.bottom).toBeLessThanOrEqual(height);
      // Opening panels must never resize the canvas.
      expect(Math.round(layout.canvas!.width)).toBe(Math.round(layout.workspace!.width));
      expect(Math.round(layout.canvas!.height)).toBe(Math.round(layout.workspace!.height));
      await window.screenshot({
        path: path.join(screenshotDirectory, `02-surfaces-${width}x${height}.png`),
        animations: "disabled",
      });
    }

    // Repeat at the BrowserWindow's declared minimum with Tool Options in the
    // occupied-zone set. The Picker stays usable; Pages yields deterministically.
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("full-color-picker")).toHaveCount(0);
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);
    const minimum = await app.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      const [width, height] = target?.getMinimumSize() ?? [960, 640];
      target?.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 320));
      return { width, height };
    });
    await activateDockSlot(window, "pen");
    await openSlotToolOptions(window, "pen");
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await window.getByTestId("pages-toggle").click();
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await window.getByTestId("quick-color-current").click();
    await expect(window.getByTestId("full-color-picker")).toBeVisible();
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);
    const minimumLayout = await window.evaluate(() => {
      const rect = (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (element === null) return null;
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      };
      return {
        picker: rect("full-color-picker"),
        toolOptions: rect("context-tool-palette"),
        utilityRail: rect("workspace-utility-rail"),
      };
    });
    expect(minimum.width).toBeGreaterThan(0);
    expect(minimum.height).toBeGreaterThan(0);
    expect(minimumLayout.picker).not.toBeNull();
    expect(minimumLayout.toolOptions).not.toBeNull();
    expect(overlaps(minimumLayout.picker!, minimumLayout.toolOptions!)).toBe(false);
    expect(overlaps(minimumLayout.picker!, minimumLayout.utilityRail!)).toBe(false);
  } finally {
    await app.close();
  }
});
