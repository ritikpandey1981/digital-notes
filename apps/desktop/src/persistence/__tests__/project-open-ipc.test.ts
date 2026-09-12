import { EventEmitter } from "node:events";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DesktopProjectFileService } from "../../../electron/project-file-service";
import {
  createProjectOpenHandlers,
  registerProjectSaveIpc,
  PROJECT_OPEN_CHANNEL,
  PROJECT_ADOPT_CHANNEL,
  PROJECT_RELEASE_CHANNEL,
} from "../../../electron/project-save-ipc";

function setup() {
  const frame = { url: "file:///app/index.html" };
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: (): boolean => false,
  });
  const service = new DesktopProjectFileService({
    chooseSource: async () => [path.resolve("approved.folio")],
    read: async () => "approved",
    chooseDestination: async () => null,
    confirmReplacement: async () => false,
  });
  const handlers = createProjectOpenHandlers(
    window as unknown as BrowserWindow,
    service,
    frame.url,
  );
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { window, contents, frame, service, handlers, event };
}
describe("project Open IPC authorization and lifetime", () => {
  it("authorizes read/adopt/release only for this window's exact trusted main frame", async () => {
    const s = setup();
    const spies = [
      vi.spyOn(s.service, "open"),
      vi.spyOn(s.service, "adopt"),
      vi.spyOn(s.service, "release"),
    ];
    for (const invalid of [
      { sender: {}, senderFrame: s.frame },
      { sender: s.contents, senderFrame: { url: s.frame.url } },
      { sender: s.contents, senderFrame: null },
    ]) {
      for (const handler of Object.values(s.handlers))
        expect(await handler(invalid as unknown as IpcMainInvokeEvent, undefined)).toMatchObject({
          error: { code: "INVALID_REQUEST" },
        });
    }
    s.frame.url = "https://not-the-app.example/";
    for (const handler of Object.values(s.handlers))
      expect(await handler(s.event, undefined)).toMatchObject({
        error: { code: "INVALID_REQUEST" },
      });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    s.frame.url = "file:///app/index.html";
    const read = await s.handlers.open(s.event);
    if (read.status !== "read") throw new Error("Expected authorized read");
    expect(s.handlers.adopt(s.event, read.backing.id).status).toBe("adopted");
    expect(s.handlers.release(s.event, read.backing.id).status).toBe("released");
    s.window.isDestroyed = () => true;
    expect(await s.handlers.open(s.event)).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
  it.each(["navigation", "crash", "close"])(
    "revokes adopted and provisional targets on %s",
    async (kind) => {
      const s = setup();
      const ipc = { handle: vi.fn(), removeHandler: vi.fn() };
      registerProjectSaveIpc(
        ipc as unknown as IpcMain,
        s.window as unknown as BrowserWindow,
        s.service,
        s.frame.url,
      );
      const a = await s.service.open();
      if (a.status !== "read") throw new Error("Expected read");
      s.service.adopt(a.backing.id);
      const b = await s.service.open();
      if (b.status !== "read") throw new Error("Expected read");
      if (kind === "navigation")
        s.contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      if (kind === "crash") s.contents.emit("render-process-gone");
      if (kind === "close") s.window.emit("closed");
      expect(s.service.adopt(b.backing.id)).toMatchObject({
        error: { code: "TARGET_UNAVAILABLE" },
      });
      expect(
        await s.service.save({ kind: "save", targetId: a.backing.id, content: "x" }),
      ).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
      expect(ipc.handle.mock.calls.map(([name]) => name)).toEqual([
        "folio:projects:save",
        PROJECT_OPEN_CHANNEL,
        PROJECT_ADOPT_CHANNEL,
        PROJECT_RELEASE_CHANNEL,
      ]);
      if (kind === "close") expect(ipc.removeHandler).toHaveBeenCalledTimes(4);
      s.service.dispose();
    },
  );
  it("keeps the bridge narrow, sandboxed and dialog-selected", async () => {
    const preload = await readFile(
      new URL("../../../electron/preload.ts", import.meta.url),
      "utf8",
    );
    for (const channel of [PROJECT_OPEN_CHANNEL, PROJECT_ADOPT_CHANNEL, PROJECT_RELEASE_CHANNEL])
      expect(preload).toContain(channel);
    expect(preload).not.toMatch(/readFile|readdir|["']node:|sendSync/);
    const main = await readFile(new URL("../../../electron/main.ts", import.meta.url), "utf8");
    expect(main).toContain('properties: ["openFile"]');
    expect(main).toContain('extensions: ["folio"]');
    expect(main).toContain("dialog.showOpenDialog(projectWindow");
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
  });
});
