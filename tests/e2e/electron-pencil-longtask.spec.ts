import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * What the one long Pencil task actually is.
 *
 * It had been attributed twice without being caught: to presentation-tile
 * creation by reasoning, then to a major collection by its signatures. This
 * catches it, and the trick is where it looks. **The block is not in the
 * stroke.** It lands 2.98 s after pointer-up, against a three-second recovery
 * debounce, so this draws first and profiles the quiet window *afterwards* --
 * where the block is the only thing happening and a whole-profile aggregate
 * names it without the profiler's clock needing to be aligned to the page's.
 *
 * What it names: `project-validation.ts`, `json.ts` and `ink-codec.ts`, with no
 * Pencil frame anywhere in it, and more than half of the window not in
 * JavaScript at all. The window-restricted aggregate is kept as well, because
 * it is what shows that -- and because it is the measurement the earlier
 * attributions needed and did not make.
 *
 * `FOLIO_LONGTASK_WARMUP` sets how much is on the page first; the capture's
 * cost is linear in the samples in the document, so an empty page barely shows
 * it. Opt in with `FOLIO_PENCIL_LONGTASK=1`; `FOLIO_LONGTASK_LABEL` names the
 * run. Written up in
 * [`../../docs/performance/pencil-e4-3.md`](../../docs/performance/pencil-e4-3.md).
 */

const OUTPUT = path.resolve("test-results/pencil-allocation-e43b");
const LABEL = process.env.FOLIO_LONGTASK_LABEL ?? "longtask";

/** Strokes drawn before the profiled window. More on the page is slower. */
const WARMUP_STROKES = Number(process.env.FOLIO_LONGTASK_WARMUP ?? "3");

interface TaskEntry {
  readonly startMs: number;
  readonly durationMs: number;
}

declare global {
  var __folioLongTasks: TaskEntry[] | undefined;
  var __folioLongTaskObserver: PerformanceObserver | undefined;
}

async function watchLongTasks(window: Page): Promise<void> {
  await window.evaluate(() => {
    globalThis.__folioLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 30) continue;
          globalThis.__folioLongTasks?.push({
            startMs: entry.startTime,
            durationMs: entry.duration,
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      globalThis.__folioLongTaskObserver = observer;
    } catch {
      // Long-task timing unavailable.
    }
  });
}

async function readLongTasks(window: Page): Promise<TaskEntry[]> {
  return window.evaluate(() => {
    globalThis.__folioLongTaskObserver?.disconnect();
    return globalThis.__folioLongTasks ?? [];
  });
}

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

interface ProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
  };
  readonly children?: readonly number[];
  readonly parent?: number;
}

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

function frameLabel(node: ProfileNode | undefined): string {
  if (node === undefined) return "(unknown)";
  const file = node.callFrame.url.replace(/^.*[\\/]/u, "");
  const name = node.callFrame.functionName === "" ? "(anonymous)" : node.callFrame.functionName;
  return file === "" ? name : `${name} @ ${file}:${String(node.callFrame.lineNumber + 1)}`;
}

/**
 * Self time by call frame inside one window of the profile's own clock.
 *
 * `profileOriginMs` maps the profile's microsecond clock onto the page's
 * `performance.now()`, so a long-task start read from a `PerformanceObserver`
 * entry and a sample timestamp are comparable.
 */
function selfTimeInWindow(
  profile: CpuProfile,
  profileOriginMs: number,
  fromMs: number,
  toMs: number,
): { readonly totals: { where: string; ms: number }[]; readonly sampledMs: number } {
  const byId = new Map<number, ProfileNode>();
  for (const node of profile.nodes) byId.set(node.id, node);
  const totals = new Map<string, number>();
  let clock = profile.startTime;
  let sampled = 0;
  for (let index = 0; index < profile.samples.length; index += 1) {
    clock += profile.timeDeltas[index] ?? 0;
    const atMs = profileOriginMs + (clock - profile.startTime) / 1000;
    if (atMs < fromMs || atMs > toMs) continue;
    const delta = (profile.timeDeltas[index] ?? 0) / 1000;
    const where = frameLabel(byId.get(profile.samples[index] ?? -1));
    totals.set(where, (totals.get(where) ?? 0) + delta);
    sampled += delta;
  }
  return {
    totals: [...totals]
      .map(([where, ms]) => ({ where, ms: Number(ms.toFixed(2)) }))
      .sort((left, right) => right.ms - left.ms),
    sampledMs: Number(sampled.toFixed(1)),
  };
}

/** The chain of callers above the heaviest frame, so the cause is nameable. */
function ancestry(profile: CpuProfile, where: string): string[] {
  const byId = new Map<number, ProfileNode>();
  const parentOf = new Map<number, number>();
  for (const node of profile.nodes) {
    byId.set(node.id, node);
    for (const child of node.children ?? []) parentOf.set(child, node.id);
  }
  let target: ProfileNode | undefined;
  for (const node of profile.nodes) {
    if (frameLabel(node) === where) {
      target = node;
      break;
    }
  }
  const chain: string[] = [];
  let cursor = target;
  while (cursor !== undefined && chain.length < 24) {
    chain.push(frameLabel(cursor));
    const parent = parentOf.get(cursor.id);
    cursor = parent === undefined ? undefined : byId.get(parent);
  }
  return chain;
}

test("catches the one long Pencil task and names the stack inside it", async () => {
  test.skip(process.env.FOLIO_PENCIL_LONGTASK !== "1", "Explicit Pencil long-task mode required");
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
      return { visible: target.isVisible(), minimized: target.isMinimized() };
    });
    expect(foreground?.visible).toBe(true);

    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    const bounds = (await inkCanvas.boundingBox())!;
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
    await setSize(26);

    // Warm the page up: the block's cost grows with what is already on it, so
    // a first stroke on an empty page barely shows it.
    for (let stroke = 0; stroke < WARMUP_STROKES; stroke += 1) {
      await drawDense(window, { x: bounds.x + 240, y: bounds.y + 180 + stroke * 90 }, 1400);
      await window.waitForTimeout(600);
    }

    const session = await window.context().newCDPSession(window);
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 100 });

    /**
     * Draw first, then profile the quiet window after pointer-up.
     *
     * Every observed block lands 2.98 s after the previous pointer-up, which is
     * `RECOVERY_DEBOUNCE_MS` to three significant figures, so the stroke is not
     * where to look. Profiling the idle settle instead puts the block in a
     * window with nothing else in it, and the whole-profile aggregate names it
     * without needing the profiler's clock aligned to the page's.
     */
    await drawDense(window, { x: bounds.x + 240, y: bounds.y + 560 }, 1400);
    await watchLongTasks(window);
    await session.send("Profiler.start");
    const profileOriginMs = await window.evaluate(() => performance.now());
    await window.waitForTimeout(7000);
    const stopped = (await session.send("Profiler.stop")) as unknown as { profile: CpuProfile };
    const tasks = await readLongTasks(window);

    const profile = stopped.profile;
    const longest = [...tasks].sort((a, b) => b.durationMs - a.durationMs)[0];
    const windows = tasks
      .filter((task) => task.durationMs >= 50)
      .map((task) => {
        const inside = selfTimeInWindow(
          profile,
          profileOriginMs,
          task.startMs,
          task.startMs + task.durationMs,
        );
        return {
          startMs: Number(task.startMs.toFixed(1)),
          atMsFromProfileStart: Number((task.startMs - profileOriginMs).toFixed(1)),
          durationMs: Number(task.durationMs.toFixed(1)),
          sampledMs: inside.sampledMs,
          top: inside.totals.slice(0, 25),
          ancestryOfTop:
            inside.totals[0] === undefined ? [] : ancestry(profile, inside.totals[0].where),
        };
      });

    const whole = selfTimeInWindow(profile, profileOriginMs, -Infinity, Infinity);

    const report = {
      label: LABEL,
      recordedAt: new Date().toISOString(),
      machine: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model },
      warmupStrokes: WARMUP_STROKES,
      profileSpanMs: Number(((profile.endTime - profile.startTime) / 1000).toFixed(1)),
      sampleCount: profile.samples.length,
      longTasks: tasks.map((task) => ({
        atMs: Number((task.startMs - profileOriginMs).toFixed(1)),
        durationMs: Number(task.durationMs.toFixed(1)),
      })),
      longestTaskMs: longest === undefined ? 0 : Number(longest.durationMs.toFixed(1)),
      windows,
      wholeProfileTop: whole.totals.slice(0, 25),
    };
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(path.join(OUTPUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
    expect(profile.samples.length).toBeGreaterThan(0);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
