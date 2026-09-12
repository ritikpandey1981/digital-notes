import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import {
  WINDOW_CLOSE_DECISION_CHANNEL,
  WINDOW_CLOSE_REQUEST_CHANNEL,
  isWindowCloseDecision,
  type WindowCloseDecisionResult,
} from "./window-close-contract";

/** The subset of BrowserWindow this coordination needs, so it can be tested. */
export interface CloseProtectedWindow {
  readonly isDestroyed: () => boolean;
  readonly close: () => void;
  readonly on: (event: "close", listener: (event: { preventDefault: () => void }) => void) => void;
  readonly webContents: {
    readonly send: (channel: string, ...args: unknown[]) => void;
    readonly isDestroyed: () => boolean;
    readonly on: (event: "render-process-gone", listener: () => void) => void;
  };
}

export interface WindowCloseCoordinator {
  /** Answers a pending close question. Stale or unknown answers are ignored. */
  readonly decide: (decision: unknown) => WindowCloseDecisionResult;
  readonly pendingRequestId: () => number | null;
}

/**
 * Lets the renderer resolve unsaved work before a window actually closes.
 *
 * Electron's close event is synchronous and saving is not, so the first close
 * is prevented and turned into a question. Approval arrives later and closes the
 * window a second time, which this pass lets through -- the one-shot flag is
 * what keeps that second close from asking again forever.
 */
export function createWindowCloseCoordinator(window: CloseProtectedWindow): WindowCloseCoordinator {
  let approved = false;
  let pending: number | null = null;
  let ordinal = 0;

  const release = (): void => {
    // A renderer that is gone can no longer answer, and refusing to close then
    // would strand the window. Crash recovery is a separate concern.
    approved = true;
    pending = null;
  };
  window.webContents.on("render-process-gone", release);

  window.on("close", (event) => {
    if (approved) return;
    if (window.webContents.isDestroyed()) return;
    event.preventDefault();
    // A second close while the user is still deciding must not start a second
    // question, or every stray close would stack another dialog.
    if (pending !== null) return;
    pending = ordinal += 1;
    window.webContents.send(WINDOW_CLOSE_REQUEST_CHANNEL, pending);
  });

  return {
    pendingRequestId: () => pending,
    decide: (decision: unknown) => {
      if (!isWindowCloseDecision(decision) || decision.requestId !== pending)
        return { status: "ignored" };
      pending = null;
      if (!decision.allow) return { status: "accepted" };
      approved = true;
      if (!window.isDestroyed()) window.close();
      return { status: "accepted" };
    },
  };
}

/** Registers the close handshake for the one project window this app shows. */
export function registerWindowCloseIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  authorized: (event: IpcMainInvokeEvent) => boolean,
): WindowCloseCoordinator {
  const coordinator = createWindowCloseCoordinator(window as unknown as CloseProtectedWindow);
  ipc.handle(WINDOW_CLOSE_DECISION_CHANNEL, (event: IpcMainInvokeEvent, decision: unknown) =>
    authorized(event) ? coordinator.decide(decision) : { status: "ignored" },
  );
  window.once("closed", () => ipc.removeHandler(WINDOW_CLOSE_DECISION_CHANNEL));
  return coordinator;
}
