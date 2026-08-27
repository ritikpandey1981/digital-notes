import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

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
