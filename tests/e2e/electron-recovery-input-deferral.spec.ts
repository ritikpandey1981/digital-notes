import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { decodeFolioProject } from "../../packages/persistence/src/project/index";
import { surfaceOf } from "./layers-stack-helpers";

/**
 * Recovery must not start encoding the project while someone is drawing.
 *
 * The audit reproduced the failure this guards: a mark is finished, its capture
 * is armed three seconds out, the next mark begins inside those three seconds,
 * and the capture lands in the middle of it -- measured as 147 ms of blocked
 * renderer 1.76 s into the second stroke, and up to 692 ms on a larger project.
 *
 * The document is genuinely safe to serialize throughout: a live mark is not in
 * it. So this is not about correctness of content but about when the cost is
 * paid, and the assertions are about when a capture happens rather than about
 * what it contains.
 *
 * Two independent signals, because they can fail in different ways. The record
 * on disk says a capture completed, and when. The renderer's own long-task and
 * frame timing says whether anything held the main thread while the pointer was
 * down. The record is the primary evidence -- it names recovery specifically --
 * and the frame timing is reported alongside it so that a block is never
 * attributed to recovery without a capture to attribute it to.
 */

const RECOVERY_EXTENSION = ".folio-recovery";

interface RecoveryFile {
  readonly name: string;
  readonly bytes: number;
  readonly modifiedAtMs: number;
  readonly objectCount: number;
}

/**
 * The records as the main process left them.
 *
 * Read from the test process, which has ordinary filesystem access: the
 * renderer cannot be asked, because `contextBridge` freezes what it exposes and
 * the recovery port cannot be wrapped from the page.
 */
async function recoveryFiles(userDataDirectory: string): Promise<RecoveryFile[]> {
  const directory = path.join(userDataDirectory, "recovery");
  const entries = await readdir(directory).catch(() => [] as string[]);
  const files: RecoveryFile[] = [];
  for (const entry of entries.filter((name) => name.endsWith(RECOVERY_EXTENSION))) {
    const full = path.join(directory, entry);
    const info = await stat(full).catch(() => null);
    if (info === null || !info.isFile()) continue;
    const raw = await readFile(full, "utf8").catch(() => null);
    if (raw === null) continue;
    const record = JSON.parse(raw) as { readonly project: string };
    files.push({
      name: entry,
      bytes: info.size,
      modifiedAtMs: info.mtimeMs,
      objectCount: decodeFolioProject(record.project).sketchbook.firstPage.content.size,
    });
  }
  return files;
}

/** How many objects the newest record holds, or 0 when there is no record. */
async function recoveredObjectCount(userDataDirectory: string): Promise<number> {
  const files = await recoveryFiles(userDataDirectory);
  const newest = files.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)[0];
  return newest?.objectCount ?? 0;
}

interface Block {
  readonly atMs: number;
  readonly durationMs: number;
}

interface Probe {
  readonly frames: number;
  readonly medianGapMs: number;
  readonly p95GapMs: number;
  readonly longestGapMs: number;
  readonly longTasks: readonly Block[];
}

declare global {
  var __folioDeferralProbe:
    | {
        started: number;
        last: number;
        gaps: number[];
        probing: boolean;
        longTasks: Block[];
        observer: PerformanceObserver | null;
      }
    | undefined;
}

async function startProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    const now = performance.now();
    const probe = {
      started: now,
      last: now,
      gaps: [] as number[],
      probing: true,
      longTasks: [] as { atMs: number; durationMs: number }[],
      observer: null as PerformanceObserver | null,
    };
    globalThis.__folioDeferralProbe = probe;
    const frame = (): void => {
      const at = performance.now();
      probe.gaps.push(at - probe.last);
      probe.last = at;
      if (probe.probing) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
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
      // Long-task timing is unavailable here; frame gaps still record.
    }
  });
}

async function stopProbe(window: Page): Promise<Probe> {
  return window.evaluate(() => {
    const probe = globalThis.__folioDeferralProbe;
    if (probe === undefined) throw new Error("probe missing");
    probe.probing = false;
    probe.observer?.disconnect();
    const sorted = [...probe.gaps.slice(1)].sort((left, right) => left - right);
    const quantile = (fraction: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
    const round = (value: number): number => Number(value.toFixed(1));
    return {
      frames: probe.gaps.length,
      medianGapMs: round(quantile(0.5)),
      p95GapMs: round(quantile(0.95)),
      longestGapMs: round(sorted[sorted.length - 1] ?? 0),
      longTasks: probe.longTasks,
    };
  });
}

/** Where the probe thinks "now" is, so a scenario can timestamp its own steps. */
async function probeNow(window: Page): Promise<number> {
  return window.evaluate(() =>
    Number((performance.now() - (globalThis.__folioDeferralProbe?.started ?? 0)).toFixed(1)),
  );
}

/**
 * A capture-sized block.
 *
 * The smallest renderer block the audit ever measured for a capture was 147 ms,
 * on the smallest project it measured. Finishing a mark costs 18-43 ms in the
 * same thread, so this sits above ordinary drawing work and below anything
 * recovery has been seen to do.
 */
const CAPTURE_SIZED_MS = 120;

async function launch(userData: string) {
  return electron.launch({
    args: [
      path.join(process.cwd(), "apps/desktop/dist-electron/main.js"),
      // Recovery state belongs to the application directory, so each test gets
      // one of its own instead of writing into the developer's.
      `--user-data-dir=${userData}`,
    ],
    executablePath: path.join(
      process.cwd(),
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
}

/** Visible, focused and not minimized: a throttled window measures nothing. */
async function bringToForeground(app: Awaited<ReturnType<typeof launch>>): Promise<void> {
  const state = await app.evaluate(async ({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target === undefined) return null;
    target.show();
    target.focus();
    return { visible: target.isVisible(), minimized: target.isMinimized() };
  });
  expect(state?.visible).toBe(true);
  expect(state?.minimized).toBe(false);
}

async function selectPen(window: Page): Promise<void> {
  await window.locator('button[data-dock-slot="pen"]').click();
}

/** One quick mark, the way a person dashes something off. */
async function quickStroke(window: Page, y: number): Promise<void> {
  await window.mouse.move(620, y);
  await window.mouse.down();
  await window.mouse.move(820, y + 40, { steps: 12 });
  await window.mouse.up();
}

/**
 * One mark that takes real time to draw, in deliberate instalments.
 *
 * The point is wall-clock duration while the pointer is down, which is what a
 * recovery deadline can fall inside; the samples only have to keep arriving.
 */
async function slowStroke(window: Page, y: number, durationMs: number): Promise<void> {
  await window.mouse.move(360, y);
  await window.mouse.down();
  const steps = Math.max(2, Math.round(durationMs / 250));
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await window.mouse.move(360 + progress * 700, y + Math.sin(progress * 9) * 70, { steps: 6 });
    await window.waitForTimeout(250);
  }
  await window.mouse.up();
}

test("starts no recovery capture inside a mark that began before one was due", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(path.join(tmpdir(), "folio-recovery-deferral-"));
  const app = await launch(userData);
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await bringToForeground(app);
    const surface = surfaceOf(window);
    await expect(surface).toHaveAttribute("data-document-state", "ready");
    await selectPen(window);

    // The first mark arms recovery three seconds out.
    await quickStroke(window, 360);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    await startProbe(window);
    // Less than the debounce, so the capture for the first mark is still owed.
    await window.waitForTimeout(1_200);
    const before = await recoveryFiles(userData);
    const downAtMs = await probeNow(window);
    // Drawn straight through the moment that capture was due.
    await slowStroke(window, 520, 6_000);
    const upAtMs = await probeNow(window);
    const after = await recoveryFiles(userData);
    const probe = await stopProbe(window);

    // Nothing was written while the pointer was down. This is the assertion the
    // phase exists for: the capture was due in the middle of this mark.
    const landedDuringStroke = after.filter((file) => {
      const previous = before.find((candidate) => candidate.name === file.name);
      return previous === undefined || previous.modifiedAtMs !== file.modifiedAtMs;
    });
    expect(
      landedDuringStroke,
      `records written during the stroke: ${JSON.stringify(landedDuringStroke)}`,
    ).toEqual([]);

    // And nothing held the renderer for as long as a capture takes, either.
    const blocksInsideStroke = probe.longTasks.filter(
      (task) => task.durationMs >= CAPTURE_SIZED_MS && task.atMs >= downAtMs && task.atMs <= upAtMs,
    );
    expect(
      blocksInsideStroke,
      `blocks inside the stroke: ${JSON.stringify({ probe, downAtMs, upAtMs })}`,
    ).toEqual([]);

    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    // Held back, never dropped: once the drawing stops, recovery catches up to
    // the newest state rather than to the one it was originally waiting on.
    await expect.poll(async () => recoveredObjectCount(userData), { timeout: 30_000 }).toBe(2);
    expect(await recoveryFiles(userData)).toHaveLength(1);
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("captures a burst of quick marks once, after the drawing stops", async () => {
  test.setTimeout(180_000);
  const userData = await mkdtemp(path.join(tmpdir(), "folio-recovery-burst-"));
  const app = await launch(userData);
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await bringToForeground(app);
    const surface = surfaceOf(window);
    await expect(surface).toHaveAttribute("data-document-state", "ready");
    await selectPen(window);

    await startProbe(window);
    const burstStartedAtMs = await probeNow(window);
    for (let index = 0; index < 5; index += 1) {
      await quickStroke(window, 300 + index * 70);
      // Under the debounce, so each mark re-arms the one before it.
      await window.waitForTimeout(1_200);
    }
    const burstEndedAtMs = await probeNow(window);
    await expect(surface).toHaveAttribute("data-document-object-count", "5");
    const duringBurst = await recoveryFiles(userData);
    const probe = await stopProbe(window);

    // Quick editing already coalesced before this phase, and still does.
    expect(duringBurst, `records written during the burst: ${JSON.stringify(duringBurst)}`).toEqual(
      [],
    );
    const blocksInsideBurst = probe.longTasks.filter(
      (task) =>
        task.durationMs >= CAPTURE_SIZED_MS &&
        task.atMs >= burstStartedAtMs &&
        task.atMs <= burstEndedAtMs,
    );
    expect(blocksInsideBurst, `blocks inside the burst: ${JSON.stringify(probe)}`).toEqual([]);

    await expect.poll(async () => recoveredObjectCount(userData), { timeout: 30_000 }).toBe(5);
    // One capture of the latest state, not one per mark.
    expect(await recoveryFiles(userData)).toHaveLength(1);
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("interrupts no mark that outlasts the recovery age limit", async () => {
  test.setTimeout(300_000);
  const userData = await mkdtemp(path.join(tmpdir(), "folio-recovery-long-stroke-"));
  const app = await launch(userData);
  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await bringToForeground(app);
    const surface = surfaceOf(window);
    await expect(surface).toHaveAttribute("data-document-state", "ready");
    await selectPen(window);

    // A first mark, captured, so the age limit starts from a clean slate.
    await quickStroke(window, 300);
    await expect.poll(async () => recoveredObjectCount(userData), { timeout: 30_000 }).toBe(1);

    // A second mark leaves something owed, and the long mark begins before its
    // debounce expires. The age limit then also falls inside the long mark.
    await quickStroke(window, 380);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    await startProbe(window);
    const before = await recoveryFiles(userData);
    const downAtMs = await probeNow(window);
    await slowStroke(window, 520, 34_000);
    const upAtMs = await probeNow(window);
    const after = await recoveryFiles(userData);
    const probe = await stopProbe(window);
    expect(upAtMs - downAtMs).toBeGreaterThan(30_000);

    // The age limit is a deadline for the next safe moment, not a licence to
    // encode wherever it happens to fall.
    const landedDuringStroke = after.filter((file) => {
      const previous = before.find((candidate) => candidate.name === file.name);
      return previous === undefined || previous.modifiedAtMs !== file.modifiedAtMs;
    });
    expect(
      landedDuringStroke,
      `records written during the long stroke: ${JSON.stringify(landedDuringStroke)}`,
    ).toEqual([]);
    const blocksInsideStroke = probe.longTasks.filter(
      (task) => task.durationMs >= CAPTURE_SIZED_MS && task.atMs >= downAtMs && task.atMs <= upAtMs,
    );
    expect(
      blocksInsideStroke,
      `blocks inside the long stroke: ${JSON.stringify({ probe, downAtMs, upAtMs })}`,
    ).toEqual([]);

    await expect(surface).toHaveAttribute("data-document-object-count", "3");
    await expect.poll(async () => recoveredObjectCount(userData), { timeout: 30_000 }).toBe(3);
  } finally {
    await app.close().catch(() => undefined);
    await rm(userData, { recursive: true, force: true }).catch(() => undefined);
  }
});
