import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

/** Decides whether one IPC message really came from the application's own page. */
export type TrustedSender = (event: IpcMainInvokeEvent) => boolean;

/**
 * The one authorization rule every privileged channel uses.
 *
 * Four things have to hold together: the window still exists, the message came
 * from that window's contents, it came from its main frame rather than anything
 * embedded in it, and that frame is showing the exact document Folio loaded.
 * The last check is what stops a page the window navigated to from inheriting
 * the capabilities the application had, and it is the reason this lives in one
 * place instead of being written out per feature.
 */
export function createTrustedSender(window: BrowserWindow, trustedUrl: string): TrustedSender {
  return (event) =>
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame?.url === trustedUrl;
}
