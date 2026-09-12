import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopProjectOpenPort,
  ProjectReadResult,
  ProjectTargetResult,
  ProjectReleaseResult,
} from "./project-open-contract";
import type {
  DesktopProjectSavePort,
  ProjectSaveRequest,
  ProjectSaveResult,
} from "./project-save-contract";
import type {
  DesktopWindowClosePort,
  WindowCloseDecision,
  WindowCloseDecisionResult,
} from "./window-close-contract";

const folioApi = Object.freeze({
  // Sandbox preloads cannot require local modules; keep the channel literal here
  // and import only erased contract types. Main validates sender and payload.
  projects: Object.freeze({
    open: (): Promise<ProjectReadResult> => ipcRenderer.invoke("folio:projects:open"),
    adopt: (targetId: string): Promise<ProjectTargetResult> =>
      ipcRenderer.invoke("folio:projects:adopt", targetId),
    release: (targetId?: string): Promise<ProjectReleaseResult> =>
      ipcRenderer.invoke("folio:projects:release", targetId),
    save: (request: ProjectSaveRequest): Promise<ProjectSaveResult> =>
      ipcRenderer.invoke("folio:projects:save", request),
  } satisfies DesktopProjectSavePort & DesktopProjectOpenPort),
  // The renderer may answer a close question main asked, and nothing more. It
  // cannot close, open, move, or inspect a window on its own.
  window: Object.freeze({
    onCloseRequest: (handler: (requestId: number) => void): (() => void) => {
      const listener = (_event: unknown, requestId: number): void => handler(requestId);
      ipcRenderer.on("folio:window:close-request", listener);
      return () => {
        ipcRenderer.off("folio:window:close-request", listener);
      };
    },
    respondToCloseRequest: (decision: WindowCloseDecision): Promise<WindowCloseDecisionResult> =>
      ipcRenderer.invoke("folio:window:close-decision", decision),
  } satisfies DesktopWindowClosePort),
  platform: process.platform,
  runtime: Object.freeze({
    chromium: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
});

contextBridge.exposeInMainWorld("folio", folioApi);
