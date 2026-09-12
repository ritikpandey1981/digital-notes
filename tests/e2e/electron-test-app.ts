import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron } from "@playwright/test";

/**
 * Makes every Folio app a test launches hermetic and closeable.
 *
 * Two things are true of the real application that automated runs must not
 * inherit. It refuses a graceful quit while a project has unsaved changes, and
 * waits for a Save/Discard/Cancel answer no teardown will ever give. It also
 * keeps crash-recovery snapshots under its application data directory, which
 * would otherwise be the directory belonging to whoever ran the suite.
 *
 * So each launched app gets an application data directory of its own, and is
 * armed to abandon its windows when `app.quit()` arrives. Quit, and only quit,
 * is forced: a spec that closes a window the way the title bar does still meets
 * the real unsaved-change protection.
 *
 * The directory is per launch rather than per worker because a forced teardown
 * is, by design, indistinguishable from a crash: it leaves a recovery snapshot
 * behind. Sharing one directory would hand the next app in the run a startup
 * recovery prompt belonging to a different spec. A spec that passes its own
 * `--user-data-dir` keeps it, which is how a relaunch can deliberately find
 * what the previous launch left.
 */
const launch = _electron.launch.bind(_electron);

_electron.launch = async (options) => {
  const args = options?.args ?? [];
  const owned = args.some((argument) => argument.startsWith("--user-data-dir"))
    ? null
    : mkdtempSync(path.join(tmpdir(), "folio-e2e-userdata-"));
  const app = await launch({
    ...options,
    args: owned === null ? [...args] : [...args, `--user-data-dir=${owned}`],
  });
  await app
    .evaluate(({ app: electronApp, BrowserWindow }) => {
      electronApp.once("before-quit", () => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
    })
    .catch(() => {
      // An app that already died needs no teardown help.
    });
  if (owned !== null) {
    void app
      .waitForEvent("close")
      .then(() => rmSync(owned, { recursive: true, force: true }))
      .catch(() => {
        // A profile the OS still holds is temporary-directory litter, not a
        // failure of the spec that produced it.
      });
  }
  return app;
};
