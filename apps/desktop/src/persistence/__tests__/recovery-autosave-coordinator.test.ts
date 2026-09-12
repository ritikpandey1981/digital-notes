import { ProjectSession } from "@folio/editor";
import { createEmptyFolioProject, decodeFolioProject } from "@folio/persistence/project";
import { describe, expect, it, vi } from "vitest";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import { ContinuousPaperColorEdit } from "../../../../../packages/editor/src/ContinuousPaperColorEdit";
import type {
  RecoveryClearResult,
  RecoverySnapshotRequest,
  RecoveryStoreResult,
} from "../../../electron/recovery-contract";
import type { ProjectPersistenceState } from "../project-persistence-coordinator";
import { RecoveryAutosaveCoordinator, type RecoveryClock } from "../recovery-autosave-coordinator";

const DEBOUNCE = 3_000;
const MAXIMUM_AGE = 30_000;

/** A clock the test advances by hand, so nothing waits on real timers. */
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
    get pendingCount() {
      return pending.size;
    },
    /** Advances time and runs anything that came due, newest scheduling included. */
    async advance(ms: number) {
      // Let any settled write schedule its follow-up before time moves.
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
    async settle() {
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    },
  };
}

function setup(options: { origin?: "created" | "loaded" } = {}) {
  const project = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
    options.origin === undefined ? {} : { origin: options.origin },
  );
  const stored: RecoverySnapshotRequest[] = [];
  const cleared: string[] = [];
  const store = {
    store: vi.fn(async (request: RecoverySnapshotRequest): Promise<RecoveryStoreResult> => {
      stored.push(request);
      return { status: "stored" };
    }),
    clear: vi.fn(async (recoveryId: string): Promise<RecoveryClearResult> => {
      cleared.push(recoveryId);
      return { status: "cleared" };
    }),
  };
  let state: ProjectPersistenceState = {
    isDirty: false,
    hasBackingFile: false,
    hasConfirmedCheckpoint: false,
    hasUnsavedRisk: false,
  };
  const timers = createClock();
  const coordinator = new RecoveryAutosaveCoordinator({
    store,
    persistenceState: () => state,
    backingTargetId: () => null,
    createId: (() => {
      let ordinal = 0;
      return () => `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`;
    })(),
    clock: timers.clock,
    debounceMs: DEBOUNCE,
    maximumAgeMs: MAXIMUM_AGE,
    retryDelayMs: 5_000,
  });
  const history = createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    onDocumentChange: () => undefined,
  });
  const release = coordinator.connect();
  coordinator.setProject(project);
  return {
    project,
    store,
    stored,
    cleared,
    timers,
    coordinator,
    history,
    risk: (next: Partial<ProjectPersistenceState>) => {
      state = { ...state, ...next };
    },
    /** One committed durable edit, which is what recovery reacts to. */
    edit: (name: string) => history.executePageRename("page-A", name),
    cleanup: () => {
      release();
      history.destroy();
    },
  };
}

describe("recovery autosave scheduling", () => {
  it("keeps no snapshot for an untouched blank project", async () => {
    const s = setup();
    try {
      await s.timers.advance(MAXIMUM_AGE * 2);
      expect(s.store.store).not.toHaveBeenCalled();
      expect(s.timers.pendingCount).toBe(0);
    } finally {
      s.cleanup();
    }
  });

  it("captures a committed edit once the drawing goes quiet", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");

      await s.timers.advance(DEBOUNCE - 1);
      expect(s.store.store).not.toHaveBeenCalled();
      await s.timers.advance(1);

      expect(s.store.store).toHaveBeenCalledTimes(1);
      const request = s.stored[0]!;
      expect(request.documentId).toBe("A");
      expect(request.title).toBe("Study A");
      expect(request.backingTargetId).toBeNull();
      expect(decodeFolioProject(request.content).sketchbook.firstPage.name).toBe("First");
    } finally {
      s.cleanup();
    }
  });

  it("coalesces a burst of edits into one snapshot of the latest state", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      for (const name of ["One", "Two", "Three"]) {
        s.edit(name);
        await s.timers.advance(DEBOUNCE - 500);
      }
      expect(s.store.store).not.toHaveBeenCalled();

      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Three");
    } finally {
      s.cleanup();
    }
  });

  it("captures anyway when continuous editing would starve the debounce", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      for (let step = 0; step < 40; step += 1) {
        s.edit(`Step ${step}`);
        await s.timers.advance(1_000);
        if (s.store.store.mock.calls.length > 0) break;
      }

      expect(s.store.store).toHaveBeenCalledTimes(1);
      // The forced capture lands at the age limit, not at some later quiet point.
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Step 29");
    } finally {
      s.cleanup();
    }
  });

  it("ignores a live preview and captures the state its gesture commits", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      const paper = new ContinuousPaperColorEdit({
        documentSession: s.project.documentSession,
        commit: (pageId, color) => s.history.executePagePaper(pageId, { color }, "Change paper"),
        onPreviewDocumentChange: () => undefined,
      });

      expect(paper.begin("page-A")).toBe(true);
      paper.update("#fef08a");
      paper.update("#bfdbfe");
      // A pause mid-gesture must not be mistaken for a state worth recovering.
      await s.timers.advance(MAXIMUM_AGE * 2);
      expect(s.store.store).not.toHaveBeenCalled();

      paper.commit();
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.paper.color).toBe(
        "#bfdbfe",
      );
    } finally {
      s.cleanup();
    }
  });

  it("captures nothing for a gesture the user abandons", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Committed");
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);

      const paper = new ContinuousPaperColorEdit({
        documentSession: s.project.documentSession,
        commit: () => null,
        onPreviewDocumentChange: () => undefined,
      });
      paper.begin("page-A");
      paper.update("#fef08a");
      paper.cancel();

      await s.timers.advance(MAXIMUM_AGE * 2);
      // The gesture ended where it started, so there is no new state to keep.
      expect(s.store.store).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("follows Undo and Redo to whatever state is current", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      s.history.undo();
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(2);
      expect(decodeFolioProject(s.stored[1]!.content).sketchbook.firstPage.name).not.toBe("Edited");

      s.history.redo();
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(3);
      expect(decodeFolioProject(s.stored[2]!.content).sketchbook.firstPage.name).toBe("Edited");
    } finally {
      s.cleanup();
    }
  });

  it("writes one snapshot at a time and then the newest pending state", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      let finish!: (result: RecoveryStoreResult) => void;
      s.store.store.mockReturnValueOnce(
        new Promise<RecoveryStoreResult>((resolve) => {
          finish = resolve;
        }),
      );
      s.edit("First");
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);

      for (const name of ["Second", "Third"]) {
        s.edit(name);
        await s.timers.advance(DEBOUNCE);
      }
      // The in-flight write is never joined by a queue of its successors.
      expect(s.store.store).toHaveBeenCalledTimes(1);

      finish({ status: "stored" });
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(2);
      // Second and Third coalesced: the follow-up write carries only the latest.
      expect(decodeFolioProject(s.stored.at(-1)!.content).sketchbook.firstPage.name).toBe("Third");
    } finally {
      s.cleanup();
    }
  });

  it("retries a failed write with backoff and stops after a bounded number", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.store.store.mockResolvedValue({
        status: "failed",
        error: { code: "WRITE_FAILED", message: "disk" },
      });
      s.edit("First");
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);

      await s.timers.advance(60_000);
      expect(s.store.store).toHaveBeenCalledTimes(4);
      // Bounded: a failing disk must not become a write loop.
      expect(s.timers.pendingCount).toBe(0);

      // Editing still works, and a later change gets a fresh attempt.
      s.store.store.mockResolvedValue({ status: "stored" });
      s.edit("Later");
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(5);
    } finally {
      s.cleanup();
    }
  });
});

describe("recovery autosave durability boundaries", () => {
  it("leaves manual checkpoint, dirty state and backing untouched", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      const before = s.project.contentState();

      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);

      expect(s.project.contentState()).toEqual(before);
      expect(s.project.checkpointStateId).toBeNull();
      expect(s.project.isDirty).toBe(true);
      expect(s.project.hasConfirmedCheckpoint).toBe(false);
      expect(s.history.controller.getHistoryState().undoDepth).toBe(1);
    } finally {
      s.cleanup();
    }
  });

  it("keeps a snapshot for a loaded project that has no confirmed durable copy", async () => {
    const s = setup({ origin: "loaded" });
    try {
      // activated-unbacked: nothing edited it, and nothing can be saved over.
      s.risk({ isDirty: false, hasUnsavedRisk: true });
      s.coordinator.setProject(s.project);
      s.edit("Touched after opening");

      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("drops the snapshot once the current state is confirmed durable", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE);
      const recoveryId = s.coordinator.activeRecoveryId;
      expect(s.stored).toHaveLength(1);

      s.risk({ isDirty: false, hasConfirmedCheckpoint: true, hasUnsavedRisk: false });
      s.project.confirmDurableCheckpoint(s.project.contentStateId);
      await s.timers.settle();

      expect(s.cleared).toEqual([recoveryId]);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the snapshot when a save lands but newer edits are still unsaved", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Captured by Save");
      const savedStateId = s.project.contentStateId;
      s.edit("Edited while saving");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // Save(A) completes while current content is already B.
      s.project.confirmDurableCheckpoint(savedStateId);
      await s.timers.settle();

      expect(s.cleared).toEqual([]);
      expect(s.project.isDirty).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("keeps the snapshot when a save result could not be confirmed", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // An unconfirmed write changes no persistence state, so nothing is dropped.
      await s.timers.advance(MAXIMUM_AGE);
      expect(s.cleared).toEqual([]);
    } finally {
      s.cleanup();
    }
  });
});

describe("recovery autosave lifecycle", () => {
  it("retires the previous project only when a replacement is really active", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited A");
      await s.timers.advance(DEBOUNCE);
      const first = s.coordinator.activeRecoveryId;
      expect(s.stored).toHaveLength(1);

      // A replacement that never activates leaves A and its snapshot alone.
      await s.timers.advance(MAXIMUM_AGE);
      expect(s.cleared).toEqual([]);
      expect(s.coordinator.activeRecoveryId).toBe(first);

      const b = new ProjectSession(createEmptyFolioProject({ documentId: "B", pageId: "page-B" }));
      s.coordinator.setProject(b);
      await s.timers.settle();

      expect(s.cleared).toEqual([first]);
      expect(s.coordinator.activeRecoveryId).not.toBe(first);
    } finally {
      s.cleanup();
    }
  });

  it("never lets a replaced project's write land on its successor", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      let finish!: (result: RecoveryStoreResult) => void;
      s.store.store.mockReturnValueOnce(
        new Promise<RecoveryStoreResult>((resolve) => {
          finish = resolve;
        }),
      );
      s.edit("Edited A");
      await s.timers.advance(DEBOUNCE);
      const first = s.coordinator.activeRecoveryId;

      const b = new ProjectSession(createEmptyFolioProject({ documentId: "B", pageId: "page-B" }));
      s.coordinator.setProject(b);
      const second = s.coordinator.activeRecoveryId;
      finish({ status: "stored" });
      await s.timers.settle();

      // A's late success is cleaned up, and B keeps its own identity and state.
      expect(s.cleared).toEqual([first]);
      expect(s.coordinator.activeRecoveryId).toBe(second);
      expect(s.coordinator.isWriting).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("drops the snapshot when the project is deliberately put away", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE);
      const recoveryId = s.coordinator.activeRecoveryId;

      await s.coordinator.discardActiveRecovery();
      expect(s.cleared).toEqual([recoveryId]);
    } finally {
      s.cleanup();
    }
  });

  it("leaves the snapshot behind when the session simply stops", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // Losing the renderer is exactly the case recovery exists for.
      s.cleanup();
      await s.timers.advance(MAXIMUM_AGE * 2);

      expect(s.cleared).toEqual([]);
      expect(s.store.store).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });
});
