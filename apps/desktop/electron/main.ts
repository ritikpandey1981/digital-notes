import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopProjectFileService } from "./project-file-service";
import { registerProjectSaveIpc } from "./project-save-ipc";
import { registerWindowCloseIpc } from "./window-close-ipc";
import { DesktopRecoveryFileService } from "./recovery-file-service";
import { registerRecoveryIpc } from "./recovery-ipc";

let mainWindow: BrowserWindow | null = null;

function resolveAssetPath(fileName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", fileName);
  }

  return path.resolve(__dirname, "../../../assets", fileName);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    title: "Folio",
    // Every dimension below describes the web content area, not the OS frame, so
    // the editor shell's own minimum is exactly what the renderer receives.
    useContentSize: true,
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f5f3",
    icon: resolveAssetPath("app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:") {
        void shell.openExternal(target.toString());
      }
    } catch {
      // Invalid URLs are rejected below.
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    const primaryModifier = process.platform === "darwin" ? input.meta : input.control;
    const reloadKey = input.key.toLowerCase() === "r" && primaryModifier;
    const refreshKey = input.key.toLowerCase() === "f5";
    if (input.type === "keyDown" && (reloadKey || refreshKey)) {
      event.preventDefault();
    }
  });

  const developmentServerUrl = process.env.VITE_DEV_SERVER_URL;
  const projectWindow = mainWindow;
  const projectFiles = new DesktopProjectFileService({
    chooseSource: async () => {
      const result = await dialog.showOpenDialog(projectWindow, {
        title: "Open Folio Project",
        filters: [{ name: "Folio Project", extensions: ["folio"] }],
        properties: ["openFile"],
      });
      return result.canceled ? null : result.filePaths;
    },
    chooseDestination: async (suggestedName) => {
      const result = await dialog.showSaveDialog(projectWindow, {
        title: "Save Folio Project",
        defaultPath: suggestedName,
        filters: [{ name: "Folio Project", extensions: ["folio"] }],
        properties: ["showOverwriteConfirmation"],
      });
      return result.canceled ? null : result.filePath;
    },
    confirmReplacement: async (displayName) => {
      const result = await dialog.showMessageBox(projectWindow, {
        type: "warning",
        message: `Replace ${displayName}?`,
        detail: "A Folio project with this filename already exists.",
        buttons: ["Cancel", "Replace"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1;
    },
  });
  const trustedUrl =
    developmentServerUrl === undefined
      ? pathToFileURL(path.join(__dirname, "../dist/renderer/index.html")).href
      : new URL(developmentServerUrl).href;
  registerProjectSaveIpc(ipcMain, projectWindow, projectFiles, trustedUrl);
  const authorizeProjectSender = (event: IpcMainInvokeEvent): boolean =>
    !projectWindow.isDestroyed() &&
    event.sender === projectWindow.webContents &&
    event.senderFrame === projectWindow.webContents.mainFrame;
  // Recovery state belongs to the application, not to the user's folder, so it
  // lives under userData and never beside the project file being edited.
  registerRecoveryIpc(
    ipcMain,
    projectWindow,
    new DesktopRecoveryFileService({
      directory: path.join(app.getPath("userData"), "recovery"),
      resolveBackingPath: (targetId) => projectFiles.sourcePathForTarget(targetId),
    }),
    authorizeProjectSender,
  );
  // Quitting the app closes this window, so intentional exit reaches the same
  // unsaved-work question the close button does.
  registerWindowCloseIpc(ipcMain, projectWindow, authorizeProjectSender);
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const allowedUrl = developmentServerUrl
      ? new URL(navigationUrl).origin === new URL(developmentServerUrl).origin
      : navigationUrl.startsWith("file://");

    if (!allowedUrl) {
      event.preventDefault();
    }
  });

  if (developmentServerUrl) {
    void mainWindow.loadURL(developmentServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

void app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
