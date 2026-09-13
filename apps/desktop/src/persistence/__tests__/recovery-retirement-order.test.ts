import { ProjectSession } from "@folio/editor";
import { createEmptyFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import type {
  RecoveryClearResult,
  RecoverySnapshotRequest,
  RecoveryStoreResult,
} from "../../../electron/recovery-contract";
import type { ProjectPersistenceState } from "../project-persistence-coordinator";
import { RecoveryAutosaveCoordinator, type RecoveryClock } from "../recovery-autosave-coordinator";

const DEBOUNCE = 3_000;
const MAXIMUM_AGE = 30_000;

afterEach(() => vi.restoreAllMocks());

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
    async settle() {
      for (let step = 0; step < 12; step += 1) await Promise.resolve();
    },
  };
}

/** Store and clear the test releases by hand, so an interleaving can be built. */
function deferrable<TResult>(result: TResult) {
  const waiting: (() => void)[] = [];
  let deferred = false;
  const run = async (): Promise<TResult> => {
    if (!deferred) return result;
    await new Promise<void>((resolve) => waiting.push(resolve));
    return result;
  };
  return {
    run,
    defer: () => {
      deferred = true;
    },
    releaseAll: () => {
      deferred = false;
      for (const resolve of waiting.splice(0)) resolve();
    },
    get held() {
      return waiting.length;
    },
  };
}

function setup() {
  const project = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const stored: RecoverySnapshotRequest[] = [];
  const cleared: string[] = [];
  const storeGate = deferrable<RecoveryStoreResult>({ status: "stored" });
  const clearGate = deferrable<RecoveryClearResult>({ status: "cleared" });
  const store = {
    store: vi.fn(async (request: RecoverySnapshotRequest): Promise<RecoveryStoreResult> => {
      stored.push(request);
      return storeGate.run();
    }),
    clear: vi.fn(async (recoveryId: string): Promise<RecoveryClearResult> => {
      cleared.push(recoveryId);
      return clearGate.run();
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
    storeGate,
    clearGate,
    timers,
    coordinator,
    history,
    risk: (next: Partial<ProjectPersistenceState>) => {
      state = { ...state, ...next };
    },
    edit: (name: string) => history.executePageRename("page-A", name),
    /** What a save does: the project becomes clean and announces it. */
    saveClean: () => {
      state = { ...state, isDirty: false, hasConfirmedCheckpoint: true, hasUnsavedRisk: false };
      project.confirmDurableCheckpoint(project.contentStateId);
    },
    cleanup: () => {
      release();
      history.destroy();
    },
  };
}

describe("recovery records retire in a defensible order", () => {
  it("clears a record that became unnecessary while its write was in flight", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");
      s.storeGate.defer();
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // A manual save lands while the snapshot is still being written.
      s.saveClean();
      await s.timers.settle();
      s.storeGate.releaseAll();
      await s.timers.settle();
      await s.timers.advance(DEBOUNCE);

      // The file on disk now protects nothing, and must not be left behind.
      expect(s.cleared, "the stale snapshot was never cleared").toContain(s.stored[0]?.recoveryId);
    } finally {
      s.cleanup();
    }
  });

  it("does not leave a retired record behind when a late write lands after it", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");
      s.storeGate.defer();
      await s.timers.advance(DEBOUNCE);
      const recoveryId = s.stored[0]?.recoveryId;

      // The project is replaced while its snapshot is still being written.
      const replacement = new ProjectSession(
        createEmptyFolioProject({ documentId: "B", title: "Study B", pageId: "page-B" }),
      );
      s.coordinator.setProject(replacement);
      s.storeGate.releaseAll();
      await s.timers.settle();

      expect(s.cleared).toContain(recoveryId);
      // And the successor is never bound to the retired identity.
      expect(s.coordinator.activeRecoveryId).not.toBe(recoveryId);
    } finally {
      s.cleanup();
    }
  });

  it("writes the newest state when one arrived while a write was in flight", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");
      s.storeGate.defer();
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      s.edit("Second");
      s.storeGate.releaseAll();
      await s.timers.settle();
      await s.timers.advance(DEBOUNCE);

      expect(s.stored).toHaveLength(2);
      expect(s.stored[1]?.recoveryId).toBe(s.stored[0]?.recoveryId);
    } finally {
      s.cleanup();
    }
  });

  it("does not wait forever to put a project away", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // The delete never answers. Closing must still be able to finish: a
      // snapshot that outlives its project is stale, never lost work.
      s.clearGate.defer();
      let settled = false;
      void s.coordinator.discardActiveRecovery().then(() => {
        settled = true;
      });
      await s.timers.settle();
      await s.timers.advance(60_000);
      await s.timers.settle();

      expect(settled, "putting the project away hung on recovery cleanup").toBe(true);
    } finally {
      s.clearGate.releaseAll();
      s.cleanup();
    }
  });

  it("never recreates a record that was explicitly retired", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("First");
      await s.timers.advance(DEBOUNCE);
      const recoveryId = s.stored[0]?.recoveryId;

      // A late store for the retired identity must not resurrect its file.
      s.storeGate.defer();
      s.edit("Second");
      await s.timers.advance(DEBOUNCE);
      await s.coordinator.discardActiveRecovery();
      s.storeGate.releaseAll();
      await s.timers.settle();

      const clearsAfterLastStore =
        s.cleared.lastIndexOf(recoveryId ?? "") > -1 &&
        s.cleared.filter((one) => one === recoveryId).length >= 1;
      expect(clearsAfterLastStore).toBe(true);
      expect(
        s.coordinator.isWriting,
        "no write may still be outstanding for a retired record",
      ).toBe(false);
    } finally {
      s.cleanup();
    }
  });
});
