import type { ElectronApplication, Page } from "@playwright/test";
import { summarize } from "./metrics";

export async function readLiveWindowState(app: ElectronApplication, page: Page) {
  const window = await app.browserWindow(page);
  return {
    native: await window.evaluate((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused(),
      minimized: window.isMinimized(),
      alwaysOnTop: window.isAlwaysOnTop(),
      webContentsFocused: window.webContents.isFocused(),
      backgroundThrottling: window.webContents.getBackgroundThrottling(),
      bounds: window.getBounds(),
    })),
    renderer: await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      focused: document.hasFocus(),
      timestamp: performance.now(),
    })),
    display: await app.evaluate(({ screen }) => screen.getPrimaryDisplay()),
  };
}

export async function focusLiveWindow(app: ElectronApplication, page: Page) {
  const window = await app.browserWindow(page);
  await window.evaluate((window) => {
    if (window.isMinimized()) window.restore();
    window.show();
    // Only this disposable benchmark window stays above other windows during collection.
    // Keep Chromium's normal throttling policy; fix the actual visibility/focus condition.
    window.setAlwaysOnTop(true);
    window.moveTop();
    window.focus();
    window.webContents.focus();
  });
  await page.waitForFunction(() => !document.hidden && document.hasFocus(), undefined, {
    timeout: 10000,
  });
}

export async function probeLiveFrames(app: ElectronApplication, page: Page, label: string) {
  const before = await readLiveWindowState(app, page);
  const probe = await page.evaluate(
    () =>
      new Promise<{
        intervals: number[];
        states: { visibilityState: string; hidden: boolean; focused: boolean }[];
        timedOut: boolean;
      }>((resolve) => {
        const intervals: number[] = [];
        const states: { visibilityState: string; hidden: boolean; focused: boolean }[] = [];
        let previous: number | undefined;
        let frame: number;
        const finish = (timedOut: boolean) => {
          cancelAnimationFrame(frame);
          clearTimeout(timer);
          resolve({ intervals, states, timedOut });
        };
        // A hidden-window diagnostic must finish even when rAF stops entirely.
        const timer = setTimeout(() => finish(true), 12000);
        const tick = (now: number) => {
          states.push({
            visibilityState: document.visibilityState,
            hidden: document.hidden,
            focused: document.hasFocus(),
          });
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          if (intervals.length === 120) finish(false);
          else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      }),
  );
  return {
    label,
    before,
    after: await readLiveWindowState(app, page),
    ...probe,
    summary: probe.intervals.length ? summarize(label, probe.intervals) : null,
  };
}

export async function watchLiveForeground(page: Page) {
  await page.evaluate(() => {
    const changes: { type: string; at: number; hidden: boolean; focused: boolean }[] = [];
    const record = (event: Event) =>
      changes.push({
        type: event.type,
        at: performance.now(),
        hidden: document.hidden,
        focused: document.hasFocus(),
      });
    window.addEventListener("focus", record);
    window.addEventListener("blur", record);
    document.addEventListener("visibilitychange", record);
    window.stopLiveForegroundWatch = () => {
      window.removeEventListener("focus", record);
      window.removeEventListener("blur", record);
      document.removeEventListener("visibilitychange", record);
      return changes;
    };
  });
}

declare global {
  interface Window {
    stopLiveForegroundWatch: () => {
      type: string;
      at: number;
      hidden: boolean;
      focused: boolean;
    }[];
  }
}
