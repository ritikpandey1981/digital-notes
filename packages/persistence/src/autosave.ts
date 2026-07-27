import type { DirtyTracker } from "./dirty-tracker";
import type { SaveNotebookResult } from "./save-pipeline";

export type AutosaveStatus = "idle" | "saving" | "scheduled" | "stopped";

export interface AutosaveTimerAdapter {
  readonly clearTimeout: (timer: unknown) => void;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
}

export interface AutosaveSchedulerOptions {
  readonly delayMs: number;
  readonly dirtyTracker: DirtyTracker;
  readonly save: () => Promise<SaveNotebookResult>;
  readonly onError?: (error: unknown) => void;
  readonly timer?: AutosaveTimerAdapter;
}

const defaultTimer: AutosaveTimerAdapter = {
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
};

export class AutosaveScheduler {
  readonly #delayMs: number;
  readonly #dirtyTracker: DirtyTracker;
  readonly #save: () => Promise<SaveNotebookResult>;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #timerAdapter: AutosaveTimerAdapter;
  #timer: unknown = null;
  #activeSave: Promise<SaveNotebookResult | null> | null = null;
  #pendingAfterSave = false;
  #status: AutosaveStatus = "idle";
  #stopped = false;

  constructor(options: AutosaveSchedulerOptions) {
    if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
      throw new RangeError("Autosave delay must be a non-negative finite number.");
    }
    this.#delayMs = options.delayMs;
    this.#dirtyTracker = options.dirtyTracker;
    this.#save = options.save;
    this.#onError = options.onError;
    this.#timerAdapter = options.timer ?? defaultTimer;
  }

  get status(): AutosaveStatus {
    return this.#status;
  }

  notifyActivity(): void {
    if (this.#stopped) return;
    this.#clearTimer();
    if (!this.#dirtyTracker.isDirty) {
      this.#status = "idle";
      return;
    }
    if (this.#activeSave) {
      this.#pendingAfterSave = true;
      return;
    }
    this.#status = "scheduled";
    this.#timer = this.#timerAdapter.setTimeout(() => {
      this.#timer = null;
      void this.#startSave().catch((error) => this.#onError?.(error));
    }, this.#delayMs);
  }

  async flush(): Promise<SaveNotebookResult | null> {
    if (this.#stopped) return null;
    this.#clearTimer();
    if (this.#activeSave) return this.#activeSave;
    if (!this.#dirtyTracker.isDirty) {
      this.#status = "idle";
      return null;
    }
    return this.#startSave();
  }

  stop(): void {
    this.#clearTimer();
    this.#pendingAfterSave = false;
    this.#stopped = true;
    this.#status = "stopped";
  }

  async #startSave(): Promise<SaveNotebookResult | null> {
    if (this.#activeSave) return this.#activeSave;
    this.#status = "saving";
    const active = this.#save();
    this.#activeSave = active;
    try {
      return await active;
    } finally {
      this.#activeSave = null;
      if (this.#stopped) {
        this.#pendingAfterSave = false;
      } else if (this.#pendingAfterSave && this.#dirtyTracker.isDirty) {
        this.#pendingAfterSave = false;
        this.notifyActivity();
      } else {
        this.#pendingAfterSave = false;
        this.#status = "idle";
      }
    }
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      this.#timerAdapter.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

export function createAutosaveScheduler(options: AutosaveSchedulerOptions): AutosaveScheduler {
  return new AutosaveScheduler(options);
}
