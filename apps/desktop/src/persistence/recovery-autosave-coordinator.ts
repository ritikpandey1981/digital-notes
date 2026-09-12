import type { ProjectSession } from "@folio/editor";
import { encodeFolioProject } from "@folio/persistence/project";
import type { DesktopRecoveryPort, RecoveryStoreResult } from "../../electron/recovery-contract";
import type { ProjectPersistenceState } from "./project-persistence-coordinator";

/** Recovery latency, not a Save cadence: how long after the last committed edit to capture. */
export const RECOVERY_DEBOUNCE_MS = 3_000;
/** Continuous editing must not starve recovery forever, so a capture is forced by this age. */
export const RECOVERY_MAXIMUM_AGE_MS = 30_000;
export const RECOVERY_RETRY_DELAY_MS = 5_000;
export const RECOVERY_MAXIMUM_RETRIES = 3;

export type RecoveryTimerHandle = ReturnType<typeof setTimeout>;

export interface RecoveryClock {
  readonly now: () => number;
  readonly setTimeout: (handler: () => void, delayMs: number) => RecoveryTimerHandle;
  readonly clearTimeout: (handle: RecoveryTimerHandle) => void;
}

export interface RecoveryAutosaveOptions {
  readonly store: DesktopRecoveryPort;
  readonly persistenceState: () => ProjectPersistenceState;
  readonly backingTargetId: () => string | null;
  readonly createId?: () => string;
  readonly clock?: RecoveryClock;
  readonly debounceMs?: number;
  readonly maximumAgeMs?: number;
  readonly retryDelayMs?: number;
  readonly maximumRetries?: number;
  readonly onStatusChange?: (status: RecoveryStatus) => void;
}

export type RecoveryStatus =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "scheduled" }>
  | Readonly<{ phase: "writing" }>
  | Readonly<{ phase: "stored"; capturedAt: string }>
  | Readonly<{ phase: "failed"; code: string; attempts: number }>;

interface ActiveRecovery {
  readonly project: ProjectSession;
  readonly recoveryId: string;
  readonly sessionId: string;
  readonly release: () => void;
  timer: RecoveryTimerHandle | null;
  /** When the oldest unwritten committed change arrived, for the maximum age. */
  pendingSince: number | null;
  writing: Promise<unknown> | null;
  /** A newer state arrived while a write was in flight; at most one is remembered. */
  writeAgain: boolean;
  storedStateId: string | null;
  attempts: number;
}

function defaultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? "";
}

const systemClock: RecoveryClock = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
};

/**
 * Keeps a crash-recoverable copy of the active project outside the user's file.
 *
 * It deliberately does not participate in the lifecycle gate that serialises
 * Save, Open, New and Close: losing a background snapshot costs a few seconds of
 * recovery latency, while making the user wait on one would be felt on every
 * action. Snapshots are immutable captures, so a write may finish long after the
 * drawing has moved on, and a result that belongs to a replaced project is
 * discarded rather than applied to its successor.
 */
export class RecoveryAutosaveCoordinator {
  readonly #options: Required<
    Omit<
      RecoveryAutosaveOptions,
      "store" | "persistenceState" | "backingTargetId" | "onStatusChange"
    >
  > &
    RecoveryAutosaveOptions;
  #active: ActiveRecovery | null = null;
  /** Scheduling is paused while nothing is mounted; the record on disk is untouched. */
  #suspended = true;

  constructor(options: RecoveryAutosaveOptions) {
    this.#options = {
      createId: options.createId ?? defaultId,
      clock: options.clock ?? systemClock,
      debounceMs: options.debounceMs ?? RECOVERY_DEBOUNCE_MS,
      maximumAgeMs: options.maximumAgeMs ?? RECOVERY_MAXIMUM_AGE_MS,
      retryDelayMs: options.retryDelayMs ?? RECOVERY_RETRY_DELAY_MS,
      maximumRetries: options.maximumRetries ?? RECOVERY_MAXIMUM_RETRIES,
      ...options,
    };
  }

  /** The project a future startup flow would find a snapshot for, or null. */
  get activeRecoveryId(): string | null {
    return this.#active?.recoveryId ?? null;
  }

  get isWriting(): boolean {
    return this.#active?.writing !== null && this.#active !== null;
  }

  /**
   * Follows the active project.
   *
   * Switching is the moment a replacement actually committed, which is the only
   * point at which the previous project's snapshot may go: a Discard the user
   * chose earlier means nothing if the incoming project never activated.
   */
  setProject(project: ProjectSession | null): void {
    if (this.#active?.project === project) return;
    this.#retire(this.#active, true);
    this.#active = project === null ? null : this.#begin(project);
    if (this.#active !== null) this.#evaluate(this.#active);
  }

  /**
   * Drops the active snapshot because the project is being put away deliberately.
   *
   * Only an approved close or a committed replacement may call this; a crash
   * must leave the record exactly where it is.
   */
  async discardActiveRecovery(): Promise<void> {
    const active = this.#active;
    if (active === null || active.storedStateId === null) return;
    this.#cancelTimer(active);
    active.storedStateId = null;
    await this.#clear(active);
  }

  /**
   * Runs scheduling while the workspace is mounted.
   *
   * Effect replay reconnects the same coordinator rather than destroying it, and
   * a real unmount only stops timers: whatever is already on disk stays there
   * for the startup flow to find, because unmount is not a decision about the
   * drawing.
   */
  connect(): () => void {
    this.#suspended = false;
    if (this.#active !== null) this.#evaluate(this.#active);
    return () => {
      this.#suspended = true;
      if (this.#active !== null) this.#cancelTimer(this.#active);
    };
  }

  #begin(project: ProjectSession): ActiveRecovery {
    const active: ActiveRecovery = {
      project,
      recoveryId: this.#options.createId(),
      sessionId: this.#options.createId(),
      release: () => undefined,
      timer: null,
      pendingSince: null,
      writing: null,
      writeAgain: false,
      storedStateId: null,
      attempts: 0,
    };
    const unsubscribe = project.subscribeContentState(() => {
      if (this.#active === active) this.#evaluate(active);
    });
    return Object.assign(active, { release: unsubscribe });
  }

  /** Stops one project's scheduling, and optionally drops the snapshot it left. */
  #retire(active: ActiveRecovery | null, discard: boolean): void {
    if (active === null) return;
    active.release();
    this.#cancelTimer(active);
    if (!discard) return;
    const pending = active.writing;
    if (active.storedStateId === null && pending === null) return;
    // A write still in flight lands after this point, so the delete waits for it
    // rather than racing it and leaving a file no session owns.
    void Promise.resolve(pending).then(
      () => this.#clear(active),
      () => this.#clear(active),
    );
  }

  async #clear(active: ActiveRecovery): Promise<void> {
    try {
      await this.#options.store.clear(active.recoveryId);
    } catch {
      // A snapshot that outlives its project is stale, not dangerous: the
      // startup flow validates candidates before offering any of them.
    }
  }

  /** Decides whether the current state still needs a snapshot, and when. */
  #evaluate(active: ActiveRecovery): void {
    if (this.#suspended || this.#active !== active) return;
    const state = this.#options.persistenceState();
    if (!state.hasUnsavedRisk) {
      // Nothing left to rescue: either a confirmed durable copy holds this exact
      // content, or the project is the blank sketch Folio made.
      this.#cancelTimer(active);
      active.pendingSince = null;
      if (active.storedStateId !== null) {
        active.storedStateId = null;
        void this.#clear(active);
      }
      this.#publish({ phase: "idle" });
      return;
    }
    if (active.project.contentStateId === active.storedStateId) return;
    this.#schedule(active);
  }

  #schedule(active: ActiveRecovery, delayOverrideMs?: number): void {
    const clock = this.#options.clock;
    const now = clock.now();
    active.pendingSince ??= now;
    const debounced = now + (delayOverrideMs ?? this.#options.debounceMs);
    // Quiet editing is captured a few seconds after it stops; continuous editing
    // is captured anyway once the oldest unwritten change reaches its age limit.
    const deadline =
      delayOverrideMs === undefined
        ? Math.min(debounced, active.pendingSince + this.#options.maximumAgeMs)
        : debounced;
    this.#cancelTimer(active);
    active.timer = clock.setTimeout(
      () => {
        active.timer = null;
        this.#capture(active);
      },
      Math.max(0, deadline - now),
    );
    this.#publish({ phase: "scheduled" });
  }

  #cancelTimer(active: ActiveRecovery): void {
    if (active.timer === null) return;
    this.#options.clock.clearTimeout(active.timer);
    active.timer = null;
  }

  #capture(active: ActiveRecovery): void {
    if (this.#suspended || this.#active !== active) return;
    // A live preview is not a state anything should be able to recover into.
    if (active.project.documentSession.hasTransientEdit) {
      this.#schedule(active, this.#options.debounceMs);
      return;
    }
    const state = this.#options.persistenceState();
    if (!state.hasUnsavedRisk) {
      this.#evaluate(active);
      return;
    }
    if (active.writing !== null) {
      active.writeAgain = true;
      return;
    }
    const capture = active.project.capturePersistenceSnapshot();
    let content: string;
    try {
      content = encodeFolioProject(capture.project);
    } catch {
      this.#failed(active, "ENCODE_FAILED");
      return;
    }
    this.#publish({ phase: "writing" });
    const capturedAt = new Date(this.#options.clock.now()).toISOString();
    const write = this.#options.store
      .store({
        recoveryId: active.recoveryId,
        sessionId: active.sessionId,
        documentId: active.project.metadata.documentId,
        title: active.project.metadata.title,
        capturedAt,
        backingTargetId: this.#options.backingTargetId(),
        content,
      })
      .then(
        (result) => this.#settled(active, result, capture.stateId, capturedAt),
        () =>
          this.#settled(
            active,
            { status: "failed", error: { code: "UNKNOWN", message: "" } },
            capture.stateId,
            capturedAt,
          ),
      );
    active.writing = write;
  }

  #settled(
    active: ActiveRecovery,
    result: RecoveryStoreResult,
    stateId: string,
    capturedAt: string,
  ): void {
    active.writing = null;
    // The project this snapshot belonged to is gone; its result must not touch
    // whatever replaced it.
    if (this.#active !== active) return;
    if (result.status === "failed") {
      this.#failed(active, result.error.code);
      return;
    }
    active.attempts = 0;
    active.storedStateId = stateId;
    active.pendingSince = null;
    this.#publish({ phase: "stored", capturedAt });
    const again = active.writeAgain;
    active.writeAgain = false;
    if (again || active.project.contentStateId !== stateId) this.#evaluate(active);
  }

  #failed(active: ActiveRecovery, code: string): void {
    active.attempts += 1;
    this.#publish({ phase: "failed", code, attempts: active.attempts });
    // Drawing continues regardless; a snapshot that cannot be written is a
    // reduced safety net, never an editing error.
    if (active.attempts > this.#options.maximumRetries) return;
    this.#schedule(active, this.#options.retryDelayMs * active.attempts);
  }

  #publish(status: RecoveryStatus): void {
    try {
      this.#options.onStatusChange?.(status);
    } catch {
      // Status observers cannot interrupt recovery.
    }
  }
}
