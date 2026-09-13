import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { DesktopProjectFileService } from "./project-file-service";
import { saveFailure, type ProjectSaveResult } from "./project-save-contract";
import { openFailure } from "./project-open-contract";
import { createTrustedSender } from "./trusted-sender";

export const PROJECT_SAVE_CHANNEL = "folio:projects:save";
export const PROJECT_OPEN_CHANNEL = "folio:projects:open";
export const PROJECT_ADOPT_CHANNEL = "folio:projects:adopt";
export const PROJECT_RELEASE_CHANNEL = "folio:projects:release";

function authorized(window: BrowserWindow, event: IpcMainInvokeEvent, trustedUrl: string): boolean {
  return createTrustedSender(window, trustedUrl)(event);
}

export function createProjectOpenHandlers(
  window: BrowserWindow,
  service: DesktopProjectFileService,
  trustedUrl: string,
) {
  const denied = () =>
    openFailure("INVALID_REQUEST", "Project Open is unavailable to this sender.");
  return {
    open: (event: IpcMainInvokeEvent, input?: unknown) =>
      authorized(window, event, trustedUrl) ? service.open(input) : Promise.resolve(denied()),
    adopt: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(window, event, trustedUrl) ? service.adopt(input) : denied(),
    release: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(window, event, trustedUrl) ? service.release(input) : denied(),
  };
}

/** Authorization precedes payload processing: only the owning app's main frame. */
export function createProjectSaveHandler(
  window: BrowserWindow,
  service: DesktopProjectFileService,
  trustedUrl: string,
): (event: IpcMainInvokeEvent, request: unknown) => Promise<ProjectSaveResult> {
  return async (event, request) => {
    if (!authorized(window, event, trustedUrl)) {
      return saveFailure("INVALID_REQUEST", "Project save is unavailable to this sender.");
    }
    return service.save(request);
  };
}

/** Current desktop composition has one project window; release its channel on close. */
export function registerProjectSaveIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  service: DesktopProjectFileService,
  trustedUrl: string,
): void {
  ipc.handle(PROJECT_SAVE_CHANNEL, createProjectSaveHandler(window, service, trustedUrl));
  const handlers = createProjectOpenHandlers(window, service, trustedUrl);
  ipc.handle(PROJECT_OPEN_CHANNEL, handlers.open);
  ipc.handle(PROJECT_ADOPT_CHANNEL, handlers.adopt);
  ipc.handle(PROJECT_RELEASE_CHANNEL, handlers.release);
  window.webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) service.revoke();
  });
  window.once("closed", () => {
    service.dispose();
    ipc.removeHandler(PROJECT_SAVE_CHANNEL);
    ipc.removeHandler(PROJECT_OPEN_CHANNEL);
    ipc.removeHandler(PROJECT_ADOPT_CHANNEL);
    ipc.removeHandler(PROJECT_RELEASE_CHANNEL);
  });
  window.webContents.on("render-process-gone", () => service.revoke());
}
