import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { DesktopProjectFileService } from "./project-file-service";
import { saveFailure, type ProjectSaveResult } from "./project-save-contract";

export const PROJECT_SAVE_CHANNEL = "folio:projects:save";

/** Authorization precedes payload processing: only the owning app's main frame. */
export function createProjectSaveHandler(
  window: BrowserWindow,
  service: DesktopProjectFileService,
  trustedUrl: string,
): (event: IpcMainInvokeEvent, request: unknown) => Promise<ProjectSaveResult> {
  return async (event, request) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame?.url !== trustedUrl
    ) {
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
  window.webContents.on("did-start-navigation", (event) => {
    if (event.isMainFrame && !event.isSameDocument) service.revoke();
  });
  window.once("closed", () => {
    service.dispose();
    ipc.removeHandler(PROJECT_SAVE_CHANNEL);
  });
}
