import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared dock interactions for specs that are not about the Brush Library.
 *
 * The production gesture makes a press on the *active* drawing slot open the
 * Brush Library, so "click the slot to make sure it is selected" is no longer
 * idempotent. These helpers say what a spec actually means.
 */

/** Selects a drawing slot, and does nothing if it is already selected. */
export async function activateDockSlot(window: Page, slotId: string): Promise<void> {
  const button = window.locator(`button[data-dock-slot="${slotId}"]`);
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** Opens the Brush Library from a drawing slot without racing React's toggle commit. */
export async function openDockSlotBrushLibrary(window: Page, target: Locator): Promise<void> {
  const library = window.getByTestId("radial-brush-library");
  if ((await library.count()) > 0) {
    const phase = await library.getAttribute("data-library-phase");
    if (phase === "open") return;
    if (phase === "opening") {
      await expect(library).toHaveAttribute("data-library-phase", "open");
      return;
    }
    await expect(library).toHaveCount(0);
  }
  if ((await target.getAttribute("aria-pressed")) !== "true") {
    await target.click();
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(library).toHaveCount(0);
  }
  await target.click();
  await expect(library).toHaveAttribute("data-library-phase", "open");
}

/** Selects a slot and opens its Tool Options, whatever state the dock is in. */
export async function openSlotToolOptions(window: Page, slotId: string): Promise<void> {
  await activateDockSlot(window, slotId);
  const rail = window.getByTestId("drawing-property-rail");
  const palette = window.getByTestId("context-tool-palette");
  await expect(rail).toBeVisible();
  const expectedTool = await rail.getAttribute("data-property-rail-tool");
  let paletteAlreadyMatches =
    (await palette.isVisible()) &&
    (await palette.getAttribute("data-tool-options-tool")) === expectedTool;
  if (paletteAlreadyMatches) {
    // AnimatePresence keeps the previous palette visible while it exits. Give
    // that short choreography time to distinguish a stable open palette from
    // an old matching instance that is about to detach.
    await window.waitForTimeout(250);
    paletteAlreadyMatches =
      (await palette.isVisible()) &&
      (await palette.getAttribute("data-tool-options-tool")) === expectedTool;
  }
  if (!paletteAlreadyMatches) {
    // A palette left in its close choreography can still cover the rail for a
    // few frames. Wait for that exiting instance rather than forcing a click
    // through it; only an already-open palette for this slot's current tool is
    // the desired state and needs no second activation.
    await expect(palette).toHaveCount(0);
    await rail.locator('button[data-property-key="strokeWidth"]').click();
  }
  await expect(palette).toBeVisible();
}
