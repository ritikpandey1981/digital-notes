import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  drawStroke,
  launchFolio,
  openLayerList,
  openStack,
  surfaceOf,
} from "./layers-stack-helpers";

/**
 * Top Chrome: the workspace's own controls, as segmented islands.
 *
 * The application's identity belongs to the native window, so nothing here
 * repeats it. What remains is history, pages and appearance -- each in a
 * surface only as wide as its contents, over a canvas that reaches the top.
 *
 * The composition is two-sided on purpose: the application menu on the left,
 * everything that acts on the work on the right, and nothing at all in the
 * middle.
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const EMPTY_BOX: Box = { x: 0, y: 0, width: 0, height: 0 };

async function boxOf(locator: Locator): Promise<Box> {
  return (await locator.boundingBox()) ?? EMPTY_BOX;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every group and island the top chrome is allowed to have. */
async function chromeBoxes(window: Page): Promise<{
  readonly left: Box;
  readonly right: Box;
  readonly application: Box;
  readonly sketch: Box;
  readonly history: Box;
  readonly page: Box;
}> {
  const [left, right, application, sketch, history, page] = await Promise.all([
    boxOf(window.getByTestId("top-chrome-left")),
    boxOf(window.getByTestId("top-chrome-right")),
    boxOf(window.getByTestId("top-chrome-application")),
    boxOf(window.getByTestId("top-chrome-sketch")),
    boxOf(window.getByTestId("top-chrome-history")),
    boxOf(window.getByTestId("top-chrome-page")),
  ]);
  return { left, right, application, sketch, history, page };
}

/**
 * The top chrome is a few islands on two sides, not a bar.
 *
 * The contract here is as much about what is *absent* as what is present: no
 * painted strip, no reserved row, no width spent on anything that is not a
 * control, and above all nothing in the middle.
 */
test("splits the top chrome between the two corners and leaves the centre empty", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    const viewport = window.viewportSize() ?? { width: 1440, height: 900 };
    const chrome = await chromeBoxes(window);

    // The retired bar is gone, not merely restyled, and it took the wordmark
    // and the workspace subtitle with it.
    await expect(window.getByTestId("sketchbook-top-bar")).toHaveCount(0);
    await expect(window.getByText("Sketching workspace")).toHaveCount(0);
    await expect(window.getByText("Folio", { exact: true })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "Workspace menu" })).toHaveCount(0);

    // Left: the application menu, and the name of the sketch beside it.
    await expect(
      window.getByTestId("top-chrome-application").getByTestId("application-menu-trigger"),
    ).toBeVisible();
    expect(chrome.left.x, "the application island keeps the left inset").toBeCloseTo(16, 0);
    expect(chrome.application.x, "the menu comes first").toBeLessThan(chrome.sketch.x);
    expect(chrome.sketch.x, "the sketch name sits immediately beside it").toBeCloseTo(
      chrome.application.x + chrome.application.width + 8,
      0,
    );

    // It is identity, not a control: one group of controls on this side, and
    // nothing inside the name island that can be pressed or typed into.
    await expect(window.getByTestId("top-chrome-left").getByRole("group")).toHaveCount(1);
    await expect(window.getByTestId("sketch-name")).toHaveText("Untitled Sketch");
    const sketch = window.getByTestId("top-chrome-sketch");
    await expect(sketch.locator("button, a, input, textarea, [contenteditable]")).toHaveCount(0);
    await sketch.dblclick();
    await expect(
      sketch.locator("input, [contenteditable]"),
      "double click does not rename",
    ).toHaveCount(0);
    await expect(window.getByTestId("sketch-name")).toHaveText("Untitled Sketch");

    // Right: history and pages, in that order, and nothing else.
    await expect(window.getByTestId("top-chrome-right").getByRole("group")).toHaveCount(2);
    expect(chrome.history.x).toBeLessThan(chrome.page.x);
    expect(chrome.right.x, "the right groups are on the right").toBeGreaterThan(viewport.width / 2);

    // Every island is sized by its contents rather than by the window, and the
    // two sides share one axis.
    for (const [name, box] of Object.entries(chrome)) {
      expect(box.width, `${name} is content-sized`).toBeLessThan(viewport.width / 3);
      expect(box.height, `${name} shares one chrome height`).toBeCloseTo(36, 0);
      expect(box.y, `${name} shares one top inset`).toBeCloseTo(16, 0);
    }
    // Islands are separated by real gaps, so the canvas shows between them.
    expect(chrome.page.x).toBeGreaterThan(chrome.history.x + chrome.history.width);

    // The centre is genuinely empty: the widest part of the top edge is canvas,
    // and no top chrome paints across it.
    const centre = chrome.right.x - (chrome.left.x + chrome.left.width);
    expect(centre, "the middle is the largest part of the top edge").toBeGreaterThan(
      viewport.width / 2,
    );
    const painted = await window.evaluate(
      (gap: { start: number; end: number }) => {
        const middle = (gap.start + gap.end) / 2;
        return document
          .elementsFromPoint(middle, 34)
          .some((element) => element.closest('[data-testid^="top-chrome-"]') !== null);
      },
      { start: chrome.left.x + chrome.left.width, end: chrome.right.x },
    );
    expect(painted, "no top chrome surface reaches the centre").toBe(false);

    // The canvas is genuinely behind the top area, not below a reserved row.
    const workspaceTop = await window
      .getByTestId("sketchbook-workspace")
      .evaluate((node) => node.getBoundingClientRect().top);
    expect(workspaceTop, "no reserved top row").toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});

test("keeps every top chrome action working and truthful", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const surface = surfaceOf(window);

    // History reflects the real controller, and both directions are labelled
    // with the shortcut that actually performs them.
    const undo = window.getByRole("button", { name: "Undo", exact: true });
    const redo = window.getByRole("button", { name: "Redo", exact: true });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    // Pages and Page settings now show the state they have always announced.
    const pages = window.getByTestId("pages-toggle");
    const settings = window.getByTestId("page-settings-toggle");
    const background = async (control: Locator): Promise<string> =>
      control.evaluate((node) => getComputedStyle(node).backgroundColor);
    const resting = await background(pages);
    await expect(pages).toHaveAttribute("aria-pressed", "false");
    await pages.click();
    await expect(pages).toHaveAttribute("aria-pressed", "true");
    expect(await background(pages), "a pressed toggle looks pressed").not.toBe(resting);
    await pages.click();
    await expect(pages).toHaveAttribute("aria-pressed", "false");

    await expect(settings).toHaveAttribute("aria-pressed", "false");
    await settings.click();
    await expect(settings).toHaveAttribute("aria-pressed", "true");
    expect(await background(settings)).not.toBe(resting);
    await settings.click();

    // The application menu offers only what the application can actually do.
    await window.getByTestId("application-menu-trigger").click();
    const menu = window.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await expect(menu.getByRole("menuitem", { name: /appearance/iu })).toHaveCount(2);
    for (const absent of ["New", "Open", "Save", "Save As", "Recent", "Close"]) {
      await expect(
        menu.getByRole("menuitem", { name: new RegExp(`^${absent}`, "u") }),
        `${absent} is not offered before persistence exists`,
      ).toHaveCount(0);
    }
    await window.keyboard.press("Escape");

    // No page context in the chrome: the navigator is where a page says its
    // name, and there is no document identity to show beside it yet.
    await expect(window.getByTestId("active-page-name")).toHaveCount(0);
    await expect(window.getByTestId("top-chrome-right").getByText(/Page/u)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/**
 * The right corner is shared, and the persistent controls own it.
 *
 * Everything that opens into that corner -- the page panels, the Layers mode
 * switch -- arranges itself underneath. The chrome itself never moves, so the
 * two corners stay symmetric whatever else is on screen.
 */
test("keeps the right chrome fixed and sends everything else below it", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const viewport = window.viewportSize() ?? { width: 1440, height: 900 };
    const left = await boxOf(window.getByTestId("top-chrome-left"));
    const right = await boxOf(window.getByTestId("top-chrome-right"));
    const below = right.y + right.height;

    // Symmetric corners: the same inset on both sides, and no reserved gutter.
    expect(
      viewport.width - (right.x + right.width),
      "the right inset matches the left",
    ).toBeCloseTo(left.x, 0);

    // Page Navigator opens centred and clear.
    await window.getByTestId("pages-toggle").click();
    const navigator = await boxOf(window.getByTestId("page-navigator"));
    expect(overlaps(right, navigator), "the page navigator clears the right chrome").toBe(false);
    await window.getByTestId("pages-toggle").click();

    // Page Settings opens below its own trigger rather than over it.
    await window.getByTestId("page-settings-toggle").click();
    const settings = await boxOf(window.getByTestId("page-settings"));
    expect(overlaps(right, settings), "page settings opens below the right chrome").toBe(false);
    expect(settings.y, "page settings opens below, not beside").toBeGreaterThanOrEqual(below);
    await window.getByTestId("page-settings-toggle").click();

    // The Layers mode switch takes the row beneath the persistent chrome: what
    // the workspace can always do above, what is only true in Layers below.
    await openStack(window);
    const settled = await boxOf(window.getByTestId("top-chrome-right"));
    expect(settled, "the right chrome does not move when the Stack opens").toEqual(right);
    const modeSwitch = await boxOf(window.getByTestId("layers-view-switch"));
    expect(overlaps(settled, modeSwitch), "the two rows do not overlap").toBe(false);
    expect(modeSwitch.y, "the mode switch is the second row").toBeGreaterThanOrEqual(below);
    expect(modeSwitch.x + modeSwitch.width, "both rows share the right edge").toBeCloseTo(
      settled.x + settled.width,
      0,
    );

    // The frozen presentation is untouched by the moved chrome: the sheets are
    // still laid out from the Stack's own workspace inset.
    const bounds = await boxOf(window.getByTestId("spatial-layers-bounds"));
    expect(bounds.x, "sheet bounds keep their frozen left inset").toBeCloseTo(128, 0);
    expect(bounds.y, "sheet bounds keep their frozen top inset").toBeCloseTo(24, 0);
    expect(viewport.width - (bounds.x + bounds.width)).toBeCloseTo(96, 0);
    expect(viewport.height - (bounds.y + bounds.height)).toBeCloseTo(24, 0);

    // Both rows remain usable.
    await expect(window.getByTestId("spatial-layers-add")).toBeVisible();
    await expect(window.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(window.getByTestId("top-chrome-application")).toBeVisible();

    // The list is an ordinary panel with its own header, and it opens below the
    // chrome the same way the page panels do.
    await openLayerList(window);
    const panel = await boxOf(window.getByTestId("layers-panel"));
    expect(overlaps(right, panel), "the layers list clears the right chrome").toBe(false);
    expect(panel.y).toBeGreaterThanOrEqual(below);
    expect(await boxOf(window.getByTestId("top-chrome-right"))).toEqual(right);
  } finally {
    await app.close();
  }
});

test("keeps the top chrome contained at a minimum window", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio(960, 640);
  try {
    const chrome = await chromeBoxes(window);
    // The two sides still do not meet, so the composition survives the width.
    expect(chrome.right.x, "the sides stay apart at 960").toBeGreaterThan(
      chrome.left.x + chrome.left.width,
    );
    expect(chrome.right.x + chrome.right.width).toBeLessThanOrEqual(960);
    // Still symmetric at the minimum width.
    expect(960 - (chrome.right.x + chrome.right.width)).toBeCloseTo(chrome.left.x, 0);

    // Clear of the persistent workspace chrome it shares the window with.
    for (const id of ["workspace-utility-rail", "viewport-controls"]) {
      const other = await window.getByTestId(id).boundingBox();
      if (other === null) continue;
      expect(overlaps(chrome.left, other), `left chrome clears ${id}`).toBe(false);
      expect(overlaps(chrome.right, other), `right chrome clears ${id}`).toBe(false);
    }
    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    if ((await dock.count()) > 0) {
      const box = await boxOf(dock);
      expect(overlaps(chrome.left, box), "left chrome clears the tool dock").toBe(false);
      expect(overlaps(chrome.right, box), "right chrome clears the tool dock").toBe(false);
    }

    // And of the panels that open at the top of the workspace.
    await window.getByTestId("pages-toggle").click();
    const navigator = await boxOf(window.getByTestId("page-navigator"));
    expect(overlaps(chrome.right, navigator), "the navigator fits between the sides").toBe(false);
    expect(overlaps(chrome.left, navigator)).toBe(false);
    await window.getByTestId("pages-toggle").click();

    await window.getByTestId("page-settings-toggle").click();
    const settings = await boxOf(window.getByTestId("page-settings"));
    expect(overlaps(chrome.right, settings), "page settings clears the chrome").toBe(false);
    expect(settings.y + settings.height, "page settings stays in the window").toBeLessThanOrEqual(
      640,
    );
    await window.getByTestId("page-settings-toggle").click();

    // Nothing has pushed the window into scrolling.
    const overflow = await window.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal, "no horizontal overflow").toBe(false);
    expect(overflow.vertical, "no vertical overflow").toBe(false);
  } finally {
    await app.close();
  }
});
