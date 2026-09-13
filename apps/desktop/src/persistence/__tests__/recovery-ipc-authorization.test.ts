import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRecoveryFileService } from "../../../electron/recovery-file-service";
import { registerRecoveryIpc } from "../../../electron/recovery-ipc";
import type { RecoverySnapshotRequest } from "../../../electron/recovery-contract";

const TRUSTED_URL = "file:///C:/app/dist/renderer/index.html";
const RECOVERY_ID = "00000000-0000-4000-8000-0000000000a1";
const SESSION_ID = "00000000-0000-4000-8000-0000000000b2";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** The parts of Electron this registration actually touches. */
function createWindow() {
  const listeners = new Map<string, ((...args: never[]) => void)[]>();
  const mainFrame = { url: TRUSTED_URL };
  const webContents = {
    mainFrame,
    on: (event: string, listener: (...args: never[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
  };
  let destroyed = false;
  return {
    window: {
      isDestroyed: () => destroyed,
      webContents,
      once: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
    },
    mainFrame,
    destroy: () => {
      destroyed = true;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? [])
        (listener as (...values: unknown[]) => void)(...args);
    },
    /** An event as it arrives from the trusted document, unless overridden. */
    event: (overrides: { senderFrame?: unknown; sender?: unknown } = {}) =>
      ({
        sender: overrides.sender ?? webContents,
        senderFrame: "senderFrame" in overrides ? overrides.senderFrame : mainFrame,
      }) as never,
  };
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "folio-recovery-auth-"));
  directories.push(root);
  const service = new DesktopRecoveryFileService({ directory: path.join(root, "recovery") });
  const host = createWindow();
  const handlers = new Map<string, (event: never, input: unknown) => unknown>();
  const ipc = {
    handle: (channel: string, handler: (event: never, input: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  };
  const openOriginal = vi.fn(async () => ({ status: "cancelled" }) as const);
  registerRecoveryIpc(
    ipc as never,
    host.window as never,
    service,
    TRUSTED_URL,
    openOriginal as never,
  );
  const request: RecoverySnapshotRequest = {
    recoveryId: RECOVERY_ID,
    sessionId: SESSION_ID,
    documentId: "A",
    title: "Study A",
    capturedAt: "2026-09-13T10:00:00.000Z",
    backingTargetId: null,
    content: encodeFolioProject(createEmptyFolioProject({ documentId: "A", pageId: "page-A" })),
  };
  const call = (channel: string, input?: unknown) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler(host.event() as never, input);
  };
  const callFrom = (channel: string, event: unknown, input?: unknown) => {
    const handler = handlers.get(channel);
    if (handler === undefined) throw new Error(`no handler for ${channel}`);
    return handler(event as never, input);
  };
  return { service, host, handlers, request, call, callFrom, openOriginal };
}

describe("recovery answers only the document it belongs to", () => {
  it("serves the trusted application document", async () => {
    const s = await setup();
    expect(await s.call("folio:recovery:store", s.request)).toEqual({ status: "stored" });
    expect(await s.call("folio:recovery:list")).toMatchObject({ status: "listed" });
    expect(await s.call("folio:recovery:read", RECOVERY_ID)).toMatchObject({ status: "read" });
  });

  it("refuses the same window showing a different document", async () => {
    const s = await setup();
    const foreign = s.host.event({ senderFrame: { url: "file:///C:/elsewhere/evil.html" } });

    for (const channel of [
      "folio:recovery:store",
      "folio:recovery:clear",
      "folio:recovery:list",
      "folio:recovery:read",
      "folio:recovery:open-original",
    ]) {
      expect(
        await s.callFrom(channel, foreign, RECOVERY_ID),
        `${channel} served a foreign document`,
      ).toMatchObject({ status: "failed" });
    }
    expect(s.openOriginal).not.toHaveBeenCalled();
  });

  it("refuses a child frame of the trusted document", async () => {
    const s = await setup();
    const child = s.host.event({ senderFrame: { url: TRUSTED_URL } });

    expect(await s.callFrom("folio:recovery:store", child, s.request)).toMatchObject({
      status: "failed",
    });
    expect(await s.callFrom("folio:recovery:list", child)).toMatchObject({ status: "failed" });
  });

  it("refuses another window's contents", async () => {
    const s = await setup();
    const other = s.host.event({ sender: { mainFrame: { url: TRUSTED_URL } } });

    expect(await s.callFrom("folio:recovery:read", other, RECOVERY_ID)).toMatchObject({
      status: "failed",
    });
  });

  it("stops answering once the document has navigated away", async () => {
    const s = await setup();
    expect(await s.call("folio:recovery:store", s.request)).toEqual({ status: "stored" });

    s.host.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    s.host.mainFrame.url = "file:///C:/app/dist/renderer/other.html";

    expect(await s.call("folio:recovery:store", s.request)).toMatchObject({ status: "failed" });
  });

  it("stops answering a renderer that is gone", async () => {
    const s = await setup();
    s.host.emit("render-process-gone");

    expect(await s.call("folio:recovery:store", s.request)).toMatchObject({ status: "failed" });
  });

  it("stops answering once the window is destroyed", async () => {
    const s = await setup();
    s.host.destroy();

    expect(await s.call("folio:recovery:list")).toMatchObject({ status: "failed" });
  });
});
