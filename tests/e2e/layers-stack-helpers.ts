import path from "node:path";
import { expect, _electron as electron, type Locator, type Page } from "@playwright/test";

/** Shared driving for the Layers experience, used by the stack specs. */

export async function launchFolio(
  width = 1440,
  height = 900,
): Promise<{
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
  // Everything after the launch has to close the app if it throws. A failure
  // here -- the window never arriving, the canvas never becoming visible --
  // would otherwise leave a live Electron app behind for the rest of the run,
  // competing for the foreground with every later pointer spec.
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width, height });
    await expect(window.getByTestId("canvas-surface")).toBeVisible();
    return { app, window };
  } catch (cause) {
    await app.close().catch(() => {
      // Already gone, which is the outcome this wanted anyway.
    });
    throw cause;
  }
}

export const surfaceOf = (window: Page): Locator => window.getByTestId("canvas-surface");

export async function objectCount(window: Page): Promise<string> {
  return (await surfaceOf(window).getAttribute("data-document-object-count")) ?? "";
}

export async function drawStroke(
  window: Page,
  originY: number,
  amplitude = 22,
  originX = 560,
  span = 18,
): Promise<void> {
  const before = Number(await objectCount(window));
  await window.mouse.move(originX, originY);
  await window.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await window.mouse.move(originX + step * span, originY + Math.sin(step / 2) * amplitude);
  }
  await window.mouse.up();
  await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", String(before + 1));
}

/** Picks one of the quick rail swatches, so a layer carries real colour. */
export async function pickQuickColor(window: Page, index: number): Promise<void> {
  await window.getByTestId("quick-color-rail").locator("[data-color]").nth(index).click();
}

/**
 * Waits for the Layers experience to actually be showing something.
 *
 * The trigger opens whichever view it last showed, and which one that is
 * cannot be read until React has committed. Sampling before then makes the
 * caller take the wrong branch and hunt for a switch that is not there yet.
 */
async function openLayersExperience(window: Page): Promise<void> {
  const toggle = window.getByTestId("layers-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect
    .poll(
      async () =>
        (await window.getByTestId("spatial-layers-view").count()) +
        (await window.getByTestId("layers-panel").count()),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
}

/** Opens the Layers experience and switches it to the list presentation. */
export async function openLayerList(window: Page): Promise<void> {
  await openLayersExperience(window);
  const panel = window.getByTestId("layers-panel");
  if ((await panel.count()) === 0) {
    await window.getByTestId("spatial-layers-view").getByTestId("layers-view-list").click();
  }
  await expect(panel).toBeVisible();
}

export async function closeLayers(window: Page): Promise<void> {
  const toggle = window.getByTestId("layers-toggle");
  if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  await expect(window.getByTestId("layers-panel")).toHaveCount(0);
  await expect(window.getByTestId("spatial-layers-view")).toHaveCount(0);
}

export async function addLayer(window: Page): Promise<void> {
  await openLayerList(window);
  await window.getByTestId("layers-add").click();
  await closeLayers(window);
}

export async function openStack(window: Page): Promise<Locator> {
  await openLayersExperience(window);
  const view = window.getByTestId("spatial-layers-view");
  if ((await view.count()) === 0) {
    await window.getByTestId("layers-panel").getByTestId("layers-view-stack").click();
  }
  await expect(view).toBeVisible();
  // Settled, not merely present: the sheets are still travelling for a moment
  // after the view mounts, and measuring or pressing during the separation
  // reads a frame of the choreography rather than the arrangement.
  await expect(view).toHaveAttribute("data-stack-phase", "open");
  return view;
}

export async function useDarkAppearance(window: Page): Promise<void> {
  await window.getByRole("button", { name: "Workspace menu", exact: true }).click();
  await window.getByRole("menuitem", { name: "Use dark appearance", exact: true }).click();
  await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
}

/**
 * The repeatable QA document.
 *
 * One layer of each kind the stack has to present honestly: thin sparse pencil,
 * heavier pen, a vector shape, large coloured Ink, and an empty layer, with one
 * hidden and one locked. Same document for every comparison, so what changes
 * between two screenshots is the geometry and nothing else.
 */
export async function buildQaDocument(window: Page): Promise<readonly string[]> {
  await window.locator('button[data-dock-slot="pencil"]').click();
  await drawStroke(window, 300, 12, 430, 26); // thin, sparse pencil ink

  await addLayer(window);
  await window.locator('button[data-dock-slot="pen"]').click();
  await drawStroke(window, 420, 34, 470, 22); // heavier pen ink

  await addLayer(window);
  await window.locator('button[data-dock-slot="shapes"]').click();
  await window.mouse.move(520, 470);
  await window.mouse.down();
  await window.mouse.move(800, 620, { steps: 8 });
  await window.mouse.up();

  await addLayer(window);
  await window.locator('button[data-dock-slot="marker"]').click();
  await pickQuickColor(window, 4); // large, saturated Ink: the legibility case
  await drawStroke(window, 560, 70, 400, 40);

  await addLayer(window); // stays empty

  const order = JSON.parse(
    (await surfaceOf(window).getAttribute("data-layer-order")) ?? "[]",
  ) as string[];
  await openLayerList(window);
  await window.getByTestId(`layer-visibility-${order[1]}`).click();
  await window.getByTestId(`layer-lock-${order[2]}`).click();
  await closeLayers(window);
  return order;
}

/**
 * Toggles the list presentation the way the old panel trigger used to.
 *
 * The Layers button now opens one experience with two views, so "show me the
 * panel" is open-then-switch, and "hide it" is close the experience.
 */
export async function toggleLayerList(window: Page): Promise<void> {
  if ((await window.getByTestId("layers-panel").count()) > 0) {
    await closeLayers(window);
    return;
  }
  await openLayerList(window);
}
