import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { toggleLayerList } from "./layers-stack-helpers";
import { activateDockSlot } from "./dock-helpers";

/**
 * Covers the contracts introduced by the Pre-Phase-22 quality pass.
 *
 * Everything here is behaviour the earlier suites did not assert: the shell's
 * real minimum size, active-Layer write refusal, independent Eraser state,
 * last-in-first-out dismissal, canvas Escape, and the relocated document and
 * artwork controls.
 */

async function launch(width = 1440, height = 900) {
  const root = process.cwd();
  const app = await electron.launch({
    args: [path.join(root, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe"),
  });
  const window = await app.firstWindow();
  await app.evaluate(
    async ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    { width, height },
  );
  await window.waitForSelector('canvas[data-folio-renderer="true"]');
  await window.waitForTimeout(400);
  return { app, window };
}

async function drawOnPage(window: Page, offsetY: number): Promise<void> {
  const origin = await pagePoint(window, 0.3, offsetY);
  const end = await pagePoint(window, 0.55, offsetY + 0.06);
  await window.mouse.move(origin.x, origin.y);
  await window.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await window.mouse.move(
      origin.x + ((end.x - origin.x) * step) / 10,
      origin.y + ((end.y - origin.y) * step) / 10,
    );
  }
  await window.mouse.up();
  await window.waitForTimeout(120);
}

/** A screen point at the given fraction across the live page rectangle. */
async function pagePoint(
  window: Page,
  fractionX: number,
  fractionY: number,
): Promise<{ x: number; y: number }> {
  return window.evaluate(
    ({ fx, fy }) => {
      const surface = document.querySelector('[data-testid="canvas-surface"]');
      if (surface === null) throw new Error("Canvas surface is unavailable.");
      const read = (name: string): number => Number(surface.getAttribute(name));
      const bounds = surface.getBoundingClientRect();
      return {
        x: bounds.left + read("data-viewport-page-x") + read("data-viewport-page-width") * fx,
        y: bounds.top + read("data-viewport-page-y") + read("data-viewport-page-height") * fy,
      };
    },
    { fx: fractionX, fy: fractionY },
  );
}

/**
 * Opens the active tool's settings and returns its size field.
 *
 * The panel is scoped by tool: a panel leaving for a previous tool overlaps the
 * arriving one for the length of the close animation.
 */
async function openToolOptions(window: Page, tool: string) {
  const palette = window.locator(
    `[data-testid="context-tool-palette"][data-tool-options-tool="${tool}"]`,
  );
  if ((await palette.count()) === 0) {
    const propertyRail = window.getByTestId("drawing-property-rail");
    if ((await propertyRail.count()) > 0) {
      await propertyRail.locator('button[data-property-key="strokeWidth"]').click();
    } else {
      // Eraser has no drawing Property Rail. Its existing active-utility
      // re-press opens its registered settings widget without restoring a
      // nested chevron to any drawing slot.
      await window.getByRole("button", { name: tool, exact: true }).click();
    }
  }
  await expect(palette).toBeVisible();
  return palette.getByRole("spinbutton").first();
}

test("Pre-22 recovery keeps the shell, layer guards, and dismissal contracts", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  try {
    // 1. A new sketchbook opens on A4 landscape.
    await expect(surface).toHaveAttribute("data-page-width", "1123");
    await expect(surface).toHaveAttribute("data-page-height", "794");
    await expect(surface).toHaveAttribute("data-page-orientation", "landscape");

    // 2. Artwork utilities sit on the right rail, document controls on top.
    const utilityRail = window.getByTestId("workspace-utility-rail");
    await expect(utilityRail.getByTestId("layers-toggle")).toBeVisible();
    await expect(window.getByTestId("sketchbook-top-bar").getByTestId("layers-toggle")).toHaveCount(
      0,
    );
    await expect(window.getByTestId("page-settings-toggle")).toBeVisible();

    // 3. Page Settings opens from the top bar and closes by button and Escape.
    await window.getByTestId("page-settings-toggle").click();
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await window.getByTestId("page-settings-close").click();
    await expect(window.getByTestId("page-settings")).toHaveCount(0);
    await window.getByTestId("page-settings-toggle").click();
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("page-settings")).toHaveCount(0);

    // 4. A square page presents Square instead of two inert orientation buttons.
    await window.getByTestId("page-settings-toggle").click();
    await window.getByTestId("page-preset").selectOption("square");
    await expect(surface).toHaveAttribute("data-page-orientation", "square");
    await expect(window.getByTestId("page-orientation-square")).toBeVisible();
    await expect(window.getByTestId("page-orientation-portrait")).toHaveCount(0);
    await expect(window.getByTestId("page-orientation-landscape")).toHaveCount(0);

    // 5. An out-of-range dimension reports itself and leaves the document alone.
    // A square page has no orientation to preserve, so the next preset arrives
    // in its own portrait proportions.
    await window.getByTestId("page-preset").selectOption("a4");
    await expect(surface).toHaveAttribute("data-page-width", "794");
    await expect(surface).toHaveAttribute("data-page-orientation", "portrait");
    const historyBeforeInvalid = await surface.getAttribute("data-history-undo-depth");
    await window.getByTestId("page-width").fill("5");
    await window.getByTestId("page-width").press("Enter");
    await expect(window.getByTestId("page-width-error")).toBeVisible();
    await expect(window.getByTestId("page-width")).toHaveAttribute("aria-invalid", "true");
    await expect(surface).toHaveAttribute("data-page-width", "794");
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBeforeInvalid);
    // Escape restores the field being edited before it reaches the panel.
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await expect(window.getByTestId("page-width")).toHaveValue("794");
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("page-settings")).toHaveCount(0);

    // 6. The Eraser owns its size; switching tools never moves the other's.
    await activateDockSlot(window, "pen");
    const penSize = await openToolOptions(window, "Pen");
    await penSize.fill("3");
    await penSize.press("Enter");
    await expect(surface).toHaveAttribute("data-drawing-width", "3");
    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    const eraserSize = await openToolOptions(window, "Eraser");
    await eraserSize.fill("24");
    await eraserSize.press("Enter");
    await expect(surface).toHaveAttribute("data-drawing-width", "24");
    const historyBeforeToolSwitching = await surface.getAttribute("data-history-undo-depth");
    for (let round = 0; round < 2; round += 1) {
      await activateDockSlot(window, "pen");
      await expect(surface).toHaveAttribute("data-drawing-width", "3");
      await window.getByRole("button", { name: "Eraser", exact: true }).click();
      await expect(surface).toHaveAttribute("data-drawing-width", "24");
    }
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBeforeToolSwitching);

    // 7. A canvas gesture dismisses Tool Options without swallowing the stroke.
    await activateDockSlot(window, "pen");
    await openToolOptions(window, "Pen");
    await drawOnPage(window, 0.3);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(window.getByTestId("context-tool-palette")).toHaveCount(0);

    // Unrelated controls do not act as canvas dismissal, so nested surfaces
    // still establish a deterministic Escape order.
    await openToolOptions(window, "Pen");
    await toggleLayerList(window);
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();

    // 8. Escape dismisses one surface at a time, most recent first.
    await window.getByTestId("pages-toggle").click();
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("context-tool-palette")).toHaveCount(0);

    // 9. A first selection click also passes through canvas-only dismissal.
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await toggleLayerList(window);
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    const strokePoint = await pagePoint(window, 0.42, 0.33);
    const historyBeforeSelection = await surface.getAttribute("data-history-undo-depth");
    await window.mouse.click(strokePoint.x, strokePoint.y);
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBeforeSelection);

    // Escape then reaches the canvas: selection clears without History.
    const historyBeforeEscape = await surface.getAttribute("data-history-undo-depth");
    await window.keyboard.press("Escape");
    await expect(surface).toHaveAttribute("data-selected-object-id", "");
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBeforeEscape);

    // 10. Escape mid-transform restores the original geometry with no History.
    await window.mouse.click(strokePoint.x, strokePoint.y);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");
    const boundsBeforeCancel = await surface.getAttribute("data-selected-object-bounds-x");
    await window.mouse.move(strokePoint.x, strokePoint.y);
    await window.mouse.down();
    await window.mouse.move(strokePoint.x + 140, strokePoint.y + 90, { steps: 10 });
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-manipulation-phase", "idle");
    await expect(surface).toHaveAttribute(
      "data-selected-object-bounds-x",
      boundsBeforeCancel ?? "",
    );
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBeforeEscape);

    // 11. A first Shape drag survives Page Settings dismissal and commits once.
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await window.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await window.getByTestId("page-settings-toggle").click();
    await expect(window.getByTestId("page-settings")).toBeVisible();
    const shapeStart = await pagePoint(window, 0.18, 0.68);
    const shapeEnd = await pagePoint(window, 0.34, 0.82);
    const objectsBeforeShape = Number(await surface.getAttribute("data-document-object-count"));
    const historyBeforeShape = Number(await surface.getAttribute("data-history-undo-depth"));
    await window.mouse.move(shapeStart.x, shapeStart.y);
    await window.mouse.down();
    await window.mouse.move(shapeEnd.x, shapeEnd.y, { steps: 8 });
    await window.mouse.up();
    await expect(window.getByTestId("page-settings")).toHaveCount(0);
    await expect(surface).toHaveAttribute(
      "data-document-object-count",
      String(objectsBeforeShape + 1),
    );
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(
      historyBeforeShape + 1,
    );

    // 12. A press that starts off the paper creates nothing.
    await activateDockSlot(window, "pen");
    const objectsBeforeOffPage = await surface.getAttribute("data-document-object-count");
    const hostBounds = await window.getByTestId("canvas-host").boundingBox();
    if (hostBounds === null) throw new Error("Canvas host has no bounds.");
    await window.mouse.click(hostBounds.x + hostBounds.width - 24, hostBounds.y + 24);
    await window.waitForTimeout(200);
    expect(await surface.getAttribute("data-document-object-count")).toBe(objectsBeforeOffPage);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pre-22 recovery refuses creation on hidden and locked active Layers", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  try {
    // Seed one stroke so the clipboard routes have a source to copy.
    await activateDockSlot(window, "pen");
    await drawOnPage(window, 0.25);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    const seeded = await pagePoint(window, 0.42, 0.28);
    await window.mouse.click(seeded.x, seeded.y);
    await window.keyboard.press("Control+c");
    await expect(surface).toHaveAttribute("data-clipboard-can-paste", "true");

    for (const state of ["hidden", "locked"] as const) {
      await toggleLayerList(window);
      await expect(window.getByTestId("layers-panel")).toBeVisible();
      const control = state === "hidden" ? "layer-visibility-layer-1" : "layer-lock-layer-1";
      await window.getByTestId(control).click();
      await window.waitForTimeout(200);
      const objectsBefore = await surface.getAttribute("data-document-object-count");
      const historyBefore = await surface.getAttribute("data-history-undo-depth");

      await activateDockSlot(window, "pen");
      await drawOnPage(window, 0.5);
      await activateDockSlot(window, "highlighter");
      await drawOnPage(window, 0.6);
      await window.getByRole("button", { name: "Select", exact: true }).click();
      await window.keyboard.press("Control+v");
      await window.waitForTimeout(250);
      await window.keyboard.press("Control+d");
      await window.waitForTimeout(250);

      // Nothing was created and History never advanced.
      expect(await surface.getAttribute("data-document-object-count")).toBe(objectsBefore);
      expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBefore);

      await toggleLayerList(window);
      await expect(window.getByTestId("layers-panel")).toBeVisible();
      await window.getByTestId(control).click();
      await window.waitForTimeout(200);
      await toggleLayerList(window);
      await expect(window.getByTestId("layers-panel")).toHaveCount(0);
    }

    // A locked Layer keeps its artwork selectable but read-only.
    await toggleLayerList(window);
    await window.getByTestId("layer-lock-layer-1").click();
    await window.waitForTimeout(200);
    await toggleLayerList(window);
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(seeded.x, seeded.y);
    await expect(surface).not.toHaveAttribute("data-selected-object-id", "");
    await expect(window.getByTestId("shape-editing-toolbar")).toHaveAttribute(
      "data-selection-read-only",
      "true",
    );
    await expect(window.getByTestId("selection-read-only-badge")).toBeVisible();
    const objectsBeforeDelete = await surface.getAttribute("data-document-object-count");
    await window.keyboard.press("Delete");
    await window.waitForTimeout(250);
    expect(await surface.getAttribute("data-document-object-count")).toBe(objectsBeforeDelete);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pre-22 recovery fits the shell inside the real minimum content area", async () => {
  test.setTimeout(120_000);
  const { app, window } = await launch(960, 640);
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    const metrics = await window.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(metrics.scrollHeight).toBe(metrics.clientHeight);
    expect(metrics.scrollWidth).toBe(metrics.clientWidth);

    // Open every workspace surface and confirm nothing leaves the viewport.
    await toggleLayerList(window);
    await window.getByTestId("pages-toggle").click();
    await window.waitForTimeout(400);
    const offscreen = await window.evaluate(() => {
      const ids = [
        "sketchbook-top-bar",
        "workspace-utility-rail",
        "layers-panel",
        "page-navigator",
        "context-hint",
        "viewport-controls",
      ];
      return ids
        .map((id) => {
          const element =
            id === "tool-dock"
              ? document.querySelector("[data-tool-dock-layout]")
              : document.querySelector(`[data-testid="${id}"]`);
          if (element === null) return null;
          const rect = element.getBoundingClientRect();
          return rect.top < -0.5 ||
            rect.left < -0.5 ||
            rect.bottom > window.innerHeight + 0.5 ||
            rect.right > window.innerWidth + 0.5
            ? id
            : null;
        })
        .filter((id) => id !== null);
    });
    expect(offscreen).toEqual([]);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
