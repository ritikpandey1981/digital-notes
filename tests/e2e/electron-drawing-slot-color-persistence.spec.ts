import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

/**
 * A creation colour is a preference, and preferences survive changing tools.
 *
 * Before the fix, a colour chosen but not yet drawn with was silently reverted
 * the moment another dock slot was pressed: the Tool Dock is exempt from
 * outside-pointer dismissal, so the picker session stayed open, and the
 * workspace's valid-target guard then cancelled it — restoring the colour the
 * picker had opened on. Drawing first hid the bug by committing the session
 * through the canvas.
 *
 * Every scenario here therefore checks the *no drawing* path explicitly. Where
 * a stroke appears it is either deliberate setup or the control case.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

async function launch(): Promise<{
  readonly app: Awaited<ReturnType<typeof electron.launch>>;
  readonly window: Page;
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
  await expect(window.getByTestId("canvas-surface")).toBeVisible();
  return { app, window };
}

const historyDepth = async (surface: Locator): Promise<string> =>
  (await surface.getAttribute("data-history-undo-depth")) ?? "";

const objectCount = async (surface: Locator): Promise<string> =>
  (await surface.getAttribute("data-document-object-count")) ?? "";

function drawingGlyph(window: Page, slotId: string): Locator {
  return window.locator(`[data-drawing-slot-glyph="${slotId}"]`);
}

/** Every slot's stored colour, read without activating anything. */
async function readAllSlotColors(window: Page): Promise<Record<string, string>> {
  return window
    .locator("[data-drawing-slot-glyph]")
    .evaluateAll((glyphs) =>
      Object.fromEntries(
        glyphs.map((glyph) => [
          glyph.getAttribute("data-drawing-slot-glyph") ?? "",
          glyph.getAttribute("data-drawing-slot-glyph-color") ?? "",
        ]),
      ),
    );
}

function rgbCssColor(hex: string): string {
  const normalized = hex.slice(1);
  return `rgb(${Number.parseInt(normalized.slice(0, 2), 16)}, ${Number.parseInt(
    normalized.slice(2, 4),
    16,
  )}, ${Number.parseInt(normalized.slice(4, 6), 16)})`;
}

async function collapseToolOptions(window: Page): Promise<void> {
  const palette = window.getByTestId("context-tool-palette");
  if (await palette.isVisible()) {
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  }
}

/**
 * Chooses a colour through the Property Rail and leaves the session OPEN.
 *
 * The picker is deliberately not dismissed: resolving it is what the fix is
 * about, and the caller decides which boundary does the resolving.
 */
async function previewColorFromPropertyRail(
  window: Page,
  slotId: string,
  color: string,
): Promise<void> {
  await activateDockSlot(window, slotId);
  await collapseToolOptions(window);
  await window
    .getByTestId("drawing-property-rail")
    .locator('button[data-property-key="strokeColor"]')
    .click();
  const picker = window.getByTestId("full-color-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("textbox", { name: "Hex color" }).fill(color);
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute("data-drawing-color", color);
  await expect(drawingGlyph(window, slotId)).toHaveAttribute(
    "data-drawing-slot-glyph-color",
    color,
  );
}

/** Every place the workspace claims a slot's colour must agree. */
async function expectSlotColorEverywhere(
  window: Page,
  slotId: string,
  color: string,
): Promise<void> {
  await activateDockSlot(window, slotId);
  const glyph = drawingGlyph(window, slotId);
  await expect(glyph, `${slotId} glyph`).toHaveAttribute("data-drawing-slot-glyph-color", color);
  expect(await glyph.evaluate((element) => getComputedStyle(element).color)).toBe(
    rgbCssColor(color),
  );
  await expect(
    window.getByTestId("canvas-surface"),
    "the active creation target agrees",
  ).toHaveAttribute("data-drawing-color", color);
  const swatch = window.getByTestId("drawing-property-color-swatch");
  expect(
    await swatch.evaluate((element) => getComputedStyle(element).backgroundColor),
    "Property Rail swatch",
  ).toBe(rgbCssColor(color));
}

async function pageToScreen(surface: Locator, canvas: Locator, point: Point): Promise<Point> {
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas bounds unavailable.");
  const metrics = await surface.evaluate((element) => {
    const dataset = (element as HTMLElement).dataset;
    return {
      pageX: Number(dataset.viewportPageX),
      pageY: Number(dataset.viewportPageY),
      zoom: Number(dataset.viewportZoom),
      viewportWidth: Number(dataset.viewportWidth),
      viewportHeight: Number(dataset.viewportHeight),
    };
  });
  return {
    x: bounds.x + (metrics.pageX + point.x * metrics.zoom) * (bounds.width / metrics.viewportWidth),
    y:
      bounds.y +
      (metrics.pageY + point.y * metrics.zoom) * (bounds.height / metrics.viewportHeight),
  };
}

async function drawStroke(
  window: Page,
  surface: Locator,
  canvas: Locator,
  start: Point,
  end: Point,
): Promise<void> {
  const before = Number(await objectCount(surface));
  const startScreen = await pageToScreen(surface, canvas, start);
  const endScreen = await pageToScreen(surface, canvas, end);
  await window.mouse.move(startScreen.x, startScreen.y);
  await window.mouse.down();
  await window.mouse.move(endScreen.x, endScreen.y, { steps: 12 });
  await window.mouse.up();
  await expect(surface).toHaveAttribute("data-document-object-count", String(before + 1));
}

test("keeps an undrawn creation colour across slot, utility, and library switches", async () => {
  test.setTimeout(150_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const picker = window.getByTestId("full-color-picker");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const baselineHistory = await historyDepth(surface);
    const baselineObjects = await objectCount(surface);

    // The reported bug, exactly: choose, do not draw, leave, come back.
    await previewColorFromPropertyRail(window, "pencil", "#ef4444");
    await activateDockSlot(window, "pen");
    await expect(picker, "the switch resolves the session rather than orphaning it").toHaveCount(0);
    await expectSlotColorEverywhere(window, "pencil", "#ef4444");
    expect(await historyDepth(surface), "a preference change is not History").toBe(baselineHistory);
    expect(await objectCount(surface), "nothing was drawn").toBe(baselineObjects);

    // Five independent slots, still with no stroke anywhere.
    const colors = {
      pencil: "#ef4444",
      pen: "#2563eb",
      "brush-pen": "#16a34a",
      marker: "#000000",
      highlighter: "#eab308",
    } as const;
    for (const [slotId, color] of Object.entries(colors)) {
      if (slotId === "pencil") continue;
      await previewColorFromPropertyRail(window, slotId, color);
      await activateDockSlot(window, slotId === "highlighter" ? "pencil" : "highlighter");
      await expect(picker).toHaveCount(0);
    }
    for (const slotId of ["pencil", "brush-pen", "highlighter", "pen", "marker", "pencil"]) {
      await activateDockSlot(window, slotId);
    }
    for (const [slotId, color] of Object.entries(colors)) {
      await expect(drawingGlyph(window, slotId)).toHaveAttribute(
        "data-drawing-slot-glyph-color",
        color,
      );
    }

    // Changing one slot moves only that slot.
    await previewColorFromPropertyRail(window, "brush-pen", "#7c3aed");
    await activateDockSlot(window, "marker");
    await expect(picker).toHaveCount(0);
    for (const [slotId, color] of Object.entries({ ...colors, "brush-pen": "#7c3aed" })) {
      await expect(drawingGlyph(window, slotId), slotId).toHaveAttribute(
        "data-drawing-slot-glyph-color",
        color,
      );
    }

    // Utility tools own no drawing slot, so they are the other ownership move.
    const utilityColors = { select: "#0891b2", eraser: "#db2777", shapes: "#4d7c0f" } as const;
    for (const [utility, color] of Object.entries(utilityColors)) {
      await previewColorFromPropertyRail(window, "pen", color);
      const utilityButton = window.locator(`button[data-dock-slot="${utility}"]`);
      await utilityButton.click();
      await expect(utilityButton).toHaveAttribute("aria-pressed", "true");
      await expect(picker).toHaveCount(0);
      await expectSlotColorEverywhere(window, "pen", color);
    }

    // Pressing the active slot opens the Brush Library. The colour must not be
    // caught by that transition either.
    await previewColorFromPropertyRail(window, "marker", "#c2410c");
    await window.locator('button[data-dock-slot="marker"]').click();
    const library = window.getByTestId("radial-brush-library");
    await expect(library).toHaveAttribute("data-library-phase", "open");
    await expect(picker).toHaveCount(0);
    await window.keyboard.press("Escape");
    await expect(library).toHaveCount(0);
    await expectSlotColorEverywhere(window, "marker", "#c2410c");

    expect(await historyDepth(surface), "no creation colour reached History").toBe(baselineHistory);
    expect(await objectCount(surface), "no stroke was ever drawn").toBe(baselineObjects);
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("keeps quick-colour and sampled colours, and leaves object colour isolated", async () => {
  test.setTimeout(150_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const picker = window.getByTestId("full-color-picker");
    const rail = window.getByTestId("quick-color-rail");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');

    // A. Quick colour with no session open: already atomic, must stay correct.
    await activateDockSlot(window, "pencil");
    await collapseToolOptions(window);
    const quickSwatch = rail.locator("button[data-color]").first();
    const quickColor = (await quickSwatch.getAttribute("data-color")) ?? "";
    expect(quickColor).toMatch(/^#[0-9a-f]{6}$/u);
    await quickSwatch.click();
    await expect(surface).toHaveAttribute("data-drawing-color", quickColor);
    await activateDockSlot(window, "pen");
    await expectSlotColorEverywhere(window, "pencil", quickColor);

    // B. Quick colour applied while a creation session is already open: this
    // routes through preview and leaves the session open, so it inherits the
    // same resolution rule.
    await activateDockSlot(window, "marker");
    await collapseToolOptions(window);
    await rail.getByTestId("quick-color-current").click();
    await expect(picker).toBeVisible();
    const secondSwatch = rail.locator("button[data-color]").nth(1);
    const secondColor = (await secondSwatch.getAttribute("data-color")) ?? "";
    await secondSwatch.click();
    await expect(surface).toHaveAttribute("data-drawing-color", secondColor);
    await activateDockSlot(window, "pen");
    await expect(picker).toHaveCount(0);
    await expectSlotColorEverywhere(window, "marker", secondColor);

    // C. Eyedropper samples into the open creation session. One stroke is drawn
    // here purely as something to sample from.
    // Brush Pen is the sampling target on purpose: 6px and fully opaque, so the
    // sampled pixel is the artwork colour rather than a blend with the paper.
    await previewColorFromPropertyRail(window, "brush-pen", "#dc2626");
    await activateDockSlot(window, "pen");
    await expect(picker).toHaveCount(0);
    await activateDockSlot(window, "brush-pen");
    // Far right of the page: a picker anchored on the left Property Rail must
    // not be covering the pixel the eyedropper is aimed at.
    await drawStroke(window, surface, inkCanvas, { x: 820, y: 200 }, { x: 820, y: 420 });
    const sampleAt = await pageToScreen(surface, inkCanvas, { x: 820, y: 320 });

    await previewColorFromPropertyRail(window, "highlighter", "#eab308");
    await picker.getByRole("button", { name: "Pick color from canvas" }).click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    await window.mouse.move(sampleAt.x + 1, sampleAt.y + 1);
    await window.mouse.move(sampleAt.x, sampleAt.y);
    await window.mouse.click(sampleAt.x, sampleAt.y);
    await expect(surface).toHaveAttribute("data-artwork-sample-status", "success");
    await expect(surface).toHaveAttribute("data-artwork-sample-color", "#dc2626");
    await expect(surface).toHaveAttribute("data-drawing-color", "#dc2626");
    // Leave without drawing again. The sampled colour is a preference now.
    await activateDockSlot(window, "marker");
    await expect(picker).toHaveCount(0);
    await expectSlotColorEverywhere(window, "highlighter", "#dc2626");

    // D. Selected-object colour editing stays object-scoped. A creation slot
    // must never receive an object's colour, and the object's own session is
    // not a creation session, so this fix leaves its semantics alone.
    const slotColorsBefore = await readAllSlotColors(window);
    await window.locator('button[data-dock-slot="select"]').click();
    const strokeAt = await pageToScreen(surface, inkCanvas, { x: 820, y: 320 });
    await window.mouse.click(strokeAt.x, strokeAt.y);
    await expect(surface).toHaveAttribute("data-selection-state", "selected");
    await window.getByTestId("selected-vector-color-trigger").click();
    await expect(picker).toBeVisible();
    await picker.getByRole("textbox", { name: "Hex color" }).fill("#9333ea");
    expect(await readAllSlotColors(window), "editing an object moves no drawing slot").toEqual(
      slotColorsBefore,
    );

    await activateDockSlot(window, "marker");
    expect(
      await readAllSlotColors(window),
      "leaving an object edit still moves no drawing slot",
    ).toEqual(slotColorsBefore);
    await expectSlotColorEverywhere(window, "marker", secondColor);
  } finally {
    await app.close();
  }
});

test("draws with the persisted colour without treating the stroke as the commit", async () => {
  test.setTimeout(150_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');

    // The original control case: choose, draw, switch, return. Brush Pen draws
    // an opaque 6px line, so the sample below reads the artwork exactly.
    await previewColorFromPropertyRail(window, "brush-pen", "#16a34a");
    await activateDockSlot(window, "pen");
    await activateDockSlot(window, "brush-pen");
    const historyBeforeStroke = Number(await historyDepth(surface));

    await drawStroke(window, surface, inkCanvas, { x: 820, y: 260 }, { x: 820, y: 460 });
    expect(Number(await historyDepth(surface)), "one stroke is exactly one History operation").toBe(
      historyBeforeStroke + 1,
    );

    // Read the committed artwork itself rather than any UI mirror: sampling
    // reports the colour actually frozen into the stroke.
    await collapseToolOptions(window);
    await window
      .getByTestId("drawing-property-rail")
      .locator('button[data-property-key="strokeColor"]')
      .click();
    const picker = window.getByTestId("full-color-picker");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Pick color from canvas" }).click();
    await expect(picker).toHaveAttribute("data-eyedropper-state", "active");
    const strokeAt = await pageToScreen(surface, inkCanvas, { x: 820, y: 360 });
    await window.mouse.move(strokeAt.x + 1, strokeAt.y + 1);
    await window.mouse.move(strokeAt.x, strokeAt.y);
    await window.mouse.click(strokeAt.x, strokeAt.y);
    await expect(surface).toHaveAttribute("data-artwork-sample-status", "success");
    await expect(surface, "the stroke used the colour chosen before any drawing").toHaveAttribute(
      "data-artwork-sample-color",
      "#16a34a",
    );

    await activateDockSlot(window, "marker");
    await expectSlotColorEverywhere(window, "brush-pen", "#16a34a");
    expect(Number(await historyDepth(surface)), "switching back added no preference History").toBe(
      historyBeforeStroke + 1,
    );
  } finally {
    await app.close();
  }
});
