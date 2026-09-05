import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

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
  return { app, window };
}

const historyDepth = async (surface: Locator): Promise<number> =>
  Number(await surface.getAttribute("data-history-undo-depth"));

const activePageId = async (surface: Locator): Promise<string> =>
  (await surface.getAttribute("data-active-page-id")) ?? "";

async function beginPaperPreview(window: Page, color: string): Promise<Locator> {
  const panel = window.getByTestId("page-settings");
  if ((await panel.count()) === 0) await window.getByTestId("page-settings-toggle").click();
  await expect(panel).toBeVisible();
  const input = panel.getByTestId("paper-color-custom");
  await input.focus();
  await input.fill(color);
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
    "data-page-paper-color",
    color,
  );
  return input;
}

test("resolves a custom paper preview when Page Settings is dismissed outside", async () => {
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const originalColor = (await surface.getAttribute("data-page-paper-color")) ?? "";
    const depthBefore = await historyDepth(surface);

    const panel = window.getByTestId("page-settings");
    await beginPaperPreview(window, "#dbeafe");
    expect(await historyDepth(surface), "preview is outside History").toBe(depthBefore);

    const canvas = window.locator('canvas[data-folio-layer="ink"]');
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("The ink canvas must be measurable.");
    await window.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await expect(panel).toHaveCount(0);

    await expect(surface, "outside dismissal commits the completed edit").toHaveAttribute(
      "data-page-paper-color",
      "#dbeafe",
    );
    expect(await historyDepth(surface), "one logical edit produces one command").toBe(
      depthBefore + 1,
    );
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-paper-color", originalColor);

    // Escape and the explicit X are aborts: both restore the original and add
    // no command, even though native blur may arrive during the close gesture.
    await beginPaperPreview(window, "#fee2e2");
    await window.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-page-paper-color", originalColor);
    expect(await historyDepth(surface)).toBe(depthBefore);

    await beginPaperPreview(window, "#ede9fe");
    await panel.getByTestId("page-settings-close").click();
    await expect(panel).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-page-paper-color", originalColor);
    expect(await historyDepth(surface)).toBe(depthBefore);

    // Parent-driven close and window blur also cancel deterministically.
    await beginPaperPreview(window, "#fce7f3");
    await window
      .getByTestId("page-settings-toggle")
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(panel).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-page-paper-color", originalColor);
    expect(await historyDepth(surface)).toBe(depthBefore);

    const input = await beginPaperPreview(window, "#ffedd5");
    await window.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(surface).toHaveAttribute("data-page-paper-color", originalColor);
    expect(await historyDepth(surface)).toBe(depthBefore);

    // A fresh edit after every cancellation still commits once on blur.
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    await input.focus();
    await input.fill("#dcfce7");
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    await expect(surface).toHaveAttribute("data-page-paper-color", "#dcfce7");
    expect(await historyDepth(surface)).toBe(depthBefore + 1);

    // A page switch that occurs without a native blur still cancels the
    // unresolved preview through the editor's transient-interaction boundary.
    await window.getByTestId("pages-toggle").click();
    const navigator = window.getByTestId("page-navigator");
    const first = await activePageId(surface);
    await navigator.getByTestId("page-add").click();
    const second = await activePageId(surface);
    await navigator
      .getByTestId(`page-select-${first}`)
      .evaluate((element) => (element as HTMLButtonElement).click());
    const depthBeforePageChange = await historyDepth(surface);
    await beginPaperPreview(window, "#fecaca");
    await navigator
      .getByTestId(`page-select-${second}`)
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(surface).toHaveAttribute("data-active-page-id", second);
    expect(await historyDepth(surface)).toBe(depthBeforePageChange);
    await navigator
      .getByTestId(`page-select-${first}`)
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(surface).toHaveAttribute("data-page-paper-color", "#dcfce7");
    expect(await historyDepth(surface), "page-change cancellation adds no History").toBe(
      depthBeforePageChange,
    );
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("makes cross-page Undo and Redo visible for paper and structural page commands", async () => {
  const { app, window } = await launch();
  try {
    const surface = window.getByTestId("canvas-surface");
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.getByTestId("pages-toggle").click();
    const navigator = window.getByTestId("page-navigator");
    const first = await activePageId(surface);
    await navigator.getByTestId("page-add").click();
    const second = await activePageId(surface);
    await navigator.getByTestId(`page-select-${first}`).click();

    await window.getByTestId("page-settings-toggle").click();
    const settings = window.getByTestId("page-settings");
    await settings.getByTestId("paper-type-grid").click();
    await expect(surface).toHaveAttribute("data-page-paper-type", "grid");
    await navigator.getByTestId(`page-select-${second}`).click();
    await expect(surface).toHaveAttribute("data-page-paper-type", "blank");
    const depthAfterPaper = await historyDepth(surface);

    await window.keyboard.press("Control+z");
    await expect(surface, "Undo makes its changed page visible").toHaveAttribute(
      "data-active-page-id",
      first,
    );
    await expect(surface).toHaveAttribute("data-page-paper-type", "blank");
    expect(await historyDepth(surface)).toBe(depthAfterPaper - 1);
    await window.keyboard.press("Control+y");
    await expect(surface, "Redo keeps the changed page visible").toHaveAttribute(
      "data-active-page-id",
      first,
    );
    await expect(surface).toHaveAttribute("data-page-paper-type", "grid");
    expect(await historyDepth(surface)).toBe(depthAfterPaper);

    await settings.getByTestId("page-settings-close").click();
    await navigator.getByTestId(`page-actions-${first}`).click();
    await window.getByTestId(`page-duplicate-${first}`).click();
    const duplicate = await activePageId(surface);
    expect(duplicate).not.toBe(first);
    await navigator.getByTestId(`page-select-${second}`).click();
    const depthAfterDuplicate = await historyDepth(surface);

    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-count", "2");
    await expect(surface, "Undo Duplicate returns to its source").toHaveAttribute(
      "data-active-page-id",
      first,
    );
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-page-count", "3");
    await expect(surface, "Redo Duplicate reveals the restored copy").toHaveAttribute(
      "data-active-page-id",
      duplicate,
    );
    expect(await historyDepth(surface)).toBe(depthAfterDuplicate);

    await navigator.getByTestId(`page-actions-${duplicate}`).click();
    await window.getByTestId(`page-delete-${duplicate}`).click();
    await expect(surface).toHaveAttribute("data-page-count", "2");
    await expect(surface, "Delete uses the existing next-page policy").toHaveAttribute(
      "data-active-page-id",
      second,
    );
    const depthAfterRemove = await historyDepth(surface);
    await navigator.getByTestId(`page-select-${first}`).click();
    expect(await historyDepth(surface), "navigation adds no History").toBe(depthAfterRemove);

    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-page-count", "3");
    await expect(surface, "Undo Remove reveals the restored page").toHaveAttribute(
      "data-active-page-id",
      duplicate,
    );
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-page-count", "2");
    await expect(surface, "Redo Remove activates the stored surviving neighbor").toHaveAttribute(
      "data-active-page-id",
      second,
    );
    expect(await historyDepth(surface)).toBe(depthAfterRemove);
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
