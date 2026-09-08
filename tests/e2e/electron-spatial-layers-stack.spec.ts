import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addLayer,
  buildQaDocument,
  drawStroke,
  launchFolio,
  objectCount,
  openLayerList,
  openStack,
  surfaceOf,
  useDarkAppearance,
} from "./layers-stack-helpers";

/**
 * Phase 2: the Layers experience, presented as a spatial stack or a list.
 *
 * These specs care about what the stack shows and who owns input -- not about
 * layer management, which the list panel still provides. Screenshots are
 * captured for the manual visual pass this phase exists to enable.
 */

async function historyDepth(window: Page): Promise<string> {
  return (await surfaceOf(window).getAttribute("data-history-undo-depth")) ?? "";
}

async function camera(window: Page): Promise<string> {
  const surface = surfaceOf(window);
  return [
    await surface.getAttribute("data-viewport-zoom"),
    await surface.getAttribute("data-viewport-page-x"),
    await surface.getAttribute("data-viewport-page-y"),
  ].join("|");
}

async function layerOrder(window: Page): Promise<readonly string[]> {
  return JSON.parse((await surfaceOf(window).getAttribute("data-layer-order")) ?? "[]") as string[];
}

async function capture(window: Page, name: string): Promise<void> {
  await window.waitForTimeout(220);
  await window.screenshot({ path: test.info().outputPath(name) });
}

/** Reads a plane's canvas to decide whether anything was actually drawn. */
async function canvasIsBlank(view: Locator, layerId: string): Promise<boolean> {
  return view.locator(`[data-layer-canvas="${layerId}"]`).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) return true;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] !== 0) return false;
    }
    return true;
  });
}

/** The resolved sheet edge, so border strength is asserted rather than described. */
async function borderOf(view: Locator, layerId: string): Promise<string> {
  return view
    .locator(`[data-layer-plane="${layerId}"]`)
    .evaluate((node) => getComputedStyle(node).borderTopColor);
}

/** Alpha of a resolved CSS colour, 1 when the colour carries no alpha channel. */
function alphaOf(color: string): number {
  const parts = color.match(/[\d.]+/gu) ?? [];
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

async function overlaps(first: Locator, second: Locator): Promise<boolean> {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (a === null || b === null) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("opens one Layers experience showing real sheets over the page paper", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // 1. Exactly one Layers entry point in the workspace.
    await expect(window.getByTestId("layers-toggle")).toHaveCount(1);
    await expect(window.getByTestId("layer-list-toggle")).toHaveCount(0);

    const order = await buildQaDocument(window);
    const historyBefore = await historyDepth(window);
    const cameraBefore = await camera(window);

    // 2. The trigger opens the stack, with one plane per Layer plus the paper.
    const view = await openStack(window);
    await expect(view).toHaveAttribute("data-layer-count", String(order.length));
    await expect(view.locator("[data-layer-plane]")).toHaveCount(order.length);
    await expect(view.getByTestId("spatial-paper-plane")).toHaveCount(1);

    // 3. Visual order matches compositing order.
    const displayed = await view
      .locator("[data-layer-display-index]")
      .evaluateAll((nodes) =>
        nodes
          .sort(
            (first, second) =>
              Number(first.getAttribute("data-layer-display-index")) -
              Number(second.getAttribute("data-layer-display-index")),
          )
          .map((node) => node.getAttribute("data-testid")),
      );
    expect(displayed).toEqual([...order].reverse().map((id) => `spatial-layer-plane-${id}`));

    // 4. Labels name the real Layers and stay clear of the utility rail.
    for (const layerId of order) {
      await expect(view.getByTestId(`spatial-layer-label-${layerId}`)).toBeVisible();
    }
    await expect(view.getByTestId("spatial-paper-label")).toBeVisible();
    expect(
      await overlaps(
        view.getByTestId(`spatial-layer-label-${order[0]}`),
        window.getByTestId("workspace-utility-rail"),
      ),
      "labels must never run under the utility rail",
    ).toBe(false);

    // 5 + 6. Activation is session state. The topmost sheet is nearest and
    // fully exposed, which is where a person would press.
    const target = order.at(-1)!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect(surfaceOf(window)).toHaveAttribute("data-active-layer-id", target);
    await expect(view.locator(`[data-testid="spatial-layer-plane-${target}"]`)).toHaveAttribute(
      "data-layer-active",
      "true",
    );
    expect(await historyDepth(window), "activation creates no History").toBe(historyBefore);

    // 7. The thin pencil layer really is rendered, not merely present.
    expect(await canvasIsBlank(view, order[0]!), "thin ink must reach the plane").toBe(false);

    await capture(window, "A-light-chosen-geometry.png");

    // 8. The canvas is inert while the stack owns the page.
    const objectsBefore = await objectCount(window);
    await window.mouse.move(700, 420);
    await window.mouse.down();
    await window.mouse.move(820, 500, { steps: 8 });
    await window.mouse.up();
    expect(await objectCount(window)).toBe(objectsBefore);
    expect(await historyDepth(window)).toBe(historyBefore);

    // 9. Escape closes, focus returns, viewport untouched.
    await window.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(window.getByTestId("layers-toggle")).toBeFocused();
    await expect(window.getByTestId("layers-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(await camera(window), "a structural view never moves the camera").toBe(cameraBefore);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("switches between stack and list without touching the document", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const historyBefore = await historyDepth(window);
    const view = await openStack(window);

    // Stack -> List shows the mature panel, and every command stays reachable.
    await view.getByTestId("layers-view-list").click();
    const panel = window.getByTestId("layers-panel");
    await expect(panel).toBeVisible();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);

    const order = await layerOrder(window);
    for (const testId of [
      "layers-add",
      `layer-visibility-${order[0]}`,
      `layer-lock-${order[0]}`,
      `layer-delete-${order[0]}`,
      `layer-options-${order[0]}`,
      `layer-name-${order[0]}`,
    ]) {
      await expect(panel.getByTestId(testId), `${testId} stays reachable`).toBeVisible();
    }
    await expect(panel.getByTestId(`layer-drag-handle-${order[0]}`)).toBeAttached();

    // List -> Stack returns, and neither switch is a document change.
    await panel.getByTestId("layers-view-stack").click();
    await expect(window.getByTestId("spatial-layers-view")).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(await historyDepth(window), "view switching creates no History").toBe(historyBefore);

    // The single trigger closes whichever view is showing.
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    await openLayerList(window);
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("layers-panel")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("shows empty, hidden and locked layers truthfully", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildQaDocument(window);
    const bottom = order[0]!;
    const hidden = order[1]!;
    const locked = order[2]!;
    const empty = order.at(-1)!;
    const view = await openStack(window);

    // Hidden: plane, label and marker remain; the canvas is genuinely empty.
    await expect(view.locator(`[data-testid="spatial-layer-plane-${hidden}"]`)).toHaveAttribute(
      "data-layer-visible",
      "false",
    );
    await expect(view.getByTestId(`spatial-layer-hidden-${hidden}`)).toBeVisible();
    await expect(view.getByTestId(`spatial-layer-label-${hidden}`)).toBeVisible();
    expect(await canvasIsBlank(view, hidden)).toBe(true);

    // Locked: artwork still drawn, plus a marker.
    await expect(view.getByTestId(`spatial-layer-locked-${locked}`)).toBeVisible();
    expect(await canvasIsBlank(view, locked), "lock is not visibility").toBe(false);

    // Empty: a real, focusable plane with nothing painted into it.
    await expect(view.locator(`[data-layer-plane="${empty}"]`)).toBeEnabled();
    expect(await canvasIsBlank(view, empty)).toBe(true);
    expect(await canvasIsBlank(view, bottom)).toBe(false);

    await capture(window, "C-light-empty-hidden-locked.png");
    await useDarkAppearance(window);
    await capture(window, "C-dark-empty-hidden-locked.png");
  } finally {
    await app.close();
  }
});

test("stays keyboard navigable and clear of the workspace chrome", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio(960, 640);
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 300);
    await addLayer(window);
    await drawStroke(window, 380);
    const view = await openStack(window);

    const bounds = view.getByTestId("spatial-layers-bounds");
    for (const chrome of ["drawing-property-rail", "workspace-utility-rail"]) {
      expect(
        await overlaps(bounds, window.getByTestId(chrome)),
        `${chrome} must not sit under the stack`,
      ).toBe(false);
    }
    await capture(window, "D-minimum-window.png");

    const display = [...(await layerOrder(window))].reverse();
    await view.locator(`[data-layer-plane="${display[0]}"]`).focus();
    await window.keyboard.press("ArrowDown");
    await expect(view.locator(`[data-layer-plane="${display[1]}"]`)).toBeFocused();
    await window.keyboard.press("Home");
    await expect(view.locator(`[data-layer-plane="${display[0]}"]`)).toBeFocused();
    await window.keyboard.press("End");
    await expect(view.locator(`[data-layer-plane="${display.at(-1)}"]`)).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(surfaceOf(window)).toHaveAttribute("data-active-layer-id", display.at(-1)!);
  } finally {
    await app.close();
  }
});

test("separates the page into sheets and brings them back together", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await buildQaDocument(window);
    // Leave the experience remembering the stack so the trigger opens it cold.
    await openStack(window);
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);

    const view = window.getByTestId("spatial-layers-view");
    const toggle = window.getByTestId("layers-toggle");
    const historyBefore = await historyDepth(window);
    const activeBefore = await surfaceOf(window).getAttribute("data-active-layer-id");

    // 1. The trigger starts a separation rather than showing a finished stack.
    await toggle.click();
    await expect(view).toHaveAttribute("data-stack-phase", "opening");
    // 2. Sheets that are still travelling do not take presses meant for the
    //    workspace, and the canvas cannot be drawn through either.
    const objectsBefore = await objectCount(window);
    const planes = view.locator("[data-layer-plane]");
    expect(await planes.first().evaluate((node) => getComputedStyle(node).pointerEvents)).toBe(
      "none",
    );
    await window.mouse.move(700, 420);
    await window.mouse.down();
    await window.mouse.move(820, 520, { steps: 6 });
    await window.mouse.up();

    // 3. It settles, and only then do the sheets become interactive.
    await expect(view).toHaveAttribute("data-stack-phase", "open");
    await expect(view).toHaveAttribute("data-stack-progress", "1.00");
    expect(await planes.first().evaluate((node) => getComputedStyle(node).pointerEvents)).not.toBe(
      "none",
    );
    expect(await objectCount(window)).toBe(objectsBefore);

    // 4. The separation is presentation: no History, no change of active Layer.
    expect(await historyDepth(window)).toBe(historyBefore);
    await expect(surfaceOf(window)).toHaveAttribute("data-active-layer-id", activeBefore ?? "");

    // 5. Escape closes through the same travel and hands focus back.
    await window.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // 6. A rapid toggle leaves nothing stranded: the stack ends where the last
    //    press asked it to, fully settled, with one plane per Layer.
    const order = await layerOrder(window);
    await toggle.click();
    await toggle.click();
    await toggle.click();
    await expect(view).toHaveAttribute("data-stack-phase", "open");
    await expect(view).toHaveAttribute("data-stack-progress", "1.00");
    await expect(view.locator("[data-layer-plane]")).toHaveCount(order.length);
    await toggle.click();
    await expect(view).toHaveCount(0);
    expect(await historyDepth(window)).toBe(historyBefore);
  } finally {
    await app.close();
  }
});

test("arrives at its final geometry immediately under reduced motion", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await openStack(window);
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);

    await window.emulateMedia({ reducedMotion: "reduce" });
    const view = window.getByTestId("spatial-layers-view");
    // No staged separation at all: the arrangement is simply there.
    await window.getByTestId("layers-toggle").click();
    await expect(view).toHaveAttribute("data-stack-phase", "open");
    await expect(view).toHaveAttribute("data-stack-progress", "1.00");
    await expect(view.locator("[data-layer-plane]")).toHaveCount(2);
    await window.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("gives every sheet an edge, whatever the layer holds", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildQaDocument(window);
    const hidden = order[1]!;
    const locked = order[2]!;
    const empty = order.at(-1)!;
    const view = await openStack(window);

    // 1. Every plane carries a visible boundary -- empty, hidden and locked
    //    included. The outline is what says a Layer is there at all.
    for (const layerId of order) {
      const border = await borderOf(view, layerId);
      expect(alphaOf(border), `${layerId} must have a sheet edge`).toBeGreaterThan(0.15);
    }
    for (const layerId of [hidden, locked, empty]) {
      expect(alphaOf(await borderOf(view, layerId))).toBeGreaterThan(0.15);
    }

    // 2. Inactive is restrained, hover is stronger, active is the accent. The
    //    hierarchy is what carries the state, not a fill or a shadow.
    //
    //    Measured on the topmost sheet, which is the only one no other sheet
    //    covers -- the rest are deliberately overlapped, and a pointer cannot
    //    reach their centres. Focus moves one step down so the top sheet is
    //    inactive while staying beside the focus zone; sending focus to the far
    //    end of the stack would carry it off screen, which is the navigation
    //    working, not a sheet that has stopped existing.
    const top = order.at(-1)!;
    const neighbour = order.at(-2)!;
    const accented = await borderOf(view, top);
    await view.locator(`[data-layer-plane="${top}"]`).focus();
    await window.keyboard.press("ArrowDown");
    await expect(surfaceOf(window)).toHaveAttribute("data-active-layer-id", neighbour);
    await window.mouse.move(4, 4);

    const inactive = await borderOf(view, top);
    expect(inactive, "the active sheet is accented").not.toBe(accented);
    await view.locator(`[data-layer-plane="${top}"]`).hover();
    expect(await borderOf(view, top), "hover strengthens the edge").not.toBe(inactive);
    expect(alphaOf(inactive), "and inactive stays restrained").toBeLessThan(alphaOf(accented));

    // 3. Only the paper is a physical object: it alone gets a base shadow.
    const paperShadow = await view
      .getByTestId("spatial-paper-plane")
      .locator("div")
      .first()
      .evaluate((node) => getComputedStyle(node).boxShadow);
    expect(paperShadow).not.toBe("none");
    const sheetShadow = await view
      .locator(`[data-layer-plane="${order[0]}"]`)
      .evaluate((node) => getComputedStyle(node).boxShadow);
    expect(sheetShadow, "transparent sheets do not float").toBe("none");

    // 4. Hovering and focusing never touch the document.
    await expect(view.locator(`[data-testid="spatial-layer-plane-${hidden}"]`)).toHaveAttribute(
      "data-layer-visible",
      "false",
    );
    await expect(view.locator(`[data-testid="spatial-layer-plane-${locked}"]`)).toHaveAttribute(
      "data-layer-locked",
      "true",
    );
  } finally {
    await app.close();
  }
});

test("ends the stack on a page switch but leaves the list alone", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await window.getByTestId("pages-toggle").click();
    const navigator = window.getByTestId("page-navigator");
    await expect(navigator).toBeVisible();

    // The stack is a modal structural view of one page, so a page switch ends
    // it rather than rebuilding it for a different document.
    await openStack(window);
    await navigator.getByTestId("page-add").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);

    // The list is an ordinary panel and has always coexisted with the pages it
    // is used alongside. It must survive the same switch -- and closing it here
    // would also reorder the dismissal stack, so the next press on the canvas
    // would put away the navigator instead of the panel.
    await openLayerList(window);
    await expect(navigator).toBeVisible();
    await navigator.getByTestId("page-add").click();
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await expect(navigator).toBeVisible();
  } finally {
    await app.close();
  }
});

test("gives way to the drawing tools and the brush library", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await openStack(window);

    // Choosing a tool closes the experience and activates the tool normally.
    await window.locator('button[data-dock-slot="marker"]').click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    await expect(window.locator('button[data-dock-slot="marker"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await drawStroke(window, 340);

    // The radial library and the stack never coexist: marker is already active,
    // so one press both closes the stack and opens the library.
    await openStack(window);
    await window.locator('button[data-dock-slot="marker"]').click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
      "data-library-phase",
      "open",
    );
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("radial-brush-library")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/**
 * The Layer currently on the focus shelf, read from the live geometry.
 *
 * The shelf is a line near the bottom of the free workspace that the focused
 * sheet's lower edge rests on, so this asks which sheet's bottom is closest to
 * it -- the same thing the model places, measured off the real rendered boxes.
 */
async function focusZoneLayer(view: Locator): Promise<string> {
  return view.evaluate((root) => {
    const bounds = root.querySelector('[data-testid="spatial-layers-bounds"]')!;
    const box = bounds.getBoundingClientRect();
    const shelf = box.top + box.height * 0.9;
    let best = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const plane of root.querySelectorAll("[data-layer-plane]")) {
      const rect = plane.getBoundingClientRect();
      const distance = Math.abs(rect.bottom - shelf);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = plane.getAttribute("data-layer-plane") ?? "";
      }
    }
    return best;
  });
}

/**
 * The sheets that actually take part in the settled picture.
 *
 * Read from the emphasis the view publishes, which is the product rule itself:
 * everything beyond the focused sheet's immediate neighbours steps out of the
 * composition while staying mounted and navigable.
 */
async function composition(view: Locator): Promise<readonly string[]> {
  return view.evaluate((root) =>
    Array.from(root.querySelectorAll("[data-layer-emphasis]"))
      .filter((node) => Number(node.getAttribute("data-layer-emphasis")) > 0.05)
      .map(
        (node) => node.querySelector("[data-layer-plane]")?.getAttribute("data-layer-plane") ?? "",
      ),
  );
}

/** How much of a sheet's own surface is inside the workspace. */
async function visibleShareOf(view: Locator, layerId: string): Promise<number> {
  return view.evaluate((root, id) => {
    const bounds = root
      .querySelector('[data-testid="spatial-layers-bounds"]')!
      .getBoundingClientRect();
    const rect = root.querySelector(`[data-layer-plane="${id}"]`)!.getBoundingClientRect();
    const visible = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
    return Math.max(0, visible) / rect.height;
  }, layerId);
}

/** Waits for the arrangement to settle with `layerId` holding the focus zone. */
async function expectFocused(view: Locator, layerId: string | undefined): Promise<void> {
  await expect.poll(async () => focusZoneLayer(view), { timeout: 5_000 }).toBe(layerId ?? "");
}

const stackOffset = async (view: Locator): Promise<string> =>
  (await view.getByTestId("spatial-layers-scroller").getAttribute("data-stack-offset")) ?? "";

/**
 * Presses a sheet where a person actually can.
 *
 * Sheets overlap by design, so the centre of any plane but the topmost is
 * behind the one above it. The band along a sheet's lower edge is the part that
 * belongs to it alone, and that is where a press lands.
 */
async function clickSheet(view: Locator, layerId: string): Promise<void> {
  const plane = view.locator(`[data-layer-plane="${layerId}"]`);
  const height = await plane.evaluate((node) => node.getBoundingClientRect().height);
  await plane.click({ position: { x: 120, y: height - 14 } });
}

/** One deliberate gesture: enough movement, spaced enough to be intentional. */
async function wheelGesture(window: Page, deltaY: number): Promise<void> {
  await window.mouse.move(660, 430);
  await window.mouse.wheel(0, deltaY);
  await window.waitForTimeout(220);
}

/** A ten-Layer document, so navigation has somewhere to go. */
async function buildDeepDocument(window: Page): Promise<readonly string[]> {
  await window.locator('button[data-dock-slot="pencil"]').click();
  await drawStroke(window, 320, 18, 440, 24);
  for (let index = 0; index < 9; index += 1) {
    await addLayer(window);
    await drawStroke(window, 300 + index * 22, 16, 420 + index * 8, 22);
  }
  return JSON.parse(
    (await surfaceOf(window).getAttribute("data-layer-order")) ?? "[]",
  ) as readonly string[];
}

test("navigates between sheets instead of scrolling", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildDeepDocument(window);
    const display = [...order].reverse();
    const view = await openStack(window);
    const surface = surfaceOf(window);
    const historyBefore = await historyDepth(window);
    const cameraBefore = await camera(window);

    // 1. The stack opens on the Layer being worked on, in the focus zone.
    const active = await surface.getAttribute("data-active-layer-id");
    expect(active).toBe(display[0]);
    await expectFocused(view, active); // "the active Layer is the focused one"

    // 2. There is no browser scrollbar and no reserved gutter.
    const scroller = view.getByTestId("spatial-layers-scroller");
    const gutter = await scroller.evaluate((node) => ({
      vertical: node.offsetWidth - node.clientWidth,
      horizontal: node.offsetHeight - node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(gutter.vertical, "no vertical scrollbar gutter").toBe(0);
    expect(gutter.horizontal, "no horizontal scrollbar gutter").toBe(0);
    expect(gutter.overflowY).toBe("hidden");

    // 3. A window onto the arrangement, not a picture of all of it. Ten Layers
    //    settle into three: the one being worked on and its two neighbours.
    //    The rest stay mounted and navigable but leave the composition.
    const composed = await composition(view);
    expect(composed.length, "only three sheets read at once").toBeLessThanOrEqual(3);
    expect(composed, "and the focused sheet is one of them").toContain(active);
    expect(
      await visibleShareOf(view, active!),
      "the focused sheet is wholly inspectable",
    ).toBeGreaterThan(0.95);

    // 4. One deliberate gesture moves exactly one Layer, downward through the
    //    visual stack, and the Layer it lands on becomes active.
    const offsetBefore = await stackOffset(view);
    await wheelGesture(window, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[1]!);
    await expectFocused(view, display[1]);
    expect(await stackOffset(view), "the arrangement moved").not.toBe(offsetBefore);
    await expect(view.locator(`[data-testid="spatial-layer-plane-${display[1]}"]`)).toHaveAttribute(
      "data-layer-active",
      "true",
    );
    await expect(
      view.locator(`[data-testid="spatial-layer-plane-${display[0]}"]`),
      "the accent follows the focus",
    ).toHaveAttribute("data-layer-active", "false");

    // 4. The next gesture continues, and a reversed one comes back.
    await wheelGesture(window, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[2]!);
    await wheelGesture(window, -140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[1]!);
    await expectFocused(view, display[1]);

    // 5. Navigation is presentation: no History, no canvas viewport change.
    expect(await historyDepth(window), "navigation creates no History").toBe(historyBefore);
    expect(await camera(window), "and never moves the real canvas").toBe(cameraBefore);

    // 6. Every Layer stays reachable, including the far end of the stack.
    for (let step = 0; step < 8; step += 1) await wheelGesture(window, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display.at(-1)!);
    await expectFocused(view, display.at(-1));
    // The bottom of the stack is the end of it: there is no Paper to focus.
    await wheelGesture(window, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display.at(-1)!);
  } finally {
    await app.close();
  }
});

test("moves the same way whichever input asks", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildDeepDocument(window);
    const display = [...order].reverse();
    const view = await openStack(window);
    const surface = surfaceOf(window);
    const historyBefore = await historyDepth(window);

    // Keyboard walks the visual order and focuses as it goes.
    await view.locator(`[data-layer-plane="${display[0]}"]`).focus();
    await window.keyboard.press("ArrowDown");
    await expect(surface).toHaveAttribute("data-active-layer-id", display[1]!);
    await expectFocused(view, display[1]);
    await window.keyboard.press("ArrowUp");
    await expect(surface).toHaveAttribute("data-active-layer-id", display[0]!);
    await window.keyboard.press("End");
    await expect(surface).toHaveAttribute("data-active-layer-id", display.at(-1)!);
    await expectFocused(view, display.at(-1));
    await window.keyboard.press("Home");
    await expect(surface).toHaveAttribute("data-active-layer-id", display[0]!);
    await expectFocused(view, display[0]);

    // A press on a visible neighbour does exactly what the wheel and the keys
    // do: it becomes active and comes into the focus zone.
    await clickSheet(view, display[1]!);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[1]!);
    await expectFocused(view, display[1]);

    expect(await historyDepth(window), "no input path writes History").toBe(historyBefore);
  } finally {
    await app.close();
  }
});

test("retargets rather than queueing when input keeps coming", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildDeepDocument(window);
    const display = [...order].reverse();
    const view = await openStack(window);
    const surface = surfaceOf(window);

    // Two gestures in quick succession: the second is accepted while the first
    // is still settling, and the stack ends on the latest target rather than
    // working through a backlog.
    await window.mouse.move(660, 430);
    await window.mouse.wheel(0, 140);
    await window.waitForTimeout(160);
    await window.mouse.wheel(0, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[2]!);

    // Settled: one Layer holds the focus position, with nothing left in flight.
    // Waited for rather than timed, because how long the arrangement takes to
    // arrive depends on how far it had to come.
    await expectFocused(view, display[2]);
    // Sustained stillness, not two samples that happened to agree: under load a
    // slow pair of frames can read the same twice while the value is still on
    // its way.
    const recent: string[] = [];
    await expect
      .poll(
        async () => {
          recent.push(await stackOffset(view));
          if (recent.length > 4) recent.shift();
          return recent.length === 4 && new Set(recent).size === 1;
        },
        { timeout: 8_000, intervals: [120] },
      )
      .toBe(true);
    const resting = recent.at(-1);
    await window.waitForTimeout(300);
    expect(await stackOffset(view), "nothing is still drifting").toBe(resting);
  } finally {
    await app.close();
  }
});

test("navigates immediately under reduced motion", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    const order = await buildDeepDocument(window);
    const display = [...order].reverse();
    await openStack(window);
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);

    await window.emulateMedia({ reducedMotion: "reduce" });
    const view = await openStack(window);
    const surface = surfaceOf(window);

    // No travel to wait for: the arrangement is already at the new offset.
    await window.mouse.move(660, 430);
    await window.mouse.wheel(0, 140);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[1]!);
    await expectFocused(view, display[1]); // "focused without any settling"

    await clickSheet(view, display[0]!);
    await expect(surface).toHaveAttribute("data-active-layer-id", display[0]!);
    await expectFocused(view, display[0]);
  } finally {
    await app.close();
  }
});

/**
 * Phase 3: contextual actions on the focused sheet.
 *
 * The stack is a second presentation of the same Layer model, so these specs
 * check that it reaches the existing actions with the existing semantics -- and
 * that only the focused sheet ever carries controls.
 */

const controlCluster = (window: Page): Locator => window.getByTestId("spatial-layer-controls");

async function activeLayerId(window: Page): Promise<string> {
  return (await surfaceOf(window).getAttribute("data-active-layer-id")) ?? "";
}

const planeOf = (view: Locator, layerId: string): Locator =>
  view.getByTestId(`spatial-layer-plane-${layerId}`);

/** Focuses a sheet by pressing it, and waits for the activation to land. */
async function focusSheet(view: Locator, window: Page, layerId: string): Promise<void> {
  await view.locator(`[data-layer-plane="${layerId}"]`).click();
  await expect.poll(() => activeLayerId(window)).toBe(layerId);
  await expect(controlCluster(window)).toHaveAttribute("data-layer-controls-for", layerId);
}

test("gives contextual controls to the focused sheet and to no other", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const order = await layerOrder(window);
    const active = await activeLayerId(window);

    // Exactly one cluster exists, and it belongs to the active sheet.
    await expect(controlCluster(window)).toHaveCount(1);
    await expect(controlCluster(window)).toHaveAttribute("data-layer-controls-for", active);
    await expect(window.getByTestId(`spatial-layer-visibility-${active}`)).toBeVisible();

    // Neighbours keep their quiet label and passive markers, nothing more.
    for (const layerId of order.filter((id) => id !== active)) {
      await expect(window.getByTestId(`spatial-layer-label-${layerId}`)).toBeAttached();
      await expect(window.getByTestId(`spatial-layer-visibility-${layerId}`)).toHaveCount(0);
      await expect(window.getByTestId(`spatial-layer-lock-${layerId}`)).toHaveCount(0);
      await expect(window.getByTestId(`spatial-layer-delete-${layerId}`)).toHaveCount(0);
      await expect(window.getByTestId(`spatial-layer-rename-${layerId}`)).toHaveCount(0);
    }

    // The cluster follows the focus rather than being duplicated onto it.
    const neighbour = order.find((id) => id !== active) ?? "";
    await focusSheet(view, window, neighbour);
    await expect(controlCluster(window)).toHaveCount(1);
    await expect(window.getByTestId(`spatial-layer-visibility-${active}`)).toHaveCount(0);
    await expect(window.getByTestId(`spatial-layer-label-${active}`)).toBeAttached();
  } finally {
    await app.close();
  }
});

test("toggles visibility and lock through the existing layer actions", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const view = await openStack(window);
    const order = await layerOrder(window);
    const target = order[0] ?? "";
    await focusSheet(view, window, target);

    // Artwork is really there before hiding.
    expect(await canvasIsBlank(view, target)).toBe(false);

    const beforeVisibility = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-visibility-${target}`).click();
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-visible", "false");
    // One logical entry, and the artwork actually disappears from the preview.
    expect(Number(await historyDepth(window))).toBe(beforeVisibility + 1);
    await expect.poll(() => canvasIsBlank(view, target)).toBe(true);

    // A hidden focused layer stays manageable: the control that turns it back
    // on is still there, still named for the action it performs.
    const showAgain = window.getByTestId(`spatial-layer-visibility-${target}`);
    await expect(showAgain).toBeVisible();
    await expect(showAgain).toHaveAttribute("aria-label", /^Show /u);
    await showAgain.click();
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-visible", "true");
    await expect.poll(() => canvasIsBlank(view, target)).toBe(false);

    // Undo restores the layer action exactly, same as the list.
    await window.keyboard.press("Control+z");
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-visible", "false");
    await window.keyboard.press("Control+y");
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-visible", "true");

    // Lock is the same contract, and a locked layer never becomes unlockable.
    const beforeLock = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-locked", "true");
    expect(Number(await historyDepth(window))).toBe(beforeLock + 1);
    const unlock = window.getByTestId(`spatial-layer-lock-${target}`);
    await expect(unlock).toBeEnabled();
    await expect(unlock).toHaveAttribute("aria-label", /^Unlock /u);
    await unlock.click();
    await expect(planeOf(view, target)).toHaveAttribute("data-layer-locked", "false");
  } finally {
    await app.close();
  }
});

test("renames the focused layer, and restores it on Escape", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);
    const label = window.getByTestId(`spatial-layer-label-${target}`);

    // Commit.
    const beforeRename = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    const input = window.getByTestId("spatial-layer-rename-input");
    await expect(input).toBeFocused();
    await input.fill("Underdrawing");
    await input.press("Enter");
    await expect(label).toHaveText("Underdrawing");
    expect(Number(await historyDepth(window))).toBe(beforeRename + 1);

    // Typing must not navigate: the focused sheet is unchanged.
    expect(await activeLayerId(window)).toBe(target);

    // Escape restores the original and leaves the stack open.
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Discarded");
    await window.getByTestId("spatial-layer-rename-input").press("Escape");
    await expect(window.getByTestId("spatial-layer-rename-input")).toHaveCount(0);
    await expect(label).toHaveText("Underdrawing");
    await expect(view).toBeVisible();

    // An unchanged name is not a document change.
    const beforeNoop = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").press("Enter");
    await expect(window.getByTestId("spatial-layer-rename-input")).toHaveCount(0);
    expect(Number(await historyDepth(window))).toBe(beforeNoop);

    // The name the artist gave it survives the round trip to the list.
    await view.getByTestId("layers-view-list").click();
    await expect(window.getByTestId(`layer-name-${target}`)).toContainText("Underdrawing");
  } finally {
    await app.close();
  }
});

test("adjusts layer opacity as one transaction", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);
    const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${target}`);

    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    await expect(disclosure).toBeVisible();

    // One drag is one History entry, however many preview frames it produced.
    const slider = disclosure.getByRole("slider");
    const track = (await slider.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const beforeDrag = Number(await historyDepth(window));
    await window.mouse.move(track.x + track.width * 0.9, track.y + track.height / 2);
    await window.mouse.down();
    // Several moves, so a per-frame command would be caught by the count below.
    for (const share of [0.75, 0.6, 0.5, 0.42, 0.35]) {
      await window.mouse.move(track.x + track.width * share, track.y + track.height / 2);
    }
    const previewed = Number(await slider.inputValue());
    expect(previewed, "the preview reaches the live layer").toBeLessThan(1);
    await window.mouse.up();
    expect(Number(await historyDepth(window)), "one gesture, one entry").toBe(beforeDrag + 1);

    // The exact value is set through the numeric field, which commits once too.
    const beforeCommit = Number(await historyDepth(window));
    const field = disclosure.getByRole("spinbutton");
    await field.fill("40");
    await field.press("Enter");
    await expect(window.getByTestId(`spatial-layer-opacity-value-${target}`)).toHaveText("40%");
    expect(Number(await historyDepth(window))).toBe(beforeCommit + 1);
    await expect(window.getByTestId(`spatial-layer-opacity-${target}`)).toHaveAttribute(
      "aria-label",
      /40 percent/u,
    );

    // Escape cancels the open disclosure without closing the stack, and the
    // committed value is what survives.
    await window.keyboard.press("Escape");
    await expect(disclosure).toHaveCount(0);
    await expect(view).toBeVisible();
    await expect(window.getByTestId(`spatial-layer-opacity-value-${target}`)).toHaveText("40%");

    // The list agrees, because there is only one opacity.
    await view.getByTestId("layers-view-list").click();
    await expect(window.getByTestId(`layer-opacity-value-${target}`)).toHaveText("40%");
  } finally {
    await app.close();
  }
});

test("adds and deletes layers through the existing fallback rules", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);

    const view = await openStack(window);

    // A single-layer document cannot lose its last layer.
    const only = await activeLayerId(window);
    await expect(window.getByTestId(`spatial-layer-delete-${only}`)).toBeDisabled();

    // Add makes the new layer active, and the arrangement follows the derived
    // focus without anything setting an offset.
    const beforeAdd = Number(await historyDepth(window));
    await window.getByTestId("spatial-layers-add").click();
    await expect.poll(() => activeLayerId(window)).not.toBe(only);
    const added = await activeLayerId(window);
    expect(Number(await historyDepth(window))).toBe(beforeAdd + 1);
    await expect(view).toHaveAttribute("data-layer-count", "2");
    await expect(controlCluster(window)).toHaveAttribute("data-layer-controls-for", added);

    // Delete is now allowed, and the surviving layer becomes active and focused.
    await expect(window.getByTestId(`spatial-layer-delete-${added}`)).toBeEnabled();
    const beforeDelete = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-delete-${added}`).click();
    await expect(view).toHaveAttribute("data-layer-count", "1");
    expect(Number(await historyDepth(window))).toBe(beforeDelete + 1);
    await expect.poll(() => activeLayerId(window)).toBe(only);
    await expect(controlCluster(window)).toHaveAttribute("data-layer-controls-for", only);
    await expect(window.getByTestId(`spatial-layer-delete-${only}`)).toBeDisabled();
  } finally {
    await app.close();
  }
});

test("keeps navigation and the canvas working around the controls", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const order = await layerOrder(window);
    const scroller = view.getByTestId("spatial-layers-scroller");

    // Using a control must not move the arrangement.
    const target = await activeLayerId(window);
    const offsetBefore = await scroller.getAttribute("data-stack-offset");
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    expect(await activeLayerId(window)).toBe(target);
    expect(await scroller.getAttribute("data-stack-offset")).toBe(offsetBefore);

    // Wheel over the opacity disclosure adjusts the control, never the stack.
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${target}`);
    await expect(disclosure).toBeVisible();
    const box = (await disclosure.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.wheel(0, 400);
    expect(await activeLayerId(window)).toBe(target);
    await window.keyboard.press("Escape");
    await expect(disclosure).toHaveCount(0);

    // Keyboard navigation still works after using the controls.
    await view.locator(`[data-layer-plane="${target}"]`).focus();
    await window.keyboard.press("ArrowDown");
    await expect.poll(() => activeLayerId(window)).not.toBe(target);
    await window.keyboard.press("Home");
    await expect.poll(() => activeLayerId(window)).toBe(order[order.length - 1]);

    // Closing after control use must not swallow the next stroke.
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    const before = Number(await objectCount(window));
    await drawStroke(window, 300);
    expect(Number(await objectCount(window))).toBe(before + 1);
  } finally {
    await app.close();
  }
});

test("keeps stack and list showing the same layer state", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);

    // Mutations made in the stack are visible in the list.
    await window.getByTestId(`spatial-layer-visibility-${target}`).click();
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    await view.getByTestId("layers-view-list").click();
    const panel = window.getByTestId("layers-panel");
    await expect(panel.getByTestId(`layer-visibility-${target}`)).toHaveAttribute(
      "aria-label",
      /^Show /u,
    );
    await expect(panel.getByTestId(`layer-lock-${target}`)).toHaveAttribute(
      "aria-label",
      /^Unlock /u,
    );

    // Mutations made in the list are visible in the stack.
    await panel.getByTestId(`layer-visibility-${target}`).click();
    await panel.getByTestId("layers-view-stack").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveAttribute(
      "data-stack-phase",
      "open",
    );
    await expect(window.getByTestId(`spatial-layer-visibility-${target}`)).toHaveAttribute(
      "aria-label",
      /^Hide /u,
    );
    await expect(window.getByTestId(`spatial-layer-lock-${target}`)).toHaveAttribute(
      "aria-label",
      /^Unlock /u,
    );
  } finally {
    await app.close();
  }
});

/**
 * Every way an opacity adjustment and a rename can end.
 *
 * The transaction owner is shared with the list, so what is being checked here
 * is that the stack reaches every exit -- close, Escape, navigation, view
 * switch, page change, deletion, teardown -- and that each one resolves exactly
 * once with the semantics the list already defines.
 */

/** Drags the disclosure's track to a value below full, without releasing. */
async function dragOpacity(window: Page, disclosure: Locator, share: number): Promise<void> {
  const track = (await disclosure.getByRole("slider").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  await window.mouse.move(track.x + track.width * 0.95, track.y + track.height / 2);
  await window.mouse.down();
  await window.mouse.move(track.x + track.width * share, track.y + track.height / 2);
  await window.mouse.up();
}

/**
 * Waits for the arrangement to stop moving.
 *
 * Navigation settles toward its target rather than jumping, so a press issued
 * straight after an activation can land where a control used to be. Two
 * matching reads of the offset is the product's own "arrived" signal.
 */
async function settleStack(window: Page): Promise<void> {
  const scroller = window.getByTestId("spatial-layers-scroller");
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await scroller.getAttribute("data-stack-offset");
        const stable = previous !== null && current === previous;
        previous = current;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function openOpacity(window: Page, layerId: string): Promise<Locator> {
  await settleStack(window);
  await window.getByTestId(`spatial-layer-opacity-${layerId}`).click();
  const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${layerId}`);
  await expect(disclosure).toBeVisible();
  return disclosure;
}

/** Percentage the layer actually holds, read from the control's own name. */
async function opacityPercent(window: Page, layerId: string): Promise<number> {
  const label =
    (await window.getByTestId(`spatial-layer-opacity-${layerId}`).getAttribute("aria-label")) ?? "";
  return Number(/(\d+) percent/u.exec(label)?.[1] ?? Number.NaN);
}

test("resolves an opacity adjustment exactly once on every exit", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);

    // A. adjust, then close the disclosure normally -> commit, one entry.
    let disclosure = await openOpacity(window, target);
    let before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.6);
    const committed = await opacityPercent(window, target);
    expect(committed).toBeLessThan(100);
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    await expect(disclosure).toHaveCount(0);
    expect(Number(await historyDepth(window)), "A: one entry for the gesture").toBe(before + 1);
    expect(await opacityPercent(window, target)).toBe(committed);

    // I. reopen, change nothing, close -> zero History.
    disclosure = await openOpacity(window, target);
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    await expect(disclosure).toHaveCount(0);
    expect(Number(await historyDepth(window)), "I: an unchanged value is not a change").toBe(
      before,
    );
    expect(await opacityPercent(window, target)).toBe(committed);

    // B. adjust, then Escape -> the committed drag stands, the stack stays open.
    disclosure = await openOpacity(window, target);
    before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.3);
    const afterSecondDrag = await opacityPercent(window, target);
    await window.keyboard.press("Escape");
    await expect(disclosure).toHaveCount(0);
    await expect(view).toBeVisible();
    expect(Number(await historyDepth(window)), "B: Escape adds nothing of its own").toBe(
      before + 1,
    );
    expect(await opacityPercent(window, target)).toBe(afterSecondDrag);

    // C. adjust, then focus another layer -> resolved, and the disclosure does
    // not follow the focus onto the new sheet.
    disclosure = await openOpacity(window, target);
    before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.5);
    const beforeNavigate = await opacityPercent(window, target);
    const order = await layerOrder(window);
    const neighbour = order.find((id) => id !== target) ?? "";
    await view.locator(`[data-layer-plane="${neighbour}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(neighbour);
    await expect(window.getByTestId(`spatial-layer-opacity-panel-${neighbour}`)).toHaveCount(0);
    expect(Number(await historyDepth(window)), "C: navigating adds no entry of its own").toBe(
      before + 1,
    );
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);
    expect(await opacityPercent(window, target)).toBe(beforeNavigate);

    // D. adjust, then close the whole stack -> resolved, nothing left behind.
    disclosure = await openOpacity(window, target);
    before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.7);
    const beforeClose = await opacityPercent(window, target);
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    expect(Number(await historyDepth(window)), "D: closing adds no entry of its own").toBe(
      before + 1,
    );
    await openStack(window);
    expect(await opacityPercent(window, target)).toBe(beforeClose);
    await expect(window.getByTestId(`spatial-layer-opacity-panel-${target}`)).toHaveCount(0);

    // E. adjust, then switch to the list -> resolved, and the list agrees.
    disclosure = await openOpacity(window, target);
    before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.45);
    const beforeSwitch = await opacityPercent(window, target);
    await view.getByTestId("layers-view-list").click();
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    expect(Number(await historyDepth(window)), "E: switching view adds no entry").toBe(before + 1);
    await expect(window.getByTestId(`layer-opacity-value-${target}`)).toHaveText(
      `${beforeSwitch}%`,
    );
  } finally {
    await app.close();
  }
});

test("resolves an opacity adjustment across page switch and layer deletion", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    await openStack(window);
    let target = await activeLayerId(window);

    // F. adjust, then switch page -> the stack ends, the value is kept, and the
    // page it belonged to still holds it.
    let disclosure = await openOpacity(window, target);
    let before = Number(await historyDepth(window));
    await dragOpacity(window, disclosure, 0.55);
    const beforePageSwitch = await opacityPercent(window, target);
    await window.getByTestId("pages-toggle").click();
    await window.getByTestId("page-add").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    // Adding a page is its own entry; the opacity commit is the one before it.
    expect(Number(await historyDepth(window)), "F: opacity committed, then the page add").toBe(
      before + 2,
    );
    const pages = JSON.parse(
      (await surfaceOf(window).getAttribute("data-page-order")) ?? "[]",
    ) as string[];
    await window.getByTestId(`page-select-${pages[0]}`).click();
    await window.getByTestId("pages-toggle").click();
    await openStack(window);
    expect(await opacityPercent(window, target)).toBe(beforePageSwitch);

    // G. adjust, then delete the layer being adjusted -> the layer goes, and no
    // transaction is left pointing at it. Deleting is its own single entry.
    target = await activeLayerId(window);
    disclosure = await openOpacity(window, target);
    await dragOpacity(window, disclosure, 0.4);
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-delete-${target}`).click();
    await expect.poll(() => activeLayerId(window)).not.toBe(target);
    const survivor = await activeLayerId(window);
    expect(Number(await historyDepth(window)), "G: the delete, and nothing else").toBe(before + 1);
    await expect(window.getByTestId(`spatial-layer-opacity-panel-${survivor}`)).toHaveCount(0);

    // The survivor is fully manageable, and its own opacity is untouched.
    expect(await opacityPercent(window, survivor)).toBe(100);
    const reopened = await openOpacity(window, survivor);
    await expect(reopened).toBeVisible();
    await window.keyboard.press("Escape");

    // J. repeated close signals resolve once, not once each.
    const repeat = await openOpacity(window, survivor);
    await dragOpacity(window, repeat, 0.65);
    before = Number(await historyDepth(window));
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    await openStack(window);
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    expect(Number(await historyDepth(window)), "J: one resolution, however many signals").toBe(
      before,
    );
  } finally {
    await app.close();
  }
});

test("resolves a rename on every exit the way the list does", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);
    const label = window.getByTestId(`spatial-layer-label-${target}`);
    const startingName = (await label.textContent()) ?? "";

    // blur commits, exactly as the list's rename input does.
    let before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Blurred");
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    await expect(window.getByTestId("spatial-layer-rename-input")).toHaveCount(0);
    await expect(label).toHaveText("Blurred");
    // The rename commit plus the lock press that caused the blur.
    expect(Number(await historyDepth(window)), "blur commits the draft").toBe(before + 2);
    await window.getByTestId(`spatial-layer-lock-${target}`).click();

    // An empty draft is discarded by the shared normalisation, keeping the name.
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("   ");
    await window.getByTestId("spatial-layer-rename-input").press("Enter");
    await expect(label).toHaveText("Blurred");
    expect(Number(await historyDepth(window)), "an empty name is not a rename").toBe(before);

    // Focusing another layer ends the rename by blurring it, which commits --
    // the same thing pressing anything else in the list does. One entry for the
    // rename, one for the activation being a selection rather than a command.
    const order = await layerOrder(window);
    const neighbour = order.find((id) => id !== target) ?? "";
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Committed by blur");
    await view.locator(`[data-layer-plane="${neighbour}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(neighbour);
    await expect(window.getByTestId("spatial-layer-rename-input")).toHaveCount(0);
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);
    await expect(label).toHaveText("Committed by blur");
    expect(
      Number(await historyDepth(window)),
      "blur commits once; activating a layer is not a command",
    ).toBe(before + 1);

    // Closing the stack resolves the rename the same way, and reopening starts
    // clean rather than resurrecting the field.
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Closed while editing");
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    await openStack(window);
    await expect(window.getByTestId("spatial-layer-rename-input")).toHaveCount(0);
    await expect(window.getByTestId(`spatial-layer-label-${target}`)).toHaveText(
      "Closed while editing",
    );
    expect(Number(await historyDepth(window)), "one rename, however it ended").toBe(before + 1);

    // Escape is the one exit that discards, and it still leaves the stack open.
    before = Number(await historyDepth(window));
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Discarded");
    await window.getByTestId("spatial-layer-rename-input").press("Escape");
    await expect(view).toBeVisible();
    await expect(label).toHaveText("Closed while editing");
    expect(Number(await historyDepth(window)), "Escape discards the draft").toBe(before);

    // Switching to the list resolves it too, and the list shows the same name.
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    await window.getByTestId("spatial-layer-rename-input").fill("Seen by the list");
    await window.getByTestId("spatial-layers-view").getByTestId("layers-view-list").click();
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await expect(window.getByTestId(`layer-name-${target}`)).toContainText("Seen by the list");
    expect(startingName.length).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});

test("keeps the focused controls inside a minimum window", async () => {
  test.setTimeout(240_000);
  // The project's minimum supported window, chrome included.
  const { app, window } = await launchFolio(900, 640);
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320, 12, 380, 20);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const target = await activeLayerId(window);
    const band = view.getByTestId("spatial-layers-bounds");
    const bandBox = (await band.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

    /** Everything the artist has to reach must stay inside the free band. */
    const assertContained = async (control: Locator, what: string): Promise<void> => {
      const rect = (await control.boundingBox()) ?? { x: -1, y: -1, width: 0, height: 0 };
      expect(rect.x, `${what}: clear of the dock and property rail`).toBeGreaterThanOrEqual(
        bandBox.x - 1,
      );
      expect(rect.x + rect.width, `${what}: clear of the utility rail`).toBeLessThanOrEqual(
        bandBox.x + bandBox.width + 1,
      );
      expect(rect.y, `${what}: below the top chrome`).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height, `${what}: inside the window`).toBeLessThanOrEqual(640);
    };

    await assertContained(window.getByTestId("spatial-layer-control-row"), "control row");

    // The disclosure slides along its anchor and flips to whichever side fits,
    // rather than the arrangement moving to accommodate it.
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${target}`);
    await expect(disclosure).toBeVisible();
    await assertContained(disclosure, "opacity disclosure");
    await expect(disclosure).toHaveAttribute("data-disclosure-side", /above|below/u);
    await window.keyboard.press("Escape");

    // The rename field stays reachable and inside at the same size.
    await window.getByTestId(`spatial-layer-rename-${target}`).click();
    const input = window.getByTestId("spatial-layer-rename-input");
    await expect(input).toBeFocused();
    await assertContained(input, "rename field");
    await input.press("Escape");

    // Nothing here scrolls: not the page, and not the arrangement.
    const overflow = await window.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal, "no horizontal page scrollbar").toBe(false);
    expect(overflow.vertical, "no vertical page scrollbar").toBe(false);
    // The arrangement is deliberately taller than its container -- sheets keep
    // their size and are navigated. What must stay true is that this never
    // becomes a scroll: no gutter, no scrollbar, and a pinned scroll position.
    const gutter = await view.getByTestId("spatial-layers-scroller").evaluate((node) => ({
      horizontal: node.offsetHeight - node.clientHeight,
      vertical: node.offsetWidth - node.clientWidth,
      overflowY: getComputedStyle(node).overflowY,
      scrollTop: node.scrollTop,
    }));
    expect(gutter.vertical, "no vertical scrollbar gutter").toBe(0);
    expect(gutter.horizontal, "no horizontal scrollbar gutter").toBe(0);
    expect(gutter.overflowY).toBe("hidden");
    expect(gutter.scrollTop, "the offset is the only authority on position").toBe(0);
  } finally {
    await app.close();
  }
});

/**
 * Phase 4: reordering a Layer directly from the arrangement.
 *
 * The stack reaches the same `moveLayer` the list does, so what these check is
 * that a spatial gesture produces one canonical move, that nothing reaches the
 * document until the drop, and that every way out of a drag resolves cleanly.
 */

/** Comfortably longer than the product's first dwell plus one repeat. */
const REORDER_DWELL_SETTLE = 900;

/** Mirrors the product's edge-zone depth, for parking just outside one. */
const REORDER_EDGE_ZONE = 72;

const gripOf = (window: Page, layerId: string): Locator =>
  window.getByTestId(`spatial-layer-reorder-${layerId}`);

/** Display order, top-first: the reverse of canonical bottom-to-top storage. */
async function displayOrder(window: Page): Promise<readonly string[]> {
  return [...(await layerOrder(window))].reverse();
}

/**
 * Drags a sheet by its grip until the drop candidate is the wanted gap.
 *
 * State-driven rather than timed: the pointer travels in small steps and the
 * arrangement reports the gap it would drop into, so the gesture stops when it
 * has actually arrived rather than after a guessed distance.
 *
 * Only travel that stays inside the window is issued. The focused sheet sits on
 * a shelf near the bottom of the workspace, so the destination *below* it is
 * off-screen at supported window sizes -- see the report; downward moves are
 * covered by the keyboard, which reaches every position.
 */
async function dragSheetToGap(window: Page, layerId: string, targetGap: number): Promise<boolean> {
  const view = window.getByTestId("spatial-layers-view");
  // Measure the grip only once the arrangement has stopped moving: focusing a
  // sheet settles it toward the shelf, and a raw pointer press does not wait
  // for stability the way a click does.
  await settleStack(window);
  const grip = gripOf(window, layerId);
  const box = (await grip.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const viewport = window.viewportSize() ?? { width: 1440, height: 900 };
  const lowest = viewport.height - 4;

  await window.mouse.move(startX, startY);
  await window.mouse.down();
  // Comfortably past the product's 4px drag threshold, so the gesture is a drag
  // before it is aimed anywhere.
  await window.mouse.move(startX, startY + 8);
  await expect(view).toHaveAttribute("data-stack-reordering", "true");

  const dropIndex = async (): Promise<number> =>
    Number((await view.getAttribute("data-stack-drop-index")) ?? "-1");
  let y = startY;
  for (let step = 0; step < 120; step += 1) {
    const current = await dropIndex();
    if (current === targetGap) return true;
    const next = Math.min(lowest, Math.max(4, y + (current > targetGap ? -12 : 12)));
    if (next === y) return (await dropIndex()) === targetGap;
    y = next;
    await window.mouse.move(startX, y);
  }
  return (await dropIndex()) === targetGap;
}

/** Completes a drag that `dragSheetToGap` left holding the pointer. */
async function dropSheet(window: Page): Promise<void> {
  await window.mouse.up();
  await expect(window.getByTestId("spatial-layers-view")).toHaveAttribute(
    "data-stack-reordering",
    "false",
  );
}

test("reorders the focused layer by dragging its grip", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    expect(before).toHaveLength(3);

    // Focus the middle sheet, through the existing focus path, then move it up.
    const target = before[1]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const depth = Number(await historyDepth(window));
    expect(await dragSheetToGap(window, target, 0), "reaches the gap above the top sheet").toBe(
      true,
    );
    // Nothing has reached the document yet: the arrangement is presentation.
    expect(await displayOrder(window), "no command until the drop").toEqual(before);
    await dropSheet(window);

    await expect.poll(async () => (await displayOrder(window))[0]).toBe(target);
    expect(Number(await historyDepth(window)), "one gesture, one entry").toBe(depth + 1);
    expect(await activeLayerId(window), "the moved layer stays active").toBe(target);
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-active",
      "true",
    );
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-display-index",
      "0",
    );

    // Undo and Redo restore each canonical order exactly.
    await window.keyboard.press("Control+z");
    await expect.poll(() => displayOrder(window)).toEqual(before);
    await window.keyboard.press("Control+y");
    await expect.poll(async () => (await displayOrder(window))[0]).toBe(target);

    // The list agrees, because there is one canonical order.
    const moved = await displayOrder(window);
    await view.getByTestId("layers-view-list").click();
    const panel = window.getByTestId("layers-panel");
    await expect(panel).toBeVisible();
    const rows = await panel
      .locator("[data-layer-row-index]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid")?.replace("layer-row-", "") ?? ""),
      );
    expect(rows, "the list renders the same top-first order").toEqual(moved);
  } finally {
    await app.close();
  }
});

test("crosses several layers as one canonical move", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    for (let index = 0; index < 3; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    expect(before).toHaveLength(4);

    // The bottom sheet, carried to the top in one gesture.
    const target = before[3]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    // Two positions up in one gesture: the sheet crosses two others, and the
    // document sees one command. (The very top is off-screen from the focus
    // shelf at this depth; the keyboard reaches it, and the report says so.)
    const depth = Number(await historyDepth(window));
    expect(await dragSheetToGap(window, target, 1)).toBe(true);
    expect(await displayOrder(window), "no command until the drop").toEqual(before);
    await dropSheet(window);
    await expect.poll(async () => (await displayOrder(window))[1]).toBe(target);
    expect(Number(await historyDepth(window)), "crossing layers is not crossing commands").toBe(
      depth + 1,
    );

    // One Undo returns the whole multi-position move.
    await window.keyboard.press("Control+z");
    await expect.poll(() => displayOrder(window)).toEqual(before);
    await window.keyboard.press("Control+y");
    await expect.poll(async () => (await displayOrder(window))[1]).toBe(target);
  } finally {
    await app.close();
  }
});

test("leaves the order alone when a drag is abandoned", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = before[1]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const grip = gripOf(window, target);
    const box = (await grip.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Below the threshold is not a drag at all.
    let depth = Number(await historyDepth(window));
    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(startX, startY - 2);
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "a tremor is not a reorder").toBe(depth);

    // Escape during a drag restores the canonical order and keeps the stack
    // open, because the drag is the innermost thing Escape can unwind.
    depth = Number(await historyDepth(window));
    expect(await dragSheetToGap(window, target, 0)).toBe(true);
    await window.keyboard.press("Escape");
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    await expect(view).toBeVisible();
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "a cancelled drag reaches no command").toBe(depth);

    // A drop back into its own position is a no-op too.
    depth = Number(await historyDepth(window));
    expect(await dragSheetToGap(window, target, 1)).toBe(true);
    await dropSheet(window);
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "dropping it back is not a change").toBe(depth);

    // A live drag owns the pointer outright, so nothing else can be pressed
    // while it runs -- Escape is the way out. What must hold is the order of
    // release: the drag resolves, then the stack lets go of the workspace, and
    // the next stroke reaches the canvas rather than being swallowed.
    depth = Number(await historyDepth(window));
    expect(await dragSheetToGap(window, target, 0)).toBe(true);
    await window.keyboard.press("Escape");
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    await expect(view).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window))).toBe(depth);
    const objects = Number(await objectCount(window));
    await drawStroke(window, 300);
    expect(Number(await objectCount(window)), "the first stroke after a drag is not eaten").toBe(
      objects + 1,
    );
  } finally {
    await app.close();
  }
});

test("keeps the Phase 3 controls and navigation out of the reorder gesture", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = await activeLayerId(window);

    // Pressing and dragging a control never starts a reorder.
    for (const testId of [
      `spatial-layer-visibility-${target}`,
      `spatial-layer-lock-${target}`,
      `spatial-layer-rename-${target}`,
    ]) {
      const control = window.getByTestId(testId);
      const box = (await control.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await window.mouse.down();
      await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60);
      await expect(view).toHaveAttribute("data-stack-reordering", "false");
      await window.mouse.up();
    }
    // A press that travels is not a click, so none of those controls activated
    // either -- which is the point: the gesture belonged to nothing.
    expect(await window.getByTestId("spatial-layer-rename-input").count()).toBe(0);
    expect(await displayOrder(window)).toEqual(before);

    // The opacity control still owns its own drag.
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${target}`);
    await expect(disclosure).toBeVisible();
    const slider = disclosure.getByRole("slider");
    const track = (await slider.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    await window.mouse.move(track.x + track.width * 0.9, track.y + track.height / 2);
    await window.mouse.down();
    await window.mouse.move(track.x + track.width * 0.4, track.y + track.height / 2);
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    expect(Number(await slider.inputValue())).toBeLessThan(1);
    expect(await displayOrder(window)).toEqual(before);
    await window.keyboard.press("Escape");

    // The wheel does not move the focus underneath a live drag, and resumes the
    // moment the drag resolves.
    expect(await dragSheetToGap(window, target, 0)).toBe(true);
    await window.mouse.wheel(0, 600);
    expect(await activeLayerId(window), "the wheel is suspended during a drag").toBe(target);
    await window.keyboard.press("Escape");
    await window.mouse.up();
    expect(await displayOrder(window)).toEqual(before);

    await window.mouse.move(600, 400);
    await window.mouse.wheel(0, 400);
    await expect.poll(() => activeLayerId(window), { timeout: 10_000 }).not.toBe(target);
  } finally {
    await app.close();
  }
});

test("reorders from the keyboard, in both directions and at the clamps", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = await activeLayerId(window);
    expect(target).toBe(before[0]);

    // Alt with the arrows moves the layer; the bare arrows navigate. This is
    // also how a layer reaches a position the pointer cannot: the destination
    // below the focus shelf is off-screen at supported window sizes.
    await view.locator(`[data-layer-plane="${target}"]`).focus();
    let depth = Number(await historyDepth(window));
    await window.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await displayOrder(window))[1]).toBe(target);
    expect(Number(await historyDepth(window)), "one intentional move, one entry").toBe(depth + 1);
    expect(await activeLayerId(window), "the moved layer stays active").toBe(target);

    await window.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await displayOrder(window))[2]).toBe(target);

    // The bottom of the arrangement clamps rather than wrapping or erroring,
    // and never moves past the paper.
    depth = Number(await historyDepth(window));
    await window.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await displayOrder(window))[2]).toBe(target);
    expect(Number(await historyDepth(window)), "the bottom clamp is a no-op").toBe(depth);

    await window.keyboard.press("Alt+ArrowUp");
    await window.keyboard.press("Alt+ArrowUp");
    await expect.poll(() => displayOrder(window)).toEqual(before);
    depth = Number(await historyDepth(window));
    await window.keyboard.press("Alt+ArrowUp");
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "the top clamp is a no-op").toBe(depth);

    // Ordinary navigation is untouched.
    await window.keyboard.press("ArrowDown");
    await expect.poll(() => activeLayerId(window)).toBe(before[1]);
    await window.keyboard.press("Home");
    await expect.poll(() => activeLayerId(window)).toBe(before[0]);
  } finally {
    await app.close();
  }
});

test("reorders hidden and locked layers, and agrees with the list", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = before[1]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    // A hidden layer is still a structural sheet, and still reorderable.
    await window.getByTestId(`spatial-layer-visibility-${target}`).click();
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-visible",
      "false",
    );
    expect(await dragSheetToGap(window, target, 0)).toBe(true);
    await dropSheet(window);
    await expect.poll(async () => (await displayOrder(window))[0]).toBe(target);
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-visible",
      "false",
    );
    await window.getByTestId(`spatial-layer-visibility-${target}`).click();

    // Lock governs artwork editing, not where the sheet sits.
    await window.getByTestId(`spatial-layer-lock-${target}`).click();
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-locked",
      "true",
    );
    await window.keyboard.press("Alt+ArrowDown");
    await expect.poll(async () => (await displayOrder(window))[1]).toBe(target);
    await expect(view.getByTestId(`spatial-layer-plane-${target}`)).toHaveAttribute(
      "data-layer-locked",
      "true",
    );

    // A reorder made in the list is what the stack shows next.
    await view.getByTestId("layers-view-list").click();
    const panel = window.getByTestId("layers-panel");
    await panel.getByTestId(`layer-options-${target}`).click();
    await panel.getByTestId(`layer-move-up-${target}`).click();
    const afterListMove = await displayOrder(window);
    expect(afterListMove[0]).toBe(target);
    await panel.getByTestId("layers-view-stack").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveAttribute(
      "data-stack-phase",
      "open",
    );
    expect(await displayOrder(window)).toEqual(afterListMove);
    await expect(
      window.getByTestId("spatial-layers-view").getByTestId(`spatial-layer-plane-${target}`),
    ).toHaveAttribute("data-layer-display-index", "0");
  } finally {
    await app.close();
  }
});

/**
 * Edge-dwell auto-navigation.
 *
 * The focus shelf sits near the bottom of the workspace and the sheets are a
 * full gap apart, so the insertion point below the held sheet is off-screen at
 * every supported window size. Holding near a structural edge slides the
 * arrangement under the held sheet instead. These drive it by pointer only.
 */

/** Presses the grip and crosses the drag threshold, without releasing. */
async function beginDrag(window: Page, layerId: string): Promise<{ x: number; y: number }> {
  await settleStack(window);
  const grip = gripOf(window, layerId);
  const box = (await grip.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await window.mouse.move(x, y);
  await window.mouse.down();
  await window.mouse.move(x, y + 8);
  await expect(window.getByTestId("spatial-layers-view")).toHaveAttribute(
    "data-stack-reordering",
    "true",
  );
  return { x, y };
}

/**
 * Where the drop would land, in display order.
 *
 * Leaving an edge zone keeps the neighbourhood it exposed and resolves the
 * candidate from wherever the pointer now is, so the destination is a product
 * of both -- read it from the view rather than inferring it from travel.
 */
async function pendingDestination(window: Page, fromDisplayIndex: number): Promise<number> {
  const insert = Number(
    (await window.getByTestId("spatial-layers-view").getAttribute("data-stack-drop-index")) ?? "-1",
  );
  return insert > fromDisplayIndex ? insert - 1 : insert;
}

const exposureOf = async (window: Page): Promise<number> =>
  Number(
    (await window.getByTestId("spatial-layers-view").getAttribute("data-stack-exposure")) ?? "0",
  );

/**
 * Holds inside an edge zone until the arrangement has advanced far enough.
 *
 * Waits on real navigation progress rather than sleeping for a guessed dwell:
 * the view reports how many layers it has slid, so the test knows when the
 * gesture has actually got somewhere.
 */
async function holdEdgeUntilExposure(
  window: Page,
  x: number,
  edge: "top" | "bottom",
  wanted: number,
): Promise<number> {
  const band = (await window.getByTestId("spatial-layers-bounds").boundingBox()) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const y = edge === "top" ? band.y + 8 : band.y + band.height - 8;
  await window.mouse.move(x, y);
  // Holding keeps stepping, which is the product's own behaviour, so the hold
  // ends by leaving the zone once the arrangement has travelled far enough.
  // Polling tightly keeps that from overshooting by more than a single step.
  await expect
    .poll(
      async () => {
        const exposure = await exposureOf(window);
        return edge === "top" ? -exposure : exposure;
      },
      { timeout: 20_000, intervals: [16] },
    )
    .toBeGreaterThanOrEqual(Math.abs(wanted));
  // Parks just outside the zone rather than in the middle of the band: leaving
  // an edge keeps the neighbourhood it exposed, and the candidate is resolved
  // from wherever the pointer now is, so retreating to the centre would give
  // back the reach the hold just earned.
  await window.mouse.move(
    x,
    edge === "top"
      ? band.y + REORDER_EDGE_ZONE + 12
      : band.y + band.height - REORDER_EDGE_ZONE - 12,
  );
  return exposureOf(window);
}

test("reaches a lower destination by holding the bottom edge", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    for (let index = 0; index < 4; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    expect(before).toHaveLength(5);

    // A middle sheet, moved downward -- the direction raw pointer travel cannot
    // express, because the destination below the shelf is outside the window.
    const target = before[2]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const depth = Number(await historyDepth(window));
    const { x } = await beginDrag(window, target);
    const travelled = await holdEdgeUntilExposure(window, x, "bottom", 2);
    expect(travelled, "two or more layers exposed, by pointer alone").toBeGreaterThanOrEqual(2);

    // Nothing has reached the document, however far the arrangement has slid.
    expect(await displayOrder(window), "auto-navigation is presentation only").toEqual(before);
    expect(await activeLayerId(window), "the held layer is still the active one").toBe(target);
    expect(Number(await historyDepth(window))).toBe(depth);

    const destination = await pendingDestination(window, 2);
    expect(destination, "at least two positions further down").toBeGreaterThanOrEqual(4);

    await window.mouse.up();
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await expect.poll(async () => (await displayOrder(window))[destination]).toBe(target);
    expect(Number(await historyDepth(window)), "one drop, one entry").toBe(depth + 1);
    expect(await activeLayerId(window)).toBe(target);

    // Undo returns the whole traversal in one step.
    await window.keyboard.press("Control+z");
    await expect.poll(() => displayOrder(window)).toEqual(before);
  } finally {
    await app.close();
  }
});

test("crosses a deep stack upward in one pointer gesture", async () => {
  test.setTimeout(400_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    for (let index = 0; index < 9; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    expect(before).toHaveLength(10);

    // The bottom sheet, carried four positions up without releasing.
    const target = before[9]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const depth = Number(await historyDepth(window));
    const { x } = await beginDrag(window, target);
    const travelled = await holdEdgeUntilExposure(window, x, "top", -4);
    expect(travelled, "four or more layers exposed, in one unbroken gesture").toBeLessThanOrEqual(
      -4,
    );
    expect(await displayOrder(window), "still nothing committed").toEqual(before);

    const destination = await pendingDestination(window, 9);
    expect(destination, "at least four positions further up").toBeLessThanOrEqual(5);

    await window.mouse.up();
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await expect.poll(async () => (await displayOrder(window))[destination]).toBe(target);
    expect(Number(await historyDepth(window)), "one gesture, one entry").toBe(depth + 1);
    expect(await activeLayerId(window)).toBe(target);
  } finally {
    await app.close();
  }
});

test("reverses direction and clamps without banking dwell time", async () => {
  test.setTimeout(400_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    for (let index = 0; index < 4; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = before[2]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const { x } = await beginDrag(window, target);
    // Up two, then back down two: the final position is what counts, and the
    // reversal starts a fresh dwell rather than spending banked time.
    await holdEdgeUntilExposure(window, x, "top", -2);
    await holdEdgeUntilExposure(window, x, "bottom", 0);
    expect(await exposureOf(window)).toBe(0);
    expect(await displayOrder(window)).toEqual(before);

    // Leaving for the middle stops the traversal but keeps what it exposed.
    await holdEdgeUntilExposure(window, x, "top", -1);
    const band = (await view.getByTestId("spatial-layers-bounds").boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await window.mouse.move(x, band.y + band.height / 2);
    await window.waitForTimeout(REORDER_DWELL_SETTLE);
    expect(await exposureOf(window), "the middle is ordinary space").toBe(-1);

    // The end of the arrangement clamps: holding does nothing further, and no
    // timer churns against it.
    await holdEdgeUntilExposure(window, x, "top", -2);
    await window.mouse.move(x, band.y + 8);
    await window.waitForTimeout(REORDER_DWELL_SETTLE * 3);
    expect(await exposureOf(window), "the top of the stack is the end").toBe(-2);

    await window.keyboard.press("Escape");
    await window.mouse.up();
    expect(await displayOrder(window)).toEqual(before);
  } finally {
    await app.close();
  }
});

test("abandons and no-ops correctly after auto-navigating", async () => {
  test.setTimeout(400_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    for (let index = 0; index < 4; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = before[2]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    // Escape after a deep traversal restores everything and keeps the stack.
    let depth = Number(await historyDepth(window));
    let handle = await beginDrag(window, target);
    await holdEdgeUntilExposure(window, handle.x, "bottom", 2);
    await window.keyboard.press("Escape");
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    await expect(view).toBeVisible();
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "a cancelled traversal reaches no command").toBe(
      depth,
    );
    await expect(view).toHaveAttribute("data-stack-exposure", "0");

    // Wheel navigation resumes once the gesture is gone.
    await window.mouse.move(600, 400);
    await window.mouse.wheel(0, 400);
    await expect.poll(() => activeLayerId(window), { timeout: 10_000 }).not.toBe(target);
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    // Travelling away and back again is not a reorder: the canonical
    // destination is unchanged, so no command is issued.
    depth = Number(await historyDepth(window));
    handle = await beginDrag(window, target);
    await holdEdgeUntilExposure(window, handle.x, "bottom", 2);
    await holdEdgeUntilExposure(window, handle.x, "top", 0);
    const band = (await view.getByTestId("spatial-layers-bounds").boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await window.mouse.move(handle.x, handle.y);
    await window.waitForTimeout(REORDER_DWELL_SETTLE);
    expect(band.height).toBeGreaterThan(0);
    await window.mouse.up();
    expect(await displayOrder(window)).toEqual(before);
    expect(Number(await historyDepth(window)), "distance travelled is not a change").toBe(depth);

    // Closing after a traversal releases the workspace: the canvas is live.
    await window.getByTestId("layers-toggle").click();
    await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
    const objects = Number(await objectCount(window));
    await drawStroke(window, 300);
    expect(Number(await objectCount(window)), "the first stroke still lands").toBe(objects + 1);
  } finally {
    await app.close();
  }
});

test("auto-navigates at the minimum window and under reduced motion", async () => {
  test.setTimeout(400_000);
  const { app, window } = await launchFolio(900, 640);
  try {
    // Reduced motion may drop the neighbour transition, but a destination must
    // never become unreachable because of a preference.
    await window.emulateMedia({ reducedMotion: "reduce" });
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 300, 12, 380, 20);
    for (let index = 0; index < 4; index += 1) await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = before[2]!;
    await view.locator(`[data-layer-plane="${target}"]`).click();
    await expect.poll(() => activeLayerId(window)).toBe(target);

    const depth = Number(await historyDepth(window));
    const { x } = await beginDrag(window, target);

    // Both directions work in the smallest supported workspace.
    await holdEdgeUntilExposure(window, x, "top", -2);
    await holdEdgeUntilExposure(window, x, "bottom", 2);
    expect(await displayOrder(window)).toEqual(before);
    const destination = await pendingDestination(window, 2);
    await window.mouse.up();
    await expect.poll(async () => (await displayOrder(window))[destination]).toBe(target);
    expect(Number(await historyDepth(window))).toBe(depth + 1);

    // The band is still the band: no scrollbar appeared to make this work.
    const gutter = await view.getByTestId("spatial-layers-scroller").evaluate((node) => ({
      vertical: node.offsetWidth - node.clientWidth,
      overflowY: getComputedStyle(node).overflowY,
      scrollTop: node.scrollTop,
    }));
    expect(gutter.vertical).toBe(0);
    expect(gutter.overflowY).toBe("hidden");
    expect(gutter.scrollTop).toBe(0);
  } finally {
    await app.close();
  }
});

test("never starts an edge dwell from a Phase 3 control", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launchFolio();
  try {
    await window.locator('button[data-dock-slot="pencil"]').click();
    await drawStroke(window, 320);
    await addLayer(window);
    await addLayer(window);

    const view = await openStack(window);
    const before = await displayOrder(window);
    const target = await activeLayerId(window);
    const band = (await view.getByTestId("spatial-layers-bounds").boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    // Dragging the opacity slider parks the pointer well inside an edge zone;
    // no reorder ever started, so no dwell may run.
    await window.getByTestId(`spatial-layer-opacity-${target}`).click();
    const disclosure = window.getByTestId(`spatial-layer-opacity-panel-${target}`);
    await expect(disclosure).toBeVisible();
    const slider = disclosure.getByRole("slider");
    const track = (await slider.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    await window.mouse.move(track.x + track.width * 0.9, track.y + track.height / 2);
    await window.mouse.down();
    await window.mouse.move(track.x + track.width * 0.3, band.y + 8);
    await window.waitForTimeout(REORDER_DWELL_SETTLE * 2);
    expect(await exposureOf(window), "no gesture, no navigation").toBe(0);
    await expect(view).toHaveAttribute("data-stack-reordering", "false");
    await window.mouse.up();
    expect(Number(await slider.inputValue())).toBeLessThan(1);
    await window.keyboard.press("Escape");

    // A press on the grip that never crosses the threshold is not a drag, so
    // holding it inside an edge zone must not navigate either.
    const grip = gripOf(window, target);
    const box = (await grip.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await window.mouse.down();
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 2);
    await window.waitForTimeout(REORDER_DWELL_SETTLE * 2);
    expect(await exposureOf(window)).toBe(0);
    await window.mouse.up();
    expect(await displayOrder(window)).toEqual(before);
  } finally {
    await app.close();
  }
});
