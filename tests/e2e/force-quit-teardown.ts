import { _electron } from "@playwright/test";

/**
 * Lets test teardown end a Folio app that is holding unsaved work.
 *
 * Folio refuses a graceful quit while a project has unsaved changes, and waits
 * for a Save/Discard/Cancel answer that no automated teardown will ever give.
 * Ending a test run is not a user decision about a drawing, so every launched
 * app is armed to abandon its windows when `app.quit()` arrives.
 *
 * This deliberately does not touch `window.close()`, so a spec that closes a
 * window the way the title bar does still meets the real protection.
 */
const launch = _electron.launch.bind(_electron);

_electron.launch = async (options) => {
  const app = await launch(options);
  await app
    .evaluate(({ app: electronApp, BrowserWindow }) => {
      electronApp.once("before-quit", () => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
    })
    .catch(() => {
      // An app that already died needs no teardown help.
    });
  return app;
};
