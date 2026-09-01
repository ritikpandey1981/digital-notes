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

/** The chevron beside one slot, which is the explicit route to Tool Options. */
export function slotOptionsAffordance(window: Page, slotId: string): Locator {
  return window.locator(
    `div:has(> button[data-dock-slot="${slotId}"]) [data-testid="tool-options-affordance"]`,
  );
}

/** Selects a slot and opens its Tool Options, whatever state the dock is in. */
export async function openSlotToolOptions(window: Page, slotId: string): Promise<void> {
  await activateDockSlot(window, slotId);
  const chevron = slotOptionsAffordance(window, slotId);
  const palette = window.getByTestId("context-tool-palette");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await chevron.getAttribute("data-tool-options-open")) !== "true") await chevron.click();
    // `data-tool-options-open` is the logical state, not the animation, so it
    // is the thing to wait on. A dismissal left in flight by an earlier
    // interaction can still flip it back on the next frame, so let the frame
    // pass and re-read rather than trusting a single sample.
    await nextFrames(window);
    if ((await chevron.getAttribute("data-tool-options-open")) === "true") break;
  }
  await expect(chevron).toHaveAttribute("data-tool-options-open", "true");
  await expect(palette).toBeVisible();
}

/** Waits two animation frames: a settle point, not an arbitrary delay. */
async function nextFrames(window: Page): Promise<void> {
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
