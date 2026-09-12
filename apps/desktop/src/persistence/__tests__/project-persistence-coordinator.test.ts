import { ProjectSession, ProjectRuntimeHost } from "@folio/editor";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import { createEmptyFolioProject, decodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";

const FIRST = { id: "00000000-0000-4000-8000-000000000001", displayName: "first.folio" };
const SECOND = { id: "00000000-0000-4000-8000-000000000002", displayName: "second.folio" };
const success = (backing = FIRST): ProjectSaveResult => ({ status: "saved", backing });
afterEach(() => vi.restoreAllMocks());

function setup() {
  const project = new ProjectSession(createEmptyFolioProject({ title: "Logical title" }));
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue(success());
  return { project, save, coordinator: new ProjectPersistenceCoordinator(project, { save }) };
}

describe("project manual save coordinator", () => {
  it("retains A after failed preparation, then captures edited B after a successful handoff", async () => {
    const a = new ProjectSession(createEmptyFolioProject({ documentId: "A" }));
    const host = new ProjectRuntimeHost(a, () => !coordinator.isSaving);
    const save = vi
      .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
      .mockResolvedValue(success());
    const coordinator: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
      () => host.active.project,
      { save },
      () => !host.replacing,
    );
    const activate = (fail = false) => {
      const entry = host.getSnapshot().at(-1)!;
      const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
      entry.activation = scope;
      if (fail) scope.report(new Error("candidate failure"));
      host.prepared(
        entry,
        scope.finishPreparation(() => undefined),
      );
    };
    activate();
    await coordinator.saveAs();
    const failed = host.replace(
      new ProjectSession(createEmptyFolioProject({ documentId: "failed" })),
    );
    expect(await coordinator.save()).toMatchObject({ status: "failed", error: { code: "BUSY" } });
    activate(true);
    expect(await failed).toMatchObject({ status: "failed" });
    expect(host.active.project).toBe(a);
    expect(coordinator.backing).toEqual(FIRST);
    await coordinator.save();
    expect(decodeFolioProject(save.mock.calls.at(-1)![0].content).metadata.documentId).toBe("A");
    for (const documentId of ["B", "C"]) {
      const project = new ProjectSession(createEmptyFolioProject({ documentId }));
      const replacement = host.replace(project);
      activate();
      expect(await replacement).toMatchObject({ status: "activated" });
      expect(coordinator.backing).toBeNull();
      const history = createEditorHistoryCoordinator({
        documentSession: project.documentSession,
        onDocumentChange: () => undefined,
      });
      history.executePageRename(project.documentSession.activePageId, `Edited ${documentId}`);
      await coordinator.save();
      const request = save.mock.calls.at(-1)![0];
      expect(request.kind).toBe("saveAs");
      const captured = decodeFolioProject(request.content);
      expect(captured.metadata.documentId).toBe(documentId);
      expect(captured.sketchbook.firstPage.name).toBe(`Edited ${documentId}`);
      await coordinator.save();
      expect(save.mock.calls.at(-1)![0].kind).toBe("save");
      history.destroy();
    }
    expect(a.documentSession.activePage.name).not.toBe("Edited C");
    host.active.activation?.dispose();
  });

  it("refuses replacement while an existing Save is awaiting its result", async () => {
    let finish!: (result: ProjectSaveResult) => void;
    const a = new ProjectSession(createEmptyFolioProject());
    const host = new ProjectRuntimeHost(a, () => !coordinator.isSaving);
    const coordinator: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
      () => host.active.project,
      {
        save: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
      () => !host.replacing,
    );
    const saving = coordinator.save();
    expect(await host.replace(new ProjectSession(createEmptyFolioProject()))).toEqual({
      status: "busy",
    });
    finish(success());
    expect(await saving).toEqual(success());
    expect(host.active.project).toBe(a);
  });
  it("saves as, then saves current content to the returned opaque target", async () => {
    const { project, save, coordinator } = setup();
    expect(coordinator.backing).toBeNull();
    expect(await coordinator.saveAs()).toEqual(success());
    expect(save.mock.calls[0]![0]).toMatchObject({ kind: "saveAs", title: "Logical title" });
    expect(coordinator.backing).toEqual(FIRST);
    expect(Object.isFrozen(coordinator.backing)).toBe(true);
    await coordinator.save();
    expect(save.mock.calls[1]![0]).toMatchObject({ kind: "save", targetId: FIRST.id });
    expect(decodeFolioProject(save.mock.calls[1]![0].content).metadata).toEqual(project.metadata);
    expect(project.metadata.title).toBe("Logical title");
  });

  it("delegates Save without a backing target to Save As", async () => {
    const { save, coordinator } = setup();
    await coordinator.save();
    expect(save.mock.calls[0]![0].kind).toBe("saveAs");
  });

  it("keeps an existing target on cancellation and changes it only on successful Save As", async () => {
    const { save, coordinator } = setup();
    await coordinator.saveAs();
    save.mockResolvedValueOnce({ status: "cancelled" });
    expect(await coordinator.saveAs()).toEqual({ status: "cancelled" });
    expect(coordinator.backing).toEqual(FIRST);
    save.mockResolvedValueOnce(success(SECOND));
    await coordinator.saveAs();
    expect(coordinator.backing).toEqual(SECOND);
  });

  it.each([
    "WRITE_FAILED",
    "REPLACE_FAILED",
    "PERMISSION_DENIED",
    "READ_ONLY",
    "TARGET_UNAVAILABLE",
  ] as const)("retains the previous target on %s from either save operation", async (code) => {
    const { save, coordinator } = setup();
    await coordinator.saveAs();
    const failure: ProjectSaveResult = { status: "failed", error: { code, message: "Failure" } };
    save.mockResolvedValue(failure);
    expect(await coordinator.save()).toEqual(failure);
    expect(await coordinator.saveAs()).toEqual(failure);
    expect(coordinator.backing).toEqual(FIRST);
  });

  it("makes no desktop call and preserves backing state when encoding fails", async () => {
    const { project, save, coordinator } = setup();
    await coordinator.saveAs();
    const valid = project.captureSnapshot();
    vi.spyOn(ProjectSession.prototype, "captureSnapshot").mockReturnValue({
      ...valid,
      metadata: { ...valid.metadata, title: "" },
    });
    expect(await coordinator.save()).toMatchObject({
      status: "failed",
      error: { code: "ENCODE_FAILED" },
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(coordinator.backing).toEqual(FIRST);
  });

  it("saves captured A while live B advances and refuses simultaneous Save/Save As", async () => {
    const { project, save, coordinator } = setup();
    let finish!: (result: ProjectSaveResult) => void;
    save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const original = project.captureSnapshot();
    const pending = coordinator.saveAs();
    const session = project.documentSession;
    session.replaceDocument(session.sketchbook.replacePage(session.activePage.withName("Later B")));
    const current = session.sketchbook;
    expect(coordinator.backing).toBeNull();
    for (const result of [await coordinator.save(), await coordinator.saveAs()]) {
      expect(result).toMatchObject({ status: "failed", error: { code: "BUSY" } });
    }
    expect(save).toHaveBeenCalledTimes(1);
    finish(success());
    await pending;
    expect(decodeFolioProject(save.mock.calls[0]![0].content).sketchbook.firstPage.name).toBe(
      original.sketchbook.firstPage.name,
    );
    expect(session.sketchbook).toBe(current);
    expect(current.firstPage.name).toBe("Later B");
    expect(project.metadata).toBe(original.metadata);
    await coordinator.save();
    expect(decodeFolioProject(save.mock.calls[1]![0].content).sketchbook.firstPage.name).toBe(
      "Later B",
    );
  });

  it("maps a lost IPC reply to UNKNOWN without inventing save success", async () => {
    const { save, coordinator } = setup();
    save.mockRejectedValueOnce(new Error("internal IPC detail"));
    const result = await coordinator.save();
    expect(result).toMatchObject({ status: "failed", error: { code: "UNKNOWN" } });
    expect(JSON.stringify(result)).not.toContain("internal IPC detail");
    expect(coordinator.backing).toBeNull();
    expect(await coordinator.save()).toEqual(success());
  });
});
