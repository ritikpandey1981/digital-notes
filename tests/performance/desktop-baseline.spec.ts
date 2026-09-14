import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { test, expect, _electron as electron } from "@playwright/test";
import type * as Baseline from "./browser-baseline";
import {
  focusLiveWindow,
  probeLiveFrames,
  readLiveWindowState,
  watchLiveForeground,
} from "./live-scheduling";
import { summarize, type Measurement } from "./metrics";
import type {} from "../../apps/desktop/src/components/editor/__tests__/runtime-harness";
import type {} from "../../apps/desktop/src/types/preload";

declare global {
  interface Window {
    baseline: typeof Baseline;
  }
}

test("measured desktop baseline (no speed thresholds)", async () => {
  test.skip(process.env.FOLIO_PERFORMANCE_BASELINE !== "1", "Explicit performance mode required");
  const output = path.resolve(
    "test-results/performance-data",
    process.env.FOLIO_BASELINE_RUN ?? new Date().toISOString().replaceAll(/[:.]/g, "-"),
  );
  await mkdir(output, { recursive: true });
  const stages = process.env.FOLIO_BASELINE_STAGES?.split(",");
  const includesStage = (name: string) => !stages || stages.includes(name);
  const results: Measurement[] = [];
  const memory: unknown[] = [];
  const environment = {
    os: `${os.type()} ${os.release()} ${os.version()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
    harnessNode: process.version,
    build:
      "Vite development runtime harness, React StrictMode; production startup measured separately",
  };
  await writeFile(path.join(output, "environment.json"), JSON.stringify(environment, null, 2));
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
    const cdp = await page.context().newCDPSession(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByTestId("canvas-surface")).toBeVisible();
    await page.evaluate(async () => {
      const url = "/tests/performance/browser-baseline.ts";
      window.baseline = await import(/* @vite-ignore */ url);
    });
    const details = await app.evaluate(async ({ app, screen }) => ({
      gpu: await app.getGPUInfo("basic"),
      display: screen.getPrimaryDisplay(),
      versions: process.versions,
    }));
    const browser = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      width: innerWidth,
      height: innerHeight,
      visibility: document.visibilityState,
      runtime: window.folio.runtime,
    }));
    await writeFile(
      path.join(output, "environment.json"),
      JSON.stringify({ ...environment, ...details, browser }, null, 2),
    );
    const saveResults = async () => {
      await writeFile(path.join(output, "measurements.json"), JSON.stringify(results, null, 2));
      await writeFile(path.join(output, "memory.json"), JSON.stringify(memory, null, 2));
    };
    const takeMemory = async (label: string) => {
      memory.push({
        label,
        heap: await cdp.send("Runtime.getHeapUsage"),
        canvases: await page.locator("canvas").count(),
        dom: await cdp.send("Memory.getDOMCounters"),
        metrics: await app.evaluate(({ app }) => app.getAppMetrics()),
      });
      await saveResults();
    };
    await takeMemory("startup");
    for (const [group, sizes] of [
      ["stroke", [100, 500, 1000, 2500, 5000, 10000, 20000]],
      ["document", [100, 1000, 5000, 10000]],
      ["layers", [1, 10, 25, 50, 100]],
      ["pages", [1, 10, 25, 50]],
      ["selection", [10, 100, 500, 1000]],
    ] as const) {
      if (
        process.env.FOLIO_BASELINE_GROUPS &&
        !process.env.FOLIO_BASELINE_GROUPS.split(",").includes(group)
      )
        continue;
      for (const size of sizes) {
        if (
          process.env.FOLIO_BASELINE_MODEL_SIZES &&
          !process.env.FOLIO_BASELINE_MODEL_SIZES.split(",").includes(String(size))
        )
          continue;
        console.log(`Measuring ${group}/${size}`);
        results.push(
          ...(await page.evaluate(({ group, size }) => window.baseline.runModels(group, size), {
            group,
            size,
          })),
        );
        await saveResults();
      }
    }
    if (stages?.includes("raf-sanity")) {
      const probes = [await probeLiveFrames(app, page, "launch-unmodified")];
      await writeFile(path.join(output, "raf-sanity.json"), JSON.stringify(probes, null, 2));
      const window = await app.browserWindow(page);
      await window.evaluate((window) => window.minimize());
      await expect.poll(() => window.evaluate((window) => window.isMinimized())).toBe(true);
      probes.push(await probeLiveFrames(app, page, "deliberately-minimized"));
      await writeFile(path.join(output, "raf-sanity.json"), JSON.stringify(probes, null, 2));
      // Observe sustained background state as well as the immediate transition.
      await new Promise((resolve) => setTimeout(resolve, 12000));
      probes.push(await probeLiveFrames(app, page, "minimized-after-12-seconds"));
      await writeFile(path.join(output, "raf-sanity.json"), JSON.stringify(probes, null, 2));
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      probes.push(await probeLiveFrames(app, page, "minimized-without-focus-emulation"));
      await writeFile(path.join(output, "raf-sanity.json"), JSON.stringify(probes, null, 2));
      await focusLiveWindow(app, page);
      probes.push(await probeLiveFrames(app, page, "restored-focused"));
      await writeFile(path.join(output, "raf-sanity.json"), JSON.stringify(probes, null, 2));
    }
    if (includesStage("live")) {
      // Playwright otherwise reports renderer focus even for a minimized native window.
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await focusLiveWindow(app, page);
      const sanity = await probeLiveFrames(app, page, "foreground-before-live");
      const scheduling: unknown[] = [sanity];
      await writeFile(
        path.join(output, "live-scheduling.json"),
        JSON.stringify(scheduling, null, 2),
      );
      if (sanity.timedOut || sanity.states.some((state) => state.hidden || !state.focused))
        throw new Error("Live baseline did not obtain continuous foreground rAF observations");
      for (const kind of ["centerline", "outline", "technical-pen", "pressure-pen"] as const) {
        for (const [count, density] of [
          [100, 1],
          [1000, 4],
          [5000, 16],
          [20000, 64],
        ] as const) {
          await focusLiveWindow(app, page);
          const before = await readLiveWindowState(app, page);
          await watchLiveForeground(page);
          console.log(`Measuring live ${kind}/${count}/${density}`);
          results.push(
            ...(await page.evaluate(
              ({ kind, count, density }) => window.baseline.runLive(kind, count, density),
              { kind, count, density },
            )),
          );
          const changes = await page.evaluate(() => window.stopLiveForegroundWatch());
          const after = await readLiveWindowState(app, page);
          scheduling.push({ kind, count, density, before, after, changes });
          await writeFile(
            path.join(output, "live-scheduling.json"),
            JSON.stringify(scheduling, null, 2),
          );
          await saveResults();
          if (
            !before.native.focused ||
            !after.native.focused ||
            after.renderer.hidden ||
            !after.renderer.focused ||
            changes.some((change) => change.hidden || !change.focused)
          )
            throw new Error("Live workload lost foreground ownership; timing is not accepted");
        }
      }
    }
    if (["mounted", "navigation", "save", "open", "recovery"].some(includesStage))
      for (const size of [100, 500, 1000, 5000, 10000]) {
        if (
          process.env.FOLIO_BASELINE_MODEL_SIZES &&
          !process.env.FOLIO_BASELINE_MODEL_SIZES.split(",").includes(String(size))
        )
          continue;
        console.log(`Measuring mounted runtime and persistence/${size}`);
        const target = path.join(output, `fixture-${size}.folio`);
        await app.evaluate(({ dialog }, target) => {
          dialog.showSaveDialog = (async () => ({
            canceled: false,
            filePath: target,
          })) as typeof dialog.showSaveDialog;
          dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [target],
          })) as typeof dialog.showOpenDialog;
        }, target);
        results.push(
          ...(await page.evaluate(
            async ({ size, stages }) => {
              const enabled = (name: string) =>
                !stages || stages.includes("mounted") || stages.includes(name);
              const { fixture, paint, measureAsync } = window.baseline;
              const moduleUrl = "/packages/editor/src/project-session.ts";
              const { ProjectSession } = await import(/* @vite-ignore */ moduleUrl);
              const values: Measurement[] = [];
              const snapshot = fixture(size);
              values.push(
                await measureAsync(
                  `mounted/${size}/replacement-to-two-raf`,
                  async () => {
                    const result = await window.runtimeHarness.replaceForBaseline(
                      new ProjectSession(snapshot),
                    );
                    if (result.status !== "activated")
                      throw new Error(`Replacement: ${result.status}`);
                    await paint();
                  },
                  5,
                ),
              );
              let step = 0;
              if (enabled("navigation"))
                for (const action of ["pan", "zoom", "fit"] as const)
                  values.push(
                    await measureAsync(
                      `mounted/${size}/${action === "fit" ? "zoom-then-fit-roundtrip" : action}-to-two-raf`,
                      async () => {
                        const viewport = window.runtimeHarness.viewportActions!;
                        if (action === "pan") viewport.panBy({ x: step++ % 2 ? -10 : 10, y: 0 });
                        if (action === "zoom") viewport.setZoom(step++ % 2 ? 0.7 : 0.8);
                        if (action === "fit") {
                          viewport.setZoom(0.8);
                          await paint();
                          viewport.fitPage();
                        }
                        await paint();
                      },
                    ),
                  );
              if (size > 1000 || !["save", "open", "recovery"].some(enabled)) return values;
              if (enabled("save"))
                values.push(
                  await measureAsync(
                    `save/${size}/acknowledged`,
                    async () => {
                      const result = await window.runtimeHarness.save();
                      if (result.status !== "saved") throw new Error(JSON.stringify(result));
                    },
                    5,
                  ),
                );
              if (!enabled("save")) {
                const result = await window.runtimeHarness.save();
                if (result.status !== "saved") throw new Error(JSON.stringify(result));
              }
              const project = window.runtimeHarness.project;
              const codecUrl = "/packages/persistence/src/project/index.ts";
              const { encodeFolioProject } = await import(/* @vite-ignore */ codecUrl);
              const content = encodeFolioProject(project.capturePersistenceSnapshot().project);
              const bytes = new TextEncoder().encode(content).byteLength;
              if (enabled("save"))
                values.push(
                  await measureAsync(
                    `save/${size}/ipc-write-preencoded`,
                    async () => {
                      const result = await window.folio.projects.save({
                        kind: "save",
                        targetId: window.runtimeHarness.backing!.id,
                        content,
                      });
                      if (result.status !== "saved") throw new Error(JSON.stringify(result));
                    },
                    5,
                  ),
                );
              if (enabled("recovery") && bytes <= 64 * 1024 * 1024) {
                const gaps: number[] = [];
                let last = performance.now();
                let handle: number;
                const observe = (now: number) => {
                  gaps.push(now - last);
                  last = now;
                  handle = requestAnimationFrame(observe);
                };
                handle = requestAnimationFrame(observe);
                await paint();
                values.push(
                  await measureAsync(
                    `recovery/${size}/capture-encode-ipc-store`,
                    async () => {
                      const result = await window.folio.recovery.store({
                        recoveryId: "11111111-1111-4111-8111-111111111111",
                        sessionId: "22222222-2222-4222-8222-222222222222",
                        documentId: project.metadata.documentId,
                        title: project.metadata.title,
                        capturedAt: new Date().toISOString(),
                        backingTargetId: null,
                        content: encodeFolioProject(project.capturePersistenceSnapshot().project),
                      });
                      if (result.status !== "stored") throw new Error(JSON.stringify(result));
                    },
                    5,
                  ),
                );
                values.push(
                  await measureAsync(
                    `recovery/${size}/ipc-store-preencoded`,
                    async () => {
                      const result = await window.folio.recovery.store({
                        recoveryId: "11111111-1111-4111-8111-111111111111",
                        sessionId: "22222222-2222-4222-8222-222222222222",
                        documentId: project.metadata.documentId,
                        title: project.metadata.title,
                        capturedAt: new Date().toISOString(),
                        backingTargetId: null,
                        content,
                      });
                      if (result.status !== "stored") throw new Error(JSON.stringify(result));
                    },
                    5,
                  ),
                );
                await paint();
                cancelAnimationFrame(handle);
                const metricsUrl = "/tests/performance/metrics.ts";
                const { summarize } = await import(/* @vite-ignore */ metricsUrl);
                values.push(
                  summarize(
                    `recovery/${size}/raf-interval-during-store`,
                    gaps.filter((gap) => gap >= 0),
                  ),
                );
              }
              if (enabled("open"))
                values.push(
                  await measureAsync(
                    `open/${size}/read-decode-activate-to-two-raf`,
                    async () => {
                      const result = await window.runtimeHarness.open();
                      if (result.status !== "opened") throw new Error(JSON.stringify(result));
                      await paint();
                    },
                    5,
                  ),
                );
              return values;
            },
            { size, stages },
          )),
        );
        await takeMemory(`after-mounted-open-${size}`);
        if (size <= 1000 && ["mounted", "save", "open", "recovery"].some(includesStage)) {
          const bytes = await readFile(target);
          expect(bytes.length).toBeGreaterThan(0);
        }
        await saveResults();
      }
    if (includesStage("soak")) {
      await takeMemory("before-soak");
      const soak = await page.evaluate(() => window.baseline.runSoak(120));
      await writeFile(path.join(output, "soak.json"), JSON.stringify(soak, null, 2));
      await takeMemory("after-soak-before-gc");
    }
    if (includesStage("memory")) {
      for (const count of [0, 100, 1000, 10000, 0]) {
        await page.evaluate(async (count) => {
          const moduleUrl = "/packages/editor/src/project-session.ts";
          const { ProjectSession } = await import(/* @vite-ignore */ moduleUrl);
          const result = await window.runtimeHarness.replaceForBaseline(
            new ProjectSession(window.baseline.fixture(count)),
          );
          if (result.status !== "activated") throw new Error(result.status);
          await window.baseline.paint();
        }, count);
        await cdp.send("HeapProfiler.collectGarbage");
        await takeMemory(`retained-${count}-strokes-after-explicit-gc`);
      }
      for (let cycle = 0; cycle < 6; cycle++) {
        await page.evaluate(async (cycle) => {
          const moduleUrl = "/packages/editor/src/project-session.ts";
          const { ProjectSession } = await import(/* @vite-ignore */ moduleUrl);
          const result = await window.runtimeHarness.replaceForBaseline(
            new ProjectSession(window.baseline.fixture(cycle % 3 === 2 ? 0 : 100)),
          );
          if (result.status !== "activated") throw new Error(result.status);
          await window.baseline.paint();
        }, cycle);
        await cdp.send("HeapProfiler.collectGarbage");
        await takeMemory(`replacement-cycle-${cycle}-after-explicit-gc`);
      }
    }
    if (includesStage("memory")) {
      // Inspector console entries can keep logged objects alive independently of the app.
      await cdp.send("Runtime.discardConsoleEntries");
      await cdp.send("HeapProfiler.collectGarbage");
      await takeMemory("after-console-clear-and-explicit-gc");
      const prototype = await cdp.send("Runtime.evaluate", {
        expression: "window.runtimeHarness.project.constructor.prototype",
        objectGroup: "baseline-project-diagnostics",
      });
      try {
        const projects = await cdp.send("Runtime.queryObjects", {
          prototypeObjectId: prototype.result.objectId!,
          objectGroup: "baseline-project-diagnostics",
        });
        const counts = await cdp.send("Runtime.callFunctionOn", {
          objectId: projects.objects.objectId!,
          functionDeclaration:
            "function() { return this.map(project => project.documentSession.sketchbook.pages.reduce((sum, page) => sum + page.objectCount, 0)); }",
          returnByValue: true,
        });
        await writeFile(
          path.join(output, "retained-projects.json"),
          JSON.stringify(counts.result.value, null, 2),
        );
      } finally {
        await cdp.send("Runtime.releaseObjectGroup", {
          objectGroup: "baseline-project-diagnostics",
        });
      }
    }
    if (includesStage("profile")) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      await page.evaluate(() => window.baseline.runModels("stroke", 5000));
      const profile = await cdp.send("Profiler.stop");
      await writeFile(path.join(output, "stroke.cpuprofile"), JSON.stringify(profile.profile));
    }
    await writeFile(
      path.join(output, "gpu-final.json"),
      JSON.stringify(
        await app.evaluate(async ({ app }) => ({
          info: await app.getGPUInfo("basic"),
          features: app.getGPUFeatureStatus(),
        })),
        null,
        2,
      ),
    );
    await cdp.detach();
    expect(errors).toEqual([]);
    await saveResults();
  } finally {
    await app.close();
    await server.close();
  }
});

test("production startup to editor readiness", async () => {
  test.skip(process.env.FOLIO_PERFORMANCE_BASELINE !== "1", "Explicit performance mode required");
  const samples = [];
  for (let index = 0; index < 6; index++) {
    const start = performance.now();
    const app = await electron.launch({
      args: [path.resolve("apps/desktop/dist-electron/main.js")],
      executablePath: path.resolve("apps/desktop/node_modules/electron/dist/electron.exe"),
    });
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId("canvas-surface")).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      samples.push(performance.now() - start);
    } finally {
      await app.close();
    }
  }
  const output = path.resolve(
    "test-results/performance-data",
    process.env.FOLIO_BASELINE_RUN ?? "startup",
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "startup.json"),
    JSON.stringify(
      summarize("production-launch-to-surface-plus-two-raf", samples.slice(1), samples[0]),
      null,
      2,
    ),
  );
});
