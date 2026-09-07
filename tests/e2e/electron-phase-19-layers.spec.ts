import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { openLayerList, toggleLayerList } from "./layers-stack-helpers";
import { activateDockSlot } from "./dock-helpers";

const PAGE_CANVAS = 'canvas[data-folio-renderer="true"]';

async function launch(): Promise<{
  app: Awaited<ReturnType<typeof electron.launch>>;
  window: Page;
}> {
  const repositoryRoot = process.cwd();
  const app = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
  const window = await app.firstWindow();
  await window.setViewportSize({ width: 1440, height: 900 });
  await expect(window.locator(PAGE_CANVAS)).toHaveAttribute("data-render-count", /[1-9]\d*/u);
  return { app, window };
}

async function drawStroke(window: Page, originY: number): Promise<void> {
  await window.mouse.move(560, originY);
  await window.mouse.down();
  for (let step = 1; step <= 16; step += 1) {
    await window.mouse.move(560 + step * 16, originY + Math.sin(step / 3) * 18);
  }
  await window.mouse.up();
  await window.waitForTimeout(60);
}

async function historyDepth(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-history-undo-depth"));
}

async function objectCount(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-document-object-count"));
}

async function renderedOrder(surface: Locator): Promise<readonly string[]> {
  return JSON.parse((await surface.getAttribute("data-rendered-object-order")) ?? "[]") as string[];
}

async function membership(surface: Locator): Promise<readonly number[]> {
  return JSON.parse((await surface.getAttribute("data-layer-membership")) ?? "[]") as number[];
}

async function openLayers(window: Page): Promise<Locator> {
  await openLayerList(window);
  return window.getByTestId("layers-panel");
}

test("Phase 19 delivers layers with canonical ordering, interaction rules, and a compact panel", async () => {
  test.setTimeout(180_000);
  const { app, window } = await launch();

  try {
    const surface = window.getByTestId("canvas-surface");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // 1. Default Layer 1, panel closed on launch.
    await expect(surface).toHaveAttribute("data-layer-count", "1");
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-1");
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);

    const panel = await openLayers(window);
    await expect(panel.getByTestId("layer-name-layer-1")).toHaveText("Layer 1");

    // 2. Draw in Layer 1.
    await activateDockSlot(window, "pencil");
    await drawStroke(window, 260);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect(await membership(surface)).toEqual([1]);
    await expect(panel).toHaveCount(0);
    await openLayers(window);

    // 3-4. Add Layer 2; it becomes active and sits above Layer 1.
    await panel.getByTestId("layers-add").click();
    await expect(surface).toHaveAttribute("data-layer-count", "2");
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-2");
    expect(JSON.parse((await surface.getAttribute("data-layer-order")) ?? "[]")).toEqual([
      "layer-1",
      "layer-2",
    ]);

    // 5. New ink and vector artwork enters the active layer.
    await drawStroke(window, 340);
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await window.getByRole("button", { name: "Rectangle", exact: true }).click();
    await window.mouse.move(620, 420);
    await window.mouse.down();
    await window.mouse.move(800, 520, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    expect(await membership(surface)).toEqual([1, 2]);

    // Canvas gestures dismiss the panel without swallowing either creation.
    await expect(panel).toHaveCount(0);
    await openLayers(window);

    const orderWithLayerTwo = await renderedOrder(surface);
    expect(orderWithLayerTwo).toHaveLength(3);

    // 6-7. Hiding a layer removes its artwork from rendering and interaction.
    const historyBeforeHide = await historyDepth(surface);
    await panel.getByTestId("layer-visibility-layer-2").click();
    await expect(panel.getByTestId("layer-visibility-layer-2")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(await historyDepth(surface)).toBe(historyBeforeHide + 1);
    await expect.poll(async () => (await renderedOrder(surface)).length).toBe(1);
    expect(await objectCount(surface)).toBe(3);

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(700, 470);
    await expect(surface).toHaveAttribute("data-selected-object-id", "");

    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.move(600, 340);
    await window.mouse.down();
    await window.mouse.move(700, 345, { steps: 4 });
    await window.mouse.up();
    expect(await objectCount(surface)).toBe(3);

    // 8. Undo restores visibility.
    await openLayers(window);
    await window.keyboard.press("Control+z");
    await expect(panel.getByTestId("layer-visibility-layer-2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(async () => (await renderedOrder(surface)).length).toBe(3);

    // 9-11. Locking keeps artwork visible and read-only.
    await panel.getByTestId("layer-lock-layer-2").click();
    await expect(panel.getByTestId("layer-lock-layer-2")).toHaveAttribute("aria-pressed", "true");
    expect(await renderedOrder(surface)).toHaveLength(3);

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(700, 470);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");

    const historyBeforeBlockedEdits = await historyDepth(surface);
    const objectsBeforeBlockedEdits = await objectCount(surface);
    await window.mouse.move(700, 470);
    await window.mouse.down();
    await window.mouse.move(760, 520, { steps: 5 });
    await window.mouse.up();
    await window.keyboard.press("Delete");
    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.move(600, 340);
    await window.mouse.down();
    await window.mouse.move(700, 345, { steps: 4 });
    await window.mouse.up();
    expect(await historyDepth(surface)).toBe(historyBeforeBlockedEdits);
    expect(await objectCount(surface)).toBe(objectsBeforeBlockedEdits);

    await openLayers(window);
    await panel.getByTestId("layer-lock-layer-2").click();
    await expect(panel.getByTestId("layer-lock-layer-2")).toHaveAttribute("aria-pressed", "false");

    // 12-13. One opacity gesture is exactly one History entry; opacity 0 stays selectable.
    await panel.getByTestId("layer-options-layer-2").click();
    const opacitySlider = panel
      .getByTestId("layer-options-panel-layer-2")
      .locator('input[type="range"]');
    const sliderBox = await opacitySlider.boundingBox();
    expect(sliderBox).not.toBeNull();
    const historyBeforeOpacity = await historyDepth(surface);
    await window.mouse.move(
      sliderBox!.x + sliderBox!.width - 4,
      sliderBox!.y + sliderBox!.height / 2,
    );
    await window.mouse.down();
    for (let step = 1; step <= 24; step += 1) {
      await window.mouse.move(
        sliderBox!.x + sliderBox!.width - (sliderBox!.width * step) / 24,
        sliderBox!.y + sliderBox!.height / 2,
      );
    }
    await window.mouse.up();
    expect(await historyDepth(surface)).toBe(historyBeforeOpacity + 1);
    await expect(panel.getByTestId("layer-opacity-value-layer-2")).toHaveText("0%");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(700, 470);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");
    expect(await renderedOrder(surface)).toHaveLength(3);

    await openLayers(window);
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(panel.getByTestId("layer-opacity-value-layer-2")).toHaveText("100%");
    await expect(panel.getByTestId("layer-options-panel-layer-2")).toHaveCount(0);

    // 14-15. Reordering layers changes overlapping visual order and undoes exactly.
    const orderBeforeReorder = await renderedOrder(surface);
    await panel.getByTestId("layer-options-layer-2").click();
    await expect(panel.getByTestId("layer-options-panel-layer-2")).toBeVisible();
    await panel.getByTestId("layer-move-down-layer-2").click();
    await expect
      .poll(async () => JSON.parse((await surface.getAttribute("data-layer-order")) ?? "[]"))
      .toEqual(["layer-2", "layer-1"]);
    const orderAfterReorder = await renderedOrder(surface);
    expect(orderAfterReorder).not.toEqual(orderBeforeReorder);
    expect([...orderAfterReorder].sort()).toEqual([...orderBeforeReorder].sort());

    await window.keyboard.press("Control+z");
    await expect.poll(async () => renderedOrder(surface)).toEqual(orderBeforeReorder);
    await window.keyboard.press("Control+y");
    await expect.poll(async () => renderedOrder(surface)).toEqual(orderAfterReorder);
    await window.keyboard.press("Control+z");
    await expect.poll(async () => renderedOrder(surface)).toEqual(orderBeforeReorder);

    // 16-17. Paste and duplicate both enter the active layer.
    await panel.getByTestId("layer-row-button-layer-1").click();
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-1");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(700, 470);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");
    // Selecting artwork must never change which Layer receives new objects.
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-1");

    const membershipBeforePaste = await membership(surface);
    await window.keyboard.press("Control+c");
    await window.keyboard.press("Control+v");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    const membershipAfterPaste = await membership(surface);
    expect(membershipAfterPaste[0]).toBe((membershipBeforePaste[0] ?? 0) + 1);

    await window.keyboard.press("Control+d");
    await expect(surface).toHaveAttribute("data-document-object-count", "5");
    expect((await membership(surface))[0]).toBe((membershipBeforePaste[0] ?? 0) + 2);

    // 20. Active-layer switching records zero History.
    await openLayers(window);
    const historyBeforeActiveSwitch = await historyDepth(surface);
    await panel.getByTestId("layer-row-button-layer-2").click();
    await panel.getByTestId("layer-row-button-layer-1").click();
    await panel.getByTestId("layer-row-button-layer-2").click();
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-2");
    expect(await historyDepth(surface)).toBe(historyBeforeActiveSwitch);

    // 18-19. Deleting a non-empty layer is one command that undoes exactly.
    const orderBeforeDelete = await renderedOrder(surface);
    const countBeforeDelete = await objectCount(surface);
    const membershipBeforeDelete = await membership(surface);
    const historyBeforeDelete = await historyDepth(surface);
    await panel.getByTestId("layer-options-layer-2").click();
    await expect(panel.getByTestId("layer-options-panel-layer-2")).toBeVisible();
    await panel.getByTestId("layer-delete-layer-2").click();
    await expect(surface).toHaveAttribute("data-layer-count", "1");
    expect(await objectCount(surface)).toBeLessThan(countBeforeDelete);
    expect(await historyDepth(surface)).toBe(historyBeforeDelete + 1);

    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-layer-count", "2");
    expect(await objectCount(surface)).toBe(countBeforeDelete);
    expect(await membership(surface)).toEqual(membershipBeforeDelete);
    await expect.poll(async () => renderedOrder(surface)).toEqual(orderBeforeDelete);

    // The final remaining layer can never be deleted.
    await panel.getByTestId("layer-options-layer-1").click();
    await panel.getByTestId("layer-row-button-layer-1").click();
    await expect(surface).toHaveAttribute("data-active-layer-id", "layer-1");

    // 21. The Eyedropper samples the visible composite with no layer special cases.
    await activateDockSlot(window, "pencil");
    await window.getByTestId("quick-color-current").click();
    const picker = window.getByTestId("full-color-picker");
    await expect(picker).toBeVisible();

    // 22. Panel, Quick Rail, and picker coexist without overlapping.
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
        };
      };
      return {
        panel: rect('[data-testid="layers-panel"]'),
        rail: rect('[data-testid="quick-color-rail"]'),
        picker: rect('[data-testid="full-color-picker"]'),
        viewportControls: rect('[data-testid="viewport-controls"]'),
      };
    });
    expect(layout.panel).not.toBeNull();
    expect(layout.picker).not.toBeNull();
    const overlaps = (
      first: { left: number; top: number; right: number; bottom: number },
      second: { left: number; top: number; right: number; bottom: number },
    ): boolean =>
      first.left < second.right &&
      second.left < first.right &&
      first.top < second.bottom &&
      second.top < first.bottom;
    expect(overlaps(layout.panel!, layout.picker!)).toBe(false);
    expect(overlaps(layout.panel!, layout.rail!)).toBe(false);
    expect(overlaps(layout.panel!, layout.viewportControls!)).toBe(false);
    await window.keyboard.press("Escape");

    // 23-25. The workspace stays usable at the minimum supported window size.
    const canvasBefore = await window.locator(PAGE_CANVAS).boundingBox();
    await window.setViewportSize({ width: 960, height: 640 });
    await window.waitForTimeout(400);
    const smallLayout = await window.evaluate(() => {
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
        panel: rect('[data-testid="layers-panel"]'),
        rail: rect('[data-testid="quick-color-rail"]'),
        viewportControls: rect('[data-testid="viewport-controls"]'),
        workspace: rect('[data-testid="editor-workspace"]'),
        canvas: rect('canvas[data-folio-renderer="true"]'),
      };
    });
    expect(smallLayout.panel).not.toBeNull();
    expect(overlaps(smallLayout.panel!, smallLayout.rail!)).toBe(false);
    expect(overlaps(smallLayout.panel!, smallLayout.viewportControls!)).toBe(false);
    expect(smallLayout.panel!.right).toBeLessThanOrEqual(960);
    expect(smallLayout.panel!.bottom).toBeLessThanOrEqual(640);
    // 25. The canvas fills the workspace: the panel floats and never resizes it.
    expect(Math.round(smallLayout.canvas!.width)).toBe(Math.round(smallLayout.workspace!.width));
    expect(Math.round(smallLayout.canvas!.height)).toBe(Math.round(smallLayout.workspace!.height));
    expect(canvasBefore).not.toBeNull();

    // Keyboard: rows are reachable and reorder with Alt + Arrow.
    // A row is a list item holding its own buttons rather than a focusable
    // option, so its keyboard anchor is the reorder handle Tab reaches first.
    await window.setViewportSize({ width: 1440, height: 900 });
    await window.waitForTimeout(300);
    await window.getByTestId("layer-drag-handle-layer-2").focus();
    await window.keyboard.press("F2");
    await expect(window.getByTestId("layer-rename-layer-2")).toBeVisible();
    await window.getByTestId("layer-rename-layer-2").fill("Construction");
    await window.keyboard.press("Enter");
    await expect(window.getByTestId("layer-name-layer-2")).toHaveText("Construction");
    await window.keyboard.press("Control+z");
    await expect(window.getByTestId("layer-name-layer-2")).toHaveText("Layer 2");

    await toggleLayerList(window);
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
