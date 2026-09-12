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
    // Identity is read, not operated: no control role, and the keyboard passes
    // straight over it.
    expect(
      await window
        .getByTestId("sketch-name")
        .evaluate(
          (node) => `${node.getAttribute("role") ?? ""}|${node.getAttribute("tabindex") ?? ""}`,
        ),
      "the sketch name is not a control",
    ).toBe("|");
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
    // Persistence exists now, so the file actions are real; the ones that still
    // have no implementation behind them are still absent rather than greyed.
    await window.getByTestId("application-menu-trigger").click();
    const menu = window.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(7);
    for (const [testId, label] of [
      ["menu-new-project", "New"],
      ["menu-open-project", "Open…"],
      ["menu-save-project", "Save"],
      ["menu-save-project-as", "Save As…"],
      ["menu-show-recovery", "Recovered drawings…"],
    ] as const) {
      const item = menu.getByTestId(testId);
      await expect(item, `${label} is offered`).toHaveCount(1);
      await expect(item).toContainText(label);
      await expect(item).toBeEnabled();
    }
    // Each file action names the key that also performs it.
    for (const accelerator of ["Ctrl+N", "Ctrl+O", "Ctrl+S", "Ctrl+Shift+S"]) {
      await expect(menu.getByText(accelerator, { exact: true })).toHaveCount(1);
    }
    await expect(menu.getByRole("menuitem", { name: /appearance/iu })).toHaveCount(2);
    for (const absent of ["Recent", "Close", "Export", "Print", "Rename"]) {
      await expect(
        menu.getByRole("menuitem", { name: new RegExp(`^${absent}`, "u") }),
        `${absent} has no implementation, so it is not offered`,
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

/**
 * The application menu is a keyboard destination, not a mouse-only one.
 *
 * Radix owns the mechanics; what this protects is that Folio has not put
 * anything in their way -- a global key handler, a stolen focus, a tooltip
 * hanging over the open menu -- and that the keyboard always comes back
 * somewhere it can act from.
 */
test("opens and navigates the application menu from the keyboard", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const trigger = window.getByTestId("application-menu-trigger");
    const menu = window.getByRole("menu");
    const first = menu.getByRole("menuitem").first();
    const last = menu.getByRole("menuitem").last();

    // The top-left control is the first thing the keyboard reaches.
    await window.evaluate(() => document.body.focus());
    await window.keyboard.press("Tab");
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    await expect(menu).toBeVisible();
    await expect(first).toBeFocused();
    // No tooltip left hanging over the surface the trigger just opened.
    await expect(window.locator('[role="tooltip"]:visible')).toHaveCount(0);

    await window.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await window.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();
    await window.keyboard.press("End");
    await expect(last).toBeFocused();
    await window.keyboard.press("Home");
    await expect(first).toBeFocused();

    // Escape closes it and hands the keyboard back to the trigger.
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Space opens it too, and a press outside dismisses without losing focus.
    await trigger.press("Space");
    await expect(menu).toBeVisible();
    await expect(first).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await trigger.press("Enter");
    await expect(menu).toBeVisible();
    // Settled, not merely mounted, and reached the way a hand reaches it: a
    // menu opened from the keyboard ignores an outside press until the pointer
    // has actually moved, so move before pressing.
    await expect(first).toBeFocused();
    await window.mouse.move(760, 520);
    await window.mouse.click(760, 520);
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Reduced motion changes the choreography, never the reachability.
    await window.emulateMedia({ reducedMotion: "reduce" });
    await trigger.press("Enter");
    await expect(menu).toBeVisible();
    await expect(first).toBeFocused();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await window.emulateMedia({ reducedMotion: "no-preference" });
  } finally {
    await app.close();
  }
});

test("keeps appearance honest and hands focus back from its settings", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const trigger = window.getByTestId("application-menu-trigger");
    const menu = window.getByRole("menu");
    const dialog = window.getByRole("dialog");

    // The appearance action does what it says and closes behind itself.
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
    await trigger.click();
    await menu.getByRole("menuitem", { name: /^use .* appearance$/iu }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Settings opens exactly one dialog, and closing it -- either way -- puts
    // the keyboard back on the control that opened it rather than the body.
    for (const close of ["escape", "done"] as const) {
      await trigger.click();
      await menu.getByRole("menuitem", { name: /settings/iu }).click();
      await expect(dialog).toHaveCount(1);
      await expect(menu).toHaveCount(0);
      if (close === "escape") await window.keyboard.press("Escape");
      else await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  } finally {
    await app.close();
  }
});

/**
 * The menu shares the workspace with surfaces that own their own space.
 *
 * None of them is modal over the others, so the contract is about handover:
 * pressing another control dismisses the menu and that control still acts,
 * and dismissing the menu never disturbs what was already open.
 */
test("hands over cleanly between the menu and the workspace surfaces", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const trigger = window.getByTestId("application-menu-trigger");
    const menu = window.getByRole("menu");
    const pages = window.getByTestId("pages-toggle");

    // A press on Pages while the menu is open reaches Pages.
    await trigger.click();
    await expect(menu).toBeVisible();
    await pages.click();
    await expect(menu).toHaveCount(0);
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await expect(pages).toHaveAttribute("aria-pressed", "true");

    // Opening the menu over the navigator leaves the navigator alone, and
    // closing the menu leaves it open with its toggle still reading pressed.
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await expect(pages).toHaveAttribute("aria-pressed", "true");
    await pages.click();
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);
    await expect(pages).toHaveAttribute("aria-pressed", "false");

    // The same for Page settings.
    const settingsToggle = window.getByTestId("page-settings-toggle");
    await settingsToggle.click();
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(settingsToggle).toHaveAttribute("aria-pressed", "true");
    await settingsToggle.click();

    // And for the Layers Stack, whose own mode row stays reachable.
    await openStack(window);
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(window.getByTestId("spatial-layers-view")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(window.getByTestId("spatial-layers-view")).toBeVisible();
    await expect(window.getByTestId("spatial-layers-add")).toBeVisible();
    await expect(trigger).toBeFocused();
  } finally {
    await app.close();
  }
});

test("contains the application menu at a minimum window", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio(960, 640);
  try {
    await window.getByTestId("application-menu-trigger").click();
    const menu = window.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = await boxOf(menu);
    expect(box.x, "the menu stays inside the window").toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(960);
    expect(box.y + box.height).toBeLessThanOrEqual(640);

    // Below the chrome it belongs to, and clear of the identity beside it.
    const sketch = await boxOf(window.getByTestId("top-chrome-sketch"));
    expect(box.y, "the menu opens beneath the chrome").toBeGreaterThanOrEqual(
      sketch.y + sketch.height,
    );
    expect(overlaps(box, sketch), "the menu does not cover the sketch name").toBe(false);
    // A menu long enough to hold the file actions reaches down the left edge,
    // which is what a transient surface is allowed to do. What it must not do
    // is push the workspace around while it is open.
    const dock = window.locator("[data-tool-dock-layout]");
    if ((await dock.count()) > 0) {
      const open = await boxOf(dock);
      await window.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(await boxOf(dock), "the menu overlays the dock without moving it").toEqual(open);
      await window.getByTestId("application-menu-trigger").click();
      await expect(menu).toBeVisible();
    }

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

/**
 * Space belongs to whatever holds focus, and focus is now truthful.
 *
 * The editor holds Space for the transient pan. It used to take the key
 * whenever the pointer was over the canvas, because pressing the artwork left
 * focus parked on the last button pressed and "what is focused" was therefore
 * a stale answer for the whole drawing session. The drawing surface now takes
 * focus when it is pressed, so the question is worth asking again: a control
 * the user is on keeps its own activation key, and the canvas keeps the pan.
 */
test("gives Space to the control that holds focus, and to the pan when the canvas does", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const surface = surfaceOf(window);
    const trigger = window.getByTestId("application-menu-trigger");
    const menu = window.getByRole("menu");
    const pages = window.getByTestId("pages-toggle");
    const settings = window.getByTestId("page-settings-toggle");
    const panState = async (): Promise<string | null> =>
      surface.getAttribute("data-viewport-pan-state");

    // Selecting a tool leaves that button focused, and Space stays with it.
    await window.locator('button[data-dock-slot="pen"]').click();
    await expect(window.locator('button[data-dock-slot="pen"]')).toBeFocused();

    // Pressing the artwork hands focus to the surface, which is what makes the
    // pan gesture the truthful owner of Space from then on.
    await window.mouse.move(700, 500);
    await window.mouse.down({ button: "middle" });
    await window.mouse.up({ button: "middle" });
    await expect(surface).toBeFocused();
    await window.keyboard.down("Space");
    await expect(surface).toHaveAttribute("data-viewport-pan-state", "grab");
    await window.keyboard.up("Space");
    await expect(surface).toHaveAttribute("data-viewport-pan-state", "idle");

    // Walking to a control takes the key back, with the pointer left exactly
    // where it was: over the canvas.
    // Tab from the canvas continues from the canvas's place in the document,
    // so it walks the workspace controls before coming round to the chrome.
    for (
      let step = 0;
      step < 30 && !(await trigger.evaluate((node) => node === document.activeElement));
      step += 1
    ) {
      await window.keyboard.press("Tab");
    }
    await expect(trigger).toBeFocused();
    await window.keyboard.press("Space");
    await expect(menu).toBeVisible();
    expect(await panState(), "the canvas did not take Space").toBe("idle");

    // A menu item reached with the arrows activates on Space too. End lands on
    // appearance settings, which is the one item that answers without leaving
    // the window.
    await window.keyboard.press("End");
    await expect(menu.getByRole("menuitem").last()).toBeFocused();
    await window.keyboard.press("Space");
    await expect(window.getByRole("dialog")).toBeVisible();
    expect(await panState()).toBe("idle");
    await window.keyboard.press("Escape");
    await expect(window.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // The rest of the top chrome, walked to the same way.
    await window.keyboard.press("Tab");
    await expect(pages).toBeFocused();
    await window.keyboard.press("Space");
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await expect(pages).toHaveAttribute("aria-pressed", "true");
    expect(await panState()).toBe("idle");
    await window.keyboard.press("Space");
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);

    await window.keyboard.press("Tab");
    await expect(settings).toBeFocused();
    await window.keyboard.press("Space");
    await expect(window.getByTestId("page-settings")).toBeVisible();
    await expect(settings).toHaveAttribute("aria-pressed", "true");
    expect(await panState()).toBe("idle");
    await window.keyboard.press("Space");
    await expect(window.getByTestId("page-settings")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("moves keyboard ownership back and forth with the pointer", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const surface = surfaceOf(window);
    const pages = window.getByTestId("pages-toggle");

    // Canvas takes focus from a press...
    await window.mouse.move(700, 500);
    await window.mouse.down({ button: "middle" });
    await window.mouse.up({ button: "middle" });
    await expect(surface).toBeFocused();

    // ...and a control takes it straight back, with its own Space.
    await pages.click();
    await expect(pages).toBeFocused();
    await expect(window.getByTestId("page-navigator")).toBeVisible();
    await window.keyboard.press("Space");
    await expect(window.getByTestId("page-navigator")).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-viewport-pan-state", "idle");

    // A pan that started always releases, whatever takes focus under it.
    await window.mouse.move(700, 500);
    await window.mouse.down({ button: "middle" });
    await window.mouse.up({ button: "middle" });
    await expect(surface).toBeFocused();
    await window.keyboard.down("Space");
    await expect(surface).toHaveAttribute("data-viewport-pan-state", "grab");
    await window.getByTestId("application-menu-trigger").focus();
    await window.keyboard.up("Space");
    await expect(surface).toHaveAttribute("data-viewport-pan-state", "idle");
  } finally {
    await app.close();
  }
});
