import { mkdtemp, readdir, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopRecoveryFileService } from "../../../electron/recovery-file-service";
import {
  MAXIMUM_RECOVERY_BYTES,
  RECOVERY_FILE_EXTENSION,
  type RecoverySnapshotRequest,
} from "../../../electron/recovery-contract";

const IDS = [
  "00000000-0000-4000-8000-0000000000a1",
  "00000000-0000-4000-8000-0000000000a2",
  "00000000-0000-4000-8000-0000000000a3",
] as const;
const SESSION_ID = "00000000-0000-4000-8000-0000000000b2";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "folio-recovery-hardening-"));
  directories.push(root);
  const directory = path.join(root, "recovery");
  const service = new DesktopRecoveryFileService({ directory });
  const request = (overrides: Partial<RecoverySnapshotRequest> = {}): RecoverySnapshotRequest => ({
    recoveryId: IDS[0],
    sessionId: SESSION_ID,
    documentId: "A",
    title: "Study A",
    capturedAt: "2026-09-13T10:00:00.000Z",
    backingTargetId: null,
    content: encodeFolioProject(createEmptyFolioProject({ documentId: "A", pageId: "page-A" })),
    ...overrides,
  });
  const write = async (name: string, content: string) => {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, name), content);
  };
  return { root, directory, service, request, write };
}

describe("recovery storage accepts exactly what it can read back", () => {
  it("refuses a snapshot whose envelope would exceed the read limit", async () => {
    const s = await setup();
    // Escaping expands the embedded project, so a payload measured on its own
    // can pass a write check and produce a file no read will ever accept.
    const expanding = `"${"\\".repeat(Math.floor(MAXIMUM_RECOVERY_BYTES * 0.7))}"`;
    const result = await s.service.store(s.request({ content: expanding }));

    if (result.status === "stored") {
      const [entry] = await readdir(s.directory);
      const raw = await readFile(path.join(s.directory, entry!), "utf8");
      expect(
        Buffer.byteLength(raw, "utf8"),
        "an accepted snapshot must be within the read limit",
      ).toBeLessThanOrEqual(MAXIMUM_RECOVERY_BYTES);
      expect(
        await s.service.read(IDS[0]),
        "the stored record could not be read back",
      ).not.toBeNull();
    } else {
      expect(result.error.code).toBe("TOO_LARGE");
      expect(await readdir(s.directory).catch(() => [])).toEqual([]);
    }
  });

  it("protects a project whose title and identity are valid for a project file", async () => {
    const s = await setup();
    // Canonical project limits allow these; recovery must not be the reason a
    // legitimate project goes unprotected.
    const result = await s.service.store(
      s.request({ title: "T".repeat(1024), documentId: "D".repeat(512) }),
    );

    expect(result, "recovery refused a project the project format accepts").toEqual({
      status: "stored",
    });
    expect(await s.service.read(IDS[0])).not.toBeNull();
  });

  it("refuses a record whose filename disagrees with what it contains", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const raw = await readFile(
      path.join(s.directory, `${IDS[0]}${RECOVERY_FILE_EXTENSION}`),
      "utf8",
    );
    // A record copied or renamed under another id is not that id's record.
    await s.write(`${IDS[1]}${RECOVERY_FILE_EXTENSION}`, raw);

    expect(await s.service.read(IDS[1]), "a mismatched filename was trusted").toBeNull();
    const offered = await s.service.list();
    expect(offered.map((one) => one.recoveryId)).toEqual([IDS[0]]);
  });

  it("refuses anything that is not a regular file", async () => {
    const s = await setup();
    await s.service.store(s.request());
    const real = path.join(s.directory, `${IDS[0]}${RECOVERY_FILE_EXTENSION}`);
    let linked = false;
    try {
      await symlink(real, path.join(s.directory, `${IDS[1]}${RECOVERY_FILE_EXTENSION}`));
      linked = true;
    } catch {
      // Creating symlinks needs a privilege this machine may not grant.
    }
    await mkdir(path.join(s.directory, `${IDS[2]}${RECOVERY_FILE_EXTENSION}`), { recursive: true });

    expect(await s.service.read(IDS[2]), "a directory was read as a record").toBeNull();
    if (linked) expect(await s.service.read(IDS[1]), "a symlink was followed").toBeNull();
    // The genuine record beside them is still offered.
    expect((await s.service.list()).map((one) => one.recoveryId)).toEqual([IDS[0]]);
  });

  it("keeps no payloads while deciding what to offer", async () => {
    const s = await setup();
    for (const id of IDS) await s.service.store(s.request({ recoveryId: id }));

    const offered = await s.service.list();
    expect(offered).toHaveLength(3);
    // Discovery returns what the renderer may see, not three whole projects.
    expect(JSON.stringify(offered)).not.toContain("folio-project");
    for (const candidate of offered) {
      expect(Object.hasOwn(candidate, "project")).toBe(false);
      expect(Object.hasOwn(candidate, "source")).toBe(false);
    }
  });

  it("lets one unreadable record sit beside the ones that still work", async () => {
    const s = await setup();
    await s.service.store(s.request());
    await s.write(`${IDS[1]}${RECOVERY_FILE_EXTENSION}`, "{truncated");
    await s.write(`${IDS[2]}${RECOVERY_FILE_EXTENSION}`, "x".repeat(1024));

    expect((await s.service.list()).map((one) => one.recoveryId)).toEqual([IDS[0]]);
    // And nothing was deleted on a guess.
    expect((await readdir(s.directory)).length).toBe(3);
  });
});
