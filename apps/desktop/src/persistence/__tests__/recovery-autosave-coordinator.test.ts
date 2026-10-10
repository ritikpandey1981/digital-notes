import { ForegroundInteractionTracker, ProjectSession } from "@folio/editor";
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
const INPUT_SETTLE = 250;

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
  // The real signal, driven by hand: these tests are about what recovery does
  // with it, and a stand-in could agree with an implementation that is wrong.
  const interaction = new ForegroundInteractionTracker();
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
    inputSettleMs: INPUT_SETTLE,
    interactionActivity: interaction,
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
    interaction,
    /** A press begins, the mark it draws commits, and the hand lifts. */
    stroke: (name: string) => {
      interaction.begin(1);
      history.executePageRename("page-A", name);
      interaction.end(1);
    },
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

describe("recovery waits for the document to settle", () => {
  it("captures nothing while a gesture transaction is open, and nothing after it rolls back", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Committed");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      // The shape of an eraser gesture: real successors, none of them decided.
      s.history.controller.beginTransaction({
        id: "erase-strokes-probe",
        timestamp: "2026-09-13T09:00:00.000Z",
        description: "Erase strokes",
      });
      s.edit("Mid gesture");
      await s.timers.advance(MAXIMUM_AGE * 2);
      expect(s.stored, "an undecided state must never be recoverable").toHaveLength(1);

      s.history.controller.rollbackTransaction();
      await s.timers.advance(MAXIMUM_AGE);
      // Back to the state already on disk, so there is nothing new to write.
      expect(s.stored).toHaveLength(1);
      expect(s.project.documentSession.sketchbook.firstPage.name).toBe("Committed");
    } finally {
      s.cleanup();
    }
  });

  it("captures the gesture once the user keeps it", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Committed");
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(1);

      s.history.controller.beginTransaction({
        id: "erase-strokes-probe",
        timestamp: "2026-09-13T09:00:00.000Z",
        description: "Erase strokes",
      });
      s.edit("Kept");
      await s.timers.advance(MAXIMUM_AGE * 2);
      expect(s.stored).toHaveLength(1);

      s.history.controller.commitTransaction();
      await s.timers.advance(DEBOUNCE);
      expect(s.stored).toHaveLength(2);
      expect(decodeFolioProject(s.stored[1]!.content).sketchbook.firstPage.name).toBe("Kept");
    } finally {
      s.cleanup();
    }
  });
});

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

/**
 * Recovery used to be allowed to encode the project while someone was drawing.
 *
 * Not because it ignored anything, but because the only question it asked was
 * whether the document was safe to serialize, and the answer during a stroke is
 * yes: the mark being drawn is not in the document. What it could not see was
 * that producing those bytes takes several hundred milliseconds, and that the
 * person is holding a pen.
 */
describe("recovery stays out of the way of interaction", () => {
  it("captures a due state when nothing is being interacted with", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Quiet");
      await s.timers.advance(DEBOUNCE);

      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(s.interaction.isActive()).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("does not start a due capture while a press is in progress", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Mark A");

      // The next mark starts inside the debounce armed by the previous one.
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      // Far past the moment the capture was due, and still nothing has run.
      await s.timers.advance(DEBOUNCE * 4);

      expect(s.store.store).not.toHaveBeenCalled();
      // The requirement is not lost: it is still armed, waiting for the hand.
      expect(s.timers.pendingCount).toBe(1);
    } finally {
      s.cleanup();
    }
  });

  it("resumes a held-back capture promptly when the press commits nothing", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Mark A");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).not.toHaveBeenCalled();

      // A cancelled stroke, a pan, a click that selected nothing: the press is
      // over and the document is exactly what it was when the capture came due.
      s.interaction.end(1);
      expect(s.store.store).not.toHaveBeenCalled();

      await s.timers.advance(INPUT_SETTLE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Mark A");
    } finally {
      s.cleanup();
    }
  });

  it("never encodes inside the release that ends the press", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Mark A");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      await s.timers.advance(DEBOUNCE);

      s.interaction.end(1);
      // Finishing a mark commits it, hands it to the compositor and flushes a
      // render, all in this one task. Recovery is not allowed to join it.
      expect(s.store.store).not.toHaveBeenCalled();
      await s.timers.advance(INPUT_SETTLE - 1);
      expect(s.store.store).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("coalesces a held-back capture into the state the press committed", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Mark A");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.stroke("Mark B");
      await s.timers.advance(DEBOUNCE);

      // One capture, of B. A's capture was due and held back; B's own debounce
      // then became the authority, so A is never written on its own.
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Mark B");
    } finally {
      s.cleanup();
    }
  });

  it("lets the newer state keep its own debounce rather than capturing early", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Mark A");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      // Long enough that A's capture really does come due inside the press.
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).not.toHaveBeenCalled();
      s.edit("Mark B");
      s.interaction.end(1);

      // The prompt resumption belongs to a press that committed nothing. This
      // one committed, so capturing a quarter of a second after the lift would
      // put the encode right back where the artist is still working.
      await s.timers.advance(INPUT_SETTLE * 2);
      expect(s.store.store).not.toHaveBeenCalled();

      // It is B's own debounce that decides, and B is what gets written.
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Mark B");
    } finally {
      s.cleanup();
    }
  });

  it("interrupts no stroke in a burst, and captures once afterwards", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      for (const name of ["One", "Two", "Three", "Four", "Five"]) {
        s.interaction.begin(1);
        // A mark takes time to draw, and the debounce can come due inside it.
        await s.timers.advance(2_000);
        s.edit(name);
        s.interaction.end(1);
        await s.timers.advance(1_500);
      }
      expect(s.store.store).not.toHaveBeenCalled();

      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Five");
    } finally {
      s.cleanup();
    }
  });

  it("holds back the age limit instead of forcing an encode into a stroke", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      // Steady committed editing: the age limit, not the debounce, decides.
      for (let step = 0; step < 9; step += 1) {
        s.stroke(`Step ${step}`);
        await s.timers.advance(2_000);
      }
      expect(s.store.store).not.toHaveBeenCalled();

      // One long mark, drawn straight through the age limit.
      s.interaction.begin(1);
      await s.timers.advance(MAXIMUM_AGE * 2);
      expect(s.store.store).not.toHaveBeenCalled();

      s.interaction.end(1);
      await s.timers.advance(INPUT_SETTLE);
      // Overdue, so it goes at the first moment the hand is free -- which is
      // what the age limit is for. It is a deadline for the next safe boundary,
      // not a licence to block the renderer wherever it happens to fall.
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(decodeFolioProject(s.stored[0]!.content).sketchbook.firstPage.name).toBe("Step 8");
    } finally {
      s.cleanup();
    }
  });

  it("writes nothing for a project that was retired while a capture was held back", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited A");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).not.toHaveBeenCalled();

      const b = new ProjectSession(createEmptyFolioProject({ documentId: "B", pageId: "page-B" }));
      s.coordinator.setProject(b);
      s.interaction.end(1);
      await s.timers.advance(MAXIMUM_AGE);

      // A is gone. Nothing it had pending may reach the disk under its identity.
      expect(s.stored.every((request) => request.documentId === "B")).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("drops a held-back capture that a confirmed save has made unnecessary", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).not.toHaveBeenCalled();

      // Save lands while the press continues. The artwork is durable now, so
      // the snapshot that was waiting protects nothing.
      s.risk({ isDirty: false, hasConfirmedCheckpoint: true, hasUnsavedRisk: false });
      s.project.confirmDurableCheckpoint(s.project.contentStateId);
      s.interaction.end(1);
      await s.timers.advance(MAXIMUM_AGE);

      expect(s.store.store).not.toHaveBeenCalled();
      expect(s.timers.pendingCount).toBe(0);
    } finally {
      s.cleanup();
    }
  });

  it("keeps one timer and one pending capture however long input continues", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.interaction.begin(1);
      for (let step = 0; step < 20; step += 1) {
        s.edit(`Step ${step}`);
        await s.timers.advance(DEBOUNCE);
        // Deferral is a flag and a timer, not a list of postponed captures.
        expect(s.timers.pendingCount).toBe(1);
      }
      expect(s.store.store).not.toHaveBeenCalled();

      s.interaction.end(1);
      await s.timers.advance(DEBOUNCE + INPUT_SETTLE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
      expect(s.timers.pendingCount).toBe(0);
    } finally {
      s.cleanup();
    }
  });

  it("leaves settlement meaning what it meant, with or without a press", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      // A press is not a transaction: the document is settled throughout one.
      s.interaction.begin(1);
      expect(s.project.isPersistenceSettled).toBe(true);
      s.edit("Drawn");
      expect(s.project.isPersistenceSettled).toBe(true);
      s.interaction.end(1);

      // An open gesture transaction is still the thing that unsettles it.
      s.history.controller.beginTransaction({
        id: "erase-strokes-probe",
        timestamp: "2026-10-10T09:00:00.000Z",
        description: "Erase strokes",
      });
      s.edit("Mid gesture");
      expect(s.project.isPersistenceSettled).toBe(false);
      s.history.controller.rollbackTransaction();
      expect(s.project.isPersistenceSettled).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("changes nothing about the document by being pressed on", async () => {
    const s = setup();
    try {
      const before = {
        stateId: s.project.contentStateId,
        dirty: s.project.isDirty,
        undo: s.history.controller.canUndo(),
      };

      s.interaction.begin(1);
      s.interaction.begin(2);
      s.interaction.end(2);
      s.interaction.end(1);
      await s.timers.settle();

      expect(s.project.contentStateId).toBe(before.stateId);
      expect(s.project.isDirty).toBe(before.dirty);
      expect(s.history.controller.canUndo()).toBe(before.undo);
      expect(s.store.store).not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("waits for the last press to lift, not the first", async () => {
    const s = setup();
    try {
      s.risk({ isDirty: true, hasUnsavedRisk: true });
      s.edit("Edited");
      await s.timers.advance(DEBOUNCE - 1_000);
      s.interaction.begin(1);
      s.interaction.begin(2);
      await s.timers.advance(DEBOUNCE);
      expect(s.store.store).not.toHaveBeenCalled();

      s.interaction.end(1);
      await s.timers.advance(INPUT_SETTLE * 2);
      // One finger up is not the end of the interaction.
      expect(s.store.store).not.toHaveBeenCalled();

      s.interaction.end(2);
      await s.timers.advance(INPUT_SETTLE);
      expect(s.store.store).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });
});
