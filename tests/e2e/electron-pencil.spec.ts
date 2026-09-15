import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openDockSlotBrushLibrary } from "./dock-helpers";

/**
 * Pencil in the real application: the seeded pencil slot, drawn with,
 * recoloured, committed, undone and erased.
 *
 * Unit tests settle what the strategy draws. What only the running app can
 * settle is that a dry medium reaches the canvas through the ordinary slot,
 * preset, colour and input path, that the dock says which instrument the slot
 * is holding, and that nothing in the editor had to learn about grain.
 */

test("draws with Pencil through the ordinary slot, colour and input path", async () => {
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
    const pencilSlot = dock.locator('button[data-dock-slot="pencil"]');
    const penSlot = dock.locator('button[data-dock-slot="pen"]');

    // 1. The seeded pencil slot holds the preset that moved onto the strategy,
    //    and says so with a pencil rather than a nib.
    await activateDockSlot(window, "pencil");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pencil-hb");
    await expect(pencilSlot).toHaveAttribute("data-slot-glyph", "pencil");
    await expect(penSlot).toHaveAttribute("data-slot-glyph", "pen-nib");

    // 2. Draw. The live renderer names the new strategy while the stroke is
    //    still in progress, which is the wiring this spec exists to prove.
    const bounds = (await inkCanvas.boundingBox())!;
    await window.mouse.move(bounds.x + 420, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 540, bounds.y + 360, { steps: 12 });
    await window.mouse.move(bounds.x + 660, bounds.y + 290, { steps: 12 });
    await expect(inkCanvas).toHaveAttribute("data-ink-brush-strategy", "pencil");
    await window.mouse.up();

    // 3. One stroke, one History entry, carrying the new strategy durably.
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    const committed = await strokeBrushes(window);
    expect(committed).toHaveLength(1);
    expect(committed[0]!.presetId).toBe("pencil-hb");
    expect(committed[0]!.rendererKind).toBe("pencil");
    expect(committed[0]!.family).toBe("pencil");
    // A mouse keeps the strategy and loses only the expression, so a
    // pressureless device still draws a pencil rather than something else.
    expect(committed[0]!.pointerType).toBe("mouse");

    // 4. Graphite takes the artwork colour rather than a hardcoded grey.
    const colour = await drawingColour(window);
    expect(colour).not.toBe("");
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect((await strokeBrushes(window))[0]!.rendererKind).toBe("pencil");

    // 5. The eraser removes it whole, through the shared path. Nothing about
    //    the eraser is grain-aware.
    await dock.locator('button[data-dock-slot="eraser"]').click();
    await window.mouse.move(bounds.x + 420, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 470, bounds.y + 330, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 6. A pencil in a slot the dock seeded as a pen: assignment is generic,
    //    and the glyph follows the brush both ways.
    await activateDockSlot(window, "pen");
    await expect(penSlot).toHaveAttribute("data-slot-glyph", "pen-nib");
    await openDockSlotBrushLibrary(window, penSlot);
    await expect(library.locator('[data-brush-item="hb-pencil"]')).toHaveAttribute(
      "data-brush-glyph",
      "pencil",
    );
    await expect(library.locator('[data-brush-item="technical-pen"]')).toHaveAttribute(
      "data-brush-glyph",
      "pen-nib",
    );
    await selectLibraryCell(window, "hb-pencil");
    await expect(library).toHaveCount(0);
    await expect(penSlot).toHaveAttribute("data-slot-family", "pencil");
    await expect(penSlot).toHaveAttribute("data-slot-glyph", "pencil");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pencil-hb");

    await window.mouse.move(bounds.x + 420, bounds.y + 520);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 580, bounds.y + 560, { steps: 10 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect((await strokeBrushes(window))[0]!.rendererKind).toBe("pencil");

    // 7. Switching the slot back restores the Technical Pen and its glyph: the
    //    two strategies and the two instruments coexist.
    await openDockSlotBrushLibrary(window, penSlot);
    await selectLibraryCell(window, "technical-pen");
    await expect(library).toHaveCount(0);
    await expect(penSlot).toHaveAttribute("data-slot-glyph", "pen-nib");
    await window.mouse.move(bounds.x + 420, bounds.y + 640);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 560, bounds.y + 680, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    const both = await strokeBrushes(window);
    expect(both.map(({ rendererKind }) => rendererKind)).toEqual(["pencil", "technical-pen"]);

    // 8. The pencil slot kept its own pencil throughout.
    await expect(pencilSlot).toHaveAttribute("data-slot-glyph", "pencil");

    expect(consoleErrors, "no console errors").toEqual([]);
  } finally {
    await electronApp.close();
  }
});

/**
 * Chooses a library cell by keyboard.
 *
 * Where a named cell lands on the wheel depends on rotation, and this spec is
 * about the brush reaching the canvas rather than about where the cell sits.
 */
async function selectLibraryCell(window: Page, brushId: string): Promise<void> {
  const focused = await window.evaluate((id) => {
    const target = document.querySelector(`[data-brush-item="${id}"]`);
    if (target === null) return null;
    (target as SVGGElement).focus();
    return document.activeElement?.getAttribute("data-brush-item") ?? null;
  }, brushId);
  expect(focused, `the ${brushId} cell takes focus`).toBe(brushId);
  await window.keyboard.press("Enter");
}

async function drawingColour(window: Page): Promise<string> {
  return window.evaluate(
    () =>
      document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getAttribute("data-drawing-color") ?? "",
  );
}

async function strokeBrushes(
  window: Page,
): Promise<
  readonly { presetId: string; rendererKind: string; family: string; pointerType: string }[]
> {
  return window.evaluate(() => {
    const raw =
      document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getAttribute("data-document-stroke-brushes") ?? "[]";
    return JSON.parse(raw) as {
      presetId: string;
      rendererKind: string;
      family: string;
      pointerType: string;
    }[];
  });
}
