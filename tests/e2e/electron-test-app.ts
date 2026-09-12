import { mkdtempSync } from "node:fs";
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
 * So each launched app gets its own application data directory, and is armed to
 * abandon its windows when `app.quit()` arrives. Quit, and only quit, is forced:
 * a spec that closes a window the way the title bar does still meets the real
 * unsaved-change protection.
 */
const launch = _electron.launch.bind(_electron);

let userDataDirectory: string | null = null;

function isolatedUserDataArgument(args: readonly string[]): string[] {
  if (args.some((argument) => argument.startsWith("--user-data-dir"))) return [];
  userDataDirectory ??= mkdtempSync(path.join(tmpdir(), "folio-e2e-userdata-"));
  return [`--user-data-dir=${userDataDirectory}`];
}

_electron.launch = async (options) => {
  const args = options?.args ?? [];
  const app = await launch({
    ...options,
    args: [...args, ...isolatedUserDataArgument(args)],
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
  return app;
};
