import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

async function launch(): Promise<{
  app: Awaited<ReturnType<typeof electron.launch>>;
  window: Page;
}> {
  const root = process.cwd();
  const app = await electron.launch({
    args: [path.join(root, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(root, "apps/desktop/node_modules/electron/dist/electron.exe"),
  });
  const window = await app.firstWindow();
  await window.setViewportSize({ width: 1440, height: 900 });
  await expect(window.locator('canvas[data-folio-renderer="true"]')).toHaveAttribute(
    "data-render-count",
    /[1-9]\d*/u,
  );
  return { app, window };
}

async function stroke(window: Page, originY: number): Promise<void> {
  await window.mouse.move(560, originY);
  await window.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await window.mouse.move(560 + step * 14, originY + Math.sin(step / 3) * 14);
  }
  await window.mouse.up();
  await window.waitForTimeout(60);
}

const depth = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-history-undo-depth"));
const count = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-document-object-count"));
const selected = async (surface: Locator): Promise<readonly string[]> =>
  JSON.parse((await surface.getAttribute("data-selected-object-ids")) ?? "[]") as string[];
const membership = async (surface: Locator): Promise<readonly number[]> =>
  JSON.parse((await surface.getAttribute("data-layer-membership")) ?? "[]") as number[];

function overlaps(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    first.left < second.right &&
    second.left < first.right &&
    first.top < second.bottom &&
    second.top < first.bottom
  );
}

test("Phase 20 delivers multi-selection, marquee, group transform, and selection editing", async () => {
  test.setTimeout(200_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // Mixed content: three strokes plus one rectangle.
    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    for (let index = 0; index < 3; index += 1) await stroke(window, 260 + index * 70);
    await window.getByRole("button", { name: "Shapes", exact: true }).click();
    await window.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(surface).toHaveAttribute("data-active-editor-tool", "rectangle");
    await window.mouse.move(600, 500);
    await window.mouse.down();
    await window.mouse.move(780, 580, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    const brushColorBefore = await surface.getAttribute("data-drawing-color");
    const brushWidthBefore = await surface.getAttribute("data-drawing-width");

    await window.getByRole("button", { name: "Select", exact: true }).click();

    // Marquee selects a mixed group and records zero History.
    const historyAfterCreation = await depth(surface);
    await window.mouse.move(520, 220);
    await window.mouse.down();
    await window.mouse.move(830, 600, { steps: 10 });
    await expect(surface).toHaveAttribute("data-marquee-state", "active");
    await window.mouse.up();
    expect(await selected(surface)).toHaveLength(4);
    expect(await depth(surface)).toBe(historyAfterCreation);
    await expect(surface).toHaveAttribute("data-marquee-state", "idle");

    // Shift removes and re-adds a member, still with zero History.
    await window.keyboard.down("Shift");
    await window.mouse.click(700, 265);
    await window.keyboard.up("Shift");
    expect(await selected(surface)).toHaveLength(3);
    await window.keyboard.down("Shift");
    await window.mouse.click(700, 265);
    await window.keyboard.up("Shift");
    expect(await selected(surface)).toHaveLength(4);
    expect(await depth(surface)).toBe(historyAfterCreation);

    // Group move is one History action and Undo restores it exactly.
    await window.mouse.move(700, 400);
    await window.mouse.down();
    await window.mouse.move(760, 440, { steps: 8 });
    await window.mouse.up();
    expect(await depth(surface)).toBe(historyAfterCreation + 1);
    expect(await selected(surface)).toHaveLength(4);
    await window.keyboard.press("Control+z");
    expect(await depth(surface)).toBe(historyAfterCreation);
    await window.keyboard.press("Control+y");
    expect(await depth(surface)).toBe(historyAfterCreation + 1);
    await window.keyboard.press("Control+z");

    // Ctrl+D duplicates the whole selection into the active layer as one action.
    const beforeDuplicate = await count(surface);
    const historyBeforeDuplicate = await depth(surface);
    await window.keyboard.press("Control+d");
    expect(await count(surface)).toBe(beforeDuplicate * 2);
    expect(await depth(surface)).toBe(historyBeforeDuplicate + 1);
    expect((await membership(surface))[0]).toBe(beforeDuplicate * 2);
    await window.keyboard.press("Control+z");
    expect(await count(surface)).toBe(beforeDuplicate);

    // Selected Ink editing: one action per gesture, brush settings untouched.
    await window.mouse.click(1200, 760);
    await window.mouse.click(700, 265);
    expect(await selected(surface)).toHaveLength(1);
    const toolbar = window.getByTestId("shape-editing-toolbar");
    await expect(toolbar).toHaveAttribute("data-toolbar-state", "visible");
    await expect(toolbar).toHaveAttribute("data-selected-shape-type", "ink");

    await toolbar.locator("[data-toolbar-expansion-trigger='strokeWidth']").click();
    const slider = window.locator('input[type="range"]').first();
    const box = await slider.boundingBox();
    expect(box).not.toBeNull();
    const historyBeforeInk = await depth(surface);
    await window.mouse.move(box!.x + 4, box!.y + box!.height / 2);
    await window.mouse.down();
    for (let step = 1; step <= 24; step += 1) {
      await window.mouse.move(box!.x + (box!.width * step) / 24, box!.y + box!.height / 2);
    }
    await window.mouse.up();
    expect(await depth(surface)).toBe(historyBeforeInk + 1);
    await window.keyboard.press("Escape");

    await expect(surface).toHaveAttribute("data-drawing-color", brushColorBefore ?? "");
    await expect(surface).toHaveAttribute("data-drawing-width", brushWidthBefore ?? "");

    await window.keyboard.press("Control+z");
    expect(await depth(surface)).toBe(historyBeforeInk);

    // Move the selection to another Layer through the compact contextual menu.
    await window.getByTestId("layers-toggle").click();
    await window.getByTestId("layers-add").click();
    await expect(surface).toHaveAttribute("data-layer-count", "2");
    await window.getByTestId("layers-toggle").click();
    await window.mouse.click(700, 265);
    expect(await selected(surface)).toHaveLength(1);
    const membershipBeforeMove = await membership(surface);
    const historyBeforeMove = await depth(surface);
    await window.getByTestId("selection-more-options").click();
    await window.getByTestId("move-to-layer-layer-2").click();
    await expect
      .poll(async () => (await membership(surface))[1])
      .toBe((membershipBeforeMove[1] ?? 0) + 1);
    expect(await depth(surface)).toBe(historyBeforeMove + 1);
    await window.keyboard.press("Control+z");
    expect(await membership(surface)).toEqual(membershipBeforeMove);

    // Panels coexist and the workspace stays usable at the minimum size.
    await window.getByTestId("layers-toggle").click();
    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    await window.getByTestId("quick-color-current").click();
    await expect(window.getByTestId("full-color-picker")).toBeVisible();
    await window.setViewportSize({ width: 960, height: 640 });
    await window.waitForTimeout(400);
    const layout = await window.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      };
      return {
        panel: rect('[data-testid="layers-panel"]'),
        picker: rect('[data-testid="full-color-picker"]'),
        rail: rect('[data-testid="quick-color-rail"]'),
        viewportControls: rect('[data-testid="viewport-controls"]'),
        workspace: rect('[data-testid="editor-workspace"]'),
        canvas: rect('canvas[data-folio-renderer="true"]'),
      };
    });
    expect(layout.panel).not.toBeNull();
    expect(layout.picker).not.toBeNull();
    expect(overlaps(layout.panel!, layout.picker!)).toBe(false);
    expect(overlaps(layout.panel!, layout.rail!)).toBe(false);
    expect(overlaps(layout.picker!, layout.viewportControls!)).toBe(false);
    expect(Math.round(layout.canvas!.width)).toBe(Math.round(layout.workspace!.width));
    expect(Math.round(layout.canvas!.height)).toBe(Math.round(layout.workspace!.height));

    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Phase 20 keeps locked layers read-only and preserves Alt overlap cycling", async () => {
  test.setTimeout(200_000);
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");

    await window.getByRole("button", { name: "Pencil", exact: true }).click();
    await stroke(window, 300);
    await stroke(window, 306);
    await window.getByRole("button", { name: "Select", exact: true }).click();

    // Alt overlap cycling still selects a single object beneath the pointer.
    await window.keyboard.down("Alt");
    await window.mouse.click(700, 305);
    const firstCandidate = await selected(surface);
    await window.mouse.click(700, 305);
    const secondCandidate = await selected(surface);
    await window.keyboard.up("Alt");
    expect(firstCandidate).toHaveLength(1);
    expect(secondCandidate).toHaveLength(1);
    expect(secondCandidate[0]).not.toBe(firstCandidate[0]);

    // A locked Layer stays selectable read-only and refuses every edit.
    await window.getByTestId("layers-toggle").click();
    await window.getByTestId("layer-lock-layer-1").click();
    await expect(window.getByTestId("layer-lock-layer-1")).toHaveAttribute("aria-pressed", "true");
    await window.getByTestId("layers-toggle").click();

    await window.mouse.click(700, 305);
    expect(await selected(surface)).toHaveLength(1);

    const historyBefore = await depth(surface);
    const countBefore = await count(surface);
    await window.mouse.move(700, 305);
    await window.mouse.down();
    await window.mouse.move(760, 360, { steps: 6 });
    await window.mouse.up();
    await window.keyboard.press("Delete");
    await window.keyboard.press("Control+d");
    // Locked Layers stay selectable but refuse transform, delete, and duplicate.
    expect(await depth(surface)).toBe(historyBefore);
    expect(await count(surface)).toBe(countBefore);
    expect(await selected(surface)).toHaveLength(1);
  } finally {
    await app.close();
  }
});
