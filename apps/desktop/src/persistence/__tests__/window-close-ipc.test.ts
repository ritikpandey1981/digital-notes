import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createWindowCloseCoordinator,
  type CloseProtectedWindow,
} from "../../../electron/window-close-ipc";
import {
  WINDOW_CLOSE_REQUEST_CHANNEL,
  isWindowCloseDecision,
} from "../../../electron/window-close-contract";

function createWindow() {
  const listeners = { close: [] as ((event: { preventDefault: () => void }) => void)[] };
  const rendererGone: (() => void)[] = [];
  const sent: number[] = [];
  let destroyed = false;
  let closedTimes = 0;
  const window: CloseProtectedWindow = {
    isDestroyed: () => destroyed,
    close: () => {
      closedTimes += 1;
      // Electron re-emits close when close() is called again; mirror that here or
      // a coordinator that asked twice would look correct.
      for (const listener of listeners.close) listener({ preventDefault: () => (prevented += 1) });
    },
    on: (_event, listener) => listeners.close.push(listener),
    webContents: {
      send: (channel, ...args) => {
        expect(channel).toBe(WINDOW_CLOSE_REQUEST_CHANNEL);
        sent.push(args[0] as number);
      },
      isDestroyed: () => destroyed,
      on: (_event, listener) => rendererGone.push(listener),
    },
  };
  let prevented = 0;
  return {
    window,
    sent,
    closedTimes: () => closedTimes,
    prevented: () => prevented,
    requestClose: () => {
      for (const listener of [...listeners.close])
        listener({ preventDefault: () => (prevented += 1) });
    },
    rendererGone: () => {
      for (const listener of rendererGone) listener();
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

describe("window close handshake", () => {
  it("holds the first close open and asks the renderer exactly once", () => {
    const harness = createWindow();
    const coordinator = createWindowCloseCoordinator(harness.window);

    harness.requestClose();
    expect(harness.prevented()).toBe(1);
    expect(harness.sent).toEqual([1]);
    expect(coordinator.pendingRequestId()).toBe(1);

    // Repeated close attempts while the user is deciding must not stack dialogs.
    harness.requestClose();
    harness.requestClose();
    expect(harness.sent).toEqual([1]);
    expect(harness.prevented()).toBe(3);
    expect(harness.closedTimes()).toBe(0);
  });

  it("closes once on approval without asking again", () => {
    const harness = createWindow();
    const coordinator = createWindowCloseCoordinator(harness.window);
    harness.requestClose();

    expect(coordinator.decide({ requestId: 1, allow: true })).toEqual({ status: "accepted" });
    expect(harness.closedTimes()).toBe(1);
    // The approved close re-enters the handler; it must pass straight through
    // instead of starting another question, or the window could never close.
    expect(harness.sent).toEqual([1]);
    expect(coordinator.pendingRequestId()).toBeNull();
  });

  it("keeps the window open on refusal and asks again on the next attempt", () => {
    const harness = createWindow();
    const coordinator = createWindowCloseCoordinator(harness.window);
    harness.requestClose();

    expect(coordinator.decide({ requestId: 1, allow: false })).toEqual({ status: "accepted" });
    expect(harness.closedTimes()).toBe(0);
    expect(coordinator.pendingRequestId()).toBeNull();

    harness.requestClose();
    expect(harness.sent).toEqual([1, 2]);
    coordinator.decide({ requestId: 2, allow: true });
    expect(harness.closedTimes()).toBe(1);
  });

  it("ignores stale, duplicate and malformed answers", () => {
    const harness = createWindow();
    const coordinator = createWindowCloseCoordinator(harness.window);
    harness.requestClose();

    for (const invalid of [
      { requestId: 99, allow: true },
      { requestId: 1, allow: "yes" },
      { allow: true },
      null,
      "close",
    ]) {
      expect(coordinator.decide(invalid)).toEqual({ status: "ignored" });
    }
    expect(harness.closedTimes()).toBe(0);

    coordinator.decide({ requestId: 1, allow: false });
    // The answered question is gone, so a replayed approval cannot close later.
    expect(coordinator.decide({ requestId: 1, allow: true })).toEqual({ status: "ignored" });
    expect(harness.closedTimes()).toBe(0);
  });

  it("stops holding the window when the renderer can no longer answer", () => {
    const harness = createWindow();
    createWindowCloseCoordinator(harness.window);
    harness.requestClose();
    expect(harness.prevented()).toBe(1);

    harness.rendererGone();
    harness.requestClose();
    expect(harness.prevented()).toBe(1);
    expect(harness.sent).toEqual([1]);
  });

  it("never prevents a close it cannot ask about", () => {
    const harness = createWindow();
    createWindowCloseCoordinator(harness.window);
    harness.destroy();

    harness.requestClose();
    expect(harness.prevented()).toBe(0);
    expect(harness.sent).toEqual([]);
  });

  it("accepts only well-formed decisions", () => {
    expect(isWindowCloseDecision({ requestId: 1, allow: true })).toBe(true);
    expect(isWindowCloseDecision({ requestId: 1.5, allow: true })).toBe(false);
    expect(isWindowCloseDecision({ requestId: "1", allow: true })).toBe(false);
    expect(isWindowCloseDecision(undefined)).toBe(false);
  });

  it("gives the renderer no window authority beyond answering", async () => {
    const [preload, main] = await Promise.all([
      readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8"),
    ]);

    expect(preload).toContain("onCloseRequest");
    expect(preload).toContain("respondToCloseRequest");
    for (const forbidden of ["BrowserWindow", "getCurrentWindow", "window.close(", "app.quit"]) {
      expect(preload).not.toContain(forbidden);
    }
    // Intentional exit routes through the same window close the button uses.
    expect(main).toContain("registerWindowCloseIpc");
  });

  it("registers the handshake for the project window and releases it on close", async () => {
    const closed: (() => void)[] = [];
    const handlers = new Map<string, unknown>();
    const removed: string[] = [];
    const harness = createWindow();
    const window = Object.assign(harness.window, {
      once: (_event: string, listener: () => void) => closed.push(listener),
    });
    const ipc = {
      handle: (channel: string, handler: unknown) => handlers.set(channel, handler),
      removeHandler: (channel: string) => removed.push(channel),
    };
    const { registerWindowCloseIpc } = await import("../../../electron/window-close-ipc");
    const authorized = vi.fn(() => false);

    const coordinator = registerWindowCloseIpc(ipc as never, window as never, authorized as never);
    harness.requestClose();
    const handler = handlers.get("folio:window:close-decision") as (
      event: unknown,
      decision: unknown,
    ) => { status: string };

    // An unauthorized sender cannot resolve a close the real renderer was asked about.
    expect(handler({}, { requestId: 1, allow: true })).toEqual({ status: "ignored" });
    expect(harness.closedTimes()).toBe(0);
    expect(coordinator.pendingRequestId()).toBe(1);

    authorized.mockReturnValue(true);
    expect(handler({}, { requestId: 1, allow: true })).toEqual({ status: "accepted" });
    expect(harness.closedTimes()).toBe(1);

    for (const listener of closed) listener();
    expect(removed).toEqual(["folio:window:close-decision"]);
  });
});
