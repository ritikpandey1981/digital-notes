import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * Where a broad Pencil's memory goes, and whether that is what blocks.
 *
 * The mounted measurement in
 * [`../../docs/performance/pencil-e4-2.md`](../../docs/performance/pencil-e4-2.md) left one
 * finding unexplained: a single ~230 ms main-thread block, only at 26 page
 * units, once per run, that no CPU profile or timeline trace reproduces and
 * that attributes entirely to `(program)`. The signatures said major
 * collection, which is a claim about allocation, and allocation was never
 * measured.
 *
 * This measures it. Two instruments, deliberately not mixed:
 *
 * - **Timing runs** carry only the frame probe and the long-task observer, so
 *   what they report is what a person would experience.
 * - **Allocation runs** carry V8's sampling heap profiler over CDP, which
 *   attributes *allocated* bytes to the stack that asked for them. That is the
 *   strongest attribution the platform offers; it names functions rather than
 *   object classes, and this file does not pretend otherwise.
 *
 * What it found, so that the next reader starts from the answer: Pencil
 * allocates about 50 KB a second, 82% of it freezing the finished `Stroke`
 * once, nothing per-frame above the sampling floor -- and the block is the
 * recovery capture, which lands 2.98 s after the previous pointer-up and is
 * linear in the samples in the document rather than in the width of the mark.
 * Written up in [`../../docs/performance/pencil-e4-3.md`](../../docs/performance/pencil-e4-3.md).
 *
 * Opt in with `FOLIO_PENCIL_ALLOCATION=1`. `FOLIO_ALLOC_LABEL` names the run in
 * the artifact so two can sit side by side.
 */

const OUTPUT = path.resolve("test-results/pencil-allocation-e43b");
const LABEL = process.env.FOLIO_ALLOC_LABEL ?? "run";
/**
 * How long the probe keeps watching after pointer-up.
 *
 * Six seconds by default, because the recovery capture's debounce is three and
 * a settle that stops short of it leaves the capture to land in the *next*
 * stroke, where it reads as that stroke's long task -- which is exactly how it
 * was misattributed twice. Past three seconds the capture is inside the probe
 * that caused it and after the mark, so a stroke's own cost and a capture that
 * merely lands during one are told apart. Set it to 1500 to reproduce the
 * misreading.
 */
const SETTLE_MS = Number(process.env.FOLIO_ALLOC_SETTLE_MS ?? "6000");

interface FrameProbe {
  readonly frames: number;
  readonly medianGapMs: number;
  readonly p95GapMs: number;
  readonly longestGapMs: number;
  readonly longestGapAtMs: number;
  readonly longTasks: number;
  readonly longestTaskMs: number;
  /** Every task over 50 ms, with when it started, so one-offs are visible. */
  readonly tasks: readonly { readonly atMs: number; readonly durationMs: number }[];
  /** Every frame interval over one display period, worst first. */
  readonly slowFrames: readonly { readonly atMs: number; readonly gapMs: number }[];
  readonly slowFrameCount: number;
  readonly elapsedMs: number;
}

declare global {
  var __folioProbe:
    | {
        gaps: number[];
        at: number[];
        last: number;
        started: number;
        probing: boolean;
        tasks: { atMs: number; durationMs: number }[];
        taskCount: number;
        longest: number;
        observer: PerformanceObserver | null;
      }
    | undefined;
}

async function startProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    const probe = {
      gaps: [] as number[],
      at: [] as number[],
      last: performance.now(),
      started: performance.now(),
      probing: true,
      tasks: [] as { atMs: number; durationMs: number }[],
      taskCount: 0,
      longest: 0,
      observer: null as PerformanceObserver | null,
    };
    globalThis.__folioProbe = probe;
    const tick = (): void => {
      const now = performance.now();
      probe.gaps.push(now - probe.last);
      probe.at.push(probe.last - probe.started);
      probe.last = now;
      if (probe.probing) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.taskCount += 1;
          if (entry.duration > probe.longest) probe.longest = entry.duration;
          if (entry.duration >= 50) {
            probe.tasks.push({
              atMs: Number((entry.startTime - probe.started).toFixed(1)),
              durationMs: Number(entry.duration.toFixed(1)),
            });
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      probe.observer = observer;
    } catch {
      // Long-task timing is unavailable; frame gaps still record.
    }
  });
}

async function stopProbe(window: Page): Promise<FrameProbe> {
  return window.evaluate(() => {
    const probe = globalThis.__folioProbe;
    if (probe === undefined) throw new Error("probe missing");
    probe.probing = false;
    probe.observer?.disconnect();
    // The first interval is the probe starting, not a frame the stroke caused.
    const gaps = probe.gaps.slice(1);
    const sorted = [...gaps].sort((a, b) => a - b);
    const at = (fraction: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
    let longestIndex = 1;
    for (let index = 1; index < probe.gaps.length; index += 1) {
      if ((probe.gaps[index] ?? 0) > (probe.gaps[longestIndex] ?? 0)) longestIndex = index;
    }
    const round = (value: number): number => Number(value.toFixed(1));
    const slow: { atMs: number; gapMs: number }[] = [];
    for (let index = 1; index < probe.gaps.length; index += 1) {
      const gap = probe.gaps[index] ?? 0;
      if (gap < 16.67) continue;
      slow.push({
        atMs: Number((probe.at[index] ?? 0).toFixed(1)),
        gapMs: Number(gap.toFixed(1)),
      });
    }
    slow.sort((left, right) => right.gapMs - left.gapMs);
    return {
      slowFrames: slow.slice(0, 40),
      slowFrameCount: slow.length,
      frames: probe.gaps.length,
      medianGapMs: round(at(0.5)),
      p95GapMs: round(at(0.95)),
      longestGapMs: round(sorted[sorted.length - 1] ?? 0),
      longestGapAtMs: round(probe.at[longestIndex] ?? 0),
      longTasks: probe.taskCount,
      longestTaskMs: round(probe.longest),
      tasks: probe.tasks,
      elapsedMs: round(performance.now() - probe.started),
    };
  });
}

interface MaterialDiagnostics {
  readonly residentTiles: number;
  readonly materialBytes: number;
  readonly fieldTiles: number;
  readonly fieldBytes: number;
  readonly presentations: number;
  readonly presentationMs: number;
  readonly slices: number;
  readonly published: number;
}

async function diagnostics(window: Page): Promise<MaterialDiagnostics> {
  return window.locator('canvas[data-folio-layer="ink"]').evaluate((element) => {
    const data = (element as HTMLCanvasElement).dataset;
    const read = (key: string): number => Number(data[key] ?? "0");
    return {
      residentTiles: read("materialResidentTiles"),
      materialBytes: read("materialBytes"),
      fieldTiles: read("materialFieldTiles"),
      fieldBytes: read("materialFieldBytes"),
      presentations: read("materialPresentations"),
      presentationMs: read("materialPresentationMs"),
      slices: read("materialSlices"),
      published: read("materialPublished"),
    };
  });
}

/** One stroke of a given sample count through the real input path. */
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
    const next = index + batch >= samples ? samples - 1 : index + batch;
    const progress = next / samples;
    await window.mouse.move(
      origin.x + Math.sin(progress * 11) * 160 + progress * span,
      origin.y + Math.cos(progress * 7) * 110,
      { steps: batch },
    );
  }
  await window.mouse.up();
}

interface HeapUsage {
  readonly usedBytes: number;
  readonly totalBytes: number;
}

interface AllocationSite {
  readonly bytes: number;
  readonly where: string;
}

/** Aggregates a sampling profile's self-size by call frame, largest first. */
interface SamplingNode {
  readonly callFrame?: {
    readonly functionName?: string;
    readonly url?: string;
    readonly lineNumber?: number;
  };
  readonly selfSize?: number;
  readonly children?: readonly SamplingNode[];
}

function walkSamplingNode(node: SamplingNode, into: Map<string, number>): void {
  const frame = node.callFrame;
  const url = frame?.url ?? "";
  const file = url === "" ? "(native)" : url.replace(/^.*[\\/]/u, "");
  const raw = frame?.functionName ?? "";
  const name = raw === "" ? "(anonymous)" : raw;
  const line = (frame?.lineNumber ?? -1) + 1;
  const where = `${name} @ ${file}:${String(line)}`;
  const self = node.selfSize ?? 0;
  if (self > 0) into.set(where, (into.get(where) ?? 0) + self);
  for (const child of node.children ?? []) walkSamplingNode(child, into);
}

function allocationSites(root: SamplingNode): AllocationSite[] {
  const into = new Map<string, number>();
  walkSamplingNode(root, into);
  return [...into]
    .map(([where, bytes]) => ({ where, bytes }))
    .sort((left, right) => right.bytes - left.bytes);
}

test("profiles broad Pencil allocation and the long task it is blamed for", async () => {
  test.skip(
    process.env.FOLIO_PENCIL_ALLOCATION !== "1",
    "Explicit Pencil allocation mode required",
  );
  test.setTimeout(1_800_000);
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

    const session = await window.context().newCDPSession(window);
    await session.send("HeapProfiler.enable");
    const heap = async (): Promise<HeapUsage> => {
      const usage = (await session.send("Runtime.getHeapUsage")) as unknown as {
        usedSize: number;
        totalSize: number;
      };
      return { usedBytes: usage.usedSize, totalBytes: usage.totalSize };
    };
    const collect = async (): Promise<void> => {
      await session.send("HeapProfiler.collectGarbage");
    };

    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    const bounds = (await inkCanvas.boundingBox())!;
    /**
     * Sets the Pencil's width through the control a person uses.
     *
     * The previous mounted spec set it through a `window.__folioDrawingActions`
     * hook that **does not exist** -- optional-chained, so every call was a
     * silent no-op and every "12 px" and "26 px" workload was drawn at the
     * preset's own 2 page units. The slider is real and its range is 0.5 to 40,
     * so 26 is reachable; the value is read back rather than assumed, because
     * that is the mistake this is correcting.
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

    await collect();
    const idleHeap = await heap();

    const workloads = [
      { name: "ordinary", samples: 220, size: 2, profiled: false },
      { name: "dense-12pu", samples: 5000, size: 12, profiled: false },
      { name: "dense-26pu-timing-1", samples: 5000, size: 26, profiled: false },
      { name: "dense-26pu-timing-2", samples: 5000, size: 26, profiled: false },
      { name: "dense-26pu-timing-3", samples: 5000, size: 26, profiled: false },
      { name: "dense-26pu-profiled", samples: 5000, size: 26, profiled: true },
      { name: "dense-12pu-profiled", samples: 5000, size: 12, profiled: true },
    ] as const;

    const runs: Record<string, unknown>[] = [];
    let objects = 0;
    for (const workload of workloads) {
      await setSize(workload.size);
      const origin = {
        x: bounds.x + 240,
        y: bounds.y + 180 + (objects % 6) * 90,
      };
      await collect();
      const heapBefore = await heap();
      const before = await diagnostics(window);
      if (workload.profiled) {
        await session.send("HeapProfiler.startSampling", { samplingInterval: 4096 });
      }
      await startProbe(window);
      await drawDense(window, origin, workload.samples);
      const pointerUpAtMs = await window.evaluate(
        () => performance.now() - (globalThis.__folioProbe?.started ?? 0),
      );
      await window.waitForTimeout(SETTLE_MS);
      const probe = await stopProbe(window);
      const heapAfterDraw = await heap();
      let sites: AllocationSite[] = [];
      let sampledBytes = 0;
      if (workload.profiled) {
        const result = (await session.send("HeapProfiler.stopSampling")) as unknown as {
          profile: { head: SamplingNode };
        };
        sites = allocationSites(result.profile.head);
        for (const site of sites) sampledBytes += site.bytes;
      }
      objects += 1;
      await expect(surface).toHaveAttribute("data-document-object-count", String(objects));
      const after = await diagnostics(window);
      await collect();
      const heapAfterGc = await heap();
      runs.push({
        workload: workload.name,
        samples: workload.samples,
        sizePageUnits: workload.size,
        profiled: workload.profiled,
        ...probe,
        pointerUpAtMs: Number(pointerUpAtMs.toFixed(1)),
        heapBeforeBytes: heapBefore.usedBytes,
        heapAfterDrawBytes: heapAfterDraw.usedBytes,
        heapAfterGcBytes: heapAfterGc.usedBytes,
        heapTotalAfterDrawBytes: heapAfterDraw.totalBytes,
        residentTiles: after.residentTiles,
        materialBytes: after.materialBytes,
        tilesReached: after.residentTiles - before.residentTiles,
        fieldTiles: after.fieldTiles,
        fieldBytes: after.fieldBytes,
        presentationsBuilt: after.presentations - before.presentations,
        slices: after.slices - before.slices,
        sampledAllocationBytes: sampledBytes,
        topAllocationSites: sites.slice(0, 30),
      });
    }

    await collect();
    const settledHeap = await heap();

    const report = {
      label: LABEL,
      settleMs: SETTLE_MS,
      recordedAt: new Date().toISOString(),
      machine: {
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
      },
      foreground,
      idleHeapBytes: idleHeap.usedBytes,
      settledHeapBytes: settledHeap.usedBytes,
      runs,
    };
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(path.join(OUTPUT, `${LABEL}.json`), JSON.stringify(report, null, 2));

    // A measurement, not a threshold: the only assertion is that it ran.
    expect(runs.length).toBe(workloads.length);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
