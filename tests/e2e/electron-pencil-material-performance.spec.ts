import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * Hybrid Pencil measured in the mounted editor.
 *
 * Microbenchmarks settled that the material can be deposited and rebuilt inside
 * a frame budget. What only the running application can settle is whether it
 * still fits once a real compositor, a real React tree and a real input path
 * are in front of it.
 *
 * What is measured is the main thread, from inside the page: how long the
 * longest gap between animation frames is while a stroke is being drawn, and
 * how long the reconstruction slices are. Neither is pen-to-screen latency, and
 * neither is claimed to be -- a frame gap is main-thread scheduling, and the
 * compositor and the display are downstream of it.
 *
 * The long task this records is **not Pencil's.** It is the recovery capture,
 * firing three seconds after pointer-up, and `taskStartsMs` against
 * `pointerUpAtMs` is what says so. See `../../docs/performance/pencil-e4-3.md`.
 *
 * Opt in with `FOLIO_PENCIL_PERFORMANCE=1`; it is skipped in the ordinary suite
 * because it is a measurement rather than an assertion about correctness.
 */

const OUTPUT = path.resolve("test-results/pencil-material-e42b");

interface FrameProbe {
  readonly frames: number;
  readonly longestGapMs: number;
  readonly p95GapMs: number;
  readonly medianGapMs: number;
  readonly elapsedMs: number;
  /** Where the longest gap started, measured from the probe's own start. */
  readonly longestGapAtMs: number;
  /**
   * The longest main-thread task, which is what actually blocks the UI.
   *
   * A frame gap and a long task are different measurements and the difference
   * matters: rAF is driven by the compositor, so a gap can open because the GPU
   * process is busy while the main thread sits idle. Only a long task means
   * JavaScript held the thread.
   */
  readonly longestTaskMs: number;
  readonly longTasks: number;
  /** When each task over 50 ms began, measured from the probe's own start. */
  readonly taskStartsMs: readonly number[];
  readonly taskDurationsMs: readonly number[];
}

/** Records the gaps between animation frames while `body` runs. */
async function withFrameProbe<T>(window: Page, body: () => Promise<T>): Promise<[T, FrameProbe]> {
  await window.evaluate(() => {
    const probe = {
      gaps: [] as number[],
      at: [] as number[],
      last: performance.now(),
      started: performance.now(),
    };
    (window as unknown as { __folioFrameProbe: typeof probe }).__folioFrameProbe = probe;
    const tick = (): void => {
      const now = performance.now();
      probe.gaps.push(now - probe.last);
      probe.at.push(probe.last - probe.started);
      probe.last = now;
      if ((window as unknown as { __folioProbing?: boolean }).__folioProbing === true) {
        requestAnimationFrame(tick);
      }
    };
    (window as unknown as { __folioProbing: boolean }).__folioProbing = true;
    requestAnimationFrame(tick);
    const tasks = { longest: 0, count: 0, starts: [] as number[], durations: [] as number[] };
    (window as unknown as { __folioTasks: typeof tasks }).__folioTasks = tasks;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        tasks.count += 1;
        if (entry.duration > tasks.longest) tasks.longest = entry.duration;
        if (entry.duration >= 50) {
          tasks.starts.push(Number((entry.startTime - probe.started).toFixed(1)));
          tasks.durations.push(Number(entry.duration.toFixed(1)));
        }
      }
    });
    try {
      observer.observe({ entryTypes: ["longtask"] });
      (window as unknown as { __folioTaskObserver: PerformanceObserver }).__folioTaskObserver =
        observer;
    } catch {
      // Long-task timing is unavailable; the frame gaps still record.
    }
  });
  const value = await body();
  const probe = await window.evaluate(() => {
    (window as unknown as { __folioProbing: boolean }).__folioProbing = false;
    const state = (
      window as unknown as { __folioFrameProbe: { gaps: number[]; at: number[]; started: number } }
    ).__folioFrameProbe;
    let longestIndex = 1;
    for (let index = 1; index < state.gaps.length; index += 1) {
      if ((state.gaps[index] ?? 0) > (state.gaps[longestIndex] ?? 0)) longestIndex = index;
    }
    const gaps = [...state.gaps].slice(1).sort((a, b) => a - b);
    const at = (fraction: number): number =>
      gaps.length === 0
        ? 0
        : (gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * fraction))] ?? 0);
    return {
      frames: state.gaps.length,
      longestGapMs: gaps.length === 0 ? 0 : (gaps[gaps.length - 1] ?? 0),
      p95GapMs: at(0.95),
      medianGapMs: at(0.5),
      elapsedMs: performance.now() - state.started,
      longestGapAtMs: state.at[longestIndex] ?? 0,
      longestTaskMs: Number(
        (
          (window as unknown as { __folioTasks?: { longest: number } }).__folioTasks?.longest ?? 0
        ).toFixed(1),
      ),
      longTasks:
        (window as unknown as { __folioTasks?: { count: number } }).__folioTasks?.count ?? 0,
      taskStartsMs:
        (window as unknown as { __folioTasks?: { starts: number[] } }).__folioTasks?.starts ?? [],
      taskDurationsMs:
        (window as unknown as { __folioTasks?: { durations: number[] } }).__folioTasks?.durations ??
        [],
    };
  });
  await window.evaluate(() => {
    (
      window as unknown as { __folioTaskObserver?: PerformanceObserver }
    ).__folioTaskObserver?.disconnect();
  });
  return [value, probe];
}

interface MaterialDiagnostics {
  readonly residentTiles: number;
  readonly materialBytes: number;
  readonly indexBytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly slices: number;
  readonly longestSliceMs: number;
  readonly published: number;
  readonly cancelled: number;
  readonly presentations: number;
  readonly presentationMs: number;
  readonly longestPresentationMs: number;
  readonly geometryBuilds: number;
  readonly geometryDabs: number;
  readonly geometryMs: number;
  readonly longestGeometryMs: number;
}

async function materialDiagnostics(window: Page): Promise<MaterialDiagnostics> {
  return window.locator('canvas[data-folio-layer="ink"]').evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    const read = (key: string): number => Number(data[key] ?? "0");
    return {
      residentTiles: read("materialResidentTiles"),
      materialBytes: read("materialBytes"),
      indexBytes: read("materialIndexBytes"),
      hits: read("materialHits"),
      misses: read("materialMisses"),
      evictions: read("materialEvictions"),
      slices: read("materialSlices"),
      longestSliceMs: read("materialLongestSlice"),
      published: read("materialPublished"),
      cancelled: read("materialCancelled"),
      presentations: read("materialPresentations"),
      presentationMs: read("materialPresentationMs"),
      longestPresentationMs: read("materialLongestPresentation"),
      geometryBuilds: read("materialGeometryBuilds"),
      geometryDabs: read("materialGeometryDabs"),
      geometryMs: read("materialGeometryMs"),
      longestGeometryMs: read("materialLongestGeometry"),
    };
  });
}

/** Drives one stroke of a given sample count through the real input path. */
async function drawDense(
  window: Page,
  origin: Readonly<{ x: number; y: number }>,
  samples: number,
): Promise<void> {
  await window.mouse.move(origin.x, origin.y);
  await window.mouse.down();
  const span = 520;
  const batch = 40;
  for (let index = 0; index < samples; index += batch) {
    const progress = index / samples;
    const next = index + batch >= samples ? samples - 1 : index + batch;
    const nextProgress = next / samples;
    void progress;
    await window.mouse.move(
      origin.x + Math.sin(nextProgress * 11) * 160 + nextProgress * span,
      origin.y + Math.cos(nextProgress * 7) * 110,
      { steps: batch },
    );
  }
  await window.mouse.up();
}

test("measures mounted hybrid Pencil", async () => {
  test.skip(
    process.env.FOLIO_PENCIL_PERFORMANCE !== "1",
    "Explicit Pencil performance mode required",
  );
  test.setTimeout(900_000);
  const electronApp = await electron.launch({
    args: [path.join(process.cwd(), "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      process.cwd(),
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
  try {
    const window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });

    // The window must really be in the foreground: a throttled or hidden window
    // measures the throttling rather than the work.
    const foreground = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (target === undefined) return null;
      target.show();
      target.focus();
      return {
        visible: target.isVisible(),
        minimized: target.isMinimized(),
        focused: target.isFocused(),
      };
    });
    expect(foreground?.visible).toBe(true);
    expect(foreground?.minimized).toBe(false);

    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    const bounds = (await inkCanvas.boundingBox())!;
    const runs: Record<string, unknown>[] = [];

    /**
     * Sets the Pencil's width through the control a person uses.
     *
     * This replaces a `window.__folioDrawingActions` hook that **never
     * existed**. It was optional-chained, so every call was a silent no-op and
     * the "12 px" and "26 px" workloads were both drawn at the preset's own 2
     * page units -- which is why their numbers differed only by how much was
     * already on the page. The value is read back rather than assumed.
     */
    const rail = window.getByTestId("drawing-property-rail");
    const palette = window.getByTestId("context-tool-palette");
    const setSize = async (size: number): Promise<void> => {
      await openSlotToolOptions(window, "pencil");
      const field = palette.getByLabel("Size value");
      await field.fill(String(size));
      await field.press("Enter");
      await window.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);
      await expect(rail.locator('button[data-property-key="strokeWidth"]')).toHaveAttribute(
        "data-property-value",
        String(size),
      );
    };

    const workloads = [
      { name: "ordinary", samples: 220, size: 2 },
      { name: "dense-12pu", samples: 5000, size: 12 },
      { name: "dense-26pu", samples: 5000, size: 26 },
    ] as const;

    let objects = 0;
    for (const workload of workloads) {
      await setSize(workload.size);
      const origin = { x: bounds.x + 260, y: bounds.y + 260 + runs.length * 60 };
      const before = await materialDiagnostics(window);
      let pointerUpAtMs = 0;
      const [, probe] = await withFrameProbe(window, async () => {
        await drawDense(window, origin, workload.samples);
        pointerUpAtMs = await window.evaluate(() => {
          const state = (window as unknown as { __folioFrameProbe: { started: number } })
            .__folioFrameProbe;
          return performance.now() - state.started;
        });
        /**
         * Settle past the recovery capture, not before it.
         *
         * `RECOVERY_DEBOUNCE_MS` is three seconds, and a 1500 ms settle used to
         * stop short of it -- so the capture landed about a second into the
         * *next* workload's stroke and was read as that stroke's long task.
         * Waiting past it keeps the capture in the probe that caused it, where
         * `taskStartsMs` against `pointerUpAtMs` names it for what it is.
         */
        await window.waitForTimeout(6000);
      });
      objects += 1;
      await expect(surface).toHaveAttribute("data-document-object-count", String(objects));
      const after = await materialDiagnostics(window);
      runs.push({
        workload: workload.name,
        samples: workload.samples,
        ...probe,
        pointerUpAtMs: Number(pointerUpAtMs.toFixed(1)),
        presentationsBuilt: after.presentations - before.presentations,
        presentationMs: Number((after.presentationMs - before.presentationMs).toFixed(2)),
        longestPresentationMs: after.longestPresentationMs,
        geometryBuilds: after.geometryBuilds - before.geometryBuilds,
        geometryDabs: after.geometryDabs - before.geometryDabs,
        geometryMs: Number((after.geometryMs - before.geometryMs).toFixed(2)),
        longestGeometryMs: after.longestGeometryMs,
        residentTiles: after.residentTiles,
        materialBytes: after.materialBytes,
      });
    }

    // Hot: everything just drawn is resident, so a forced repaint reconstructs
    // nothing at all.
    const beforeHot = await materialDiagnostics(window);
    const [, hotProbe] = await withFrameProbe(window, async () => {
      await window.evaluate((): void => {
        globalThis.dispatchEvent(new Event("resize"));
      });
      await window.waitForTimeout(600);
    });
    const afterHot = await materialDiagnostics(window);
    runs.push({
      workload: "hot-repaint",
      ...hotProbe,
      reconstructed: afterHot.published - beforeHot.published,
      slices: afterHot.slices - beforeHot.slices,
    });

    // Cold: undo and redo every mark, which puts the compositor through the
    // full request path again.
    const [, coldProbe] = await withFrameProbe(window, async () => {
      for (let step = 0; step < objects; step += 1) await window.keyboard.press("Control+z");
      for (let step = 0; step < objects; step += 1) await window.keyboard.press("Control+y");
      await window.waitForTimeout(1200);
    });
    const afterCold = await materialDiagnostics(window);
    runs.push({
      workload: "undo-redo",
      ...coldProbe,
      reconstructed: afterCold.published - afterHot.published,
      slices: afterCold.slices - afterHot.slices,
      longestSliceMs: afterCold.longestSliceMs,
    });

    const report = {
      recordedAt: new Date().toISOString(),
      machine: {
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
      },
      foreground,
      runs,
      finalDiagnostics: afterCold,
    };
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(path.join(OUTPUT, "mounted.json"), JSON.stringify(report, null, 2));

    // Not a threshold on the material: a bound on the thing a person feels.
    expect(afterCold.longestSliceMs).toBeLessThan(40);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
