import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import type { DesktopRecoveryFileService } from "./recovery-file-service";
import {
  RECOVERY_CLEAR_CHANNEL,
  RECOVERY_STORE_CHANNEL,
  recoveryFailure,
} from "./recovery-contract";

/** Authorization precedes payload processing: only the owning app's main frame. */
export function createRecoveryHandlers(
  service: DesktopRecoveryFileService,
  authorized: (event: IpcMainInvokeEvent) => boolean,
) {
  const denied = () =>
    recoveryFailure("INVALID_REQUEST", "Recovery is unavailable to this sender.");
  return {
    store: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(event) ? service.store(input) : Promise.resolve(denied()),
    clear: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(event) ? service.clear(input) : Promise.resolve(denied()),
  };
}

/**
 * Registers the two recovery capabilities the renderer needs.
 *
 * Deliberately no list and no read: enumerating recovery state belongs to the
 * startup flow in main, not to a running editor.
 */
export function registerRecoveryIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  service: DesktopRecoveryFileService,
  authorized: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handlers = createRecoveryHandlers(service, authorized);
  ipc.handle(RECOVERY_STORE_CHANNEL, handlers.store);
  ipc.handle(RECOVERY_CLEAR_CHANNEL, handlers.clear);
  window.once("closed", () => {
    service.dispose();
    ipc.removeHandler(RECOVERY_STORE_CHANNEL);
    ipc.removeHandler(RECOVERY_CLEAR_CHANNEL);
  });
}
