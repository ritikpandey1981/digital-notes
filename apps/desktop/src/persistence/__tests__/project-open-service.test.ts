import { mkdtemp, writeFile, readFile, truncate, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopProjectFileService } from "../../../electron/project-file-service";
import { MAXIMUM_PROJECT_BYTES, readDesktopProject } from "../../../electron/project-read";
import { PROJECT_LIMITS } from "../../../../../packages/persistence/src/project/project-validation";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "folio-open-service-"));
  directories.push(directory);
  const filename = path.join(directory, "chosen.FOLIO");
  await writeFile(filename, "approved project content");
  const chooseSource = vi
    .fn<() => Promise<readonly string[] | null>>()
    .mockResolvedValue([filename]);
  const read = vi.fn(readDesktopProject);
  const service = new DesktopProjectFileService({
    chooseSource,
    read,
    chooseDestination: async () => path.join(directory, "A.folio"),
    confirmReplacement: async () => true,
  });
  return { service, read, chooseSource, filename, directory };
}
describe("desktop project Open file authority", () => {
  it("uses the codec's authoritative encoded ceiling for Open and Save", () => {
    expect(MAXIMUM_PROJECT_BYTES).toBe(PROJECT_LIMITS.inputBytes);
  });
  it("cancels without reading", async () => {
    const { service, chooseSource, read } = await setup();
    chooseSource.mockResolvedValue(null);
    expect(await service.open()).toEqual({ status: "cancelled" });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(
    [[], ["relative.folio"], ["C:\\bad.txt"], ["one.folio", "two.folio"]].map((paths) => ({
      paths,
    })),
  )("rejects invalid dialog selection %j", async ({ paths }) => {
    const { service, chooseSource, read } = await setup();
    chooseSource.mockResolvedValue(paths);
    expect(await service.open()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects renderer paths before opening a dialog", async () => {
    const { service, chooseSource, filename } = await setup();
    expect(await service.open({ path: filename })).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expect(chooseSource).not.toHaveBeenCalled();
  });
  it("creates a provisional opaque target and adopts only explicitly", async () => {
    const { service, filename } = await setup();
    const result = await service.open();
    if (result.status !== "read") throw new Error("Expected file content");
    expect(result.content).toBe("approved project content");
    expect(result.backing.displayName).toBe("chosen.FOLIO");
    expect(JSON.stringify(result)).not.toContain(filename);
    expect(
      await service.save({ kind: "save", targetId: result.backing.id, content: "changed" }),
    ).toMatchObject({ error: { code: "BUSY" } });
    expect(await readFile(filename, "utf8")).toBe(result.content);
    expect(service.adopt(result.backing.id)).toEqual({
      status: "adopted",
      backing: result.backing,
    });
    expect(
      await service.save({ kind: "save", targetId: result.backing.id, content: "changed" }),
    ).toMatchObject({ status: "saved" });
    expect(await readFile(filename, "utf8")).toBe("changed");
  });
  it("release preserves A and stale provisionals cannot accumulate or be adopted", async () => {
    const { service } = await setup();
    const a = await service.save({ kind: "saveAs", title: "A", content: "A" });
    if (a.status !== "saved") throw new Error("Expected A backing");
    let stale = "";
    for (let index = 0; index < 5; index++) {
      const b = await service.open();
      if (b.status !== "read") throw new Error("Expected read");
      if (stale) expect(service.adopt(stale)).toMatchObject({ status: "failed" });
      stale = b.backing.id;
    }
    expect(service.release(stale)).toEqual({ status: "released" });
    expect(service.release(stale)).toEqual({ status: "released" });
    expect(service.adopt(stale)).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
    expect(
      await service.save({ kind: "save", targetId: a.backing.id, content: "edited A" }),
    ).toMatchObject({ status: "saved" });
  });
  it.each(["ENOENT", "EIO", "EACCES", "EPERM"])("sanitizes %s errors", async (code) => {
    const { service, read, filename } = await setup();
    read.mockRejectedValueOnce(Object.assign(new Error(`secret ${filename}`), { code }));
    const result = await service.open();
    expect(result).toMatchObject({
      error: { code: code === "EACCES" || code === "EPERM" ? "PERMISSION_DENIED" : "READ_FAILED" },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|stack|chosen/);
  });
  it("rejects oversized, missing, directory and invalid UTF-8 inputs", async () => {
    const { service, filename, chooseSource, directory } = await setup();
    await truncate(filename, MAXIMUM_PROJECT_BYTES + 1);
    expect(await service.open()).toMatchObject({ error: { code: "FILE_TOO_LARGE" } });
    chooseSource.mockResolvedValue([path.join(directory, "missing.folio")]);
    expect(await service.open()).toMatchObject({ error: { code: "READ_FAILED" } });
    const folder = path.join(directory, "folder.folio");
    await mkdir(folder);
    chooseSource.mockResolvedValue([folder]);
    expect(await service.open()).toMatchObject({ error: { code: "READ_FAILED" } });
    await writeFile(filename, Buffer.from([0xff, 0xfe]));
    chooseSource.mockResolvedValue([filename]);
    expect(await service.open()).toMatchObject({ error: { code: "READ_FAILED" } });
  });
  it.each(["revoke", "dispose"] as const)(
    "%s invalidates pending reads and all target capabilities",
    async (cleanup) => {
      const { service, read } = await setup();
      const first = await service.open();
      if (first.status !== "read") throw new Error("Expected read");
      let finish!: (text: string) => void;
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = service.open();
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      service[cleanup]();
      finish("late content");
      expect(await pending).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
      expect(service.adopt(first.backing.id)).toMatchObject({
        error: { code: "TARGET_UNAVAILABLE" },
      });
    },
  );
  it("serializes Open dialogs and Save while native selection is pending", async () => {
    const { service, chooseSource } = await setup();
    let finish!: (paths: null) => void;
    chooseSource.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.open();
    expect(await service.open()).toMatchObject({ error: { code: "BUSY" } });
    expect(await service.save({ kind: "saveAs", title: "A", content: "A" })).toMatchObject({
      error: { code: "BUSY" },
    });
    expect(chooseSource).toHaveBeenCalledTimes(1);
    finish(null);
    expect(await pending).toEqual({ status: "cancelled" });
  });
  it("rejects capabilities issued by another window", async () => {
    const { service } = await setup();
    const { service: other } = await setup();
    const read = await service.open();
    if (read.status !== "read") throw new Error("Expected read");
    expect(other.adopt(read.backing.id)).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
    expect(other.release(read.backing.id)).toEqual({ status: "released" });
    expect(service.adopt(read.backing.id).status).toBe("adopted");
  });
});
