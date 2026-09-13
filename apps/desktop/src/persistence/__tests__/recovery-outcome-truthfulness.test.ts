import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
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
  RecoveryClearResult,
  RecoveryListResult,
  RecoveryReadResult,
} from "../../../electron/recovery-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import { ProjectLifecycleCoordinator } from "../project-lifecycle-coordinator";
import { ProjectRecoveryCoordinator } from "../project-recovery-coordinator";
import { RecoveryAutosaveCoordinator, type RecoveryClock } from "../recovery-autosave-coordinator";

const R1 = "00000000-0000-4000-8000-0000000000d1";
const OPENED_BACKING = { id: "00000000-0000-4000-8000-0000000000b0", displayName: "b.folio" };

afterEach(() => vi.restoreAllMocks());

function setup() {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue({ status: "saved", backing: OPENED_BACKING });
  const adopt = vi.fn<(targetId: string) => Promise<ProjectTargetResult>>(async (targetId) => ({
    status: "adopted",
    backing: { id: targetId, displayName: OPENED_BACKING.displayName },
  }));
  const openOriginal = vi.fn<() => Promise<ProjectReadResult>>().mockResolvedValue({
    status: "read",
    content: encodeFolioProject(
      createEmptyFolioProject({ documentId: "O", title: "Saved original", pageId: "page-O" }),
    ),
    backing: OPENED_BACKING,
  });
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
  const lifecycle = new ProjectLifecycleCoordinator(persistence, {
    confirmReplacement: async () => "discard",
  });
  const list = vi
    .fn<() => Promise<RecoveryListResult>>()
    .mockResolvedValue({ status: "listed", candidates: [] });
  const read = vi.fn<(id: string) => Promise<RecoveryReadResult>>().mockResolvedValue({
    status: "read",
    content: encodeFolioProject(
      createEmptyFolioProject({ documentId: "R", title: "Rescued", pageId: "page-R" }),
    ),
  });
  const clear = vi
    .fn<(id: string) => Promise<RecoveryClearResult>>()
    .mockResolvedValue({ status: "cleared" });

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

  const recovery = new ProjectRecoveryCoordinator(
    persistence,
    lifecycle,
    { list, read, clear },
    { adoptPredecessorRecovery: () => undefined },
  );
  return {
    a,
    host,
    persistence,
    recovery,
    list,
    read,
    clear,
    adopt,
    openOriginal,
    cleanup: () => {
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("recovery says what actually happened", () => {
  it("tells an empty recovery directory apart from a scan that failed", async () => {
    const s = setup();
    try {
      expect(await s.recovery.listCandidates()).toEqual({ status: "listed", candidates: [] });

      s.list.mockResolvedValue({
        status: "failed",
        error: { code: "READ_FAILED", message: "no" },
      });
      expect(
        await s.recovery.listCandidates(),
        "a failed scan was reported as an empty one",
      ).toEqual({ status: "unavailable" });

      s.list.mockRejectedValue(new Error("gone"));
      expect(await s.recovery.listCandidates()).toEqual({ status: "unavailable" });
    } finally {
      s.cleanup();
    }
  });

  it("does not call an unconfirmed Open Original an ordinary success", async () => {
    const s = setup();
    try {
      s.adopt.mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "revoked" },
      });

      const result = await s.recovery.openOriginal(R1);
      expect(result).toEqual({ status: "opened-original", backingConfirmed: false });
      // The project really did change, and nothing durable holds it.
      expect(s.persistence.shellState.hasUnsavedRisk).toBe(true);
      expect(s.clear, "the candidate was consumed on an unconfirmed open").not.toHaveBeenCalled();
    } finally {
      s.cleanup();
    }
  });

  it("reports a fully confirmed Open Original plainly", async () => {
    const s = setup();
    try {
      expect(await s.recovery.openOriginal(R1)).toEqual({
        status: "opened-original",
        backingConfirmed: true,
      });
      expect(s.clear).toHaveBeenCalledWith(R1);
    } finally {
      s.cleanup();
    }
  });
});

/** A clock the test advances by hand. */
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

describe("background recovery reports when it has given up", () => {
  function autosave(storeResults: (() => Promise<{ status: "stored" } | never>)[]) {
    const project = new ProjectSession(
      createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
    );
    const statuses: { phase: string; exhausted?: boolean }[] = [];
    const timers = createClock();
    let attempt = 0;
    const coordinator = new RecoveryAutosaveCoordinator({
      store: {
        store: vi.fn(async () => {
          const next = storeResults[Math.min(attempt, storeResults.length - 1)];
          attempt += 1;
          return next!();
        }),
        clear: vi.fn(async () => ({ status: "cleared" }) as const),
      },
      persistenceState: () => ({
        isDirty: true,
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        hasUnsavedRisk: true,
      }),
      backingTargetId: () => null,
      createId: (() => {
        let ordinal = 0;
        return () => `00000000-0000-4000-8000-${String(++ordinal).padStart(12, "0")}`;
      })(),
      clock: timers.clock,
      onStatusChange: (status) => statuses.push(status as { phase: string; exhausted?: boolean }),
    });
    const release = coordinator.connect();
    coordinator.setProject(project);
    return { project, coordinator, statuses, timers, release };
  }

  it("stays quiet about a failure it then recovers from", async () => {
    const failing = async () => {
      throw new Error("disk busy");
    };
    const ok = async () => ({ status: "stored" }) as const;
    const s = autosave([failing, ok]);
    try {
      s.project.documentSession.replaceDocument(s.project.documentSession.getDocument());
      await s.timers.advance(3_000);
      await s.timers.advance(10_000);

      expect(s.statuses.some((status) => status.phase === "stored")).toBe(true);
      expect(
        s.statuses.some((status) => status.exhausted === true),
        "a retry that succeeded was reported as given up on",
      ).toBe(false);
    } finally {
      s.release();
    }
  });

  it("says so once it has stopped trying", async () => {
    const failing = async () => {
      throw new Error("disk full");
    };
    const s = autosave([failing]);
    try {
      s.project.documentSession.replaceDocument(s.project.documentSession.getDocument());
      for (let step = 0; step < 6; step += 1) await s.timers.advance(30_000);

      const exhausted = s.statuses.filter((status) => status.exhausted === true);
      expect(exhausted.length, "giving up was never reported").toBeGreaterThan(0);
    } finally {
      s.release();
    }
  });
});
