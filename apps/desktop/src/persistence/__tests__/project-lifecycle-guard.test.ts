import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import { EditorSelectionSet } from "../../../../../packages/editor/src/EditorSelectionSet";
import type {
  DesktopProjectOpenPort,
  ProjectReadResult,
} from "../../../electron/project-open-contract";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import {
  ProjectLifecycleCoordinator,
  type UnsavedChangesDecision,
  type UnsavedChangesRequest,
} from "../project-lifecycle-coordinator";

const BACKING = { id: "00000000-0000-4000-8000-000000000001", displayName: "a.folio" };
const OPENED = { id: "00000000-0000-4000-8000-0000000000b0", displayName: "b.folio" };
const saved = (backing = BACKING): ProjectSaveResult => ({ status: "saved", backing });
afterEach(() => vi.restoreAllMocks());

type ActivationFailure = "none" | "prepare" | "activate";

function setup() {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue(saved());
  const openedProject = createEmptyFolioProject({
    documentId: "B",
    title: "Study B",
    pageId: "page-B",
  });
  const read = vi.fn<() => Promise<ProjectReadResult>>().mockResolvedValue({
    status: "read",
    content: encodeFolioProject(openedProject),
    backing: OPENED,
  });
  const port: DesktopProjectOpenPort = {
    open: read,
    adopt: vi.fn(async () => ({ status: "adopted", backing: OPENED }) as const),
    release: vi.fn(async () => ({ status: "released" }) as const),
  };
  const host = new ProjectRuntimeHost(a, () => persistence.canReplaceRuntime);
  const persistence: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    { save },
    () => !host.replacing,
    { host, port },
  );
  const decisions: UnsavedChangesDecision[] = [];
  const asked: UnsavedChangesRequest[] = [];
  const confirmReplacement = vi.fn(async (request: UnsavedChangesRequest) => {
    asked.push(request);
    return decisions.shift() ?? "cancel";
  });
  const lifecycle = new ProjectLifecycleCoordinator(persistence, { confirmReplacement });

  let failure: ActivationFailure = "none";
  const activations = new Map<ProjectRuntime, { dispose: ReturnType<typeof vi.fn> }>();
  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    const dispose = vi.fn();
    if (failure === "prepare") scope.report(new Error("preparation rejected"));
    if (failure === "activate")
      scope.onActive(() => {
        throw new Error("activation rejected");
      });
    activations.set(entry, { dispose });
    host.prepared(entry, scope.finishPreparation(dispose));
  };
  prepare(host.active);
  const unsubscribe = host.subscribe(() => {
    const candidate = host.getSnapshot()[1];
    if (candidate && candidate.activation === null) prepare(candidate);
  });

  const history = () =>
    createEditorHistoryCoordinator({
      documentSession: host.active.project.documentSession,
      onDocumentChange: () => undefined,
    });
  return {
    a,
    host,
    save,
    read,
    port,
    persistence,
    lifecycle,
    confirmReplacement,
    asked,
    history,
    decide: (...next: UnsavedChangesDecision[]) => decisions.push(...next),
    fail: (mode: ActivationFailure) => {
      failure = mode;
    },
    /** Edits the active project through a real command, so it is genuinely dirty. */
    edit: (name: string) => {
      const editor = history();
      editor.executePageRename(host.active.project.documentSession.activePageId, name);
      editor.destroy();
    },
    cleanup: () => {
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("destructive project guard", () => {
  it("replaces an untouched blank project without asking", async () => {
    const s = setup();
    try {
      expect(s.lifecycle.requiresConfirmation).toBe(false);
      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "proceeded" });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("replaces a clean, durably backed project without asking", async () => {
    const s = setup();
    try {
      s.edit("Worth saving");
      expect((await s.persistence.saveAs()).status).toBe("saved");

      expect(s.lifecycle.requiresConfirmation).toBe(false);
      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "proceeded" });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("asks before replacing edited artwork, whether or not a file backs it", async () => {
    for (const backed of [false, true]) {
      const s = setup();
      try {
        if (backed) {
          s.edit("First");
          await s.persistence.saveAs();
        }
        s.edit("Unsaved work");

        expect(s.lifecycle.requiresConfirmation).toBe(true);
        s.decide("discard");
        expect(await s.lifecycle.requestNewProject()).toEqual({ status: "proceeded" });
        expect(s.confirmReplacement).toHaveBeenCalledTimes(1);
        expect(s.asked[0]).toEqual({ intent: "new", title: "Study A" });
      } finally {
        s.cleanup();
      }
    }
  });

  it("asks before replacing a project whose file association was never confirmed", async () => {
    const s = setup();
    try {
      vi.mocked(s.port.adopt).mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "revoked" },
      });
      expect((await s.persistence.open()).status).toBe("activated-unbacked");
      // Nothing has edited B, so content dirtiness alone would wave this through.
      expect(s.persistence.persistenceState).toMatchObject({
        isDirty: false,
        hasBackingFile: false,
        hasUnsavedRisk: true,
      });

      expect(s.lifecycle.requiresConfirmation).toBe(true);
      s.decide("cancel");
      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "cancelled" });
      expect(s.host.active.project.metadata.documentId).toBe("B");
    } finally {
      s.cleanup();
    }
  });

  it("proceeds only after a confirmed save, and leaves the project saved", async () => {
    const s = setup();
    try {
      s.edit("Save me");
      s.decide("save");

      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "proceeded" });
      expect(s.save).toHaveBeenCalledTimes(1);
      expect(s.save.mock.calls[0]![0].kind).toBe("saveAs");
      expect(s.a.isDirty).toBe(false);
      expect(s.a.checkpointStateId).toBe(s.a.contentStateId);
      expect(s.host.active.project).not.toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it.each([
    [
      "a confirmed failure",
      { status: "failed", error: { code: "WRITE_FAILED", message: "disk" } } as ProjectSaveResult,
      "SAVE_FAILED",
    ],
    [
      "an unconfirmed result",
      { status: "failed", error: { code: "UNKNOWN", message: "lost" } } as ProjectSaveResult,
      "SAVE_UNCONFIRMED",
    ],
  ])("keeps the project when saving ends in %s", async (_name, outcome, code) => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      const stateId = s.a.contentStateId;
      s.save.mockResolvedValue(outcome);
      s.decide("save");

      expect(await s.lifecycle.requestNewProject()).toEqual({
        status: "failed",
        error: { code, message: expect.any(String) },
      });
      expect(s.host.active.project).toBe(s.a);
      expect(s.a.contentStateId).toBe(stateId);
      expect(s.a.checkpointStateId).toBeNull();
      expect(s.persistence.persistenceState.hasUnsavedRisk).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("treats backing out of the destination picker as cancelling the request", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.save.mockResolvedValue({ status: "cancelled" });
      s.decide("save");

      // Changing your mind about where to save is not consent to lose the work.
      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "cancelled" });
      expect(s.host.active.project).toBe(s.a);
      expect(s.a.isDirty).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the exact project when the request is cancelled", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      const runtime = s.host.active;
      const root = s.a.documentSession.getDocument();
      s.decide("cancel");

      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "cancelled" });
      expect(s.host.active).toBe(runtime);
      expect(s.a.documentSession.getDocument()).toBe(root);
      expect(s.save).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("refuses a second lifecycle request while one is still being decided", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      let answer!: (decision: UnsavedChangesDecision) => void;
      s.confirmReplacement.mockReturnValueOnce(
        new Promise<UnsavedChangesDecision>((resolve) => {
          answer = resolve;
        }),
      );
      const pending = s.lifecycle.requestNewProject();

      for (const request of [
        () => s.lifecycle.requestNewProject(),
        () => s.lifecycle.requestOpenProject(),
        () => s.lifecycle.requestCloseProject(),
      ]) {
        expect(await request()).toMatchObject({ status: "failed", error: { code: "BUSY" } });
      }
      expect(s.confirmReplacement).toHaveBeenCalledTimes(1);
      answer("cancel");
      expect(await pending).toEqual({ status: "cancelled" });
    } finally {
      s.cleanup();
    }
  });

  it("refuses a lifecycle request while a save is already in flight", async () => {
    const s = setup();
    try {
      let finish!: (result: ProjectSaveResult) => void;
      s.save.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = s.persistence.saveAs();

      expect(await s.lifecycle.requestNewProject()).toMatchObject({
        status: "failed",
        error: { code: "BUSY" },
      });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
      finish(saved());
      await pending;
    } finally {
      s.cleanup();
    }
  });

  it("ignores session-only changes on a saved project", async () => {
    const s = setup();
    try {
      const editor = s.history();
      const added = editor.executeAddPage();
      const layer = editor.executeAddLayer("Second");
      await s.persistence.saveAs();
      const session = s.a.documentSession;
      const selection = new EditorSelectionSet();

      session.setActivePageId(added.pageId);
      session.setActiveLayerId(layer.layerId);
      session.rememberViewport(added.pageId, { zoom: 4, position: { x: 1, y: 2 }, mode: "manual" });
      selection.replace(["anything"]);

      expect(s.lifecycle.requiresConfirmation).toBe(false);
      expect(await s.lifecycle.requestCloseProject()).toEqual({ status: "proceeded" });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
      editor.destroy();
    } finally {
      s.cleanup();
    }
  });
});

describe("new project lifecycle", () => {
  it("creates a fresh unbacked project and forgets the previous file", async () => {
    const s = setup();
    try {
      s.edit("Saved A");
      await s.persistence.saveAs();
      expect(s.persistence.backing).toEqual(BACKING);

      expect(await s.lifecycle.requestNewProject()).toEqual({ status: "proceeded" });
      const created = s.host.active.project;

      expect(created).not.toBe(s.a);
      expect(created.metadata.documentId).not.toBe(s.a.metadata.documentId);
      expect(created.metadata.createdAt).toEqual(expect.any(String));
      expect(created.documentSession.activePageId).not.toBe("page-A");
      expect(created.documentSession.collection.size).toBe(0);
      expect(created.contentStateId).toBe(created.baselineStateId);
      expect(created.checkpointStateId).toBeNull();
      expect(created.origin).toBe("created");
      expect(s.persistence.backing).toBeNull();
      expect(s.persistence.persistenceState).toEqual({
        isDirty: false,
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        hasUnsavedRisk: false,
      });
      expect(s.host.getSnapshot()).toEqual([s.host.active]);
    } finally {
      s.cleanup();
    }
  });

  it("sends the next Save of a new project to Save As, not the old file", async () => {
    const s = setup();
    try {
      s.edit("Saved A");
      await s.persistence.saveAs();
      await s.lifecycle.requestNewProject();
      s.edit("New work");

      expect(s.persistence.persistenceState.hasUnsavedRisk).toBe(true);
      expect((await s.persistence.save()).status).toBe("saved");
      expect(s.save.mock.calls.at(-1)![0].kind).toBe("saveAs");
    } finally {
      s.cleanup();
    }
  });

  it.each(["prepare", "activate"] as const)(
    "keeps the current project exactly when a new runtime fails to %s",
    async (mode) => {
      const s = setup();
      try {
        s.edit("Saved A");
        await s.persistence.saveAs();
        s.edit("Unsaved work");
        const runtime = s.host.active;
        const root = s.a.documentSession.getDocument();
        const stateId = s.a.contentStateId;
        const checkpoint = s.a.checkpointStateId;
        // Discard authorizes the replacement; it must not destroy A by itself.
        s.decide("discard");
        s.fail(mode);

        expect(await s.lifecycle.requestNewProject()).toMatchObject({
          status: "failed",
          error: { code: "NEW_FAILED" },
        });
        expect(s.host.active).toBe(runtime);
        expect(s.host.active.project).toBe(s.a);
        expect(s.a.documentSession.getDocument()).toBe(root);
        expect(s.a.contentStateId).toBe(stateId);
        expect(s.a.checkpointStateId).toBe(checkpoint);
        expect(s.persistence.backing).toEqual(BACKING);
      } finally {
        s.cleanup();
      }
    },
  );
});

describe("guarded project open", () => {
  it("never reaches the file picker when the request is cancelled", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.decide("cancel");

      expect(await s.lifecycle.requestOpenProject()).toEqual({ status: "cancelled" });
      expect(s.read).not.toHaveBeenCalled();
      expect(s.host.active.project).toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it.each(["save", "discard"] as const)("opens the next project after %s", async (decision) => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.decide(decision);

      expect(await s.lifecycle.requestOpenProject()).toEqual({ status: "proceeded" });
      expect(s.host.active.project.metadata.documentId).toBe("B");
      expect(s.save).toHaveBeenCalledTimes(decision === "save" ? 1 : 0);
      // A was saved before being replaced, or deliberately left alone.
      expect(s.a.isDirty).toBe(decision !== "save");
    } finally {
      s.cleanup();
    }
  });

  it("keeps the saved project active when the incoming project fails to load", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.decide("save");
      s.read.mockResolvedValue({
        status: "failed",
        error: { code: "READ_FAILED", message: "missing" },
      });

      expect(await s.lifecycle.requestOpenProject()).toMatchObject({
        status: "failed",
        error: { code: "OPEN_FAILED" },
      });
      expect(s.host.active.project).toBe(s.a);
      expect(s.a.isDirty).toBe(false);
      expect(s.persistence.persistenceState.hasUnsavedRisk).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the discarded project exactly as it was when the incoming project fails", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      const root = s.a.documentSession.getDocument();
      const stateId = s.a.contentStateId;
      s.decide("discard");
      s.read.mockResolvedValue({
        status: "failed",
        error: { code: "READ_FAILED", message: "missing" },
      });

      expect((await s.lifecycle.requestOpenProject()).status).toBe("failed");
      // Discard was permission to replace A, never an instruction to clear it.
      expect(s.host.active.project).toBe(s.a);
      expect(s.a.documentSession.getDocument()).toBe(root);
      expect(s.a.contentStateId).toBe(stateId);
      expect(s.a.isDirty).toBe(true);
      expect(s.save).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("blocks the open when saving first could not be confirmed", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.save.mockRejectedValue(new Error("reply lost"));
      s.decide("save");

      expect(await s.lifecycle.requestOpenProject()).toMatchObject({
        status: "failed",
        error: { code: "SAVE_UNCONFIRMED" },
      });
      expect(s.read).not.toHaveBeenCalled();
      expect(s.host.active.project).toBe(s.a);
      expect(s.a.checkpointStateId).toBeNull();
    } finally {
      s.cleanup();
    }
  });
});

describe("project close protection", () => {
  it.each([
    ["an untouched blank project", false, undefined, "proceeded"],
    ["a saved project", true, undefined, "proceeded"],
  ] as const)("allows closing %s", async (_name, save, _decision, expected) => {
    const s = setup();
    try {
      if (save) {
        s.edit("Saved");
        await s.persistence.saveAs();
      }
      expect(await s.lifecycle.requestCloseProject()).toEqual({ status: expected });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("saves before allowing an edited project to close", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.decide("save");

      expect(await s.lifecycle.requestCloseProject()).toEqual({ status: "proceeded" });
      expect(s.asked[0]).toEqual({ intent: "close", title: "Study A" });
      expect(s.save).toHaveBeenCalledTimes(1);
      expect(s.a.isDirty).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("allows a discarded close and refuses a cancelled one", async () => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.decide("discard");
      expect(await s.lifecycle.requestCloseProject()).toEqual({ status: "proceeded" });
      expect(s.save).not.toHaveBeenCalled();
      // Discarding on close never writes, and never clears the live project.
      expect(s.a.isDirty).toBe(true);

      s.decide("cancel");
      expect(await s.lifecycle.requestCloseProject()).toEqual({ status: "cancelled" });
    } finally {
      s.cleanup();
    }
  });

  it.each([
    [
      "failed",
      { status: "failed", error: { code: "WRITE_FAILED", message: "disk" } } as ProjectSaveResult,
      "SAVE_FAILED",
    ],
    [
      "unconfirmed",
      { status: "failed", error: { code: "UNKNOWN", message: "lost" } } as ProjectSaveResult,
      "SAVE_UNCONFIRMED",
    ],
    ["cancelled", { status: "cancelled" } as ProjectSaveResult, null],
  ])("refuses to close when saving is %s", async (_name, outcome, code) => {
    const s = setup();
    try {
      s.edit("Unsaved work");
      s.save.mockResolvedValue(outcome);
      s.decide("save");

      const result = await s.lifecycle.requestCloseProject();
      expect(result.status).toBe(code === null ? "cancelled" : "failed");
      if (code !== null && result.status === "failed") expect(result.error.code).toBe(code);
      expect(s.a.isDirty).toBe(true);
    } finally {
      s.cleanup();
    }
  });
});
