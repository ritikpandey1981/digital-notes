import type { ForegroundInteractionSource, ProjectSession } from "@folio/editor";
import { encodeFolioProject } from "@folio/persistence/project";
import type { DesktopRecoveryPort, RecoveryStoreResult } from "../../electron/recovery-contract";
import type { ProjectPersistenceState } from "./project-persistence-coordinator";

/** Recovery latency, not a Save cadence: how long after the last committed edit to capture. */
export const RECOVERY_DEBOUNCE_MS = 3_000;
/** Continuous editing must not starve recovery forever, so a capture is forced by this age. */
export const RECOVERY_MAXIMUM_AGE_MS = 30_000;
export const RECOVERY_RETRY_DELAY_MS = 5_000;
export const RECOVERY_MAXIMUM_RETRIES = 3;
/**
 * How long after an interaction ends before a capture it held back may run.
 *
 * Long enough that the encoding never happens in the task that ended the
 * interaction -- finishing a mark commits it, hands it to the compositor and
 * flushes a render, all inside the release -- and short enough that nobody
 * could tell the difference in how fresh a snapshot is.
 */
export const RECOVERY_INPUT_SETTLE_MS = 250;
/**
 * How long cleanup of a record that protects nothing may hold anything up.
 *
 * Removing a stale snapshot is housekeeping. Putting a project away must never
 * wait on it indefinitely, because a leftover file costs a redundant prompt
 * next time while a hung close costs the user their window.
 */
export const RECOVERY_CLEANUP_TIMEOUT_MS = 2_000;

export type RecoveryTimerHandle = ReturnType<typeof setTimeout>;

/** Content identity as the project reports it, without depending on History here. */
type ProjectContentStateId = ProjectSession["contentStateId"];

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
  readonly inputSettleMs?: number;
  /**
   * Whether the user is interacting with the editor right now.
   *
   * Orthogonal to settlement, and the two must stay that way. Settlement
   * answers whether the model is safe to serialize. This answers whether the
   * renderer should begin several hundred milliseconds of encoding at this
   * moment. A live stroke is not in the document, so a drawing project is
   * perfectly safe to write for the whole time it is being drawn -- and that is
   * exactly when writing it is felt.
   *
   * Omitted, recovery schedules the way it did before interaction was visible
   * to it: on settlement alone.
   */
  readonly interactionActivity?: ForegroundInteractionSource;
  readonly onStatusChange?: (status: RecoveryStatus) => void;
}

export type RecoveryStatus =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "scheduled" }>
  | Readonly<{ phase: "writing" }>
  | Readonly<{ phase: "stored"; capturedAt: string }>
  /** `exhausted` means retrying has stopped; the artwork has no background copy. */
  | Readonly<{ phase: "failed"; code: string; attempts: number; exhausted: boolean }>;

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
  /**
   * The content a due capture was holding back for, while input was in progress.
   *
   * Remembering which state it was for is what tells the two endings apart. If
   * that content is still current when the interaction finishes, nothing was
   * committed and this capture is simply overdue. If it is not, the interaction
   * committed something newer, and the newer state's own debounce is the
   * schedule that should stand.
   */
  deferredStateId: ProjectContentStateId | null;
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
      "store" | "persistenceState" | "backingTargetId" | "interactionActivity" | "onStatusChange"
    >
  > &
    RecoveryAutosaveOptions;
  #active: ActiveRecovery | null = null;
  /**
   * A record from a previous run that this one is standing in for.
   *
   * Set when a crash candidate is recovered. It stays on disk until this run
   * has its own durable copy of the rescued artwork, because between activating
   * it and writing it there is a window in which that record is the only copy
   * of the drawing that exists anywhere.
   */
  #predecessorRecoveryId: string | null = null;
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
      inputSettleMs: options.inputSettleMs ?? RECOVERY_INPUT_SETTLE_MS,
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
   * Takes responsibility for the record a rescued project came from.
   *
   * Recovering activates artwork that no file holds. Deleting its source the
   * moment it appears on screen would leave it in memory alone, so the source
   * is kept until this run has protected the same artwork itself -- by writing
   * its own snapshot, by the user saving it, or by the user deliberately
   * putting it away.
   */
  adoptPredecessorRecovery(recoveryId: string): void {
    if (this.#predecessorRecoveryId === recoveryId) return;
    const previous = this.#predecessorRecoveryId;
    this.#predecessorRecoveryId = recoveryId;
    if (previous !== null) void this.#clearRecord(previous);
  }

  /**
   * Drops the active snapshot because the project is being put away deliberately.
   *
   * Only an approved close or a committed replacement may call this; a crash
   * must leave the record exactly where it is. It answers even when the delete
   * does not, because a window must not hang on housekeeping.
   */
  async discardActiveRecovery(): Promise<void> {
    this.#releasePredecessor();
    const active = this.#active;
    if (active === null || active.storedStateId === null) return;
    this.#cancelTimer(active);
    active.storedStateId = null;
    await this.#clearRecord(active.recoveryId);
  }

  /** The rescued artwork is protected by something durable now, so its source may go. */
  #releasePredecessor(): void {
    const recoveryId = this.#predecessorRecoveryId;
    if (recoveryId === null) return;
    this.#predecessorRecoveryId = null;
    void this.#clearRecord(recoveryId);
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
    const releaseInteraction =
      this.#options.interactionActivity?.subscribeIdle(() => this.#interactionEnded()) ?? null;
    if (this.#active !== null) this.#evaluate(this.#active);
    return () => {
      this.#suspended = true;
      releaseInteraction?.();
      if (this.#active !== null) this.#cancelTimer(this.#active);
    };
  }

  /**
   * Brings a capture that input held back forward to the end of that input.
   *
   * Holding one back always leaves its timer armed, so this is about promptness
   * and not about correctness: without it the capture still happens, just after
   * waiting out another debounce for no reason. A capture the interaction
   * itself made obsolete is left alone -- see {@link ActiveRecovery.deferredStateId}.
   */
  #interactionEnded(): void {
    const active = this.#active;
    if (active === null || this.#suspended) return;
    const deferredFor = active.deferredStateId;
    if (deferredFor === null) return;
    active.deferredStateId = null;
    if (active.project.contentStateId !== deferredFor) return;
    this.#schedule(active, this.#options.inputSettleMs);
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
      deferredStateId: null,
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
      () => this.#clearRecord(active.recoveryId),
      () => this.#clearRecord(active.recoveryId),
    );
  }

  async #clearRecord(recoveryId: string): Promise<void> {
    try {
      await this.#bounded(this.#options.store.clear(recoveryId));
    } catch {
      // A snapshot that outlives its project is stale, not dangerous: the
      // startup flow validates candidates before offering any of them.
    }
  }

  /** Gives up waiting on cleanup rather than letting it hold a project open. */
  #bounded(operation: Promise<unknown>): Promise<unknown> {
    const clock = this.#options.clock;
    let timer: RecoveryTimerHandle | null = null;
    const expiry = new Promise<void>((resolve) => {
      timer = clock.setTimeout(() => resolve(), RECOVERY_CLEANUP_TIMEOUT_MS);
    });
    // The delete may still land later; nothing depends on knowing whether it did.
    operation.catch(() => undefined);
    return Promise.race([operation, expiry]).finally(() => {
      if (timer !== null) clock.clearTimeout(timer);
    });
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
      active.deferredStateId = null;
      if (active.storedStateId !== null) {
        active.storedStateId = null;
        void this.#clearRecord(active.recoveryId);
      }
      // A confirmed durable copy protects rescued artwork as well as a snapshot
      // would, so whatever it was rescued from is finally free to go.
      this.#releasePredecessor();
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
    // A live preview or an open gesture transaction is not a state anything
    // should be able to recover into.
    if (!active.project.isPersistenceSettled) {
      this.#schedule(active, this.#options.debounceMs);
      return;
    }
    // Settled says the bytes are safe to write. It does not say this is a good
    // moment to spend several hundred milliseconds producing them, and during a
    // stroke it never is: the mark being drawn is not in the document, so the
    // committed project stays settled for exactly as long as someone is busy.
    //
    // Holding back is all this does. The timer stays armed, the pending change
    // keeps the age it already had, and the capture happens at the first moment
    // the hand is free -- promptly if the interaction ended with nothing newer
    // to write, and otherwise on the newer state's own debounce.
    if (this.#options.interactionActivity?.isActive() === true) {
      active.deferredStateId = active.project.contentStateId;
      this.#schedule(active, this.#options.debounceMs);
      return;
    }
    active.deferredStateId = null;
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
    // This run now holds its own durable copy of the artwork.
    this.#releasePredecessor();
    active.writeAgain = false;
    // The state that started this write is not necessarily the state now: the
    // project may have moved on, or become clean while the disk was busy. Ask
    // again rather than assuming, which is the only way a snapshot that stopped
    // being necessary gets cleared.
    this.#evaluate(active);
  }

  #failed(active: ActiveRecovery, code: string): void {
    active.attempts += 1;
    const exhausted = active.attempts > this.#options.maximumRetries;
    this.#publish({ phase: "failed", code, attempts: active.attempts, exhausted });
    // Drawing continues regardless; a snapshot that cannot be written is a
    // reduced safety net, never an editing error. Giving up is worth saying
    // once, though, because from then on nothing is protecting the drawing.
    if (exhausted) return;
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
