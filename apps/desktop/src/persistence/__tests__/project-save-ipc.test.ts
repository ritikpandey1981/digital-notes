import { readFile } from "node:fs/promises";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DesktopProjectFileService } from "../../../electron/project-file-service";
import { createProjectSaveHandler, PROJECT_SAVE_CHANNEL } from "../../../electron/project-save-ipc";

describe("project save IPC boundary", () => {
  it("authorizes only the owning window's trusted main frame", async () => {
    const frame = { url: "file:///app/index.html" };
    const webContents = { mainFrame: frame };
    const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
    const service = new DesktopProjectFileService({
      chooseDestination: async () => null,
      confirmReplacement: async () => false,
    });
    const save = vi.spyOn(service, "save");
    const handler = createProjectSaveHandler(window, service, frame.url);
    const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    expect(await handler(event, { kind: "saveAs", title: "Test", content: "x" })).toEqual({
      status: "cancelled",
    });
    for (const invalid of [
      { sender: {}, senderFrame: frame },
      { sender: webContents, senderFrame: { url: frame.url } },
      { sender: webContents, senderFrame: null },
    ]) {
      expect(await handler(invalid as unknown as IpcMainInvokeEvent, {})).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
    }
    frame.url = "https://untrusted.example/";
    expect(await handler(event, {})).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps preload imports sandbox-compatible and exposes only the project save method", async () => {
    const main = await readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8");
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
    const source = await readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8");
    expect(source).toContain(`ipcRenderer.invoke("${PROJECT_SAVE_CHANNEL}", request)`);
    expect(source).toContain("satisfies DesktopProjectSavePort");
    expect(source).not.toMatch(
      /["']node:|readFile|writeFile|sendSync|exposeInMainWorld\("(?:fs|path)"/,
    );
    const runtimeImports = source
      .split("\n")
      .filter((line) => line.startsWith("import {") && !line.includes("type"));
    expect(runtimeImports).toEqual(['import { contextBridge, ipcRenderer } from "electron";']);
  });
});
