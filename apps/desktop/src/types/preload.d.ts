import type { DesktopProjectSavePort } from "../../electron/project-save-contract";

declare global {
  interface Window {
    folio: {
      readonly projects: DesktopProjectSavePort;
      platform: NodeJS.Platform;
      runtime: {
        chromium: string;
        electron: string;
        node: string;
      };
    };
  }
}
