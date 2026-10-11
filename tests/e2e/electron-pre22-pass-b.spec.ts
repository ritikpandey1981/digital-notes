import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { toggleLayerList } from "./layers-stack-helpers";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * Covers the Pre-Phase-22 product-quality pass.
 *
 * Everything here is behaviour no earlier suite asserts: the Eyedropper's
 * magnifier, layer drag reordering, the tight oriented Ink selection frame and
 * its live angle chip, selection chrome surviving outside the page, the shared
 * occupied-zone placement model, and the one motion treatment every floating
 * surface now uses.
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

async function resize(
  app: Awaited<ReturnType<typeof launch>>["app"],
  width: number,
  height: number,
) {
  await app.evaluate(
    async ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      await new Promise((resolve) => setTimeout(resolve, 320));
    },
    { width, height },
  );
}

/** A screen point at the given fraction across the live page rectangle. */
async function pagePoint(window: Page, fractionX: number, fractionY: number) {
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

/** Converts a page-space coordinate into a client coordinate. */
async function pageSpaceToClient(window: Page, point: { x: number; y: number }) {
  return window.evaluate((value) => {
    const surface = document.querySelector('[data-testid="canvas-surface"]');
    if (surface === null) throw new Error("Canvas surface is unavailable.");
    const read = (name: string): number => Number(surface.getAttribute(name));
    const bounds = surface.getBoundingClientRect();
    const zoom = read("data-viewport-zoom");
    return {
      x: bounds.left + read("data-viewport-page-x") + value.x * zoom,
      y: bounds.top + read("data-viewport-page-y") + value.y * zoom,
    };
  }, point);
}

async function drawDiagonalInk(
  window: Page,
  from = { x: 0.3, y: 0.35 },
  to = { x: 0.62, y: 0.62 },
) {
  await activateDockSlot(window, "pen");
  const origin = await pagePoint(window, from.x, from.y);
  const end = await pagePoint(window, to.x, to.y);
  await window.mouse.move(origin.x, origin.y);
  await window.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await window.mouse.move(
      origin.x + ((end.x - origin.x) * step) / 12,
      origin.y + ((end.y - origin.y) * step) / 12,
    );
  }
  await window.mouse.up();
  await window.waitForTimeout(160);
}

async function selectedBounds(window: Page) {
  return window.evaluate(() => {
    const surface = document.querySelector('[data-testid="canvas-surface"]');
    if (surface === null) throw new Error("Canvas surface is unavailable.");
    const read = (name: string): number => Number(surface.getAttribute(name));
    return {
      x: read("data-selected-object-bounds-x"),
      y: read("data-selected-object-bounds-y"),
      width: read("data-selected-object-bounds-width"),
      height: read("data-selected-object-bounds-height"),
    };
  });
}

async function layerNames(window: Page): Promise<string[]> {
  return window.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="layer-name-"]')].map(
      (element) => element.textContent?.trim() ?? "",
    ),
  );
}

async function firstLayerId(window: Page): Promise<string> {
  const testId = await window
    .locator('[data-layer-row-index="0"]')
    .first()
    .getAttribute("data-testid");
  if (testId === null) throw new Error("The layer list is empty.");
  return testId.replace("layer-row-", "");
}

function rectsOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

test("Pass B delivers the Eyedropper magnifier over the authoritative sample path", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  const loupe = window.getByTestId("eyedropper-loupe");
  try {
    await drawDiagonalInk(window);

    // 1. Activating the Eyedropper from the picker arms sampling.
    await activateDockSlot(window, "pen");
    await window.getByTestId("quick-color-current").click();
    await expect(window.getByTestId("full-color-picker")).toBeVisible();
    await window.getByTestId("eyedropper-toggle").click();
    await expect(surface).toHaveAttribute("data-artwork-sampling-state", "active");

    // 2. The pointer over the page is the pipette, not a brush cursor.
    // The exact midpoint of the drawn diagonal, so the sample lands on ink.
    const overStroke = await pagePoint(window, 0.46, 0.485);
    await window.mouse.move(overStroke.x - 80, overStroke.y - 80);
    await window.mouse.move(overStroke.x, overStroke.y);
    await window.waitForTimeout(220);
    await expect(window.locator('canvas[data-folio-layer="ink"]')).toHaveAttribute(
      "data-eyedropper-cursor",
      "pipette",
    );

    // 3 & 5. The loupe appears and reports the colour the sampler would return.
    await expect(loupe).toHaveAttribute("data-loupe-state", "visible");
    await expect(loupe).toHaveAttribute("data-loupe-color", "#111111");

    // 4. It follows the pointer.
    const firstBox = await loupe.boundingBox();
    const elsewhere = await pagePoint(window, 0.7, 0.3);
    await window.mouse.move(elsewhere.x, elsewhere.y);
    await window.waitForTimeout(220);
    const secondBox = await loupe.boundingBox();
    expect(secondBox?.x).not.toBe(firstBox?.x);
    // Paper, not ink, away from the stroke.
    await expect(loupe).not.toHaveAttribute("data-loupe-color", "#111111");

    // 6. It flips inward rather than hanging off the workspace at a corner.
    const topLeft = await pagePoint(window, 0.01, 0.02);
    await window.mouse.move(topLeft.x, topLeft.y);
    await window.waitForTimeout(220);
    await expect(loupe).toHaveAttribute("data-loupe-flipped-y", "true");
    const flippedBox = await loupe.boundingBox();
    expect(flippedBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    // 6b. It never covers the hotspot it is magnifying.
    expect(
      rectsOverlap(
        {
          x: flippedBox!.x,
          y: flippedBox!.y,
          width: flippedBox!.width,
          height: flippedBox!.height,
        },
        { x: topLeft.x - 1, y: topLeft.y - 1, width: 2, height: 2 },
      ),
    ).toBe(false);

    // 7. Leaving the page hides it: there is nothing to magnify out there.
    await window.mouse.move(20, 500);
    await window.waitForTimeout(220);
    await expect(loupe).toHaveAttribute("data-loupe-state", "hidden");

    // 8. A taken sample ends the one-shot mode and the loupe leaves with it.
    const historyBefore = await surface.getAttribute("data-history-undo-depth");
    await window.mouse.move(overStroke.x, overStroke.y);
    await window.waitForTimeout(200);
    await expect(loupe).toHaveAttribute("data-loupe-state", "visible");
    await window.mouse.click(overStroke.x, overStroke.y);
    await window.waitForTimeout(250);
    await expect(surface).toHaveAttribute("data-artwork-sampling-state", "inactive");
    await expect(loupe).toHaveAttribute("data-loupe-state", "hidden");

    // 9. Sampling is presentation only: not one History entry.
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBefore);

    // 10. Escape exits sampling and the loupe with it.
    await window.getByTestId("eyedropper-toggle").click();
    await expect(surface).toHaveAttribute("data-artwork-sampling-state", "active");
    await window.mouse.move(overStroke.x, overStroke.y);
    await window.waitForTimeout(200);
    await expect(loupe).toHaveAttribute("data-loupe-state", "visible");
    await window.keyboard.press("Escape");
    await window.waitForTimeout(250);
    await expect(surface).toHaveAttribute("data-artwork-sampling-state", "inactive");
    await expect(loupe).toHaveAttribute("data-loupe-state", "hidden");
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(historyBefore);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B reorders layers by drag with exact History and valid semantics", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  const panel = window.getByTestId("layers-panel");
  try {
    // 11. Twelve layers is more than the panel shows at once.
    await toggleLayerList(window);
    await expect(panel).toBeVisible();
    for (let index = 0; index < 11; index += 1) await window.getByTestId("layers-add").click();
    await expect(panel).toHaveAttribute("data-layer-count", "12");
    const original = await layerNames(window);
    expect(original[0]).toBe("Layer 12");

    // 18. The list is a list of list items, not a listbox of interactive
    // options, so locator-based accessibility assertions are meaningful.
    await expect(window.getByRole("list", { name: "Layer list" })).toBeVisible();
    expect(await window.getByRole("listitem").count()).toBe(12);
    expect(await window.locator('[role="option"]').count()).toBe(0);
    // The active layer announces itself on its own name control.
    expect(await window.locator('[data-testid^="layer-name-"][aria-current="true"]').count()).toBe(
      1,
    );

    const topId = await firstLayerId(window);
    const handle = window.getByTestId(`layer-drag-handle-${topId}`);
    const handleBox = (await handle.boundingBox())!;
    const rows = window.locator('[data-testid^="layer-row-button-"]');
    const thirdRow = (await rows.nth(3).boundingBox())!;
    const historyBefore = Number(await surface.getAttribute("data-history-undo-depth"));

    // 12. Dragging the top row down shows a drag state and an insertion line.
    await window.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2 + 44,
      { steps: 6 },
    );
    await expect(panel).toHaveAttribute("data-layer-drag-state", "dragging");
    expect(await window.locator('[data-testid^="layer-drop-indicator-"]').count()).toBeGreaterThan(
      0,
    );
    await window.mouse.move(handleBox.x + handleBox.width / 2, thirdRow.y + thirdRow.height * 0.8, {
      steps: 8,
    });
    await window.mouse.up();
    await window.waitForTimeout(250);
    await expect(panel).toHaveAttribute("data-layer-drag-state", "idle");

    // 13. The order changed in display terms, and storage is not inverted:
    // every other layer keeps its relative order.
    const afterDrag = await layerNames(window);
    expect(afterDrag).not.toEqual(original);
    expect(afterDrag.indexOf("Layer 12")).toBeGreaterThan(0);
    expect(afterDrag.filter((name) => name !== "Layer 12")).toEqual(
      original.filter((name) => name !== "Layer 12"),
    );

    // 14. Exactly one History entry for a meaningful drag.
    const historyAfter = Number(await surface.getAttribute("data-history-undo-depth"));
    expect(historyAfter).toBe(historyBefore + 1);

    // 15. Undo and Redo are exact.
    await window.keyboard.press("Control+z");
    await window.waitForTimeout(250);
    expect(await layerNames(window)).toEqual(original);
    await window.keyboard.press("Control+y");
    await window.waitForTimeout(250);
    expect(await layerNames(window)).toEqual(afterDrag);

    // 16. A no-op drag reaches History zero times.
    const beforeNoop = await surface.getAttribute("data-history-undo-depth");
    const noopHandle = (await window.getByTestId(`layer-drag-handle-${topId}`).boundingBox())!;
    await window.mouse.move(
      noopHandle.x + noopHandle.width / 2,
      noopHandle.y + noopHandle.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(
      noopHandle.x + noopHandle.width / 2,
      noopHandle.y + noopHandle.height / 2 + 10,
      { steps: 3 },
    );
    await window.mouse.up();
    await window.waitForTimeout(220);
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(beforeNoop);
    expect(await layerNames(window)).toEqual(afterDrag);

    // 17. Escape during a drag cancels it: zero History, original order.
    const orderBeforeCancel = await layerNames(window);
    const cancelHandle = (await window
      .getByTestId(`layer-drag-handle-${await firstLayerId(window)}`)
      .boundingBox())!;
    await window.mouse.move(
      cancelHandle.x + cancelHandle.width / 2,
      cancelHandle.y + cancelHandle.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(
      cancelHandle.x + cancelHandle.width / 2,
      cancelHandle.y + cancelHandle.height / 2 + 90,
      { steps: 6 },
    );
    await expect(panel).toHaveAttribute("data-layer-drag-state", "dragging");
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await window.waitForTimeout(250);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-layer-drag-state", "idle");
    expect(await layerNames(window)).toEqual(orderBeforeCancel);
    expect(await surface.getAttribute("data-history-undo-depth")).toBe(beforeNoop);

    // 19. A list long enough to overflow scrolls, and a drag that reaches the
    // bottom edge scrolls it rather than stalling against the panel.
    for (let index = 0; index < 10; index += 1) await window.getByTestId("layers-add").click();
    await expect(panel).toHaveAttribute("data-layer-count", "22");
    const scrollable = await window.evaluate(() => {
      const list = document.querySelector('[data-testid="layers-list"]');
      return list === null ? false : list.scrollHeight > list.clientHeight;
    });
    expect(scrollable).toBe(true);

    const list = window.getByTestId("layers-list");
    const listBox = (await list.boundingBox())!;
    const scrollHandle = (await window
      .getByTestId(`layer-drag-handle-${await firstLayerId(window)}`)
      .boundingBox())!;
    await window.mouse.move(
      scrollHandle.x + scrollHandle.width / 2,
      scrollHandle.y + scrollHandle.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(
      scrollHandle.x + scrollHandle.width / 2,
      listBox.y + listBox.height - 6,
      { steps: 8 },
    );
    await window.waitForTimeout(450);
    const scrolled = await list.evaluate((element) => element.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await window.waitForTimeout(220);

    // 20. Keyboard reorder remains the accessible fallback, and the active
    // Layer is preserved by identity across every route.
    const activeBefore = await window
      .locator('[data-testid^="layer-name-"][aria-current="true"]')
      .textContent();
    const keyboardHandle = window.getByTestId(`layer-drag-handle-${await firstLayerId(window)}`);
    await keyboardHandle.focus();
    const beforeKeyboard = await layerNames(window);
    await window.keyboard.press("Alt+ArrowDown");
    await window.waitForTimeout(250);
    expect(await layerNames(window)).not.toEqual(beforeKeyboard);
    expect(
      await window.locator('[data-testid^="layer-name-"][aria-current="true"]').textContent(),
    ).toBe(activeBefore);

    // 21. F2 opens the rename editor, Escape abandons it.
    await window.keyboard.press("F2");
    await expect(window.locator('[data-testid^="layer-rename-"]')).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.locator('[data-testid^="layer-rename-"]')).toHaveCount(0);
    await expect(panel).toBeVisible();

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B gives one selected stroke a tight oriented frame with live angle feedback", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  const chip = window.getByTestId("rotation-angle-indicator");
  const selectionCanvas = window.locator('canvas[data-folio-layer="selection"]');
  const vectorCanvas = window.locator('canvas[data-folio-layer="vector-interaction"]');
  try {
    // 22. Select a long diagonal stroke.
    await drawDiagonalInk(window);
    await activateDockSlot(window, "select");
    const middle = await pagePoint(window, 0.46, 0.485);
    await window.mouse.click(middle.x, middle.y);
    await window.waitForTimeout(250);
    await expect(surface).toHaveAttribute("data-selection-state", "selected");
    await expect(surface).toHaveAttribute("data-selected-object-type", "ink");

    // 23. The visual frame hugs the stroke. A 2px pen over a diagonal spanning
    // roughly a third of the page must not be boxed in a rectangle far larger
    // than the ink: the frame's own diagonal stays close to the drawn one.
    const bounds = await selectedBounds(window);
    const drawnStart = await pagePoint(window, 0.3, 0.35);
    const drawnEnd = await pagePoint(window, 0.62, 0.62);
    const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const drawnWidth = Math.abs(drawnEnd.x - drawnStart.x) / zoom;
    const drawnHeight = Math.abs(drawnEnd.y - drawnStart.y) / zoom;
    // Smoothing shortens the stroke slightly, so the frame is never larger
    // than the gesture plus a small presentation allowance.
    expect(bounds.width).toBeLessThanOrEqual(drawnWidth + 12);
    expect(bounds.height).toBeLessThanOrEqual(drawnHeight + 12);

    const historyBefore = Number(await surface.getAttribute("data-history-undo-depth"));
    const centre = await pageSpaceToClient(window, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const handle = await pageSpaceToClient(window, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y - (4 + 28) / zoom,
    });
    const radius = Math.hypot(handle.x - centre.x, handle.y - centre.y);
    const startAngle = Math.atan2(handle.y - centre.y, handle.x - centre.x);

    const rotateBy = async (degrees: number): Promise<void> => {
      const target = startAngle + (degrees * Math.PI) / 180;
      for (let step = 1; step <= 8; step += 1) {
        const angle = startAngle + ((target - startAngle) * step) / 8;
        await window.mouse.move(
          centre.x + Math.cos(angle) * radius,
          centre.y + Math.sin(angle) * radius,
        );
      }
    };

    // 24 & 25. Rotating shows a live chip carrying the actual angle.
    await window.mouse.move(handle.x, handle.y);
    await window.mouse.down();
    await rotateBy(30);
    await window.waitForTimeout(200);
    await expect(chip).toHaveAttribute("data-rotation-indicator", "visible");
    const liveDegrees = Number(await chip.getAttribute("data-rotation-degrees"));
    expect(Math.abs(liveDegrees - 30)).toBeLessThanOrEqual(3);
    expect(await chip.textContent()).toBe(`${liveDegrees}°`);

    // 26. Cancelling restores the stroke and leaves History alone.
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await window.waitForTimeout(250);
    await expect(chip).toHaveAttribute("data-rotation-indicator", "hidden");
    expect(Number(await surface.getAttribute("data-selected-object-rotation"))).toBeCloseTo(0, 4);
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(historyBefore);

    // 27. Committing rotates the object and costs exactly one History entry.
    await window.mouse.move(handle.x, handle.y);
    await window.mouse.down();
    await rotateBy(30);
    await window.waitForTimeout(150);
    await window.mouse.up();
    await window.waitForTimeout(300);
    await expect(chip).toHaveAttribute("data-rotation-indicator", "hidden");
    const rotated = Number(await surface.getAttribute("data-selected-object-rotation"));
    expect(Math.abs((rotated * 180) / Math.PI - 30)).toBeLessThanOrEqual(4);
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(historyBefore + 1);

    // 28. Undo and Redo are exact.
    await window.keyboard.press("Control+z");
    await window.waitForTimeout(250);
    expect(Number(await surface.getAttribute("data-selected-object-rotation"))).toBeCloseTo(0, 4);
    await window.keyboard.press("Control+y");
    await window.waitForTimeout(250);
    expect(Number(await surface.getAttribute("data-selected-object-rotation"))).toBeCloseTo(
      rotated,
      4,
    );

    // 29. The rotated stroke exposes only the oriented frame; its generic Ink
    // hover must not paint the former dashed AABB on the vector overlay.
    await expect(selectionCanvas).toHaveAttribute("data-selection-frame-kind", "oriented");
    await window.mouse.move(middle.x, middle.y);
    await expect(vectorCanvas).toHaveAttribute("data-hovered-object-id", "");

    const readFrame = async () => {
      const corners = JSON.parse(
        (await selectionCanvas.getAttribute("data-selection-frame-corners")) ?? "[]",
      ) as { x: number; y: number }[];
      if (corners.length !== 4) throw new Error("Selected Ink has no oriented frame corners.");
      return corners;
    };
    const frameCorners = await readFrame();
    const frameCenter = frameCorners.reduce(
      (total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }),
      { x: 0, y: 0 },
    );

    // Every displayed corner is the corresponding live scale target.
    for (const corner of frameCorners) {
      const client = await pageSpaceToClient(window, corner);
      await window.mouse.move(client.x, client.y);
      await expect(surface).toHaveAttribute(
        "data-manipulation-cursor",
        /^(?:ew|ns|nwse|nesw)-resize$/u,
      );
    }

    // 30. A scale gesture starts at the displayed rotated corner, previews on
    // that frame, and commits exactly one History action.
    const scaleHistoryBefore = Number(await surface.getAttribute("data-history-undo-depth"));
    const scaleCorner = frameCorners[2]!;
    const scaleStart = await pageSpaceToClient(window, scaleCorner);
    const scaleTarget = await pageSpaceToClient(window, {
      x: frameCenter.x + (scaleCorner.x - frameCenter.x) * 1.35,
      y: frameCenter.y + (scaleCorner.y - frameCenter.y) * 1.35,
    });
    await window.mouse.move(scaleStart.x, scaleStart.y);
    await window.mouse.down();
    await window.mouse.move(scaleTarget.x, scaleTarget.y, { steps: 8 });
    await expect(surface).toHaveAttribute("data-manipulation-kind", "scale");
    await expect
      .poll(async () => Number(await surface.getAttribute("data-manipulation-scale")))
      .toBeGreaterThan(1);
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-manipulation-phase", "idle");
    const committedScale = Number(await surface.getAttribute("data-selected-object-scale"));
    expect(committedScale).toBeGreaterThan(1);
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(
      scaleHistoryBefore + 1,
    );
    await expect(selectionCanvas).toHaveAttribute("data-selection-frame-kind", "oriented");

    // Cancel restores exactly and creates no History; Undo/Redo restore the
    // committed scale exactly.
    const cancelCorners = await readFrame();
    const cancelCorner = cancelCorners[0]!;
    const cancelCenter = cancelCorners.reduce(
      (total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }),
      { x: 0, y: 0 },
    );
    const cancelStart = await pageSpaceToClient(window, cancelCorner);
    const cancelTarget = await pageSpaceToClient(window, {
      x: cancelCenter.x + (cancelCorner.x - cancelCenter.x) * 0.8,
      y: cancelCenter.y + (cancelCorner.y - cancelCenter.y) * 0.8,
    });
    await window.mouse.move(cancelStart.x, cancelStart.y);
    await window.mouse.down();
    await window.mouse.move(cancelTarget.x, cancelTarget.y, { steps: 6 });
    await window.keyboard.press("Escape");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-manipulation-phase", "idle");
    expect(Number(await surface.getAttribute("data-selected-object-scale"))).toBeCloseTo(
      committedScale,
      5,
    );
    expect(Number(await surface.getAttribute("data-history-undo-depth"))).toBe(
      scaleHistoryBefore + 1,
    );
    await window.keyboard.press("Control+z");
    expect(Number(await surface.getAttribute("data-selected-object-scale"))).toBeCloseTo(1, 5);
    await window.keyboard.press("Control+y");
    expect(Number(await surface.getAttribute("data-selected-object-scale"))).toBeCloseTo(
      committedScale,
      5,
    );

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B keeps an off-page selection recoverable while its artwork stays clipped", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  try {
    await drawDiagonalInk(window, { x: 0.3, y: 0.4 }, { x: 0.5, y: 0.6 });
    await activateDockSlot(window, "select");
    const middle = await pagePoint(window, 0.4, 0.5);
    await window.mouse.click(middle.x, middle.y);
    await expect(surface).toHaveAttribute("data-selection-state", "selected");

    // 29. Drag the stroke mostly past the right page edge.
    const bounds = await selectedBounds(window);
    const grab = await pageSpaceToClient(window, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const beyond = await pagePoint(window, 1.02, 0.5);
    await window.mouse.move(grab.x, grab.y);
    await window.mouse.down();
    await window.mouse.move(beyond.x, grab.y, { steps: 10 });
    await window.mouse.up();
    await window.waitForTimeout(300);

    // 30. The object really is outside the page now.
    const pageWidth = Number(await surface.getAttribute("data-page-width"));
    const offPage = await selectedBounds(window);
    expect(offPage.x + offPage.width).toBeGreaterThan(pageWidth);

    // 31. Selection survives, and the chrome stays inside the application.
    await expect(surface).toHaveAttribute("data-selection-state", "selected");
    const workspace = (await window.getByTestId("editor-workspace").boundingBox())!;
    const frameRight = await pageSpaceToClient(window, {
      x: offPage.x + offPage.width,
      y: offPage.y,
    });
    expect(frameRight.x).toBeLessThanOrEqual(workspace.x + workspace.width + 1);

    // 32. The contextual toolbar stays anchored and operable.
    await expect(window.getByTestId("shape-editing-toolbar")).toHaveAttribute(
      "data-toolbar-state",
      "visible",
    );

    // 33. It can be dragged back onto the page without a document mutation in
    // between: the only History entries are the two moves.
    const returnGrab = await pageSpaceToClient(window, {
      x: offPage.x + offPage.width / 2,
      y: offPage.y + offPage.height / 2,
    });
    const home = await pagePoint(window, 0.45, 0.5);
    await window.mouse.move(returnGrab.x, returnGrab.y);
    await window.mouse.down();
    await window.mouse.move(home.x, home.y, { steps: 10 });
    await window.mouse.up();
    await window.waitForTimeout(300);
    const recovered = await selectedBounds(window);
    expect(recovered.x + recovered.width).toBeLessThanOrEqual(pageWidth + 1);

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B places the color picker against the shared occupied-zone model", async () => {
  test.setTimeout(300_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const picker = window.getByTestId("full-color-picker");
  try {
    const measure = async (selector: string) => window.locator(selector).first().boundingBox();

    const assertPickerClear = async (label: string): Promise<void> => {
      const pickerBox = (await picker.boundingBox())!;
      const workspace = (await window.getByTestId("editor-workspace").boundingBox())!;
      // Inside the workspace, and the final row is not clipped away.
      expect(pickerBox.x, label).toBeGreaterThanOrEqual(workspace.x - 1);
      expect(pickerBox.x + pickerBox.width, label).toBeLessThanOrEqual(
        workspace.x + workspace.width + 1,
      );
      expect(pickerBox.y + pickerBox.height, label).toBeLessThanOrEqual(
        workspace.y + workspace.height + 1,
      );
      await expect(window.getByTestId("full-color-picker-scroll-region"), label).toBeVisible();
      for (const selector of [
        "[data-tool-dock-layout]",
        '[data-testid="workspace-utility-rail"]',
        '[data-testid="viewport-controls"]',
      ]) {
        const chrome = await measure(selector);
        if (chrome === null) continue;
        expect(rectsOverlap(pickerBox, chrome), `${label} vs ${selector}`).toBe(false);
      }
    };

    // 34. From the Quick Color Rail the picker opens beside its own rail.
    await activateDockSlot(window, "pen");
    await window.getByTestId("quick-color-current").click();
    await expect(picker).toBeVisible();
    await window.waitForTimeout(320);
    await expect(picker).toHaveAttribute("data-picker-side", "left");
    await assertPickerClear("quick rail at 1440x900");
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // 35. From Tool Options, on the opposite side of the workspace.
    await openSlotToolOptions(window, "pen");
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await window.getByTestId("tool-options-color-trigger").click();
    await expect(picker).toBeVisible();
    await window.waitForTimeout(320);
    await assertPickerClear("tool options at 1440x900");
    const toolOptions = (await measure('[data-testid="context-tool-palette"]'))!;
    expect(rectsOverlap((await picker.boundingBox())!, toolOptions)).toBe(false);
    await window.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // 36. With a selected stroke, and with the selection toolbar's Width
    // section expanded so the toolbar is measured at its real size.
    await drawDiagonalInk(window);
    await activateDockSlot(window, "select");
    const middle = await pagePoint(window, 0.46, 0.485);
    await window.mouse.click(middle.x, middle.y);
    const toolbar = window.getByTestId("shape-editing-toolbar");
    await expect(toolbar).toHaveAttribute("data-toolbar-state", "visible");
    await window.locator('[data-toolbar-expansion-trigger="strokeWidth"]').click();
    await expect(window.locator("[data-toolbar-expansion-panel]")).toBeVisible();
    await window.waitForTimeout(280);
    const expandedPanel = (await measure("[data-toolbar-expansion-panel]"))!;
    await window.getByTestId("selected-vector-color-trigger").click();
    await expect(picker).toBeVisible();
    await window.waitForTimeout(320);
    await assertPickerClear("selected ink at 1440x900");
    const selectedPicker = (await picker.boundingBox())!;
    // The picker covers neither the toolbar nor its expanded section.
    expect(rectsOverlap(selectedPicker, (await toolbar.boundingBox())!)).toBe(false);
    expect(rectsOverlap(selectedPicker, expandedPanel)).toBe(false);
    // The zone list proves the toolbar took part rather than being ignored.
    expect(await picker.getAttribute("data-picker-occupied-zones")).toContain("selection-toolbar");
    await window.keyboard.press("Escape");

    // 37. The same arrangement with Layers and Pages open.
    await toggleLayerList(window);
    await expect(window.getByTestId("layers-panel")).toBeVisible();
    await window.getByTestId("selected-vector-color-trigger").click();
    await expect(picker).toBeVisible();
    await window.waitForTimeout(320);
    await assertPickerClear("selected ink with Layers open");
    expect(
      rectsOverlap(
        (await picker.boundingBox())!,
        (await window.getByTestId("layers-panel").boundingBox())!,
      ),
    ).toBe(false);
    await window.keyboard.press("Escape");
    await toggleLayerList(window);

    // 38 & 39. Down to 960x640 and then to the true minimum content size.
    for (const [width, height] of [
      [1280, 720],
      [960, 640],
    ] as const) {
      await resize(app, width, height);
      await activateDockSlot(window, "pen");
      await window.getByTestId("quick-color-current").click();
      await expect(picker).toBeVisible();
      await window.waitForTimeout(340);
      await assertPickerClear(`quick rail at ${width}x${height}`);
      await window.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    }

    const minimum = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      const [width, height] = (target?.getMinimumSize() ?? [0, 0]) as [number, number];
      return { width, height };
    });
    await resize(app, minimum.width, minimum.height);
    await window.getByTestId("quick-color-current").click();
    await expect(picker).toBeVisible();
    await window.waitForTimeout(340);
    await assertPickerClear("quick rail at the minimum content size");

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B shares one motion treatment and never delays interaction", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const surface = window.getByTestId("canvas-surface");
  try {
    // 40. Every floating surface reports the shared preset.
    await activateDockSlot(window, "pen");
    await openSlotToolOptions(window, "pen");
    await expect(window.getByTestId("context-tool-palette")).toHaveAttribute(
      "data-motion-preset",
      "standard",
    );
    await window.keyboard.press("Escape");
    await toggleLayerList(window);
    await expect(window.getByTestId("layers-panel")).toHaveAttribute(
      "data-motion-preset",
      "standard",
    );
    await toggleLayerList(window);
    await window.getByTestId("page-settings-toggle").click();
    await expect(window.getByTestId("page-settings")).toHaveAttribute(
      "data-motion-preset",
      "standard",
    );
    await window.keyboard.press("Escape");

    // 41. Closing a panel and drawing immediately must not lose the stroke:
    // the exiting surface stops intercepting pointer input on its first frame.
    const strokesBefore = Number(await surface.getAttribute("data-document-object-count"));
    await openSlotToolOptions(window, "pen");
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    const palette = (await window.getByTestId("context-tool-palette").boundingBox())!;
    await window.keyboard.press("Escape");
    // No settling wait at all: the press lands mid-animation, over the very
    // ground the closing palette still occupies. That is the point, and it is
    // why a wait must never be added here -- the defect this catches is an
    // exiting surface that keeps intercepting input, and a settled palette
    // cannot exhibit it.
    //
    // The same property makes this sensitive to anything that blocks the main
    // thread between the press and the moves. One full-suite run during
    // Recovery R2 failed here and in two other stroke-committing cases and has
    // never recurred in six clean runs since; see `recovery-r2.md`. If it does
    // recur, measure for a long task across this gesture before suspecting
    // pointer routing.
    const under = { x: palette.x + palette.width / 2, y: palette.y + palette.height / 2 };
    await window.mouse.move(under.x, under.y);
    await window.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await window.mouse.move(under.x + step * 6, under.y + step * 3);
    }
    await window.mouse.up();
    await window.waitForTimeout(300);
    expect(Number(await surface.getAttribute("data-document-object-count"))).toBe(
      strokesBefore + 1,
    );

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Pass B honours reduced motion without changing behaviour", async () => {
  test.setTimeout(240_000);
  const { app, window } = await launch();
  const consoleErrors: string[] = [];
  window.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await window.emulateMedia({ reducedMotion: "reduce" });
    await window.waitForTimeout(200);

    // 42. Surfaces resolve the reduced preset and still open and close.
    await toggleLayerList(window);
    const panel = window.getByTestId("layers-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-motion-preset", "reduced");
    // No spatial travel at all under reduced motion.
    expect(await panel.evaluate((element) => getComputedStyle(element).transform)).toMatch(
      /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/u,
    );
    await toggleLayerList(window);
    await expect(panel).toHaveCount(0);

    await window.emulateMedia({ reducedMotion: "no-preference" });
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
