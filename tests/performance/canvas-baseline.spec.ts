import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { test, _electron as electron } from "@playwright/test";
import type {} from "../../apps/desktop/src/components/editor/__tests__/PerformanceCanvasHarness";
import type { Measurement } from "./metrics";

test("mounted canvas page, layer and selection costs", async () => {
  test.skip(process.env.FOLIO_PERFORMANCE_BASELINE !== "1", "Explicit performance mode required");
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
      VITE_DEV_SERVER_URL: `${server.resolvedUrls.local[0]}tests/performance/canvas.html`,
    },
  });
  const output = path.resolve(
    "test-results/performance-data",
    process.env.FOLIO_BASELINE_RUN ?? "canvas",
  );
  await mkdir(output, { recursive: true });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => Boolean(window.canvasBaseline));
    await writeFile(
      path.join(output, "canvas-environment.json"),
      JSON.stringify(
        {
          os: `${os.type()} ${os.release()} ${os.version()}`,
          cpu: os.cpus()[0]?.model,
          ramBytes: os.totalmem(),
          harnessNode: process.version,
          build: "Vite development, bare CanvasSurface without StrictMode",
          ...(await app.evaluate(async ({ app, screen }) => ({
            gpu: await app.getGPUInfo("basic"),
            display: screen.getPrimaryDisplay(),
            versions: process.versions,
          }))),
          browser: await page.evaluate(() => ({
            dpr: devicePixelRatio,
            width: innerWidth,
            height: innerHeight,
            visibility: document.visibilityState,
          })),
        },
        null,
        2,
      ),
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const values: Measurement[] = [];
    for (const group of ["document", "layers", "selection"] as const) {
      if (
        process.env.FOLIO_BASELINE_GROUPS &&
        !process.env.FOLIO_BASELINE_GROUPS.split(",").includes(group)
      )
        continue;
      console.log(`Mounted canvas: ${group}`);
      values.push(...(await page.evaluate((group) => window.canvasBaseline.run(group), group)));
      await writeFile(path.join(output, "canvas.json"), JSON.stringify(values, null, 2));
    }
    if (errors.length) throw new Error(errors.join("\n"));
    await page.screenshot({ path: path.join(output, "canvas-10k.png") });
  } finally {
    await app.close();
    await server.close();
  }
});
