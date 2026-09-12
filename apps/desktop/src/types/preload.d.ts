import type { DesktopProjectSavePort } from "../../electron/project-save-contract";
import type { DesktopProjectOpenPort } from "../../electron/project-open-contract";
import type { DesktopWindowClosePort } from "../../electron/window-close-contract";

declare global {
  interface Window {
    folio: {
      readonly projects: DesktopProjectSavePort & DesktopProjectOpenPort;
      readonly window: DesktopWindowClosePort;
      platform: NodeJS.Platform;
      runtime: {
        chromium: string;
        electron: string;
        node: string;
      };
    };
  }
}
