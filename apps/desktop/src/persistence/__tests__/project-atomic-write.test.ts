import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectFileSystem, writeProjectAtomically } from "../../../electron/project-atomic-write";

const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "folio-save-test-"));
  directories.push(directory);
  return { directory, target: path.join(directory, "artwork.folio") };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const ioError = (code: string) => Object.assign(new Error("private filesystem detail"), { code });

describe("project atomic replacement", () => {
  it.runIf(process.platform === "win32")(
    "preserves a destination locked by another Windows process",
    async () => {
      const { target, directory } = await setup();
      await writeFile(target, "locked original");
      const child = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          '$stream = [System.IO.File]::Open($env:FOLIO_TEST_LOCK_TARGET, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None); [Console]::WriteLine("READY"); [Console]::In.ReadLine() | Out-Null; $stream.Dispose()',
        ],
        { windowsHide: true, env: { ...process.env, FOLIO_TEST_LOCK_TARGET: target } },
      );
      const exited = once(child, "exit");
      try {
        const [ready] = await Promise.race([
          once(child.stdout, "data"),
          exited.then(() => {
            throw new Error("Lock holder exited before acquiring the file");
          }),
        ]);
        expect(String(ready)).toContain("READY");
        await expect(writeProjectAtomically(target, "new")).rejects.toMatchObject({
          code: expect.stringMatching(/^(PERMISSION_DENIED|REPLACE_FAILED)$/),
        });
      } finally {
        child.stdin.end("\n");
        await exited;
      }
      expect(await readFile(target, "utf8")).toBe("locked original");
      expect(await readdir(directory)).toEqual(["artwork.folio"]);
    },
  );
  it("creates and replaces a real file with exact UTF-8 bytes and no temporary leftovers", async () => {
    const { directory, target } = await setup();
    await writeProjectAtomically(target, "first — 研究");
    expect(await readFile(target, "utf8")).toBe("first — 研究");
    await writeProjectAtomically(target, "replacement — अभ्यास");
    expect(await readFile(target, "utf8")).toBe("replacement — अभ्यास");
    expect(await readdir(directory)).toEqual(["artwork.folio"]);
  });

  it("uses exclusive unique siblings and flushes/closes before rename", async () => {
    const { target } = await setup();
    const events: string[] = [];
    const temporaries: string[] = [];
    const fs = {
      ...projectFileSystem,
      open: vi.fn<typeof projectFileSystem.open>(async (temporary, flags, mode) => {
        expect(flags).toBe("wx");
        expect(path.dirname(String(temporary))).toBe(path.dirname(target));
        temporaries.push(String(temporary));
        const handle = await projectFileSystem.open(temporary, flags, mode);
        const write = handle.writeFile.bind(handle),
          sync = handle.sync.bind(handle),
          close = handle.close.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation(async (...args) => {
          events.push("write");
          return write(...args);
        });
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          events.push("sync");
          return sync();
        });
        vi.spyOn(handle, "close").mockImplementation(async () => {
          events.push("close");
          return close();
        });
        return handle;
      }),
      rename: vi.fn<typeof projectFileSystem.rename>(async (source, destination) => {
        events.push("rename");
        return projectFileSystem.rename(source, destination);
      }),
    };
    await writeProjectAtomically(target, "A", fs);
    await writeProjectAtomically(target, "B", fs);
    expect(new Set(temporaries).size).toBe(2);
    expect(events).toEqual([
      "write",
      "sync",
      "close",
      "rename",
      "write",
      "sync",
      "close",
      "rename",
    ]);
  });

  it.each(["writeFile", "sync", "close"] as const)(
    "preserves the old target on %s failure",
    async (method) => {
      const { target, directory } = await setup();
      await writeFile(target, "old");
      const fs = {
        ...projectFileSystem,
        open: vi.fn<typeof projectFileSystem.open>(async (...args) => {
          const handle = await projectFileSystem.open(...args);
          vi.spyOn(handle, method).mockRejectedValueOnce(ioError("ENOSPC"));
          return handle;
        }),
      };
      await expect(writeProjectAtomically(target, "new", fs)).rejects.toMatchObject({
        code: "WRITE_FAILED",
      });
      expect(await readFile(target, "utf8")).toBe("old");
      expect(await readdir(directory)).toEqual(["artwork.folio"]);
    },
  );

  it.each([
    ["EACCES", "PERMISSION_DENIED"],
    ["EROFS", "READ_ONLY"],
    ["ENOENT", "TARGET_UNAVAILABLE"],
  ])("maps temporary-open %s to %s and preserves the target", async (code, mapped) => {
    const { target } = await setup();
    await writeFile(target, "old");
    await expect(
      writeProjectAtomically(target, "new", {
        ...projectFileSystem,
        open: vi.fn().mockRejectedValue(ioError(code!)),
      }),
    ).rejects.toMatchObject({ code: mapped });
    expect(await readFile(target, "utf8")).toBe("old");
  });

  it.each([
    ["EBUSY", "REPLACE_FAILED"],
    ["EPERM", "PERMISSION_DENIED"],
  ])(
    "preserves old bytes and removes only its temp when rename fails with %s",
    async (code, mapped) => {
      const { target, directory } = await setup();
      await writeFile(target, "old");
      await writeFile(path.join(directory, ".folio-unrelated.tmp"), "keep");
      await expect(
        writeProjectAtomically(target, "new", {
          ...projectFileSystem,
          rename: vi.fn().mockRejectedValue(ioError(code!)),
        }),
      ).rejects.toMatchObject({ code: mapped });
      expect(await readFile(target, "utf8")).toBe("old");
      expect((await readdir(directory)).sort()).toEqual([".folio-unrelated.tmp", "artwork.folio"]);
    },
  );

  it("rejects a real read-only destination without changing it", async () => {
    const { target } = await setup();
    await writeFile(target, "old");
    await chmod(target, 0o444);
    try {
      await expect(writeProjectAtomically(target, "new")).rejects.toMatchObject({
        code: "READ_ONLY",
      });
      expect(await readFile(target, "utf8")).toBe("old");
    } finally {
      await chmod(target, 0o600);
    }
  });

  it("cancels replacement when the owning renderer lifetime ends", async () => {
    const { target, directory } = await setup();
    await writeFile(target, "old");
    await expect(
      writeProjectAtomically(target, "new", projectFileSystem, () => false),
    ).rejects.toMatchObject({ code: "TARGET_UNAVAILABLE" });
    expect(await readFile(target, "utf8")).toBe("old");
    expect(await readdir(directory)).toEqual(["artwork.folio"]);
  });

  it("reports a missing parent without creating arbitrary directories", async () => {
    const { directory } = await setup();
    await expect(
      writeProjectAtomically(path.join(directory, "missing", "file.folio"), "new"),
    ).rejects.toMatchObject({ code: "TARGET_UNAVAILABLE" });
    expect(await readdir(directory)).toEqual([]);
  });
});
