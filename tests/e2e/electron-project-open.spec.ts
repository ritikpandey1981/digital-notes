import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, test, _electron as electron } from "@playwright/test";
import {
  encodeFolioProject,
  decodeFolioProject,
  createEmptyFolioProject,
} from "../../packages/persistence/src/project/index";
import { createRepresentativeProject } from "../../packages/persistence/src/project/__tests__/project-fixture";
import type {} from "../../apps/desktop/src/components/editor/__tests__/runtime-harness";
import type {} from "../../apps/desktop/src/types/preload";

test("production Open reads, activates, adopts and saves without File UI", async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), "folio-open-e2e-"));
  const aPath = path.join(directory, "A.folio");
  const bPath = path.join(directory, "B-filename.folio");
  const cPath = path.join(directory, "C.folio");
  const badPath = path.join(directory, "corrupt.folio");
  const b = createRepresentativeProject();
  const c = createEmptyFolioProject({ documentId: "C", title: "Logical C", pageId: "page-C" });
  await writeFile(bPath, encodeFolioProject(b));
  await writeFile(cPath, encodeFolioProject(c));
  await writeFile(badPath, "{truncated");
  const requireDesktop = createRequire(path.resolve("apps/desktop/package.json"));
  const vite = await import(pathToFileURL(requireDesktop.resolve("vite")).href);
  const server = await vite.createServer({
    configFile: path.resolve("apps/desktop/vite.config.ts"),
    root: process.cwd(),
    resolve: {
      alias: {
        react: path.dirname(requireDesktop.resolve("react/package.json")),
        "react-dom": path.dirname(requireDesktop.resolve("react-dom/package.json")),
      },
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const app = await electron.launch({
    args: [path.resolve("apps/desktop/dist-electron/main.js")],
    executablePath: path.resolve("apps/desktop/node_modules/electron/dist/electron.exe"),
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: `${server.resolvedUrls.local[0]}tests/e2e/fixtures/runtime.html`,
    },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    const surface = page.locator('[data-project-runtime="active"] [data-testid="canvas-surface"]');
    await expect(surface).toHaveAttribute("data-renderer-state", "ready");
    const draw = async (y: number) => {
      await page.locator('button[data-dock-slot="pen"]').click();
      await page.mouse.move(650, y);
      await page.mouse.down();
      await page.mouse.move(780, y + 30, { steps: 12 });
      await page.mouse.up();
    };
    await draw(350);
    await draw(430);
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await page.evaluate(() => window.runtimeHarness.capture());
    // Only native pickers are stubbed; production IPC/read/decode/activation/adoption/write run.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as typeof dialog.showSaveDialog;
    }, aPath);
    expect((await page.evaluate(() => window.runtimeHarness.saveAs())).status).toBe("saved");
    const aBacking = await page.evaluate(() => window.runtimeHarness.backing);
    for (const chosen of [null, path.join(directory, "missing.folio"), badPath]) {
      await app.evaluate(({ dialog }, chosen) => {
        dialog.showOpenDialog = (async () => ({
          canceled: chosen === null,
          filePaths: chosen === null ? [] : [chosen],
        })) as typeof dialog.showOpenDialog;
      }, chosen);
      const result = await page.evaluate(() => window.runtimeHarness.open());
      expect(result.status).toBe(chosen === null ? "cancelled" : "failed");
      expect(await page.evaluate(() => window.runtimeHarness.unchanged())).toBe(true);
      expect(await page.evaluate(() => window.runtimeHarness.backing)).toEqual(aBacking);
      await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
      await expect(surface).toHaveAttribute("data-history-redo-depth", "1");
      await expect(surface).toHaveAttribute("data-selected-object-count", "1");
      await expect(surface).toHaveAttribute("data-clipboard-object-count", "1");
      await expect(page.getByTestId("shell-viewport")).toHaveText("1.25");
    }
    await draw(490);
    expect((await page.evaluate(() => window.runtimeHarness.save())).status).toBe("saved");
    const aBytes = await readFile(aPath, "utf8");
    expect(decodeFolioProject(aBytes).sketchbook.firstPage.content.objects.size).toBe(2);
    await page.evaluate(() => window.runtimeHarness.capture());
    // If Save after Open incorrectly asks for a destination, make that regression observable.
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => {
        throw new Error("Unexpected Save As after Open");
      }) as typeof dialog.showSaveDialog;
    });
    for (const [filename, snapshot] of [
      [bPath, b],
      [cPath, c],
    ] as const) {
      await app.evaluate(({ dialog }, filename) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [filename],
        })) as typeof dialog.showOpenDialog;
      }, filename);
      // An unfinished A/B stroke and its pointer capture must not leak into the next project.
      await page.mouse.move(620, 330);
      await page.mouse.down();
      await page.mouse.move(660, 345, { steps: 4 });
      expect((await page.evaluate(() => window.runtimeHarness.open())).status).toBe("opened");
      await page.mouse.up();
      expect(await page.evaluate(() => window.runtimeHarness.metadata)).toEqual(snapshot.metadata);
      expect(await page.evaluate(() => window.runtimeHarness.backing?.displayName)).toBe(
        path.basename(filename),
      );
      expect(await page.evaluate(() => window.runtimeHarness.encoded)).toBe(
        encodeFolioProject(snapshot),
      );
      await expect(surface).toHaveAttribute(
        "data-active-page-id",
        snapshot.sketchbook.firstPage.id,
      );
      await expect(surface).toHaveAttribute(
        "data-page-count",
        String(snapshot.sketchbook.pageCount),
      );
      await expect(surface).toHaveAttribute(
        "data-layer-count",
        String(snapshot.sketchbook.firstPage.content.layerCount),
      );
      await expect(surface).toHaveAttribute(
        "data-document-object-count",
        String(snapshot.sketchbook.firstPage.content.objects.size),
      );
      await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
      await expect(surface).toHaveAttribute("data-history-redo-depth", "0");
      await expect(surface).toHaveAttribute("data-selected-object-count", "0");
      await expect(surface).toHaveAttribute("data-clipboard-object-count", "0");
      await expect(surface).toHaveAttribute("data-viewport-mode", "fit-page");
      await expect(page.locator('[data-testid="canvas-surface"]')).toHaveCount(1);
      expect(await page.evaluate(() => window.runtimeHarness.oldDetached)).toBe(true);
      const projection = await page.getByTestId("shell-viewport").textContent();
      await page.evaluate(() => window.runtimeHarness.deliverStale());
      await expect(page.getByTestId("shell-viewport")).toHaveText(projection!);
      if (filename === bPath)
        await expect(surface).toHaveAttribute("data-rendered-object-order", /object-line/);
      else await expect(surface).not.toHaveAttribute("data-rendered-object-order", /object-/);
      await draw(350);
      await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
      expect((await page.evaluate(() => window.runtimeHarness.save())).status).toBe("saved");
      const bytes = await readFile(filename, "utf8");
      expect(bytes).toBe(await page.evaluate(() => window.runtimeHarness.encoded));
      expect(decodeFolioProject(bytes).metadata).toEqual(snapshot.metadata);
      expect(await readFile(aPath, "utf8")).toBe(aBytes);
      await page.evaluate(() => window.runtimeHarness.capture());
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
