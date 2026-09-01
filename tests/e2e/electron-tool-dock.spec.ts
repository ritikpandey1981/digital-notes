import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

// Slots are located by their stable position id. Their accessible name now
// describes the brush each one holds, which changes as soon as one is assigned.
const DRAWING_SLOTS = ["pencil", "pen", "brush-pen", "marker", "highlighter"] as const;
const UTILITY_SLOTS = ["select", "eraser", "shapes"] as const;

test("presents the tool dock as five drawing preset slots above three permanent utilities", async () => {
  test.setTimeout(90_000);
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
    const drawingCapsule = window.locator('[data-tool-dock-group="drawing"]');
    const utilityCapsule = window.locator('[data-tool-dock-group="utility"]');
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');

    await expect(dock).toBeVisible();

    // 1. Five drawing slots, three utilities, in visual order.
    await expect(drawingCapsule.locator("button[data-dock-slot]")).toHaveCount(5);
    await expect(utilityCapsule.locator("button[data-dock-slot]")).toHaveCount(3);
    for (const [index, slotId] of DRAWING_SLOTS.entries()) {
      const button = drawingCapsule.locator(`button[data-dock-slot="${slotId}"]`);
      await expect(button).toBeVisible();
      // Position first, contents second: the number is the stable slot, the
      // brush name is whatever it currently holds.
      await expect(button).toHaveAttribute(
        "aria-label",
        new RegExp(`^Brush slot ${index + 1}, .+`),
      );
    }
    for (const slotId of UTILITY_SLOTS) {
      await expect(utilityCapsule.locator(`button[data-dock-slot="${slotId}"]`)).toBeVisible();
    }

    // 2. Two genuinely separate surfaces with real exterior space between them.
    await expect(dock.locator("[data-floating-surface]")).toHaveCount(2);
    const drawingBox = (await drawingCapsule.boundingBox())!;
    const utilityBox = (await utilityCapsule.boundingBox())!;
    const gap = utilityBox.y - (drawingBox.y + drawingBox.height);
    expect(gap, "exterior gap between capsules").toBeGreaterThanOrEqual(8);
    expect(gap, "exterior gap between capsules").toBeLessThanOrEqual(24);
    expect(Math.abs(utilityBox.x - drawingBox.x), "shared vertical axis").toBeLessThanOrEqual(0.5);
    expect(Math.abs(utilityBox.width - drawingBox.width), "matching widths").toBeLessThanOrEqual(
      0.5,
    );

    // 3. The gap is empty workspace, not a divider: the element spanning both
    //    capsules paints nothing and never intercepts a pointer.
    const dockRootPresentation = await dock.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        pointerEvents: style.pointerEvents,
      };
    });
    expect(dockRootPresentation.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(dockRootPresentation.borderTopWidth).toBe("0px");
    expect(dockRootPresentation.pointerEvents).toBe("none");

    // 4. One logical dock for layout: the measured zone spans both capsules.
    const zoneBox = (await dock.boundingBox())!;
    expect(zoneBox.y).toBeLessThanOrEqual(drawingBox.y + 0.5);
    expect(zoneBox.y + zoneBox.height).toBeGreaterThanOrEqual(
      utilityBox.y + utilityBox.height - 0.5,
    );

    // 5. Drawing slots activate real brush state, not a parallel store.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await activateDockSlot(window, "pencil");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pencil-hb");
    await expectOnlyActive(dock, "pencil");

    // 6. The two pen slots are genuinely different presets, not one button twice.
    await activateDockSlot(window, "pen");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pen");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pen-fineliner");
    await expectOnlyActive(dock, "pen");

    await activateDockSlot(window, "brush-pen");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pen");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "pen-brush");
    await expect(surface).toHaveAttribute("data-drawing-width", "6");
    await expectOnlyActive(dock, "brush-pen");

    await activateDockSlot(window, "marker");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "marker");
    await expectOnlyActive(dock, "marker");

    await activateDockSlot(window, "highlighter");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "highlighter");
    await expectOnlyActive(dock, "highlighter");

    // 7. Each utility activates through the existing tool architecture, and
    //    takes the active presentation away from every drawing slot.
    await dock.getByRole("button", { name: "Select", exact: true }).click();
    await expectOnlyActive(dock, "select");
    await dock.getByRole("button", { name: "Eraser", exact: true }).click();
    await expectOnlyActive(dock, "eraser");
    await dock.getByRole("button", { name: "Shapes", exact: true }).click();
    await expectOnlyActive(dock, "shapes");
    await expect(window.getByTestId("shapes-widget")).toBeVisible();

    // 8. Switching tools and presets is workspace preference: zero History.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 9. A committed stroke still reaches History through the normal path.
    const pageToScreen = await pageCoordinateMapper(inkCanvas, surface);
    await activateDockSlot(window, "brush-pen");
    await drawPath(window, pageToScreen, 260);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    expect(await strokeBrushFamilies(surface)).toEqual(["pen"]);

    // 10. Arrow keys traverse the capsule boundary as one toolbar.
    await activateDockSlot(window, "highlighter");
    await window.keyboard.press("ArrowDown");
    await expectOnlyActive(dock, "select");
    await window.keyboard.press("ArrowUp");
    await expectOnlyActive(dock, "highlighter");

    // 11. The minimum supported window still shows the whole dock on screen.
    await window.setViewportSize({ width: 960, height: 640 });
    await expect(dock).toBeVisible();
    const clipped = await dock.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.top < -0.5 ||
        rect.left < -0.5 ||
        rect.bottom > window.innerHeight + 0.5 ||
        rect.right > window.innerWidth + 0.5
      );
    });
    expect(clipped, "dock fits the minimum window").toBe(false);
    for (const slotId of [...DRAWING_SLOTS, ...UTILITY_SLOTS]) {
      const box = await dock.locator(`button[data-dock-slot="${slotId}"]`).boundingBox();
      expect(box, `${slotId} has bounds at minimum window`).not.toBeNull();
      expect(box!.width, `${slotId} hit target`).toBeGreaterThanOrEqual(32);
      expect(box!.height, `${slotId} hit target`).toBeGreaterThanOrEqual(32);
    }

    // 12. The canvas still takes the first action after switching tools.
    await window.setViewportSize({ width: 1440, height: 900 });
    await activateDockSlot(window, "pencil");
    const restored = await pageCoordinateMapper(inkCanvas, surface);
    await drawPath(window, restored, 380);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function expectOnlyActive(dock: Locator, slotId: string): Promise<void> {
  await expect(dock.locator(`button[data-dock-slot="${slotId}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Compared by slot id rather than accessible name: the name now carries the
  // brush a slot holds, which is exactly the thing that changes.
  const pressed = await dock
    .locator("button[data-dock-slot]")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.getAttribute("aria-pressed") === "true")
        .map((button) => button.getAttribute("data-dock-slot")),
    );
  expect(pressed, `only ${slotId} is active`).toEqual([slotId]);
}

async function drawPath(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  y: number,
): Promise<void> {
  const start = pageToScreen(140, y);
  const middle = pageToScreen(300, y + 24);
  const end = pageToScreen(500, y);
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  await window.mouse.move(middle.x, middle.y, { steps: 8 });
  await window.mouse.move(end.x, end.y, { steps: 8 });
  await window.mouse.up();
}

async function strokeBrushFamilies(surface: Locator): Promise<readonly string[]> {
  const brushes = JSON.parse(
    (await surface.getAttribute("data-document-stroke-brushes")) ?? "[]",
  ) as readonly Readonly<{ family: string }>[];
  return brushes.map(({ family }) => family);
}

async function pageCoordinateMapper(
  inkCanvas: Locator,
  surface: Locator,
): Promise<(x: number, y: number) => Point> {
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const viewportWidth = await attributeNumber(surface, "data-viewport-width");
  const viewportHeight = await attributeNumber(surface, "data-viewport-height");
  return (x: number, y: number): Point => ({
    x: bounds.x + (x / viewportWidth) * bounds.width,
    y: bounds.y + (y / viewportHeight) * bounds.height,
  });
}

async function attributeNumber(locator: Locator, attribute: string): Promise<number> {
  const raw = await locator.getAttribute(attribute);
  const value = Number(raw);
  if (!Number.isFinite(value) || value === 0) {
    throw new Error(`Expected a numeric ${attribute}, received ${String(raw)}.`);
  }
  return value;
}

interface Point {
  readonly x: number;
  readonly y: number;
}
