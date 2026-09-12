import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
} from "../../packages/persistence/src/project/index";
import { surfaceOf } from "./layers-stack-helpers";

const repositoryRoot = process.cwd();
const mainScript = path.join(repositoryRoot, "apps/desktop/dist-electron/main.js");
const electronBinary = path.join(
  repositoryRoot,
  "apps/desktop/node_modules/electron/dist/electron.exe",
);

function launchFolio(userDataDirectory?: string) {
  return electron.launch({
    args:
      userDataDirectory === undefined
        ? [mainScript]
        : [mainScript, `--user-data-dir=${userDataDirectory}`],
    executablePath: electronBinary,
  });
}

async function ready(app: ElectronApplication): Promise<Page> {
  const window = await app.firstWindow();
  await window.setViewportSize({ width: 1440, height: 900 });
  await expect(surfaceOf(window)).toHaveAttribute("data-document-state", "ready");
  return window;
}

async function draw(window: Page, y: number): Promise<void> {
  await window.locator('button[data-dock-slot="pen"]').click();
  await window.mouse.move(620, y);
  await window.mouse.down();
  await window.mouse.move(820, y + 40, { steps: 10 });
  await window.mouse.up();
}

/** Opens the application menu and chooses one item, the way a hand would. */
async function chooseMenu(window: Page, testId: string): Promise<void> {
  await window.getByTestId("application-menu-trigger").click();
  await expect(window.getByRole("menu")).toBeVisible();
  await window.getByTestId(testId).click();
  await expect(window.getByRole("menu"), "the menu closes behind its action").toHaveCount(0);
}

/**
 * Answers the native destination picker with a path of the test's choosing.
 *
 * The dialog belongs to the operating system, so the only honest way to drive
 * it is to replace it in main and count what production asked for.
 */
async function stubSaveDialog(app: ElectronApplication, destination: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    const counters = globalThis as unknown as { folioSaveDialogCalls?: number };
    counters.folioSaveDialogCalls = 0;
    dialog.showSaveDialog = (async () => {
      counters.folioSaveDialogCalls = (counters.folioSaveDialogCalls ?? 0) + 1;
      return { canceled: false, filePath };
    }) as typeof dialog.showSaveDialog;
  }, destination);
}

function saveDialogCalls(app: ElectronApplication): Promise<number> {
  return app.evaluate(
    () => (globalThis as unknown as { folioSaveDialogCalls?: number }).folioSaveDialogCalls ?? 0,
  );
}

async function stubOpenDialog(app: ElectronApplication, source: string): Promise<void> {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [filePath],
    })) as typeof dialog.showOpenDialog;
  }, source);
}

test("saves, reuses its file, and shows unsaved work in the title", async () => {
  test.setTimeout(180_000);
  const documents = await mkdtemp(path.join(tmpdir(), "folio-file-ui-"));
  const app = await launchFolio();
  try {
    const window = await ready(app);
    const surface = surfaceOf(window);
    const dirty = window.getByTestId("sketch-dirty-indicator");
    const destination = path.join(documents, "Harbour study.folio");
    await stubSaveDialog(app, destination);

    // A blank sketch is clean and has nothing to mark.
    await expect(window.getByTestId("sketch-name")).toHaveText("Untitled Sketch");
    await expect(dirty).toHaveCount(0);

    await draw(window, 380);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(dirty, "an edit shows immediately").toHaveCount(1);

    // The first save has no file to write to, so it asks for one.
    await window.keyboard.press("Control+s");
    await expect(window.getByTestId("notification")).toContainText("Project saved");
    await expect(dirty, "saving what is on screen clears the marker").toHaveCount(0);
    expect(await saveDialogCalls(app)).toBe(1);
    expect(
      decodeFolioProject(await readFile(destination, "utf8")).sketchbook.firstPage.content.size,
    ).toBe(1);

    // Editing marks it again, and undoing back to the saved state clears it
    // without anything being written.
    await draw(window, 500);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    await expect(dirty).toHaveCount(1);
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(dirty, "undo back to the saved state is clean again").toHaveCount(0);
    await window.keyboard.press("Control+y");
    await expect(dirty, "and redo is dirty again").toHaveCount(1);

    // The second save already knows where it goes.
    await window.keyboard.press("Control+s");
    await expect(window.getByTestId("notification").last()).toContainText("Project saved");
    await expect(dirty).toHaveCount(0);
    expect(await saveDialogCalls(app), "it did not ask twice").toBe(1);
    expect(
      decodeFolioProject(await readFile(destination, "utf8")).sketchbook.firstPage.content.size,
    ).toBe(2);

    // Save As always asks, and moves the project to what it chose.
    const second = path.join(documents, "Harbour study copy.folio");
    await stubSaveDialog(app, second);
    await chooseMenu(window, "menu-save-project-as");
    await expect(window.getByTestId("notification").last()).toContainText("Project saved");
    expect(await saveDialogCalls(app)).toBe(1);
    expect(
      decodeFolioProject(await readFile(second, "utf8")).sketchbook.firstPage.content.size,
    ).toBe(2);
  } finally {
    await app.close().catch(() => undefined);
    await rm(documents, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("protects unsaved work before New and Open, and opens what was chosen", async () => {
  test.setTimeout(180_000);
  const documents = await mkdtemp(path.join(tmpdir(), "folio-file-ui-guard-"));
  const app = await launchFolio();
  try {
    const window = await ready(app);
    const surface = surfaceOf(window);
    const source = path.join(documents, "Opened.folio");
    await writeFile(
      source,
      encodeFolioProject(
        createEmptyFolioProject({ documentId: "O", title: "Opened study", pageId: "page-O" }),
      ),
    );
    await stubOpenDialog(app, source);

    await draw(window, 380);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    // Cancelling the question cancels the whole request.
    await chooseMenu(window, "menu-new-project");
    const unsaved = window.getByTestId("unsaved-changes-dialog");
    await expect(unsaved).toBeVisible();
    await window.getByTestId("unsaved-changes-cancel").click();
    await expect(unsaved).toHaveCount(0);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    // Discarding is permission, and the replacement really happens.
    await chooseMenu(window, "menu-new-project");
    await expect(unsaved).toBeVisible();
    await window.getByTestId("unsaved-changes-discard").click();
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(window.getByTestId("sketch-name")).toHaveText("Untitled Sketch");
    await expect(window.getByTestId("sketch-dirty-indicator")).toHaveCount(0);

    // A fresh blank project is not worth asking about, so Open goes straight
    // through and the opened project names itself.
    await chooseMenu(window, "menu-open-project");
    await expect(unsaved).toHaveCount(0);
    await expect(window.getByTestId("sketch-name")).toHaveText("Opened study");
    await expect(window.getByTestId("sketch-dirty-indicator")).toHaveCount(0);

    // Now it is worth asking about: an opened project is real work.
    await draw(window, 420);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+o");
    await expect(unsaved).toBeVisible();
    await window.getByTestId("unsaved-changes-cancel").click();
    await expect(window.getByTestId("sketch-name")).toHaveText("Opened study");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
  } finally {
    await app.close().catch(() => undefined);
    await rm(documents, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("brings the recovery list back after it has been dismissed", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(path.join(tmpdir(), "folio-file-ui-recovery-"));
  try {
    const recoveryId = "00000000-0000-4000-8000-0000000000a1";
    await mkdir(path.join(userData, "recovery"), { recursive: true });
    await writeFile(
      path.join(userData, "recovery", `${recoveryId}.folio-recovery`),
      JSON.stringify({
        format: "folio-recovery",
        formatVersion: 1,
        recoveryId,
        sessionId: "00000000-0000-4000-8000-0000000000c3",
        capturedAt: "2026-09-12T10:00:00.000Z",
        documentId: "doc-rescued",
        title: "Rescued study",
        hadBacking: false,
        source: null,
        project: encodeFolioProject(
          createEmptyFolioProject({ documentId: "doc-rescued", title: "Rescued study" }),
        ),
      }),
    );

    const app = await launchFolio(userData);
    try {
      const window = await ready(app);
      const dialog = window.getByTestId("startup-recovery-dialog");

      // Offered once at startup, and dismissing it decides nothing.
      await expect(dialog).toBeVisible();
      await window.getByTestId("startup-recovery-later").click();
      await expect(dialog).toHaveCount(0);
      expect(await readdir(path.join(userData, "recovery"))).toEqual([
        `${recoveryId}.folio-recovery`,
      ]);

      // The menu is the way back, without restarting.
      await chooseMenu(window, "menu-show-recovery");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("startup-recovery-title")).toHaveText("Rescued study");

      // Handling it refreshes the list, and asking again says so honestly.
      await dialog.getByTestId("startup-recovery-discard").click();
      await expect(dialog.getByTestId("startup-recovery-candidate")).toHaveCount(0);
      await expect(dialog).toContainText("No recovered drawings");
      expect(await readdir(path.join(userData, "recovery"))).toEqual([]);
      await window.getByTestId("startup-recovery-later").click();
      await expect(dialog).toHaveCount(0);

      await chooseMenu(window, "menu-show-recovery");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("No recovered drawings");
    } finally {
      await app.close().catch(() => undefined);
    }
  } finally {
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});
