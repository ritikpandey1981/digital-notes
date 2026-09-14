import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { openDockSlotBrushLibrary } from "./dock-helpers";

/**
 * Technical Pen in the real application: assigned from the Brush Library to a
 * dock slot, drawn with, and committed.
 *
 * The point of exercising it here rather than only in unit tests is that the
 * strategy reaches the canvas through the ordinary slot, preset and input path.
 * Nothing in the dock, the library or the renderer wiring knows it is new.
 */

test("draws with Technical Pen through the ordinary slot and input path", async () => {
  test.setTimeout(180_000);
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

    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const library = window.getByTestId("radial-brush-library");
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const penSlot = dock.locator('button[data-dock-slot="pen"]');

    // 1. Assign the Technical Pen identity to the Pen slot from the library.
    //    Selected by keyboard rather than by pointer: where a named cell lands
    //    on the wheel depends on rotation, and this spec is about the strategy
    //    reaching the canvas rather than about where the cell happens to sit.
    await openDockSlotBrushLibrary(window, penSlot);
    const cell = library.locator('[data-brush-item="technical-pen"]');
    await expect(cell, "Technical Pen is a real catalogue identity").toHaveCount(1);
    await expect(cell).toHaveAttribute("aria-label", "Technical Pen");
    await expect(cell).toHaveAttribute("data-brush-fallback-preset", "pen-technical");
    const focused = await window.evaluate(() => {
      const target = document.querySelector('[data-brush-item="technical-pen"]');
      if (target === null) return null;
      (target as SVGGElement).focus();
      return document.activeElement?.getAttribute("data-brush-item") ?? null;
    });
    expect(focused, "the cell takes focus").toBe("technical-pen");
    await window.keyboard.press("Enter");
    await expect(library, "choosing a brush closes the library").toHaveCount(0);
    await expect(penSlot).toHaveAttribute("aria-pressed", "true");

    // 2. The slot holds the identity, and reopening still indicates it.
    await openDockSlotBrushLibrary(window, penSlot);
    expect(await selectedBrush(window)).toBe("technical-pen");
    await penSlot.click();
    await expect(library).toHaveCount(0);

    // 3. Draw. The live renderer reports the new strategy while the stroke is
    //    still in progress, which is the wiring this spec exists to prove.
    const bounds = (await inkCanvas.boundingBox())!;
    await window.mouse.move(bounds.x + 420, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 520, bounds.y + 360, { steps: 10 });
    await window.mouse.move(bounds.x + 640, bounds.y + 300, { steps: 10 });
    await expect(inkCanvas).toHaveAttribute("data-ink-brush-strategy", "technical-pen");
    await window.mouse.up();

    // 4. One stroke, one History entry, carrying the new strategy durably.
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    const committed = await strokeBrushes(window);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.presetId).toBe("pen-technical");
    expect(committed[0]!.rendererKind).toBe("technical-pen");

    // 5. A mouse draws Technical Pen unchanged. There is no pressure response
    //    to downgrade, unlike the expressive outline presets.
    expect(committed[0]!.pointerType).toBe("mouse");

    // 6. Undo and redo restore the same committed stroke.
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect((await strokeBrushes(window))[0]!.rendererKind).toBe("technical-pen");

    // 7. The eraser removes it whole, through the shared path.
    await dock.locator('button[data-dock-slot="eraser"]').click();
    await window.mouse.move(bounds.x + 420, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 470, bounds.y + 330, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 8. Other slots are untouched: the Brush Pen slot still resolves its own
    //    preset and its own strategy, which is now Pressure Pen.
    await dock.locator('button[data-dock-slot="brush-pen"]').click();
    await window.mouse.move(bounds.x + 420, bounds.y + 520);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 560, bounds.y + 560, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    const other = await strokeBrushes(window);
    expect(other[0]!.presetId).toBe("pen-brush");
    expect(other[0]!.rendererKind).toBe("pressure-pen");

    expect(consoleErrors, "no console errors").toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function selectedBrush(window: Page): Promise<string | null> {
  return window.evaluate(
    () =>
      document.querySelector('[data-brush-selected="true"]')?.getAttribute("data-brush-item") ??
      null,
  );
}

async function strokeBrushes(
  window: Page,
): Promise<readonly { presetId: string; rendererKind: string; pointerType: string }[]> {
  return window.evaluate(() => {
    const raw =
      document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getAttribute("data-document-stroke-brushes") ?? "[]";
    return JSON.parse(raw) as {
      presetId: string;
      rendererKind: string;
      pointerType: string;
    }[];
  });
}
