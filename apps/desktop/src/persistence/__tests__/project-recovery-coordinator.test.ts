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
import type {
  RecoveryCandidateSummary,
  RecoveryClearResult,
  RecoveryListResult,
  RecoveryReadResult,
} from "../../../electron/recovery-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import {
  ProjectLifecycleCoordinator,
  type UnsavedChangesDecision,
  type UnsavedChangesRequest,
} from "../project-lifecycle-coordinator";
import { ProjectRecoveryCoordinator } from "../project-recovery-coordinator";
import { RecoveryAutosaveCoordinator, type RecoveryClock } from "../recovery-autosave-coordinator";

const SAVED_BACKING = { id: "00000000-0000-4000-8000-000000000001", displayName: "a.folio" };
const ORIGINAL_BACKING = { id: "00000000-0000-4000-8000-0000000000b0", displayName: "study.folio" };
const R1 = "00000000-0000-4000-8000-0000000000d1";
const R2 = "00000000-0000-4000-8000-0000000000d2";
const DEBOUNCE = 3_000;

afterEach(() => vi.restoreAllMocks());

type ActivationFailure = "none" | "prepare" | "activate";

interface StoredRecord {
  readonly summary: RecoveryCandidateSummary;
  readonly content: string;
}

function candidate(
  recoveryId: string,
  overrides: Partial<RecoveryCandidateSummary> = {},
): RecoveryCandidateSummary {
  return {
    recoveryId,
    documentId: "R",
    title: "Rescued study",
    capturedAt: "2026-09-12T10:00:00.000Z",
    hadBacking: false,
    canOpenOriginal: false,
    ...overrides,
  };
}

/** A clock the test advances by hand, so recovery autosave never waits on real timers. */
function createClock() {
  let current = 1_000;
  let ordinal = 0;
  const pending = new Map<number, { at: number; handler: () => void }>();
  const clock: RecoveryClock = {
    now: () => current,
    setTimeout: ((handler: () => void, delayMs: number) => {
      const id = ++ordinal;
      pending.set(id, { at: current + delayMs, handler });
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as RecoveryClock["setTimeout"],
    clearTimeout: ((handle: unknown) =>
      pending.delete(handle as number)) as RecoveryClock["clearTimeout"],
  };
  return {
    clock,
    async advance(ms: number) {
      for (let step = 0; step < 4; step += 1) await Promise.resolve();
      const target = current + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort((first, second) => first[1].at - second[1].at)[0];
        if (due === undefined) break;
        pending.delete(due[0]);
        current = Math.max(current, due[1].at);
        due[1].handler();
        await Promise.resolve();
        await Promise.resolve();
      }
      current = target;
      await Promise.resolve();
    },
  };
}

function setup(
  options: {
    /** What the candidate holds. A deliberately broken payload models a corrupt record. */
    readonly recoveredContent?: string;
    readonly originalContent?: string;
  } = {},
) {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue({ status: "saved", backing: SAVED_BACKING });

  const recoveredContent =
    options.recoveredContent ??
    encodeFolioProject(
      createEmptyFolioProject({ documentId: "R", title: "Rescued study", pageId: "page-R" }),
    );
  const records = new Map<string, StoredRecord>([
    [R1, { summary: candidate(R1), content: recoveredContent }],
  ]);

  const list = vi.fn<() => Promise<RecoveryListResult>>(async () => ({
    status: "listed",
    candidates: [...records.values()].map((one) => one.summary),
  }));
  const read = vi.fn<(id: string) => Promise<RecoveryReadResult>>(async (id) => {
    const record = records.get(id);
    return record === undefined
      ? { status: "failed", error: { code: "NOT_FOUND", message: "gone" } }
      : { status: "read", content: record.content };
  });
  const retired: string[] = [];
  const retire = (id: string): void => {
    retired.push(id);
    records.delete(id);
  };
  const clear = vi.fn<(id: string) => Promise<RecoveryClearResult>>(async (id) => {
    retire(id);
    return { status: "cleared" };
  });

  const originalContent =
    options.originalContent ??
    encodeFolioProject(
      createEmptyFolioProject({ documentId: "O", title: "Saved original", pageId: "page-O" }),
    );
  const openOriginal = vi.fn<(recoveryId: string) => Promise<ProjectReadResult>>(async () => ({
    status: "read",
    content: originalContent,
    backing: ORIGINAL_BACKING,
  }));

  const adopt = vi.fn<(targetId: string) => Promise<ProjectTargetResult>>(async (targetId) => ({
    status: "adopted",
    backing: { id: targetId, displayName: ORIGINAL_BACKING.displayName },
  }));
  const port: DesktopProjectOpenPort = {
    open: vi.fn(async () => ({ status: "cancelled" }) as const),
    adopt,
    release: vi.fn(async () => ({ status: "released" }) as const),
  };

  const host = new ProjectRuntimeHost(a, () => persistence.canReplaceRuntime);
  const persistence: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    { save },
    () => !host.replacing,
    { host, port, openOriginal },
  );
  const decisions: UnsavedChangesDecision[] = [];
  const asked: UnsavedChangesRequest[] = [];
  const confirmReplacement = vi.fn(async (request: UnsavedChangesRequest) => {
    asked.push(request);
    return decisions.shift() ?? "cancel";
  });
  const lifecycle = new ProjectLifecycleCoordinator(persistence, { confirmReplacement });

  // Background recovery, wired exactly as the workspace wires it: it follows the
  // active project, so a committed replacement is what moves its protection on.
  const clock = createClock();
  const stored: { recoveryId: string; title: string }[] = [];
  const autosaveClear = vi.fn(async (id: string) => {
    retire(id);
    return { status: "cleared" } as const;
  });
  const autosave = new RecoveryAutosaveCoordinator({
    store: {
      store: vi.fn(async (request) => {
        stored.push({ recoveryId: request.recoveryId, title: request.title });
        // Main's directory holds this alongside the crash candidates.
        records.set(request.recoveryId, {
          summary: candidate(request.recoveryId, { title: request.title }),
          content: request.content,
        });
        return { status: "stored" } as const;
      }),
      clear: autosaveClear,
    },
    persistenceState: () => persistence.persistenceState,
    backingTargetId: () => persistence.backing?.id ?? null,
    createId: (() => {
      let ordinal = 0;
      return () => `00000000-0000-4000-8000-00000000${String(++ordinal).padStart(4, "0")}`;
    })(),
    clock: clock.clock,
  });
  const releaseAutosave = autosave.connect();
  const recovery = new ProjectRecoveryCoordinator(
    persistence,
    lifecycle,
    { list, read, clear },
    autosave,
    () => autosave.activeRecoveryId,
  );

  let failure: ActivationFailure = "none";
  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    if (failure === "prepare") scope.report(new Error("preparation rejected"));
    if (failure === "activate")
      scope.onActive(() => {
        throw new Error("activation rejected");
      });
    host.prepared(entry, scope.finishPreparation(vi.fn()));
  };
  prepare(host.active);
  autosave.setProject(host.active.project);
  const unsubscribe = host.subscribe(() => {
    const candidateRuntime = host.getSnapshot()[1];
    if (candidateRuntime && candidateRuntime.activation === null) prepare(candidateRuntime);
    autosave.setProject(host.active.project);
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
    port,
    adopt,
    persistence,
    lifecycle,
    recovery,
    autosave,
    clock,
    stored,
    autosaveClear,
    retired,
    records,
    list,
    read,
    clear,
    openOriginal,
    confirmReplacement,
    asked,
    history,
    active: () => host.active.project,
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
      releaseAutosave();
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("recovering a drawing a previous run left behind", () => {
  it("activates the rescued artwork and keeps its own identity", async () => {
    const s = setup();
    try {
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });

      const project = s.active();
      expect(project).not.toBe(s.a);
      // Recovering does not mint a new drawing; it brings back the one that was lost.
      expect(project.metadata.documentId).toBe("R");
      expect(project.metadata.title).toBe("Rescued study");
      expect(project.documentSession.sketchbook.firstPage.id).toBe("page-R");
    } finally {
      s.cleanup();
    }
  });

  it("starts the recovered drawing with fresh, deterministic session state", async () => {
    const s = setup();
    try {
      s.edit("Something on A");
      s.decide("discard");
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });

      const editor = s.history();
      try {
        // No pre-crash History is restored, so there is nothing to undo into.
        expect(editor.controller.canUndo()).toBe(false);
        expect(editor.controller.getHistoryState().undoDepth).toBe(0);
      } finally {
        editor.destroy();
      }
      const session = s.active().documentSession;
      // Its own first page and a layer that page really has, not anything A had.
      expect(session.activePageId).toBe("page-R");
      expect(session.page.layer(session.activeLayerId)).toBeDefined();
    } finally {
      s.cleanup();
    }
  });

  it("leaves the recovered drawing detached, so saving it asks where to put it", async () => {
    const s = setup();
    try {
      await s.recovery.recover(R1);

      const state = s.persistence.persistenceState;
      expect(s.persistence.backing).toBeNull();
      expect(state.hasBackingFile).toBe(false);
      expect(state.hasConfirmedCheckpoint).toBe(false);
      // Nothing durable holds this content, even though nothing has changed it.
      expect(state.isDirty).toBe(false);
      expect(state.hasUnsavedRisk).toBe(true);

      expect((await s.persistence.save()).status).toBe("saved");
      expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ kind: "saveAs" }));
    } finally {
      s.cleanup();
    }
  });

  it("consumes the candidate only once something durable holds the drawing", async () => {
    const s = setup();
    try {
      await s.recovery.recover(R1);

      // The drawing is on screen, and the record it came from is still the
      // only copy of it anywhere, so nothing has been deleted.
      expect(s.active().metadata.documentId).toBe("R");
      expect(s.retired).toEqual([]);

      await s.clock.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);
      expect(s.retired).toEqual([R1]);
    } finally {
      s.cleanup();
    }
  });

  it("keeps both the candidate and the current drawing when activation fails", async () => {
    for (const mode of ["prepare", "activate"] as const) {
      const s = setup();
      try {
        s.fail(mode);
        expect(await s.recovery.recover(R1)).toMatchObject({
          status: "failed",
          error: { code: "RUNTIME_FAILED" },
        });

        expect(s.active()).toBe(s.a);
        expect(s.clear).not.toHaveBeenCalled();
        expect(s.records.has(R1)).toBe(true);
      } finally {
        s.cleanup();
      }
    }
  });

  it("keeps a candidate whose artwork cannot be read", async () => {
    const s = setup({ recoveredContent: "{ not a project }" });
    try {
      expect(await s.recovery.recover(R1)).toMatchObject({
        status: "failed",
        error: { code: "INVALID_PROJECT" },
      });

      expect(s.active()).toBe(s.a);
      expect(s.clear).not.toHaveBeenCalled();
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("reports a candidate that is no longer there without disturbing anything", async () => {
    const s = setup();
    try {
      expect(await s.recovery.recover(R2)).toMatchObject({
        status: "failed",
        error: { code: "NOT_FOUND" },
      });
      expect(s.active()).toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the recovered drawing when its candidate refuses to be removed", async () => {
    const s = setup();
    try {
      s.clear.mockResolvedValue({ status: "failed", error: { code: "UNKNOWN", message: "busy" } });

      // Cleanup is housekeeping. Failing it must never undo the rescue.
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.active().metadata.documentId).toBe("R");
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });
});

describe("opening the file a candidate came from", () => {
  it("opens the original as a normal, confirmed project", async () => {
    const s = setup();
    try {
      expect(await s.recovery.openOriginal(R1)).toEqual({ status: "opened-original" });

      expect(s.openOriginal).toHaveBeenCalledWith(R1);
      expect(s.active().metadata.documentId).toBe("O");
      expect(s.persistence.backing).toEqual({
        id: ORIGINAL_BACKING.id,
        displayName: ORIGINAL_BACKING.displayName,
      });
      const state = s.persistence.persistenceState;
      expect(state.hasBackingFile).toBe(true);
      expect(state.hasConfirmedCheckpoint).toBe(true);
      expect(state.isDirty).toBe(false);
      expect(state.hasUnsavedRisk).toBe(false);
      expect(s.records.has(R1)).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the candidate when the original is missing or unreadable", async () => {
    const s = setup();
    try {
      s.openOriginal.mockResolvedValue({
        status: "failed",
        error: { code: "READ_FAILED", message: "gone" },
      });

      expect(await s.recovery.openOriginal(R1)).toMatchObject({
        status: "failed",
        error: { code: "READ_FAILED" },
      });
      expect(s.active()).toBe(s.a);
      expect(s.records.has(R1)).toBe(true);

      // The rescued copy is still the fallback, and still works.
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.active().metadata.documentId).toBe("R");
    } finally {
      s.cleanup();
    }
  });

  it("keeps the candidate when the original file is corrupt", async () => {
    const s = setup({ originalContent: "{ not a project }" });
    try {
      expect(await s.recovery.openOriginal(R1)).toMatchObject({
        status: "failed",
        error: { code: "INVALID_PROJECT" },
      });
      expect(s.active()).toBe(s.a);
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the candidate when the opened file could not be confirmed", async () => {
    const s = setup();
    try {
      s.adopt.mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "lost" },
      });

      // The project did change, but nothing durable holds it, so the rescued
      // copy stays exactly where it is.
      expect(await s.recovery.openOriginal(R1)).toEqual({ status: "opened-original" });
      expect(s.active().metadata.documentId).toBe("O");
      expect(s.persistence.persistenceState.hasUnsavedRisk).toBe(true);
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("reports an unavailable original without touching the candidate", async () => {
    const s = setup();
    try {
      s.openOriginal.mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "no source" },
      });

      expect(await s.recovery.openOriginal(R1)).toMatchObject({
        status: "failed",
        error: { code: "ORIGINAL_UNAVAILABLE" },
      });
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });
});

describe("discarding a candidate", () => {
  it("removes only the one chosen, and leaves the drawing alone", async () => {
    const s = setup();
    try {
      s.records.set(R2, { summary: candidate(R2, { title: "Other" }), content: "{}" });

      expect(await s.recovery.discard(R1)).toEqual({ status: "discarded" });
      expect(s.clear).toHaveBeenCalledExactlyOnceWith(R1);
      expect([...s.records.keys()]).toEqual([R2]);
      expect(s.active()).toBe(s.a);
      expect(s.confirmReplacement).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("says so when a candidate could not be removed", async () => {
    const s = setup();
    try {
      s.clear.mockResolvedValue({
        status: "failed",
        error: { code: "PERMISSION_DENIED", message: "denied" },
      });

      expect(await s.recovery.discard(R1)).toMatchObject({
        status: "failed",
        error: { code: "DELETE_FAILED" },
      });
      // Still listed, because it is still there.
      expect(await s.recovery.listCandidates()).toHaveLength(1);
    } finally {
      s.cleanup();
    }
  });
});

describe("recovery through the unsaved-change guard", () => {
  it("recovers over an untouched blank sketch without asking", async () => {
    const s = setup();
    try {
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.confirmReplacement).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("asks before replacing edited artwork, and cancelling changes nothing", async () => {
    const s = setup();
    try {
      s.edit("Worth keeping");
      s.decide("cancel");

      expect(await s.recovery.recover(R1)).toEqual({ status: "cancelled" });
      expect(s.asked).toEqual([{ intent: "recover", title: "Study A" }]);
      expect(s.active()).toBe(s.a);
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("saves first when asked to, then recovers", async () => {
    const s = setup();
    try {
      s.edit("Worth keeping");
      s.decide("save");

      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.save).toHaveBeenCalledTimes(1);
      expect(s.active().metadata.documentId).toBe("R");
    } finally {
      s.cleanup();
    }
  });

  it("refuses to replace anything when a save cannot be confirmed", async () => {
    const s = setup();
    try {
      s.edit("Worth keeping");
      s.decide("save");
      s.save.mockResolvedValue({ status: "failed", error: { code: "UNKNOWN", message: "?" } });

      expect(await s.recovery.recover(R1)).toMatchObject({
        status: "failed",
        error: { code: "SAVE_UNCONFIRMED" },
      });
      expect(s.active()).toBe(s.a);
      expect(s.records.has(R1)).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("preserves the discarded-but-not-replaced project when recovery then fails", async () => {
    const s = setup();
    try {
      s.edit("Still here");
      s.decide("discard");
      s.fail("activate");

      expect(await s.recovery.recover(R1)).toMatchObject({ status: "failed" });
      // Discard was permission to replace, never an instruction to clear.
      expect(s.active()).toBe(s.a);
      expect(s.active().documentSession.sketchbook.firstPage.name).toBe("Still here");
      expect(s.persistence.persistenceState.isDirty).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("leaves a saved project clean when recovery then fails", async () => {
    const s = setup();
    try {
      s.edit("Saved first");
      s.decide("save");
      s.fail("activate");

      expect(await s.recovery.recover(R1)).toMatchObject({ status: "failed" });
      expect(s.active()).toBe(s.a);
      const state = s.persistence.persistenceState;
      expect(state.isDirty).toBe(false);
      expect(state.hasConfirmedCheckpoint).toBe(true);
      expect(state.hasUnsavedRisk).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("asks the same question before opening an original", async () => {
    const s = setup();
    try {
      s.edit("Worth keeping");
      s.decide("cancel");

      expect(await s.recovery.openOriginal(R1)).toEqual({ status: "cancelled" });
      expect(s.asked).toEqual([{ intent: "recover", title: "Study A" }]);
      expect(s.openOriginal).not.toHaveBeenCalled();
      expect(s.active()).toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it("refuses a second recovery while one is already running", async () => {
    const s = setup();
    try {
      s.edit("Worth keeping");
      let answer: (decision: UnsavedChangesDecision) => void = () => undefined;
      s.confirmReplacement.mockImplementation(
        () => new Promise<UnsavedChangesDecision>((resolve) => (answer = resolve)),
      );

      const first = s.recovery.recover(R1);
      expect(await s.recovery.recover(R1)).toMatchObject({
        status: "failed",
        error: { code: "BUSY" },
      });
      answer("cancel");
      expect(await first).toEqual({ status: "cancelled" });
    } finally {
      s.cleanup();
    }
  });
});

describe("several candidates at once", () => {
  it("handles one and leaves the others exactly as they were", async () => {
    const s = setup();
    try {
      s.records.set(R2, {
        summary: candidate(R2, { title: "Second study", capturedAt: "2026-09-11T09:00:00.000Z" }),
        content: encodeFolioProject(
          createEmptyFolioProject({ documentId: "S", title: "Second study", pageId: "page-S" }),
        ),
      });
      expect((await s.recovery.listCandidates()).map((one) => one.recoveryId)).toEqual([R1, R2]);

      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.active().metadata.documentId).toBe("R");
      // R1 is released once this run has protected the artwork it carried.
      await s.clock.advance(DEBOUNCE);
      expect((await s.recovery.listCandidates()).map((one) => one.recoveryId)).toEqual([R2]);

      expect(await s.recovery.discard(R2)).toEqual({ status: "discarded" });
      expect(await s.recovery.listCandidates()).toEqual([]);
      expect(s.retired).toEqual([R1, R2]);
    } finally {
      s.cleanup();
    }
  });

  it("asks before recovering a second candidate over a rescued one", async () => {
    const s = setup();
    try {
      s.records.set(R2, {
        summary: candidate(R2, { title: "Second study" }),
        content: encodeFolioProject(
          createEmptyFolioProject({ documentId: "S", title: "Second study", pageId: "page-S" }),
        ),
      });

      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });
      expect(s.confirmReplacement).not.toHaveBeenCalled();

      // The rescued drawing is now unsaved work in its own right, so replacing
      // it with another candidate is a destructive act like any other.
      s.decide("discard");
      expect(await s.recovery.recover(R2)).toEqual({ status: "recovered" });
      expect(s.asked).toEqual([{ intent: "recover", title: "Rescued study" }]);
      expect(s.active().metadata.documentId).toBe("S");
    } finally {
      s.cleanup();
    }
  });

  it("never offers the record protecting the drawing already on screen", async () => {
    const s = setup();
    try {
      await s.recovery.recover(R1);
      await s.clock.advance(DEBOUNCE);
      const live = s.stored.at(-1)?.recoveryId;

      // Main's directory really does hold it; the flow simply knows it is not a
      // crash to rescue.
      expect(s.records.has(live!)).toBe(true);
      expect(await s.recovery.listCandidates()).toEqual([]);
    } finally {
      s.cleanup();
    }
  });

  it("offers nothing rather than guessing when discovery fails", async () => {
    const s = setup();
    try {
      s.list.mockRejectedValue(new Error("unavailable"));
      expect(await s.recovery.listCandidates()).toEqual([]);
      expect(s.clear).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });
});

describe("background recovery after a rescue", () => {
  it("protects the recovered drawing under a new record of its own", async () => {
    const s = setup();
    try {
      await s.recovery.recover(R1);
      // Still there: nothing durable holds the rescued drawing yet.
      expect(s.records.has(R1)).toBe(true);

      // The rescued drawing is unsaved work like any other, so it is protected
      // again -- under an identity of this run, not the candidate's. Only then
      // is the candidate it came from released.
      await s.clock.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);
      expect(s.stored[0]?.title).toBe("Rescued study");
      expect(s.stored[0]?.recoveryId).not.toBe(R1);
      expect(s.records.has(R1)).toBe(false);

      // A crash now is exactly the case this protects: nothing retires it.
      expect(s.autosaveClear).not.toHaveBeenCalledWith(s.stored[0]?.recoveryId);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the crash candidate until the rescued drawing is protected again", async () => {
    const s = setup();
    try {
      expect(await s.recovery.recover(R1)).toEqual({ status: "recovered" });

      // The drawing is on screen and nothing durable holds it. A crash in this
      // window must still find it, so the candidate it came from stays.
      expect(s.stored).toHaveLength(0);
      expect(s.records.has(R1), "the only durable copy was deleted too early").toBe(true);

      await s.clock.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);
      expect(s.stored[0]?.recoveryId).not.toBe(R1);
      // A successor snapshot exists now, so the candidate may finally go.
      expect(s.records.has(R1)).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("releases the crash candidate when the rescued drawing is saved instead", async () => {
    const s = setup();
    try {
      await s.recovery.recover(R1);
      expect(s.records.has(R1)).toBe(true);

      // A confirmed durable copy protects the artwork just as well.
      expect((await s.persistence.save()).status).toBe("saved");
      await s.clock.advance(DEBOUNCE);

      expect(s.records.has(R1)).toBe(false);
      expect(s.stored, "a saved project needs no recovery snapshot").toHaveLength(0);
    } finally {
      s.cleanup();
    }
  });

  it("keeps protecting the opened original only while it is at risk", async () => {
    const s = setup();
    try {
      await s.recovery.openOriginal(R1);

      // A confirmed file already holds this exact content; nothing to rescue.
      await s.clock.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(0);

      s.edit("Changed after opening");
      await s.clock.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);
      expect(s.stored[0]?.title).toBe("Saved original");
    } finally {
      s.cleanup();
    }
  });
});
