import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import type {
  DesktopProjectOpenPort,
  ProjectReadResult,
  ProjectTargetResult,
} from "../../../electron/project-open-contract";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import type { RecoverySnapshotRequest } from "../../../electron/recovery-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import { RecoveryAutosaveCoordinator, type RecoveryClock } from "../recovery-autosave-coordinator";
import {
  ProjectLifecycleCoordinator,
  type UnsavedChangesDecision,
  type UnsavedChangesRequest,
} from "../project-lifecycle-coordinator";

const SAVED_BACKING = { id: "00000000-0000-4000-8000-000000000001", displayName: "a.folio" };
const OPENED_BACKING = { id: "00000000-0000-4000-8000-0000000000b0", displayName: "b.folio" };

afterEach(() => vi.restoreAllMocks());

/** A save the test releases by hand, so an edit can land while it is in flight. */
function deferredSave() {
  let release: ((result: ProjectSaveResult) => void) | null = null;
  const save = vi.fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>(
    () =>
      new Promise<ProjectSaveResult>((resolve) => {
        release = resolve;
      }),
  );
  return {
    save,
    succeed: () => release?.({ status: "saved", backing: SAVED_BACKING }),
    fail: (code: "UNKNOWN" | "PERMISSION_DENIED") =>
      release?.({ status: "failed", error: { code, message: "no" } }),
  };
}

function setup() {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const deferred = deferredSave();
  const read = vi.fn<() => Promise<ProjectReadResult>>().mockResolvedValue({
    status: "read",
    content: encodeFolioProject(
      createEmptyFolioProject({ documentId: "B", title: "Study B", pageId: "page-B" }),
    ),
    backing: OPENED_BACKING,
  });
  const adopt = vi.fn<(targetId: string) => Promise<ProjectTargetResult>>(async (targetId) => ({
    status: "adopted",
    backing: { id: targetId, displayName: OPENED_BACKING.displayName },
  }));
  const port: DesktopProjectOpenPort = {
    open: read,
    adopt,
    release: vi.fn(async () => ({ status: "released" }) as const),
  };
  const host = new ProjectRuntimeHost(a, () => persistence.canReplaceRuntime);
  const persistence: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    { save: deferred.save },
    () => !host.replacing,
    { host, port },
  );
  const decisions: UnsavedChangesDecision[] = [];
  const asked: UnsavedChangesRequest[] = [];
  const confirmReplacement = vi.fn(
    async (request: UnsavedChangesRequest): Promise<UnsavedChangesDecision> => {
      asked.push(request);
      return decisions.shift() ?? "cancel";
    },
  );
  const lifecycle = new ProjectLifecycleCoordinator(persistence, { confirmReplacement });

  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    host.prepared(entry, scope.finishPreparation(vi.fn()));
  };
  prepare(host.active);
  const unsubscribe = host.subscribe(() => {
    const candidate = host.getSnapshot()[1];
    if (candidate && candidate.activation === null) prepare(candidate);
  });

  // One editor for the whole test: undo needs the stack the edits went onto.
  let editor: ReturnType<typeof createEditorHistoryCoordinator> | null = null;
  let editorProject: ProjectSession | null = null;
  // Background recovery, wired as the workspace wires it, so the three systems
  // can be watched interacting rather than one at a time.
  let now = 1_000;
  const pending = new Map<number, { at: number; handler: () => void }>();
  let timerOrdinal = 0;
  const clock: RecoveryClock = {
    now: () => now,
    setTimeout: ((handler: () => void, delayMs: number) => {
      const id = ++timerOrdinal;
      pending.set(id, { at: now + delayMs, handler });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as RecoveryClock["setTimeout"],
    clearTimeout: ((handle: unknown) =>
      pending.delete(handle as number)) as RecoveryClock["clearTimeout"],
  };
  const snapshots: RecoverySnapshotRequest[] = [];
  const recovery = new RecoveryAutosaveCoordinator({
    store: {
      store: vi.fn(async (request: RecoverySnapshotRequest) => {
        snapshots.push(request);
        return { status: "stored" } as const;
      }),
      clear: vi.fn(async () => ({ status: "cleared" }) as const),
    },
    persistenceState: () => persistence.persistenceState,
    backingTargetId: () => persistence.backing?.id ?? null,
    createId: (() => {
      let ordinal = 0;
      return () => `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`;
    })(),
    clock,
  });
  const releaseRecovery = recovery.connect();
  recovery.setProject(a);

  const history = () => {
    if (editor === null || editorProject !== host.active.project) {
      editor?.destroy();
      editorProject = host.active.project;
      editor = createEditorHistoryCoordinator({
        documentSession: editorProject.documentSession,
        onDocumentChange: () => undefined,
      });
    }
    return editor;
  };

  return {
    a,
    host,
    deferred,
    persistence,
    lifecycle,
    asked,
    confirmReplacement,
    decide: (...next: UnsavedChangesDecision[]) => decisions.push(...next),
    edit: (name: string) =>
      history().executePageRename(host.active.project.documentSession.activePageId, name),
    undo: () => history().controller.undo(),
    recovery,
    snapshots,
    advance: async (ms: number) => {
      for (let step = 0; step < 4; step += 1) await Promise.resolve();
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((first, second) => first[1].at - second[1].at)[0];
        if (due === undefined) break;
        pending.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].handler();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    settle: async () => {
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    },
    cleanup: () => {
      releaseRecovery();
      editor?.destroy();
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("a guarded save only authorises the state it actually saved", () => {
  for (const intent of ["close", "new", "open"] as const) {
    it(`refuses to ${intent} when newer work appeared while the save was in flight`, async () => {
      const s = setup();
      try {
        s.edit("First");
        s.decide("save");

        const request =
          intent === "close"
            ? s.lifecycle.requestCloseProject()
            : intent === "new"
              ? s.lifecycle.requestNewProject()
              : s.lifecycle.requestOpenProject();
        await s.settle();

        // The disk is taking the first state. The user keeps drawing.
        s.edit("Second");
        s.deferred.succeed();
        const result = await request;

        // The save really did succeed, and it really is not permission to
        // throw away what came after it.
        expect(s.persistence.shellState.hasConfirmedCheckpoint).toBe(true);
        expect(s.persistence.shellState.isDirty).toBe(true);
        expect(result.status).not.toBe("proceeded");
        expect(s.host.active.project).toBe(s.a);
        expect(s.host.active.project.documentSession.sketchbook.firstPage.name).toBe("Second");
      } finally {
        s.cleanup();
      }
    });
  }

  it("proceeds when the user returns to exactly the state that was saved", async () => {
    const s = setup();
    try {
      s.edit("First");
      s.decide("save");

      const request = s.lifecycle.requestCloseProject();
      await s.settle();
      s.edit("Second");
      // Back to the content the write is carrying, before it lands.
      s.undo();
      s.deferred.succeed();

      // Nothing is at risk: a durable copy holds exactly this content.
      expect(await request).toEqual({ status: "proceeded" });
      expect(s.persistence.shellState.isDirty).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("refuses after two changes while the save was pending", async () => {
    const s = setup();
    try {
      s.edit("First");
      s.decide("save");
      const request = s.lifecycle.requestCloseProject();
      await s.settle();

      s.edit("Second");
      s.edit("Third");
      s.deferred.succeed();

      expect((await request).status).not.toBe("proceeded");
      expect(s.host.active.project.documentSession.sketchbook.firstPage.name).toBe("Third");
    } finally {
      s.cleanup();
    }
  });

  it("keeps refusing when the save could not be confirmed, edit or no edit", async () => {
    for (const editAfter of [false, true]) {
      const s = setup();
      try {
        s.edit("First");
        s.decide("save");
        const request = s.lifecycle.requestCloseProject();
        await s.settle();
        if (editAfter) s.edit("Second");
        s.deferred.fail("UNKNOWN");

        const result = await request;
        expect(result).toMatchObject({ status: "failed", error: { code: "SAVE_UNCONFIRMED" } });
        expect(s.persistence.shellState.hasConfirmedCheckpoint).toBe(false);
      } finally {
        s.cleanup();
      }
    }
  });

  it("keeps refusing when the save failed outright, edit or no edit", async () => {
    for (const editAfter of [false, true]) {
      const s = setup();
      try {
        s.edit("First");
        s.decide("save");
        const request = s.lifecycle.requestCloseProject();
        await s.settle();
        if (editAfter) s.edit("Second");
        s.deferred.fail("PERMISSION_DENIED");

        expect(await request).toMatchObject({
          status: "failed",
          error: { code: "SAVE_FAILED" },
        });
      } finally {
        s.cleanup();
      }
    }
  });

  it("keeps the window, the drawing and its recovery when all three systems overlap", async () => {
    const s = setup();
    try {
      s.edit("First");
      // Background recovery is already protecting the first state.
      await s.advance(3_000);
      expect(s.snapshots).toHaveLength(1);

      s.decide("save");
      const closing = s.lifecycle.requestCloseProject();
      await s.settle();

      // The user draws on while the write is out.
      s.edit("Second");
      await s.advance(3_000);
      s.deferred.succeed();

      // The close is refused, because the file does not hold the second state.
      expect((await closing).status).not.toBe("proceeded");
      expect(s.host.active.project).toBe(s.a);
      expect(s.host.active.project.documentSession.sketchbook.firstPage.name).toBe("Second");

      // And the second state is still protected, by a snapshot of its own.
      await s.advance(3_000);
      expect(s.snapshots.length).toBeGreaterThan(1);
      expect(s.persistence.shellState).toMatchObject({
        isDirty: true,
        hasConfirmedCheckpoint: true,
        hasUnsavedRisk: true,
      });
    } finally {
      s.cleanup();
    }
  });

  it("asks once, and never loops asking about the same request", async () => {
    const s = setup();
    try {
      s.edit("First");
      s.decide("save");
      const request = s.lifecycle.requestCloseProject();
      await s.settle();
      s.edit("Second");
      s.deferred.succeed();
      await request;

      // One question per request. A refusal hands the decision back to the
      // user rather than re-asking itself forever.
      expect(s.confirmReplacement).toHaveBeenCalledTimes(1);
      expect(s.lifecycle.isPending).toBe(false);
    } finally {
      s.cleanup();
    }
  });
});
