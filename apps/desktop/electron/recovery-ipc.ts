import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { openFailure, type ProjectReadResult } from "./project-open-contract";
import type { DesktopRecoveryFileService } from "./recovery-file-service";
import {
  RECOVERY_CLEAR_CHANNEL,
  RECOVERY_LIST_CHANNEL,
  RECOVERY_OPEN_ORIGINAL_CHANNEL,
  RECOVERY_READ_CHANNEL,
  RECOVERY_STORE_CHANNEL,
  isRecoveryId,
  recoveryFailure,
  toRecoveryCandidateSummary,
  type RecoveryListResult,
  type RecoveryReadResult,
} from "./recovery-contract";

/** Opens a file main resolved for itself. The renderer never supplies the path. */
export type RecoveryOriginalOpener = (filename: string) => Promise<ProjectReadResult>;

/** Authorization precedes payload processing: only the owning app's main frame. */
export function createRecoveryHandlers(
  service: DesktopRecoveryFileService,
  authorized: (event: IpcMainInvokeEvent) => boolean,
  openOriginal: RecoveryOriginalOpener,
) {
  const denied = () =>
    recoveryFailure("INVALID_REQUEST", "Recovery is unavailable to this sender.");
  return {
    store: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(event) ? service.store(input) : Promise.resolve(denied()),
    clear: (event: IpcMainInvokeEvent, input: unknown) =>
      authorized(event) ? service.clear(input) : Promise.resolve(denied()),
    list: async (event: IpcMainInvokeEvent): Promise<RecoveryListResult> => {
      if (!authorized(event)) return denied();
      // Only the safe half of each record crosses: a title, a time, and whether
      // an original is still reachable. Its location and payload stay here.
      const records = await service.list();
      return { status: "listed", candidates: records.map(toRecoveryCandidateSummary) };
    },
    read: async (event: IpcMainInvokeEvent, input: unknown): Promise<RecoveryReadResult> => {
      if (!authorized(event)) return denied();
      if (!isRecoveryId(input))
        return recoveryFailure("INVALID_REQUEST", "Invalid recovery identifier.");
      const record = await service.read(input);
      if (record === null)
        return recoveryFailure("NOT_FOUND", "That recovered drawing is no longer available.");
      // The embedded project only. Everything main knows about where it came
      // from is deliberately left behind.
      return { status: "read", content: record.project };
    },
    openOriginal: async (event: IpcMainInvokeEvent, input: unknown): Promise<ProjectReadResult> => {
      if (!authorized(event))
        return openFailure("INVALID_REQUEST", "Recovery is unavailable to this sender.");
      if (!isRecoveryId(input))
        return openFailure("INVALID_REQUEST", "Invalid recovery identifier.");
      const record = await service.read(input);
      if (record === null)
        return openFailure("TARGET_UNAVAILABLE", "That recovered drawing is no longer available.");
      if (record.source === null)
        return openFailure(
          "TARGET_UNAVAILABLE",
          "Folio does not know which file that drawing came from.",
        );
      // The path comes from main's own record and goes straight back into the
      // ordinary Open pipeline, which validates it again before reading.
      return openOriginal(record.source.path);
    },
  };
}

/**
 * Registers the recovery capabilities the renderer needs.
 *
 * Everything is scoped to an id main issued and can still find in its own
 * directory: no directory listing, no path, and no way to name a file that is
 * not a recovery record.
 */
export function registerRecoveryIpc(
  ipc: IpcMain,
  window: BrowserWindow,
  service: DesktopRecoveryFileService,
  authorized: (event: IpcMainInvokeEvent) => boolean,
  openOriginal: RecoveryOriginalOpener,
): void {
  const handlers = createRecoveryHandlers(service, authorized, openOriginal);
  ipc.handle(RECOVERY_STORE_CHANNEL, handlers.store);
  ipc.handle(RECOVERY_CLEAR_CHANNEL, handlers.clear);
  ipc.handle(RECOVERY_LIST_CHANNEL, handlers.list);
  ipc.handle(RECOVERY_READ_CHANNEL, handlers.read);
  ipc.handle(RECOVERY_OPEN_ORIGINAL_CHANNEL, handlers.openOriginal);
  window.once("closed", () => {
    service.dispose();
    for (const channel of [
      RECOVERY_STORE_CHANNEL,
      RECOVERY_CLEAR_CHANNEL,
      RECOVERY_LIST_CHANNEL,
      RECOVERY_READ_CHANNEL,
      RECOVERY_OPEN_ORIGINAL_CHANNEL,
    ])
      ipc.removeHandler(channel);
  });
}
