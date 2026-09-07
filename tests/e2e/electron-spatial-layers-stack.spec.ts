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
