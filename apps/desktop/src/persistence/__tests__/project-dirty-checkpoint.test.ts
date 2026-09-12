import { ProjectSession, ProjectRuntimeHost } from "@folio/editor";
import { createEmptyFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";

const FIRST = { id: "00000000-0000-4000-8000-000000000001", displayName: "first.folio" };
const saved = (backing = FIRST): ProjectSaveResult => ({ status: "saved", backing });
afterEach(() => vi.restoreAllMocks());

function createHistory(project: ProjectSession) {
  return createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    onDocumentChange: () => undefined,
  });
}

function setup() {
  const project = new ProjectSession(
    createEmptyFolioProject({ title: "Checkpoint study", pageId: "page-1" }),
  );
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue(saved());
  const coordinator = new ProjectPersistenceCoordinator(project, { save });
  return { project, save, coordinator, history: createHistory(project) };
}

describe("project dirty state and save checkpoints", () => {
  it("reports an untouched project as clean, disposable, and without a durable copy", () => {
    const { coordinator, history } = setup();

    // The blank sketch Folio just made is worth nothing to lose, so replacing it
    // is not a risk even though no file holds it.
    expect(coordinator.persistenceState).toEqual({
      isDirty: false,
      hasBackingFile: false,
      hasConfirmedCheckpoint: false,
      hasUnsavedRisk: false,
    });
    expect(Object.isFrozen(coordinator.persistenceState)).toBe(true);
    history.destroy();
  });

  it("becomes clean and durably backed only after a confirmed save", async () => {
    const { project, coordinator, history } = setup();
    history.executePageRename("page-1", "Edited before saving");

    expect(coordinator.persistenceState).toMatchObject({
      isDirty: true,
      hasBackingFile: false,
      hasConfirmedCheckpoint: false,
      hasUnsavedRisk: true,
    });

    expect((await coordinator.saveAs()).status).toBe("saved");
    expect(project.checkpointStateId).toBe(project.contentStateId);
    expect(coordinator.persistenceState).toEqual({
      isDirty: false,
      hasBackingFile: true,
      hasConfirmedCheckpoint: true,
      hasUnsavedRisk: false,
    });

    history.undo();
    expect(coordinator.persistenceState).toMatchObject({
      isDirty: true,
      hasBackingFile: true,
      hasConfirmedCheckpoint: true,
      hasUnsavedRisk: true,
    });
    history.redo();
    expect(coordinator.persistenceState.isDirty).toBe(false);
    history.destroy();
  });

  it("checkpoints the captured state, leaving later edits dirty when the write lands", async () => {
    const { project, save, coordinator, history } = setup();
    let finish!: (result: ProjectSaveResult) => void;
    save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const capturedStateId = project.contentStateId;

    const pending = coordinator.saveAs();
    history.executePageRename("page-1", "Edited during the write");
    const laterStateId = project.contentStateId;
    finish(saved());
    expect((await pending).status).toBe("saved");

    expect(project.checkpointStateId).toBe(capturedStateId);
    expect(project.contentStateId).toBe(laterStateId);
    expect(coordinator.persistenceState).toMatchObject({ isDirty: true, hasBackingFile: true });

    history.undo();
    expect(project.contentStateId).toBe(capturedStateId);
    expect(coordinator.persistenceState.isDirty).toBe(false);
    history.destroy();
  });

  it.each([
    ["cancellation", { status: "cancelled" } as ProjectSaveResult],
    [
      "confirmed failure",
      { status: "failed", error: { code: "WRITE_FAILED", message: "disk" } } as ProjectSaveResult,
    ],
  ])("preserves the previous checkpoint through %s", async (_name, outcome) => {
    const { project, save, coordinator, history } = setup();
    await coordinator.saveAs();
    const checkpoint = project.checkpointStateId;
    history.executePageRename("page-1", "Edited after saving");
    const edited = project.contentStateId;

    save.mockResolvedValue(outcome);
    expect(await coordinator.save()).toEqual(outcome);
    expect(await coordinator.saveAs()).toEqual(outcome);

    expect(project.checkpointStateId).toBe(checkpoint);
    expect(project.contentStateId).toBe(edited);
    expect(coordinator.persistenceState).toMatchObject({ isDirty: true, hasBackingFile: true });
    history.destroy();
  });

  it("never advances the checkpoint when the save result is unknown", async () => {
    const { project, save, coordinator, history } = setup();
    await coordinator.saveAs();
    const checkpoint = project.checkpointStateId;
    history.executePageRename("page-1", "Edited before a lost reply");

    save.mockRejectedValueOnce(new Error("reply lost"));
    expect(await coordinator.save()).toMatchObject({
      status: "failed",
      error: { code: "UNKNOWN" },
    });

    expect(project.checkpointStateId).toBe(checkpoint);
    expect(coordinator.persistenceState.isDirty).toBe(true);
    history.destroy();
  });

  it("preserves the checkpoint when encoding fails before any desktop call", async () => {
    const { project, save, coordinator, history } = setup();
    await coordinator.saveAs();
    const checkpoint = project.checkpointStateId;
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
    expect(project.checkpointStateId).toBe(checkpoint);
    history.destroy();
  });

  it("keeps each runtime's dirty state and checkpoint to itself across repeated replacement", async () => {
    const a = new ProjectSession(createEmptyFolioProject({ documentId: "A", pageId: "page-1" }));
    const host = new ProjectRuntimeHost(a, () => coordinator.canReplaceRuntime);
    const save = vi
      .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
      .mockResolvedValue(saved());
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
    const aHistory = createHistory(a);
    await coordinator.saveAs();
    aHistory.executePageRename("page-1", "Edited A");
    const aCheckpoint = a.checkpointStateId;
    expect(coordinator.persistenceState).toMatchObject({ isDirty: true, hasBackingFile: true });

    const rejected = new ProjectSession(createEmptyFolioProject({ documentId: "rejected" }));
    const failing = host.replace(rejected);
    activate(true);
    expect(await failing).toMatchObject({ status: "failed" });
    expect(host.active.project).toBe(a);
    expect(a.checkpointStateId).toBe(aCheckpoint);
    expect(coordinator.persistenceState).toMatchObject({ isDirty: true, hasBackingFile: true });

    for (const documentId of ["B", "C"]) {
      const next = new ProjectSession(
        createEmptyFolioProject({ documentId, pageId: `${documentId}-page` }),
      );
      const replacement = host.replace(next);
      activate();
      expect(await replacement).toMatchObject({ status: "activated" });
      // A fresh runtime has no confirmed durable copy, even though A had one.
      expect(coordinator.persistenceState).toEqual({
        isDirty: false,
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        hasUnsavedRisk: false,
      });

      const history = createHistory(next);
      history.executePageRename(`${documentId}-page`, `Edited ${documentId}`);
      expect(coordinator.persistenceState.isDirty).toBe(true);
      expect(a.isDirty).toBe(true);
      expect(a.checkpointStateId).toBe(aCheckpoint);

      await coordinator.save();
      expect(next.checkpointStateId).toBe(next.contentStateId);
      expect(coordinator.persistenceState).toMatchObject({ isDirty: false, hasBackingFile: true });
      expect(a.checkpointStateId).toBe(aCheckpoint);
      expect(next.checkpointStateId).not.toBe(aCheckpoint);
      history.destroy();
    }
    aHistory.destroy();
    host.active.activation?.dispose();
  });
});
