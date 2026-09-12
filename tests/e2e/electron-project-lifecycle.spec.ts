import { expect, test } from "@playwright/test";
import { launchFolio, surfaceOf } from "./layers-stack-helpers";

/** Asks main to close the project window exactly as the title bar button does. */
async function requestWindowClose(app: Awaited<ReturnType<typeof launchFolio>>["app"]) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
}

test("protects unsaved artwork when the desktop window is asked to close", async () => {
  const { app, window } = await launchFolio();
  let closed = false;
  try {
    const surface = surfaceOf(window);
    await expect(surface).toHaveAttribute("data-document-state", "ready");
    const dialog = window.getByTestId("unsaved-changes-dialog");

    // An untouched blank sketch is worth nothing to lose, so nothing is asked.
    await expect(dialog).toHaveCount(0);

    await window.locator('button[data-dock-slot="pen"]').click();
    await window.mouse.move(640, 420);
    await window.mouse.down();
    await window.mouse.move(780, 470, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    await requestWindowClose(app);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Save changes to Untitled Sketch?");

    // Cancel keeps the window and the drawing exactly as they were.
    await window.getByTestId("unsaved-changes-cancel").click();
    await expect(dialog).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // Asking again must ask again, not close on the earlier refusal.
    await requestWindowClose(app);
    await expect(dialog).toBeVisible();
    // Discarding tears the page down, so the close has to be awaited from a
    // listener attached before the click that causes it.
    const windowClosed = window.waitForEvent("close", { timeout: 15_000 });
    await window
      .getByTestId("unsaved-changes-discard")
      .click({ noWaitAfter: true })
      .catch(() => {
        // The window may already be gone, which is the outcome being asserted.
      });

    await windowClosed;
    closed = true;
  } finally {
    if (!closed)
      await app.close().catch(() => {
        // Already gone, which is what the test wanted anyway.
      });
  }
});
