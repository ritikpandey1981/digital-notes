import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

test("duplicates and deletes one selected object through immutable History", async () => {
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
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const selectionCanvas = host.locator("canvas[data-folio-layer='selection']");
    await expect(surface).toHaveAttribute("data-object-lifecycle-capability", "ready");

    const metrics = await baseCanvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return {
        logicalWidth: Number(canvas.dataset.logicalWidth),
        logicalHeight: Number(canvas.dataset.logicalHeight),
        pageX: Number(canvas.dataset.pageX),
        pageY: Number(canvas.dataset.pageY),
        pageWidth: Number(canvas.dataset.pageWidth),
        pageHeight: Number(canvas.dataset.pageHeight),
      };
    });
    const inkBounds = await inkCanvas.boundingBox();
    if (inkBounds === null) throw new Error("Ink canvas has no visible bounds.");
    const start = {
      x:
        inkBounds.x +
        (metrics.pageX + metrics.pageWidth * 0.35) * (inkBounds.width / metrics.logicalWidth),
      y:
        inkBounds.y +
        (metrics.pageY + metrics.pageHeight * 0.4) * (inkBounds.height / metrics.logicalHeight),
    };

    await activateDockSlot(window, "pen");
    await expect(window.getByTestId("context-tool-palette")).toBeHidden();
    await expect(inkCanvas).toHaveAttribute("data-desktop-tool-cursor", "pen");
    await window.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await window.mouse.move(start.x, start.y);
    await window.mouse.down();
    await window.mouse.move(start.x + 80, start.y + 20, { steps: 8 });
    await window.mouse.up();
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    await window.keyboard.press("Control+Z");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "0");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await window.keyboard.press("Control+Y");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(start.x + 30, start.y + 8);
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "selected");
    const originalId = await selectionCanvas.getAttribute("data-selected-object-id");
    const originalTranslation = {
      x: Number(await surface.getAttribute("data-selected-object-translation-x")),
      y: Number(await surface.getAttribute("data-selected-object-translation-y")),
    };

    await activateDockSlot(window, "pen");
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.mouse.click(start.x + 30, start.y + 8);
    await expect(selectionCanvas).toHaveAttribute("data-selected-object-id", originalId ?? "");

    await window.keyboard.press("Control+D");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    const duplicateId = await selectionCanvas.getAttribute("data-selected-object-id");
    expect(duplicateId).not.toBe(originalId);
    expect(duplicateId).toBeTruthy();
    await expect(surface).toHaveAttribute(
      "data-selected-object-translation-x",
      String(originalTranslation.x + 10),
    );
    await expect(surface).toHaveAttribute(
      "data-selected-object-translation-y",
      String(originalTranslation.y + 10),
    );

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");

    await window.mouse.click(start.x + 30, start.y + 8);
    await expect(selectionCanvas).toHaveAttribute("data-selected-object-id", duplicateId ?? "");
    await window.keyboard.press("Delete");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(selectionCanvas).toHaveAttribute("data-selection-state", "empty");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "2");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "2");
    await window.keyboard.press("Control+Shift+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(inkCanvas).toHaveAttribute("data-ink-stroke-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "3");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});
