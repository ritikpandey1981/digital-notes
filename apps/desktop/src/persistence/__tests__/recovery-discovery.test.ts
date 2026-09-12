import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRecoveryFileService } from "../../../electron/recovery-file-service";
import { createRecoveryHandlers } from "../../../electron/recovery-ipc";
import type { ProjectReadResult } from "../../../electron/project-open-contract";
import type { RecoverySnapshotRequest } from "../../../electron/recovery-contract";

const IDS = [
  "00000000-0000-4000-8000-0000000000a1",
  "00000000-0000-4000-8000-0000000000a2",
  "00000000-0000-4000-8000-0000000000a3",
  "00000000-0000-4000-8000-0000000000a4",
] as const;
const SESSION_ID = "00000000-0000-4000-8000-0000000000b2";
const TARGET_ID = "00000000-0000-4000-8000-0000000000c3";
const ORIGINAL = "C:\\Users\\someone\\Sketches\\Study.folio";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup(
  options: {
    resolveBackingPath?: (id: string) => string | null;
    maximumCandidates?: number;
    maximumScanEntries?: number;
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "folio-recovery-discovery-"));
  directories.push(root);
  const directory = path.join(root, "recovery");
  const service = new DesktopRecoveryFileService({ directory, ...options });
  const request = (overrides: Partial<RecoverySnapshotRequest> = {}): RecoverySnapshotRequest => ({
    recoveryId: IDS[0],
    sessionId: SESSION_ID,
    documentId: "A",
    title: "Study A",
    capturedAt: "2026-09-12T10:00:00.000Z",
    backingTargetId: null,
    content: encodeFolioProject(createEmptyFolioProject({ documentId: "A", pageId: "page-A" })),
    ...overrides,
  });
  const openOriginal = vi.fn<(filename: string) => Promise<ProjectReadResult>>(async () => ({
    status: "read",
    content: "{}",
    backing: { id: TARGET_ID, displayName: "Study.folio" },
  }));
  const handlers = createRecoveryHandlers(service, () => true, openOriginal);
  const entries = () => readdir(directory).catch(() => [] as string[]);
  return { root, directory, service, request, handlers, openOriginal, entries };
}

const event = {} as never;

describe("startup recovery discovery", () => {
  it("offers nothing when no snapshot was left behind", async () => {
    const s = await setup();

    expect(await s.service.list()).toEqual([]);
    expect(await s.handlers.list(event)).toEqual({ status: "listed", candidates: [] });
  });

  it("describes one candidate without saying where anything lives", async () => {
    const s = await setup({ resolveBackingPath: () => ORIGINAL });
    await s.service.store(s.request({ backingTargetId: TARGET_ID, title: "Harbour study" }));

    const listed = await s.handlers.list(event);
    expect(listed).toEqual({
      status: "listed",
      candidates: [
        {
          recoveryId: IDS[0],
          documentId: "A",
          title: "Harbour study",
          capturedAt: "2026-09-12T10:00:00.000Z",
          hadBacking: true,
          canOpenOriginal: true,
        },
      ],
    });
    // Main knows the location; nothing crossing the boundary carries it.
    expect(JSON.stringify(listed)).not.toContain("Sketches");
    expect(JSON.stringify(listed)).not.toContain("path");
  });

  it("orders candidates by when they were captured, newest first", async () => {
    const s = await setup();
    await s.service.store(
      s.request({ recoveryId: IDS[0], capturedAt: "2026-09-01T08:00:00.000Z" }),
    );
    await s.service.store(
      s.request({ recoveryId: IDS[1], capturedAt: "2026-09-12T10:00:00.000Z" }),
    );
    await s.service.store(
      s.request({ recoveryId: IDS[2], capturedAt: "2026-09-05T22:30:00.000Z" }),
    );

    const listed = await s.handlers.list(event);
    expect(listed.status === "listed" && listed.candidates.map((one) => one.recoveryId)).toEqual([
      IDS[1],
      IDS[2],
      IDS[0],
    ]);
  });

  it("keeps a valid snapshot however old it is", async () => {
    const s = await setup();
    await s.service.store(s.request({ capturedAt: "2019-04-02T09:15:00.000Z" }));

    // Age sorts and it is shown; it is never a reason to delete artwork.
    expect((await s.service.list()).map((one) => one.recoveryId)).toEqual([IDS[0]]);
    await s.service.sweepTemporaryFiles();
    expect(await s.entries()).toEqual([`${IDS[0]}.folio-recovery`]);
  });

  it("offers a bounded newest subset and leaves the rest on disk", async () => {
    const s = await setup({ maximumCandidates: 2 });
    await s.service.store(
      s.request({ recoveryId: IDS[0], capturedAt: "2026-09-01T08:00:00.000Z" }),
    );
    await s.service.store(
      s.request({ recoveryId: IDS[1], capturedAt: "2026-09-12T10:00:00.000Z" }),
    );
    await s.service.store(
      s.request({ recoveryId: IDS[2], capturedAt: "2026-09-05T22:30:00.000Z" }),
    );

    expect((await s.service.list()).map((one) => one.recoveryId)).toEqual([IDS[1], IDS[2]]);
    expect((await s.entries()).length).toBe(3);
  });

  it("stops parsing a flooded directory rather than stalling startup", async () => {
    const s = await setup({ maximumScanEntries: 2 });
    for (const id of [IDS[0], IDS[1], IDS[2]]) await s.service.store(s.request({ recoveryId: id }));

    expect((await s.service.list()).length).toBe(2);
    expect((await s.entries()).length).toBe(3);
  });

  it("survives a file that is not a recovery record, and leaves it alone", async () => {
    const s = await setup();
    await s.service.store(s.request());
    await writeFile(path.join(s.directory, `${IDS[1]}.folio-recovery`), "{truncated");
    await writeFile(
      path.join(s.directory, `${IDS[2]}.folio-recovery`),
      JSON.stringify({ format: "something-else", formatVersion: 1 }),
    );

    const listed = await s.handlers.list(event);
    expect(listed.status === "listed" && listed.candidates.map((one) => one.recoveryId)).toEqual([
      IDS[0],
    ]);
    // Unreadable is not the same as worthless: a later version may understand it.
    expect((await s.entries()).sort()).toEqual(
      [`${IDS[0]}.folio-recovery`, `${IDS[1]}.folio-recovery`, `${IDS[2]}.folio-recovery`].sort(),
    );
  });

  it("clears only the temporary files its own writes create", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const keep: readonly [string, string][] = [
      ["notes.txt", "not a recovery record"],
      ["folio-settings.json", "{}"],
      // Close, but not this service's naming: left strictly alone.
      [".folio-not-a-uuid.tmp", "x"],
      ["folio-00000000-0000-4000-8000-0000000000f1.tmp", "x"],
    ];
    for (const [name, content] of keep) await writeFile(path.join(s.directory, name), content);
    await writeFile(path.join(s.directory, ".folio-00000000-0000-4000-8000-0000000000f2.tmp"), "x");

    expect(await s.service.sweepTemporaryFiles()).toBe(1);
    expect((await s.entries()).sort()).toEqual(
      [`${IDS[0]}.folio-recovery`, ...keep.map(([name]) => name)].sort(),
    );
  });

  it("hands back one candidate's artwork and nothing else about it", async () => {
    const s = await setup({ resolveBackingPath: () => ORIGINAL });
    const content = encodeFolioProject(
      createEmptyFolioProject({ documentId: "A", title: "Harbour", pageId: "page-A" }),
    );
    await s.service.store(s.request({ backingTargetId: TARGET_ID, content }));

    const read = await s.handlers.read(event, IDS[0]);
    expect(read).toEqual({ status: "read", content });
    expect(JSON.stringify(read)).not.toContain("Sketches");
    expect(await s.handlers.read(event, IDS[1])).toMatchObject({
      status: "failed",
      error: { code: "NOT_FOUND" },
    });
    expect(await s.handlers.read(event, "../../project")).toMatchObject({
      status: "failed",
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("opens the original from the location it stored, never one it was given", async () => {
    const s = await setup({ resolveBackingPath: () => ORIGINAL });
    await s.service.store(s.request({ backingTargetId: TARGET_ID }));

    expect(await s.handlers.openOriginal(event, IDS[0])).toMatchObject({ status: "read" });
    expect(s.openOriginal).toHaveBeenCalledWith(ORIGINAL);
  });

  it("refuses to open an original for a candidate that never had one", async () => {
    const s = await setup();
    await s.service.store(s.request());

    // A candidate with no stored location, and one that is not there at all.
    for (const id of [IDS[0], IDS[1]])
      expect(await s.handlers.openOriginal(event, id)).toMatchObject({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE" },
      });
    expect(await s.handlers.openOriginal(event, "../../secrets.folio")).toMatchObject({
      status: "failed",
      error: { code: "INVALID_REQUEST" },
    });
    expect(s.openOriginal).not.toHaveBeenCalled();
  });

  it("reads back exactly the record it wrote, for the flow that consumes it", async () => {
    const s = await setup({ resolveBackingPath: () => ORIGINAL });
    await s.service.store(s.request({ backingTargetId: TARGET_ID }));

    const record = await s.service.read(IDS[0]);
    expect(record?.source).toEqual({ path: ORIGINAL });
    expect(await s.service.read("not-an-id")).toBeNull();
    const raw = await readFile(path.join(s.directory, `${IDS[0]}.folio-recovery`), "utf8");
    expect(JSON.parse(raw)).toEqual(record);
  });
});
