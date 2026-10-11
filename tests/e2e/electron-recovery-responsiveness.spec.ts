import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * What the recovery capture does to a drawing that is still happening.
 *
 * E4.3B established that the long foreground task is the recovery capture,
 * firing three seconds after the previous pointer-up. This reproduces the
 * user-facing failure it causes: finish a mark, start another within three
 * seconds, and the capture for the first one lands inside the second.
 *
 * It watches the main thread two ways, because they answer different
 * questions. A `longtask` entry says JavaScript held the thread. A `setTimeout`
 * heartbeat says how long the thread was unavailable to anything at all,
 * including work that is not JavaScript -- and more than half of a capture is
 * not.
 *
 * What it cannot do from the page is see the capture itself. Wrapping
 * `window.folio.recovery.store` was tried and does not install:
 * `contextBridge` freezes what it exposes, so the assignment is silently
 * ignored. The record is therefore read from the main process, where the file
 * is -- its size is the payload, and its modification time against the
 * renderer's block is how long the write took after the encode finished.
 *
 * This is the only instrument that measures the real mounted block, and it is
 * the one behind the mounted tables in `recovery-r1.md`, `recovery-r2.md` and
 * `recovery-r3.md`: the same four scenarios, matched by payload, across three
 * phases. It is kept for the next phase that claims to have made a capture
 * cheaper, and it asserts no wall-clock budget -- only that the window really
 * was in the foreground, that the size it drew at is the size it asked for, and
 * that all four scenarios produced a record. The numbers are the artifact.
 *
 * Opt in with `FOLIO_RECOVERY_RESPONSIVENESS=1`; `FOLIO_RECOVERY_LABEL` names
 * the run. Artifacts land in `test-results/recovery-responsiveness/`, which is
 * gitignored. Three runs per claim: one capture of a twenty-six-megabyte
 * document is not a measurement.
 */

const OUTPUT = path.resolve("test-results/recovery-responsiveness");
const LABEL = process.env.FOLIO_RECOVERY_LABEL ?? "foreground";

interface Block {
  readonly atMs: number;
  readonly durationMs: number;
}

interface Probe {
  readonly frames: number;
  readonly medianGapMs: number;
  readonly p95GapMs: number;
  readonly longestGapMs: number;
  readonly longestGapAtMs: number;
  readonly longTasks: readonly Block[];
  /** Heartbeat stalls: how long the thread was unavailable, JavaScript or not. */
  readonly stalls: readonly Block[];
  readonly elapsedMs: number;
}

declare global {
  var __folioRecoveryProbe:
    | {
        started: number;
        last: number;
        gaps: number[];
        at: number[];
        probing: boolean;
        longTasks: Block[];
        stalls: Block[];
        observer: PerformanceObserver | null;
        heartbeatLast: number;
      }
    | undefined;
}

async function startProbe(window: Page): Promise<number> {
  await window.evaluate(() => {
    const now = performance.now();
    const probe = {
      started: now,
      last: now,
      gaps: [] as number[],
      at: [] as number[],
      probing: true,
      longTasks: [] as { atMs: number; durationMs: number }[],
      stalls: [] as { atMs: number; durationMs: number }[],
      captures: [] as {
        calledAtMs: number;
        settledAtMs: number;
        payloadChars: number;
        status: string;
      }[],
      observer: null as PerformanceObserver | null,
      heartbeatLast: now,
    };
    globalThis.__folioRecoveryProbe = probe;

    const frame = (): void => {
      const at = performance.now();
      probe.gaps.push(at - probe.last);
      probe.at.push(probe.last - probe.started);
      probe.last = at;
      if (probe.probing) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // A zero-delay timer should land every few milliseconds. However long it
    // actually took is how long nothing else could run.
    const heartbeat = (): void => {
      const at = performance.now();
      const stall = at - probe.heartbeatLast;
      if (stall >= 16.67) {
        probe.stalls.push({
          atMs: Number((probe.heartbeatLast - probe.started).toFixed(1)),
          durationMs: Number(stall.toFixed(1)),
        });
      }
      probe.heartbeatLast = at;
      if (probe.probing) setTimeout(heartbeat, 0);
    };
    setTimeout(heartbeat, 0);

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 16.67) continue;
          probe.longTasks.push({
            atMs: Number((entry.startTime - probe.started).toFixed(1)),
            durationMs: Number(entry.duration.toFixed(1)),
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      probe.observer = observer;
    } catch {
      // Long-task timing unavailable; the heartbeat still records.
    }
  });
  return Date.now();
}

async function stopProbe(window: Page): Promise<Probe> {
  return window.evaluate(() => {
    const probe = globalThis.__folioRecoveryProbe;
    if (probe === undefined) throw new Error("probe missing");
    probe.probing = false;
    probe.observer?.disconnect();
    const gaps = probe.gaps.slice(1);
    const sorted = [...gaps].sort((left, right) => left - right);
    const at = (fraction: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
    let worst = 1;
    for (let index = 1; index < probe.gaps.length; index += 1) {
      if ((probe.gaps[index] ?? 0) > (probe.gaps[worst] ?? 0)) worst = index;
    }
    const round = (value: number): number => Number(value.toFixed(1));
    return {
      frames: probe.gaps.length,
      medianGapMs: round(at(0.5)),
      p95GapMs: round(at(0.95)),
      longestGapMs: round(sorted[sorted.length - 1] ?? 0),
      longestGapAtMs: round(probe.at[worst] ?? 0),
      longTasks: probe.longTasks,
      stalls: probe.stalls,
      elapsedMs: round(performance.now() - probe.started),
    };
  });
}

/** Where the probe thinks "now" is, so a scenario can timestamp its own steps. */
async function probeNow(window: Page): Promise<number> {
  return window.evaluate(() =>
    Number((performance.now() - (globalThis.__folioRecoveryProbe?.started ?? 0)).toFixed(1)),
  );
}

async function drawStroke(
  window: Page,
  origin: Readonly<{ x: number; y: number }>,
  samples: number,
): Promise<void> {
  await window.mouse.move(origin.x, origin.y);
  await window.mouse.down();
  const batch = 40;
  for (let index = 0; index < samples; index += batch) {
    const next = index + batch >= samples ? samples - 1 : index + batch;
    const progress = next / samples;
    await window.mouse.move(
      origin.x + Math.sin(progress * 11) * 150 + progress * 480,
      origin.y + Math.cos(progress * 7) * 100,
      { steps: batch },
    );
  }
  await window.mouse.up();
}

test("shows what a recovery capture does to a drawing in progress", async () => {
  test.skip(
    process.env.FOLIO_RECOVERY_RESPONSIVENESS !== "1",
    "Explicit recovery responsiveness mode required",
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
      return { visible: target.isVisible(), minimized: target.isMinimized() };
    });
    expect(foreground?.visible).toBe(true);

    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    await activateDockSlot(window, "pencil");
    const bounds = (await inkCanvas.boundingBox())!;
    const rail = window.getByTestId("drawing-property-rail");
    const palette = window.getByTestId("context-tool-palette");
    await openSlotToolOptions(window, "pencil");
    const sizeField = palette.getByLabel("Size value");
    await sizeField.fill("12");
    await sizeField.press("Enter");
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(rail.locator('button[data-property-key="strokeWidth"]')).toHaveAttribute(
      "data-property-value",
      "12",
    );

    /**
     * The recovery records as the main process sees them.
     *
     * Size is the payload the renderer produced; modification time against the
     * renderer's block is the write latency that followed the encode.
     */
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath("userData"));
    const recoveryDirectory = path.join(userDataPath, "recovery");
    const records = async (): Promise<
      { readonly name: string; readonly bytes: number; readonly modifiedAt: number }[]
    > => {
      // Read from the test process, which has ordinary filesystem access. The
      // Electron main context is a module scope with neither `require` nor a
      // dynamic-import callback, so it can only be asked for the path.
      try {
        const entries = await readdir(recoveryDirectory);
        const rows: { name: string; bytes: number; modifiedAt: number }[] = [];
        for (const entry of entries) {
          const info = await stat(path.join(recoveryDirectory, entry));
          if (!info.isFile()) continue;
          rows.push({ name: entry, bytes: info.size, modifiedAt: info.mtimeMs });
        }
        return rows;
      } catch {
        return [];
      }
    };

    /**
     * Every completed capture, found by watching the records change.
     *
     * The renderer cannot be asked: `contextBridge` freezes what it exposes, so
     * the store cannot be wrapped from the page. Polling the directory from the
     * test process costs the application nothing and answers the only question
     * that matters -- when a capture actually landed, which tells a capture that
     * ran during a stroke from one that waited for it to finish.
     */
    interface Landing {
      readonly atMs: number;
      readonly bytes: number;
    }
    const watchRecords = (epochAtProbeStart: number): { stop: () => Landing[] } => {
      const seen = new Map<string, number>();
      const landings: Landing[] = [];
      let running = true;
      const tick = async (): Promise<void> => {
        while (running) {
          for (const record of await records()) {
            if (seen.get(record.name) === record.modifiedAt) continue;
            seen.set(record.name, record.modifiedAt);
            landings.push({
              atMs: Number((record.modifiedAt - epochAtProbeStart).toFixed(1)),
              bytes: record.bytes,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      };
      void tick();
      return {
        stop: () => {
          running = false;
          return landings;
        },
      };
    };

    const scenarios: Record<string, unknown>[] = [];
    const at = (index: number): { x: number; y: number } => ({
      x: bounds.x + 220,
      y: bounds.y + 150 + (index % 6) * 95,
    });
    let drawn = 0;

    /**
     * Scenario 1 -- the collision.
     *
     * Finish one mark, wait less than the three-second debounce, then start
     * another. The capture for the first lands inside the second.
     */
    const collisionEpoch = await startProbe(window);
    const collisionWatch = watchRecords(collisionEpoch);
    await drawStroke(window, at(drawn), 3000);
    drawn += 1;
    const firstUpAtMs = await probeNow(window);
    await window.waitForTimeout(1200);
    const secondDownAtMs = await probeNow(window);
    await drawStroke(window, at(drawn), 3000);
    drawn += 1;
    const secondUpAtMs = await probeNow(window);
    await window.waitForTimeout(6000);
    const collision = await stopProbe(window);
    const collisionLandings = collisionWatch.stop();
    scenarios.push({
      scenario: "collision",
      records: await records(),
      landings: collisionLandings,
      firstUpAtMs,
      secondDownAtMs,
      secondUpAtMs,
      ...collision,
      blocksInsideSecondStroke: collision.stalls.filter(
        (stall) => stall.atMs >= secondDownAtMs && stall.atMs <= secondUpAtMs,
      ),
      longTasksInsideSecondStroke: collision.longTasks.filter(
        (task) => task.atMs >= secondDownAtMs && task.atMs <= secondUpAtMs,
      ),
    });

    /**
     * Scenario 2 -- one continuous stroke past the maximum age.
     *
     * The document gains nothing while a stroke is in progress, so the question
     * is whether anything fires inside it once the debounce from the previous
     * mark has already been served.
     */
    const continuousEpoch = await startProbe(window);
    const continuousWatch = watchRecords(continuousEpoch);
    const longDownAtMs = await probeNow(window);
    await drawStroke(window, at(drawn), 9000);
    drawn += 1;
    const longUpAtMs = await probeNow(window);
    await window.waitForTimeout(6000);
    const continuous = await stopProbe(window);
    const continuousLandings = continuousWatch.stop();
    scenarios.push({
      scenario: "continuous-stroke",
      records: await records(),
      landings: continuousLandings,
      downAtMs: longDownAtMs,
      upAtMs: longUpAtMs,
      strokeDurationMs: Number((longUpAtMs - longDownAtMs).toFixed(1)),
      ...continuous,
      blocksInsideStroke: continuous.stalls.filter(
        (stall) => stall.atMs >= longDownAtMs && stall.atMs <= longUpAtMs,
      ),
      longTasksInsideStroke: continuous.longTasks.filter(
        (task) => task.atMs >= longDownAtMs && task.atMs <= longUpAtMs,
      ),
    });

    /**
     * Scenario 3 -- rapid short marks.
     *
     * Every mark is real committed content, which is the case where deferring a
     * capture really does postpone something recoverable.
     */
    const burstEpoch = await startProbe(window);
    const burstWatch = watchRecords(burstEpoch);
    const burstStartedAtMs = await probeNow(window);
    for (let stroke = 0; stroke < 8; stroke += 1) {
      await drawStroke(window, at(drawn), 120);
      drawn += 1;
      await window.waitForTimeout(250);
    }
    const burstEndedAtMs = await probeNow(window);
    await window.waitForTimeout(7000);
    const burst = await stopProbe(window);
    const burstLandings = burstWatch.stop();
    scenarios.push({
      scenario: "rapid-strokes",
      records: await records(),
      landings: burstLandings,
      burstStartedAtMs,
      burstEndedAtMs,
      ...burst,
      blocksInsideBurst: burst.stalls.filter(
        (stall) => stall.atMs >= burstStartedAtMs && stall.atMs <= burstEndedAtMs,
      ),
    });

    /**
     * Scenario 4 -- idle freshness on a document that is now large.
     *
     * Nothing is drawn; the capture from the burst has already landed, so this
     * draws one more mark and measures pointer-up to stored.
     */
    const idleEpoch = await startProbe(window);
    const idleWatch = watchRecords(idleEpoch);
    await drawStroke(window, at(drawn), 3000);
    drawn += 1;
    const idleUpAtMs = await probeNow(window);
    await window.waitForTimeout(9000);
    const idle = await stopProbe(window);
    const idleLandings = idleWatch.stop();
    const stored = await records();
    const block = idle.longTasks[idle.longTasks.length - 1];
    scenarios.push({
      scenario: "idle-freshness",
      upAtMs: idleUpAtMs,
      landings: idleLandings,
      ...idle,
      records: stored,
      payloadMb: stored[0] === undefined ? null : Number((stored[0].bytes / 1048576).toFixed(2)),
      // The renderer block begins at the debounce and is the encode; everything
      // after it is the write, and the write does not block drawing.
      blockStartedAfterPointerUpMs:
        block === undefined ? null : Number((block.atMs - idleUpAtMs).toFixed(1)),
      blockDurationMs: block?.durationMs ?? null,
    });

    const report = {
      label: LABEL,
      recordedAt: new Date().toISOString(),
      machine: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model },
      foreground,
      strokesDrawn: drawn,
      scenarios,
    };
    await mkdir(OUTPUT, { recursive: true });
    await writeFile(path.join(OUTPUT, `${LABEL}.json`), `${JSON.stringify(report, null, 2)}\n`);
    expect(scenarios.length).toBe(4);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});
