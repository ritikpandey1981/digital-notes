import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopProjectSavePort,
  ProjectSaveRequest,
  ProjectSaveResult,
} from "./project-save-contract";

const folioApi = Object.freeze({
  // Sandbox preloads cannot require local modules; keep the channel literal here
  // and import only erased contract types. Main validates sender and payload.
  projects: Object.freeze({
    save: (request: ProjectSaveRequest): Promise<ProjectSaveResult> =>
      ipcRenderer.invoke("folio:projects:save", request),
  } satisfies DesktopProjectSavePort),
  platform: process.platform,
  runtime: Object.freeze({
    chromium: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
});

contextBridge.exposeInMainWorld("folio", folioApi);
