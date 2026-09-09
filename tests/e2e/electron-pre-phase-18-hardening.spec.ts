import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

test("hardens continuous edits, canvas lifetime, floating ownership, chrome, and Shapes", async () => {
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
    await window.setViewportSize({ width: 1200, height: 800 });
    const surface = window.getByTestId("canvas-surface");
    const canvasHost = window.getByTestId("canvas-host");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const toolDock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const shapeToolbar = window.getByTestId("shape-editing-toolbar");
    await expect(surface).toHaveAttribute("data-renderer-state", "ready");
    const mapping = await pageMapping(inkCanvas, surface);

    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await drawGesture(window, mapping.pageToScreen(220, 180), mapping.pageToScreen(430, 360));
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await expect(surface).toHaveAttribute("data-selected-object-type", "rectangle");
    const original = await selectedVectorStyle(surface);

    await shapeToolbar.getByRole("button", { name: "Stroke width" }).click();
    const widthSlider = shapeToolbar.getByRole("slider", { name: "Width" });
    await emitRangeGesture(widthSlider, ["3", "5", "8", "12"]);
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(12);
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(original.width);
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(12);

    await shapeToolbar.getByRole("button", { name: "Stroke opacity" }).click();
    const opacitySlider = shapeToolbar.getByRole("slider", { name: "Opacity" });
    await emitRangeGesture(opacitySlider, ["0.9", "0.7", "0.5", "0.35"]);
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    await expect.poll(async () => (await selectedVectorStyle(surface)).opacity).toBe(0.35);
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).opacity).toBe(1);
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).opacity).toBe(0.35);

    await shapeToolbar.getByLabel("Stroke color").click();
    const colorInput = window.getByRole("textbox", { name: "Hex color" });
    await emitColorGesture(colorInput, ["#dc2626", "#16a34a", "#2563eb", "#9333ea"]);
    await shapeToolbar.getByRole("button", { name: "Stroke width" }).click();
    await window.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "4");
    await expect.poll(async () => (await selectedVectorStyle(surface)).color).toBe("#9333ea");
    await window.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).color).toBe(original.color);
    await window.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await selectedVectorStyle(surface)).color).toBe("#9333ea");

    await shapeToolbar.getByRole("button", { name: "Stroke width" }).click();
    const cancelSlider = shapeToolbar.getByRole("slider", { name: "Width" });
    const depthBeforeCancel = await historyDepth(surface);
    await cancelSlider.focus();
    await cancelSlider.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 77 });
    await setRangeValues(cancelSlider, ["14", "18", "22"]);
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(22);
    await cancelSlider.press("Escape");
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(12);
    expect(await historyDepth(surface)).toBe(depthBeforeCancel);

    await shapeToolbar.getByRole("button", { name: "Stroke width" }).click();
    const widthPanel = shapeToolbar.getByRole("group", { name: "Width options" });
    const numericWidth = widthPanel.getByRole("spinbutton", { name: "Width value" });
    const depthBeforeNumeric = await historyDepth(surface);
    await numericWidth.fill("16");
    await numericWidth.press("Enter");
    expect(await historyDepth(surface)).toBe(depthBeforeNumeric + 1);
    await expect.poll(async () => (await selectedVectorStyle(surface)).width).toBe(16);

    const keyboardWidth = widthPanel.getByRole("slider", { name: "Width" });
    const depthBeforeArrow = await historyDepth(surface);
    await keyboardWidth.press("ArrowRight");
    expect(await historyDepth(surface)).toBe(depthBeforeArrow + 1);
    const depthBeforeShiftArrow = await historyDepth(surface);
    await keyboardWidth.press("Shift+ArrowRight");
    expect(await historyDepth(surface)).toBe(depthBeforeShiftArrow + 1);
    const depthBeforeWheel = await historyDepth(surface);
    await widthPanel.locator('[data-tool-option="strokeWidth"]').dispatchEvent("wheel", {
      deltaY: -100,
    });
    expect(await historyDepth(surface)).toBe(depthBeforeWheel + 1);

    await surface.evaluate((element) => {
      element.setAttribute("data-lifecycle-token", "preserve-session");
    });
    await shapeToolbar.getByRole("button", { name: "Duplicate" }).focus();
    await window.keyboard.press("Control+C");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "1");
    const lifecycleDepth = await historyDepth(surface);
    await window.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(surface).toHaveAttribute("data-lifecycle-token", "preserve-session");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-clipboard-object-count", "1");
    expect(await historyDepth(surface)).toBe(lifecycleDepth);
    await window.getByRole("button", { name: "Application menu", exact: true }).click();
    await window.getByRole("menuitem", { name: "Use dark appearance", exact: true }).click();
    await expect
      .poll(async () => canvasHost.getAttribute("data-latest-diagnostics-callback-generation"))
      .toBe(await canvasHost.getAttribute("data-render-count"));

    await openSlotToolOptions(window, "pen");
    const palette = window.getByTestId("context-tool-palette");
    await expect(palette).toBeVisible();
    const brushSizeSlider = palette.getByRole("slider", { name: "Size" });
    const documentDepthBeforeBrushSetting = await historyDepth(surface);
    await emitRangeGesture(brushSizeSlider, ["4", "7", "11"]);
    expect(await historyDepth(surface)).toBe(documentDepthBeforeBrushSetting);

    const scopeId = await palette.getAttribute("data-floating-widget-scope");
    await palette.getByRole("button", { name: "Pen preset" }).click();
    const presetMenu = window.getByTestId("brush-preset-menu");
    await expect(presetMenu).toHaveAttribute("data-floating-widget-owner", scopeId ?? "");
    await expect(palette).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(presetMenu).toHaveCount(0);
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("button", { name: "Pen preset" })).toBeFocused();

    await window.evaluate((owner) => {
      const ownedSurface = document.createElement("div");
      ownedSurface.dataset.testid = "nested-owned-surface";
      ownedSurface.setAttribute("data-floating-widget-owner", owner);
      const button = document.createElement("button");
      button.textContent = "Nested owned action";
      ownedSurface.appendChild(button);
      document.body.appendChild(ownedSurface);
    }, scopeId ?? "");
    await window.getByRole("button", { name: "Nested owned action" }).click();
    await expect(palette).toBeVisible();
    await window.getByTestId("nested-owned-surface").evaluate((element) => element.remove());
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    await openSlotToolOptions(window, "pen");
    await expect(palette).toBeVisible();
    const beforePageGesture = Number(await surface.getAttribute("data-document-object-count"));
    await drawGesture(window, mapping.pageToScreen(520, 420), mapping.pageToScreen(570, 440));
    // The first Page gesture dismisses settings and still commits the stroke.
    await expect(palette).toHaveCount(0);
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      String(beforePageGesture + 1),
    );

    await openSlotToolOptions(window, "pen");
    await expect(palette).toBeVisible();
    // Outside-page workspace is dismissal-only and does not alter artwork.
    await window.mouse.click(mapping.canvasBounds.x + 4, mapping.canvasBounds.y + 200);
    await expect(palette).toHaveCount(0);

    // Persistent chrome text stays unselectable. The workspace no longer
    // carries a wordmark, so the subject is the sketch's identity surface --
    // the one piece of prose the top chrome does show.
    const sketchName = window.getByTestId("top-chrome-sketch").getByTestId("sketch-name");
    await expect(sketchName).toHaveText("Untitled Sketch");
    await expect(sketchName).toHaveCSS("user-select", "none");
    await openSlotToolOptions(window, "pen");
    await expect(palette.getByText("Size", { exact: true })).toHaveCSS("user-select", "none");
    await expect(palette.getByRole("spinbutton", { name: "Size value" })).toHaveCSS(
      "user-select",
      "text",
    );
    await expect(surface).toHaveCSS("user-select", "auto");

    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    const shapesWidget = window.getByTestId("shapes-widget");
    await expect(shapesWidget.getByRole("button", { name: "Rectangle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await shapesWidget.getByRole("button", { name: "Ellipse", exact: true }).click();
    await activateDockSlot(window, "pen");
    await toolDock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expect(shapesWidget.getByRole("button", { name: "Ellipse" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(surface).toHaveAttribute("data-drawing-color", "#111111");
    await expect(surface).toHaveAttribute("data-drawing-width", "2");
    await expect(surface).toHaveAttribute("data-drawing-opacity", "1");
  } finally {
    await electronApp.close();
  }
});

async function emitRangeGesture(slider: Locator, values: readonly string[]): Promise<void> {
  await slider.dispatchEvent("pointerdown", { button: 0, isPrimary: true, pointerId: 71 });
  await setRangeValues(slider, values);
  await slider.dispatchEvent("pointerup", { button: 0, isPrimary: true, pointerId: 71 });
}

async function setRangeValues(slider: Locator, values: readonly string[]): Promise<void> {
  await slider.evaluate((element, nextValues) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setValue === undefined) throw new Error("Native range value setter is unavailable.");
    for (const value of nextValues) {
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, values);
}

async function emitColorGesture(input: Locator, colors: readonly string[]): Promise<void> {
  for (const color of colors) await input.fill(color);
}

async function selectedVectorStyle(surface: Locator): Promise<VectorStyleDiagnostic> {
  const selectedId = await surface.getAttribute("data-selected-object-id");
  const styles = JSON.parse(
    (await surface.getAttribute("data-document-vector-styles")) ?? "[]",
  ) as VectorStyleDiagnostic[];
  const selected = styles.find(({ id }) => id === selectedId);
  if (selected === undefined) throw new Error("Selected vector style diagnostic is unavailable.");
  return selected;
}

async function historyDepth(surface: Locator): Promise<number> {
  return Number(await surface.getAttribute("data-history-undo-depth"));
}

async function drawGesture(window: Page, start: Point, end: Point): Promise<void> {
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y, { steps: 8 });
  await window.mouse.up();
}

async function pageMapping(canvas: Locator, surface: Locator): Promise<PageMapping> {
  const canvasBounds = await canvas.boundingBox();
  if (canvasBounds === null) throw new Error("Ink canvas has no visible bounds.");
  const pageX = Number(await surface.getAttribute("data-viewport-page-x"));
  const pageY = Number(await surface.getAttribute("data-viewport-page-y"));
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return {
    canvasBounds,
    pageToScreen: (x, y) => ({
      x: canvasBounds.x + pageX + x * zoom,
      y: canvasBounds.y + pageY + y * zoom,
    }),
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PageMapping {
  readonly canvasBounds: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  readonly pageToScreen: (x: number, y: number) => Point;
}

interface VectorStyleDiagnostic {
  readonly id: string;
  readonly type: string;
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}
