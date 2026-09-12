import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRecoveryFileService } from "../../../electron/recovery-file-service";
import { createRecoveryHandlers } from "../../../electron/recovery-ipc";
import {
  MAXIMUM_RECOVERY_BYTES,
  isRecoveryRecord,
  isRecoverySnapshotRequest,
  type RecoverySnapshotRequest,
} from "../../../electron/recovery-contract";

const RECOVERY_ID = "00000000-0000-4000-8000-0000000000a1";
const SESSION_ID = "00000000-0000-4000-8000-0000000000b2";
const TARGET_ID = "00000000-0000-4000-8000-0000000000c3";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup(options: { resolveBackingPath?: (id: string) => string | null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "folio-recovery-"));
  directories.push(root);
  const directory = path.join(root, "recovery");
  const service = new DesktopRecoveryFileService({ directory, ...options });
  const request = (overrides: Partial<RecoverySnapshotRequest> = {}): RecoverySnapshotRequest => ({
    recoveryId: RECOVERY_ID,
    sessionId: SESSION_ID,
    documentId: "A",
    title: "Study A",
    capturedAt: "2026-09-12T10:00:00.000Z",
    backingTargetId: null,
    content: encodeFolioProject(createEmptyFolioProject({ documentId: "A", pageId: "page-A" })),
    ...overrides,
  });
  return { root, directory, service, request };
}

describe("recovery file storage", () => {
  it("creates its own directory and writes a validated record", async () => {
    const s = await setup();
    expect(await s.service.store(s.request())).toEqual({ status: "stored" });

    const files = await readdir(s.directory);
    expect(files).toEqual([`${RECOVERY_ID}.folio-recovery`]);
    const record: unknown = JSON.parse(await readFile(path.join(s.directory, files[0]!), "utf8"));
    expect(isRecoveryRecord(record)).toBe(true);
    expect(record).toMatchObject({
      format: "folio-recovery",
      formatVersion: 1,
      recoveryId: RECOVERY_ID,
      sessionId: SESSION_ID,
      documentId: "A",
      title: "Study A",
      hadBacking: false,
      source: null,
    });
    // The user's own project format is embedded untouched, still at version 1.
    const embedded = (record as { project: string }).project;
    expect(JSON.parse(embedded)).toMatchObject({ format: "folio-project", formatVersion: 1 });
  });

  it("replaces an existing record without leaving temporary files behind", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const second = encodeFolioProject(
      createEmptyFolioProject({ documentId: "A", title: "Later", pageId: "page-A" }),
    );
    expect(await s.service.store(s.request({ content: second }))).toEqual({ status: "stored" });

    const files = await readdir(s.directory);
    expect(files).toEqual([`${RECOVERY_ID}.folio-recovery`]);
    const record = JSON.parse(await readFile(path.join(s.directory, files[0]!), "utf8")) as {
      project: string;
    };
    expect(record.project).toBe(second);
  });

  it("keeps the previous record when a replacement write fails", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const original = await readFile(
      path.join(s.directory, `${RECOVERY_ID}.folio-recovery`),
      "utf8",
    );

    const failing = new DesktopRecoveryFileService({
      directory: s.directory,
      write: vi.fn(async () => {
        throw Object.assign(new Error("disk"), { code: "EIO" });
      }),
    });
    expect(await failing.store(s.request({ content: "{}" }))).toMatchObject({
      status: "failed",
      error: { code: "WRITE_FAILED" },
    });

    expect(await readFile(path.join(s.directory, `${RECOVERY_ID}.folio-recovery`), "utf8")).toBe(
      original,
    );
    expect(await readdir(s.directory)).toEqual([`${RECOVERY_ID}.folio-recovery`]);
  });

  it("resolves the original location in main and never returns it", async () => {
    const resolveBackingPath = vi.fn(() => "C:\\Users\\someone\\Sketches\\A.folio");
    const s = await setup({ resolveBackingPath });
    const result = await s.service.store(s.request({ backingTargetId: TARGET_ID }));

    expect(result).toEqual({ status: "stored" });
    expect(resolveBackingPath).toHaveBeenCalledWith(TARGET_ID);
    // The path is written for a future Open Original, and is absent from the reply.
    expect(JSON.stringify(result)).not.toContain("Sketches");
    const [record] = await s.service.list();
    expect(record?.source).toEqual({ path: "C:\\Users\\someone\\Sketches\\A.folio" });
    expect(record?.hadBacking).toBe(true);
  });

  it("records a project as unbacked when main cannot resolve its target", async () => {
    const s = await setup({ resolveBackingPath: () => null });
    await s.service.store(s.request({ backingTargetId: TARGET_ID }));

    const [record] = await s.service.list();
    expect(record?.source).toBeNull();
    expect(record?.hadBacking).toBe(true);
  });

  it("rejects malformed requests and oversized payloads", async () => {
    const s = await setup();
    for (const invalid of [
      null,
      "snapshot",
      { ...s.request(), recoveryId: "../escape" },
      { ...s.request(), sessionId: "not-a-session" },
      { ...s.request(), capturedAt: "whenever" },
      { ...s.request(), content: "" },
      { ...s.request(), backingTargetId: "../../etc" },
      { ...s.request(), extra: true },
    ]) {
      expect(await s.service.store(invalid)).toMatchObject({
        status: "failed",
        error: { code: "INVALID_REQUEST" },
      });
    }
    expect(
      await s.service.store(s.request({ content: "x".repeat(MAXIMUM_RECOVERY_BYTES + 1) })),
    ).toMatchObject({ status: "failed", error: { code: "TOO_LARGE" } });
    expect(await readdir(s.directory).catch(() => [])).toEqual([]);
  });

  it("skips records that are corrupt, foreign, or a newer format", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const valid = await readFile(path.join(s.directory, `${RECOVERY_ID}.folio-recovery`), "utf8");
    const write = async (name: string, content: string) =>
      writeFile(path.join(s.directory, name), content);
    await write("00000000-0000-4000-8000-0000000000d4.folio-recovery", "{truncated");
    await write(
      "00000000-0000-4000-8000-0000000000d5.folio-recovery",
      JSON.stringify({ ...JSON.parse(valid), formatVersion: 99 }),
    );
    await write(
      "00000000-0000-4000-8000-0000000000d6.folio-recovery",
      JSON.stringify({ ...JSON.parse(valid), format: "something-else" }),
    );
    await write("notes.txt", "not a recovery record");

    const records = await s.service.list();
    // A crash-truncated neighbour must not hide the snapshot that is still good.
    expect(records.map(({ recoveryId }) => recoveryId)).toEqual([RECOVERY_ID]);
  });

  it("keeps separate sessions in separate records", async () => {
    const s = await setup();
    const other = "00000000-0000-4000-8000-0000000000e7";
    await s.service.store(s.request());
    await s.service.store(s.request({ recoveryId: other, documentId: "A", title: "Copy of A" }));

    const records = await s.service.list();
    expect(records).toHaveLength(2);
    expect(new Set(records.map(({ recoveryId }) => recoveryId))).toEqual(
      new Set([RECOVERY_ID, other]),
    );
  });

  it("treats clearing an absent record as done, and refuses a forged identifier", async () => {
    const s = await setup();
    await s.service.store(s.request());
    expect(await s.service.clear(RECOVERY_ID)).toEqual({ status: "cleared" });
    expect(await s.service.clear(RECOVERY_ID)).toEqual({ status: "cleared" });
    expect(await s.service.clear("../../project")).toMatchObject({
      status: "failed",
      error: { code: "INVALID_REQUEST" },
    });
    expect(await readdir(s.directory)).toEqual([]);
  });

  it("refuses every request from a sender it cannot authorize", async () => {
    const s = await setup();
    const store = vi.spyOn(s.service, "store");
    const read = vi.spyOn(s.service, "read");
    const openOriginal = vi.fn();
    const handlers = createRecoveryHandlers(s.service, () => false, openOriginal);

    for (const refused of [
      await handlers.store({} as never, s.request()),
      await handlers.clear({} as never, RECOVERY_ID),
      await handlers.list({} as never),
      await handlers.read({} as never, RECOVERY_ID),
      await handlers.openOriginal({} as never, RECOVERY_ID),
    ])
      expect(refused).toMatchObject({ status: "failed", error: { code: "INVALID_REQUEST" } });
    expect(store).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(openOriginal).not.toHaveBeenCalled();
    expect(await readdir(s.directory).catch(() => [])).toEqual([]);
  });

  it("stops writing once its window is gone", async () => {
    const s = await setup();
    s.service.dispose();
    expect(await s.service.store(s.request())).toMatchObject({
      status: "failed",
      error: { code: "STORE_UNAVAILABLE" },
    });
  });

  it("validates requests independently of the service", () => {
    expect(isRecoverySnapshotRequest({ recoveryId: RECOVERY_ID })).toBe(false);
    expect(
      isRecoverySnapshotRequest({
        recoveryId: RECOVERY_ID,
        sessionId: SESSION_ID,
        documentId: "A",
        title: "",
        capturedAt: "2026-09-12T10:00:00.000Z",
        backingTargetId: null,
        content: "{}",
      }),
    ).toBe(true);
  });
});

describe("recovery renderer boundary", () => {
  it("scopes every renderer capability to a recovery id, and exposes no path", async () => {
    const [preload, types] = await Promise.all([
      readFile(new URL("../../../electron/preload.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../electron/recovery-contract.ts", import.meta.url), "utf8"),
    ]);

    // Startup recovery needs to enumerate and read candidates, so those two
    // channels exist now. What it still cannot do is name a file.
    for (const channel of [
      "folio:recovery:store",
      "folio:recovery:clear",
      "folio:recovery:list",
      "folio:recovery:read",
      "folio:recovery:open-original",
    ])
      expect(preload).toContain(channel);
    for (const forbidden of ["userData", "readFile", "writeFile", "unlink", "readdir"])
      expect(preload).not.toContain(forbidden);

    const slice = (name: string) =>
      types.slice(types.indexOf(name), types.indexOf("}", types.indexOf(name)));
    // The request the renderer sends carries an opaque target, never a location.
    expect(slice("interface RecoverySnapshotRequest")).toContain("backingTargetId");
    expect(slice("interface RecoverySnapshotRequest")).not.toContain("path");
    // Neither does the summary it receives back.
    expect(slice("interface RecoveryCandidateSummary")).toContain("canOpenOriginal");
    expect(slice("interface RecoveryCandidateSummary")).not.toContain("path");
  });
});
