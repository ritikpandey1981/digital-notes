import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { expect, test, _electron as electron } from "@playwright/test";
import type {} from "../../apps/desktop/src/components/editor/__tests__/runtime-harness";
import type {} from "../../apps/desktop/src/types/preload";

test("real mounted candidate failure, inert preparation and repeated handoff", async () => {
  test.setTimeout(120_000);
  const requireDesktop = createRequire(path.resolve("apps/desktop/package.json"));
  const vite = await import(pathToFileURL(requireDesktop.resolve("vite")).href);
  // Test-only page; no failure hooks, debug globals or alternate entry in the shipped app.
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
  const origin = server.resolvedUrls.local[0];
  const app = await electron.launch({
    args: [path.resolve("apps/desktop/dist-electron/main.js")],
    executablePath: path.resolve("apps/desktop/node_modules/electron/dist/electron.exe"),
    env: { ...process.env, VITE_DEV_SERVER_URL: `${origin}tests/e2e/fixtures/runtime.html` },
  });
  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));
    await window.setViewportSize({ width: 1440, height: 900 });
    const active = () =>
      window.locator('[data-project-runtime="active"] [data-testid="canvas-surface"]');
    await expect(active()).toHaveAttribute("data-renderer-state", "ready");
    await window.locator('button[data-dock-slot="pen"]').click();
    await expect(active()).toHaveAttribute("data-active-editor-tool", "ink");
    // Genuine drawing, selection, clipboard, Undo/Redo and a non-default viewport in A.
    const draw = async (y: number) => {
      await window.mouse.move(650, y);
      await window.mouse.down();
      await window.mouse.move(780, y + 30, { steps: 12 });
      await window.mouse.up();
    };
    await draw(350);
    await draw(430);
    await window.keyboard.press("Control+z");
    await expect(active()).toHaveAttribute("data-history-undo-depth", "1");
    await expect(active()).toHaveAttribute("data-history-redo-depth", "1");
    await window.getByRole("button", { name: "Select", exact: true }).click();
    await window.keyboard.press("Control+a");
    await window.keyboard.press("Control+c");
    await expect(active()).toHaveAttribute("data-selected-object-count", "1");
    await window.evaluate(() => globalThis.window.runtimeHarness.capture());
    await expect(window.getByTestId("shell-viewport")).toHaveText("1.25");
    for (const failure of ["context", "activation"] as const) {
      await window.evaluate(
        (failure) => globalThis.window.runtimeHarness.begin("failed", failure),
        failure,
      );
      if (failure === "activation") {
        await expect
          .poll(() => window.evaluate(() => globalThis.window.runtimeHarness.ready))
          .toBe(true);
        await window.evaluate(() => globalThis.window.runtimeHarness.commit());
      }
      await expect
        .poll(() => window.evaluate(() => globalThis.window.runtimeHarness.result))
        .toBe("failed");
      expect(await window.evaluate(() => globalThis.window.runtimeHarness.unchanged())).toBe(true);
      await expect(active()).toHaveAttribute("data-history-undo-depth", "1");
      await expect(active()).toHaveAttribute("data-history-redo-depth", "1");
      await expect(active()).toHaveAttribute("data-selected-object-count", "1");
      await expect(active()).toHaveAttribute("data-clipboard-object-count", "1");
      await expect(window.getByTestId("shell-viewport")).toHaveText("1.25");
      await expect(window.locator('[data-project-runtime="candidate"]')).toHaveCount(0);
      await expect(window.getByText("Couldn’t complete that edit.", { exact: true })).toHaveCount(
        0,
      );
    }
    // Failure must preserve the shared canvas Escape route too.
    await window.keyboard.press("Escape");
    await expect(active()).toHaveAttribute("data-selected-object-count", "0");
    for (const name of ["B", "C"]) {
      await window.evaluate((name) => globalThis.window.runtimeHarness.begin(name), name);
      await expect
        .poll(() => window.evaluate(() => globalThis.window.runtimeHarness.ready))
        .toBe(true);
      const candidate = window.locator(
        '[data-project-runtime="candidate"] [data-testid="canvas-surface"]',
      );
      await candidate.locator('canvas[data-folio-layer="ink"]').dispatchEvent("pointerdown", {
        pointerId: 8,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: 700,
        clientY: 350,
      });
      await expect(candidate).toHaveAttribute("data-document-object-count", "0");
      expect(await window.evaluate(() => globalThis.window.runtimeHarness.activeTitle)).not.toBe(
        name,
      );
      await window.keyboard.press("Control+z");
      await expect(candidate).toHaveAttribute("data-history-undo-depth", "0");
      await expect(window.getByTestId("shell-viewport")).not.toHaveText("0");
      await window.evaluate(() => globalThis.window.runtimeHarness.commit());
      await expect
        .poll(() => window.evaluate(() => globalThis.window.runtimeHarness.result))
        .toBe("activated");
      await expect(active()).toHaveAttribute("data-active-page-id", name);
      await expect(active()).toHaveAttribute("data-history-undo-depth", "0");
      await expect(active()).toHaveAttribute("data-history-redo-depth", "0");
      await expect(active()).toHaveAttribute("data-selected-object-count", "0");
      await expect(active()).toHaveAttribute("data-clipboard-object-count", "0");
      await expect(active()).toHaveAttribute("data-viewport-mode", "fit-page");
      await expect(window.locator('[data-testid="canvas-surface"]')).toHaveCount(1);
      await expect(window.locator('[data-project-runtime="candidate"]')).toHaveCount(0);
      const projection = await window.getByTestId("shell-viewport").textContent();
      await window.evaluate(() => globalThis.window.runtimeHarness.deliverStale());
      await expect(window.getByTestId("shell-viewport")).toHaveText(projection!);
      expect(await window.evaluate(() => globalThis.window.runtimeHarness.oldDetached)).toBe(true);
      await window.locator('button[data-dock-slot="pen"]').click();
      await draw(350);
      await expect(active()).toHaveAttribute("data-history-undo-depth", "1");
      await window.keyboard.press("Control+z");
      await expect(active()).toHaveAttribute("data-document-object-count", "0");
      await window.keyboard.press("Control+Shift+z");
      await expect(active()).toHaveAttribute("data-document-object-count", "1");
      await window.evaluate(() => globalThis.window.runtimeHarness.capture());
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});
