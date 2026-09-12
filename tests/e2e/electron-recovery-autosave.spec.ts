import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";
import { decodeFolioProject } from "../../packages/persistence/src/project/index";
import { surfaceOf } from "./layers-stack-helpers";

const RECOVERY_EXTENSION = ".folio-recovery";

async function recoveryRecords(userDataDirectory: string) {
  const directory = path.join(userDataDirectory, "recovery");
  const entries = await readdir(directory).catch(() => [] as string[]);
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(RECOVERY_EXTENSION))
      .map(async (entry) => {
        const raw = await readFile(path.join(directory, entry), "utf8");
        return JSON.parse(raw) as { recoveryId: string; title: string; project: string };
      }),
  );
  return records;
}

test("keeps a crash-recovery snapshot of unsaved artwork beside the application data", async () => {
  test.setTimeout(90_000);
  const userData = await mkdtemp(path.join(tmpdir(), "folio-recovery-e2e-"));
  const repositoryRoot = process.cwd();
  const app = await electron.launch({
    args: [
      path.join(repositoryRoot, "apps/desktop/dist-electron/main.js"),
      // Recovery state belongs to the application directory, so the test gives
      // the app one of its own instead of writing into the developer's.
      `--user-data-dir=${userData}`,
    ],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    const surface = surfaceOf(window);
    await expect(surface).toHaveAttribute("data-document-state", "ready");

    // An untouched blank sketch is not worth rescuing, so nothing is written.
    expect(await recoveryRecords(userData)).toEqual([]);

    const draw = async (y: number) => {
      await window.locator('button[data-dock-slot="pen"]').click();
      await window.mouse.move(620, y);
      await window.mouse.down();
      await window.mouse.move(820, y + 40, { steps: 10 });
      await window.mouse.up();
    };
    await draw(400);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    await expect
      .poll(async () => (await recoveryRecords(userData)).length, { timeout: 30_000 })
      .toBe(1);
    const [first] = await recoveryRecords(userData);
    expect(first?.title).toBe("Untitled Sketch");
    expect(decodeFolioProject(first!.project).sketchbook.firstPage.content.size).toBe(1);

    // The editor stays usable while recovery runs in the background.
    await draw(520);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    await expect
      .poll(
        async () => {
          const [record] = await recoveryRecords(userData);
          return record === undefined
            ? 0
            : decodeFolioProject(record.project).sketchbook.firstPage.content.size;
        },
        { timeout: 30_000 },
      )
      .toBe(2);

    const records = await recoveryRecords(userData);
    // One live project keeps exactly one record, replaced in place.
    expect(records).toHaveLength(1);
    expect(records[0]?.recoveryId).toBe(first?.recoveryId);
    expect(await readdir(path.join(userData, "recovery"))).toEqual([
      `${first?.recoveryId}${RECOVERY_EXTENSION}`,
    ]);
  } finally {
    await app.close().catch(() => {
      // Already gone, which is the outcome teardown wanted anyway.
    });
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});
