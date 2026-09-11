import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProjectSession } from "@folio/editor";
import {
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
} from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopProjectFileService,
  projectDestination,
  suggestProjectFilename,
} from "../../../electron/project-file-service";
import { ProjectWriteError, writeProjectAtomically } from "../../../electron/project-atomic-write";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "folio-service-test-"));
  directories.push(directory);
  const target = path.join(directory, "Selected filename.folio");
  const chooseDestination = vi.fn<() => Promise<string | null>>().mockResolvedValue(target);
  const confirmReplacement = vi.fn().mockResolvedValue(true);
  const service = new DesktopProjectFileService({ chooseDestination, confirmReplacement });
  return { directory, target, chooseDestination, confirmReplacement, service };
}
const request = { kind: "saveAs", title: "Logical project", content: "encoded A" } as const;

describe("desktop project file authority", () => {
  it("returns cancellation without writing or creating a backing target", async () => {
    const { directory, service, chooseDestination } = await setup();
    chooseDestination.mockResolvedValue(null);
    expect(await service.save(request)).toEqual({ status: "cancelled" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("suggests a legal filename without changing the logical title", () => {
    expect(suggestProjectFilename("Study: lines / angles?")).toBe("Study_ lines _ angles_.folio");
    expect(suggestProjectFilename("CON")).toBe("_CON.folio");
    expect(suggestProjectFilename("study.FOLIO")).toBe("study.FOLIO");
    expect(suggestProjectFilename("  . ")).toBe("Untitled Sketch.folio");
  });

  it("appends a missing extension and rejects other extensions or relative paths", async () => {
    const { directory, service, chooseDestination } = await setup();
    const bare = path.join(directory, "bare");
    chooseDestination.mockResolvedValue(bare);
    const result = await service.save(request);
    expect(result).toMatchObject({ status: "saved", backing: { displayName: "bare.folio" } });
    expect(await readFile(`${bare}.folio`, "utf8")).toBe("encoded A");
    expect(projectDestination(path.join(directory, "other.txt"))).toBeNull();
    expect(projectDestination("relative.folio")).toBeNull();
  });

  it("confirms the final appended destination if it already exists", async () => {
    const { directory, service, chooseDestination, confirmReplacement } = await setup();
    const bare = path.join(directory, "existing");
    await writeFile(`${bare}.folio`, "old");
    chooseDestination.mockResolvedValue(bare);
    confirmReplacement.mockResolvedValue(false);
    expect(await service.save(request)).toEqual({ status: "cancelled" });
    expect(confirmReplacement).toHaveBeenCalledWith("existing.folio");
    expect(await readFile(`${bare}.folio`, "utf8")).toBe("old");
  });

  it("round-trips real ProjectSession content through coordinator, main service, and disk", async () => {
    const { service, target, chooseDestination } = await setup();
    const project = new ProjectSession(createEmptyFolioProject({ title: "My artwork" }));
    const session = project.documentSession;
    const rectangle = session.createRectangleObject(
      { x: 2, y: 3, width: 40, height: 50 },
      { strokeColor: "#123456", strokeWidth: 2 },
    );
    session.replacePageDocument(session.page.add(rectangle, session.activeLayerId));
    const coordinator = new ProjectPersistenceCoordinator(project, service);
    const first = await coordinator.saveAs();
    expect(first.status).toBe("saved");
    const originalId = coordinator.backing?.id;
    const saved = await readFile(target, "utf8");
    expect(encodeFolioProject(decodeFolioProject(saved))).toBe(
      encodeFolioProject(project.captureSnapshot()),
    );
    session.replaceDocument(
      session.sketchbook.replacePage(session.activePage.withName("Edited page")),
    );
    expect(await coordinator.save()).toMatchObject({
      status: "saved",
      backing: { id: originalId },
    });
    expect(decodeFolioProject(await readFile(target, "utf8")).sketchbook.firstPage.name).toBe(
      "Edited page",
    );
    expect(chooseDestination).toHaveBeenCalledTimes(1);
    expect(chooseDestination).toHaveBeenCalledWith("My artwork.folio");
    expect(project.metadata.title).toBe("My artwork");
    expect(JSON.stringify(first)).not.toContain(target);
  });

  it("keeps the old capability on Save As failure or cancel and revokes it only after success", async () => {
    const { chooseDestination, confirmReplacement, target, directory } = await setup();
    const write = vi.fn(writeProjectAtomically);
    const service = new DesktopProjectFileService({ chooseDestination, confirmReplacement, write });
    const first = await service.save(request);
    if (first.status !== "saved") throw new Error("Expected saved target");
    chooseDestination.mockResolvedValue(path.join(directory, "other.folio"));
    write.mockRejectedValueOnce(new ProjectWriteError("REPLACE_FAILED"));
    const failure = await service.save(request);
    expect(failure).toMatchObject({ status: "failed", error: { code: "REPLACE_FAILED" } });
    expect(
      await service.save({ kind: "save", targetId: first.backing.id, content: "B" }),
    ).toMatchObject({ status: "saved" });
    expect(await readFile(target, "utf8")).toBe("B");
    chooseDestination.mockResolvedValueOnce(null);
    expect(await service.save(request)).toEqual({ status: "cancelled" });
    expect(
      await service.save({ kind: "save", targetId: first.backing.id, content: "C" }),
    ).toMatchObject({ status: "saved" });
    expect((await service.save(request)).status).toBe("saved");
    expect(
      await service.save({ kind: "save", targetId: first.backing.id, content: "D" }),
    ).toMatchObject({ status: "failed", error: { code: "TARGET_UNAVAILABLE" } });
    expect(await readFile(target, "utf8")).toBe("C");
  });

  it("serializes dialogs and refuses capabilities from other windows", async () => {
    const { service, target, chooseDestination } = await setup();
    let finish!: (value: string | null) => void;
    chooseDestination.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.save(request);
    expect(await service.save(request)).toMatchObject({ error: { code: "BUSY" } });
    expect(
      await service.save({
        kind: "save",
        targetId: "00000000-0000-4000-8000-000000000001",
        content: "B",
      }),
    ).toMatchObject({ error: { code: "BUSY" } });
    finish(target);
    const saved = await pending;
    if (saved.status !== "saved") throw new Error("Expected saved target");
    const other = new DesktopProjectFileService({
      chooseDestination,
      confirmReplacement: async () => true,
    });
    expect(
      await other.save({ kind: "save", targetId: saved.backing.id, content: "B" }),
    ).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
    service.revoke();
    expect(
      await service.save({ kind: "save", targetId: saved.backing.id, content: "B" }),
    ).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
  });

  it("refuses to write after the window closes while the dialog is pending", async () => {
    const { service, target, directory, chooseDestination } = await setup();
    let finish!: (value: string | null) => void;
    chooseDestination.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = service.save(request);
    service.dispose();
    finish(target);
    expect(await pending).toMatchObject({ error: { code: "TARGET_UNAVAILABLE" } });
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    null,
    [],
    {},
    { ...request, path: "forbidden" },
    { ...request, content: 42 },
    { ...request, title: "" },
    { kind: "save", targetId: "arbitrary-path", content: "x" },
  ])("rejects malformed IPC data without invoking the dialog", async (input) => {
    const { service, chooseDestination } = await setup();
    const result = await service.save(input);
    expect(result).toMatchObject({ status: "failed", error: { code: "INVALID_REQUEST" } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(chooseDestination).not.toHaveBeenCalled();
  });
});
