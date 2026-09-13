import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import {
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
} from "../../packages/persistence/src/project/index";
import { surfaceOf } from "./layers-stack-helpers";

const RECOVERY_EXTENSION = ".folio-recovery";
const SESSION_ID = "00000000-0000-4000-8000-0000000000c3";
const FIRST = "00000000-0000-4000-8000-0000000000a1";
const SECOND = "00000000-0000-4000-8000-0000000000a2";

const repositoryRoot = process.cwd();
const mainScript = path.join(repositoryRoot, "apps/desktop/dist-electron/main.js");
const electronBinary = path.join(
  repositoryRoot,
  "apps/desktop/node_modules/electron/dist/electron.exe",
);

/** Every launch here names its own profile, so a relaunch finds what the last one left. */
function launchFolio(userData: string) {
  return electron.launch({
    args: [mainScript, `--user-data-dir=${userData}`],
    executablePath: electronBinary,
  });
}

async function profile() {
  return mkdtemp(path.join(tmpdir(), "folio-startup-recovery-"));
}

function recoveryDirectory(userData: string) {
  return path.join(userData, "recovery");
}

async function recoveryFiles(userData: string): Promise<readonly string[]> {
  const entries = await readdir(recoveryDirectory(userData)).catch(() => [] as string[]);
  return entries.filter((entry) => entry.endsWith(RECOVERY_EXTENSION)).sort();
}

async function readRecovery(userData: string, name: string) {
  const raw = await readFile(path.join(recoveryDirectory(userData), name), "utf8");
  return JSON.parse(raw) as { recoveryId: string; title: string; project: string };
}

async function seedRecovery(
  userData: string,
  options: {
    readonly recoveryId: string;
    readonly title: string;
    readonly capturedAt: string;
    readonly project: string;
    readonly source?: string;
  },
): Promise<void> {
  const directory = recoveryDirectory(userData);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${options.recoveryId}${RECOVERY_EXTENSION}`),
    JSON.stringify({
      format: "folio-recovery",
      formatVersion: 1,
      recoveryId: options.recoveryId,
      sessionId: SESSION_ID,
      capturedAt: options.capturedAt,
      documentId: `document-${options.recoveryId}`,
      title: options.title,
      hadBacking: options.source !== undefined,
      source: options.source === undefined ? null : { path: options.source },
      project: options.project,
    }),
  );
}

function emptyProject(title: string): string {
  return encodeFolioProject(
    createEmptyFolioProject({ documentId: `doc-${title}`, title, pageId: "page-1" }),
  );
}

async function draw(window: Page, y: number): Promise<void> {
  await window.locator('button[data-dock-slot="pen"]').click();
  await window.mouse.move(620, y);
  await window.mouse.down();
  await window.mouse.move(820, y + 40, { steps: 10 });
  await window.mouse.up();
}

/**
 * One stroke of real artwork, encoded the way the application itself encodes it.
 *
 * Seeding a recovery record by hand is the only way to test the startup flow
 * without crashing an app first, and a hand-written project would be a fixture
 * of this file's own invention rather than something Folio produced.
 */
let artwork = "";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const userData = await profile();
  const app = await launchFolio(userData);
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await expect(surfaceOf(window)).toHaveAttribute("data-document-state", "ready");
    await draw(window, 400);
    await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", "1");
    await expect
      .poll(async () => (await recoveryFiles(userData)).length, { timeout: 30_000 })
      .toBe(1);
    artwork = (await readRecovery(userData, (await recoveryFiles(userData))[0] ?? "")).project;
    expect(decodeFolioProject(artwork).sketchbook.firstPage.content.size).toBe(1);
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("offers a drawing left behind by a crash, and restores it detached", async () => {
  test.setTimeout(120_000);
  const userData = await profile();
  try {
    const first = await launchFolio(userData);
    let abandoned = "";
    try {
      const window = await first.firstWindow();
      await window.setViewportSize({ width: 1440, height: 900 });
      await expect(surfaceOf(window)).toHaveAttribute("data-document-state", "ready");
      // Nothing to offer on a first run with an untouched blank sketch.
      await expect(window.getByTestId("startup-recovery-dialog")).toHaveCount(0);

      await draw(window, 400);
      await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", "1");
      await expect
        .poll(async () => (await recoveryFiles(userData)).length, { timeout: 30_000 })
        .toBe(1);
      abandoned = (await recoveryFiles(userData))[0] ?? "";
    } finally {
      // Teardown destroys the window rather than closing it, which is exactly
      // what a crash does: the snapshot is never retired.
      await first.close().catch(() => undefined);
    }
    expect(await recoveryFiles(userData)).toEqual([abandoned]);

    const second = await launchFolio(userData);
    try {
      const window = await second.firstWindow();
      await window.setViewportSize({ width: 1440, height: 900 });
      const dialog = window.getByTestId("startup-recovery-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("startup-recovery-candidate")).toHaveCount(1);
      await expect(dialog.getByTestId("startup-recovery-title")).toHaveText("Untitled Sketch");

      await dialog.getByTestId("startup-recovery-recover").click();
      await expect(dialog).toBeHidden();
      // The rescued stroke is on the canvas.
      await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", "1");

      // The rescued drawing -- which no file holds -- is protected again under a
      // record of its own, and only then is the candidate it came from released.
      // Until that successor exists the candidate is the only copy of the
      // artwork anywhere, so both are on disk for a moment.
      await expect
        .poll(
          async () => {
            const files = await recoveryFiles(userData);
            return files.length === 1 && files[0] !== abandoned ? files[0] : null;
          },
          { timeout: 30_000 },
        )
        .not.toBeNull();
      const replacement = (await recoveryFiles(userData))[0] ?? "";
      expect(replacement).not.toBe(abandoned);
      expect(
        decodeFolioProject((await readRecovery(userData, replacement)).project).sketchbook.firstPage
          .content.size,
      ).toBe(1);
    } finally {
      await second.close().catch(() => undefined);
    }
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("opens the saved file a candidate came from instead of the unsaved copy", async () => {
  test.setTimeout(120_000);
  const userData = await profile();
  const documents = await mkdtemp(path.join(tmpdir(), "folio-originals-"));
  try {
    const original = path.join(documents, "Harbour study.folio");
    // The file holds the artwork; the unsaved copy beside it is blank, so which
    // one arrives on the canvas is unambiguous.
    await writeFile(original, artwork, "utf8");
    await seedRecovery(userData, {
      recoveryId: FIRST,
      title: "Harbour study",
      capturedAt: "2026-09-12T10:00:00.000Z",
      project: emptyProject("Harbour study"),
      source: original,
    });

    const app = await launchFolio(userData);
    try {
      const window = await app.firstWindow();
      await window.setViewportSize({ width: 1440, height: 900 });
      const dialog = window.getByTestId("startup-recovery-dialog");
      await expect(dialog).toBeVisible();
      await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", "0");

      await dialog.getByTestId("startup-recovery-open-original").click();
      await expect(dialog).toBeHidden();
      await expect(surfaceOf(window)).toHaveAttribute("data-document-object-count", "1");

      // A confirmed file now holds this content, so the candidate is consumed
      // and nothing needs a background copy.
      expect(await recoveryFiles(userData)).toEqual([]);
    } finally {
      await app.close().catch(() => undefined);
    }
    // Opening the original never wrote to it.
    expect(await readFile(original, "utf8")).toBe(artwork);
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
    await rm(documents, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("lists several candidates newest first and discards only the chosen one", async () => {
  test.setTimeout(120_000);
  const userData = await profile();
  try {
    await seedRecovery(userData, {
      recoveryId: FIRST,
      title: "Older study",
      capturedAt: "2026-09-01T08:00:00.000Z",
      project: emptyProject("Older study"),
    });
    await seedRecovery(userData, {
      recoveryId: SECOND,
      title: "Newer study",
      capturedAt: "2026-09-12T10:00:00.000Z",
      project: emptyProject("Newer study"),
    });

    const app = await launchFolio(userData);
    try {
      const window = await app.firstWindow();
      await window.setViewportSize({ width: 1440, height: 900 });
      const dialog = window.getByTestId("startup-recovery-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("startup-recovery-title")).toHaveText([
        "Newer study",
        "Older study",
      ]);

      const newer = dialog.locator('[data-recovery-id="' + SECOND + '"]');
      await newer.getByTestId("startup-recovery-discard").click();
      await expect(dialog.getByTestId("startup-recovery-title")).toHaveText(["Older study"]);
      expect(await recoveryFiles(userData)).toEqual([`${FIRST}${RECOVERY_EXTENSION}`]);

      // Dismissing decides nothing: what is left is still there next time.
      await dialog.getByTestId("startup-recovery-later").click();
      await expect(dialog).toBeHidden();
      expect(await recoveryFiles(userData)).toEqual([`${FIRST}${RECOVERY_EXTENSION}`]);
    } finally {
      await app.close().catch(() => undefined);
    }
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});
