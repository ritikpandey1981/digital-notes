import { afterEach, describe, expect, it, vi } from "vitest";
import { AutosaveScheduler, createAutosaveScheduler } from "../autosave";
import { DirtyTracker } from "../dirty-tracker";
import type { DirtySnapshot } from "../dirty-tracker";
import type { SaveNotebookResult } from "../save-pipeline";

const savedResult: SaveNotebookResult = Object.freeze({
  notebookPath: "C:\\notebooks\\Atlas",
  formatVersion: 1,
  writtenFiles: Object.freeze(["metadata.json"]),
  skippedFiles: Object.freeze([]),
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AutosaveScheduler", () => {
  it("saves dirty work after the configured inactivity delay", async () => {
    vi.useFakeTimers();
    const tracker = new DirtyTracker();
    tracker.markMetadata();
    const save = vi.fn(async () => {
      const snapshot = tracker.beginSave();
      tracker.completeSave(snapshot);
      return savedResult;
    });
    const scheduler = createAutosaveScheduler({ delayMs: 100, dirtyTracker: tracker, save });

    scheduler.notifyActivity();
    expect(scheduler.status).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(99);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledOnce();
    expect(scheduler.status).toBe("idle");
  });

  it("resets the inactivity window on later activity", async () => {
    vi.useFakeTimers();
    const tracker = new DirtyTracker();
    tracker.markMetadata();
    const save = vi.fn(async () => {
      const snapshot = tracker.beginSave();
      tracker.completeSave(snapshot);
      return savedResult;
    });
    const scheduler = new AutosaveScheduler({ delayMs: 100, dirtyTracker: tracker, save });

    scheduler.notifyActivity();
    await vi.advanceTimersByTimeAsync(75);
    tracker.markMetadata();
    scheduler.notifyActivity();
    await vi.advanceTimersByTimeAsync(75);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    expect(save).toHaveBeenCalledOnce();
  });

  it("flushes immediately for application backgrounding and does nothing when clean", async () => {
    const tracker = new DirtyTracker();
    const save = vi.fn(async () => {
      const snapshot = tracker.beginSave();
      tracker.completeSave(snapshot);
      return savedResult;
    });
    const scheduler = new AutosaveScheduler({ delayMs: 1_000, dirtyTracker: tracker, save });

    await expect(scheduler.flush()).resolves.toBeNull();
    tracker.markMetadata();
    await expect(scheduler.flush()).resolves.toEqual(savedResult);
    expect(save).toHaveBeenCalledOnce();
  });

  it("reports delayed save errors and leaves dirty state available for retry", async () => {
    vi.useFakeTimers();
    const tracker = new DirtyTracker();
    tracker.markMetadata();
    const failure = new Error("disk unavailable");
    const onError = vi.fn();
    const scheduler = new AutosaveScheduler({
      delayMs: 10,
      dirtyTracker: tracker,
      save: async () => {
        tracker.failSave();
        throw failure;
      },
      onError,
    });

    scheduler.notifyActivity();
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(tracker.status).toBe("dirty");
  });

  it("queues edits made during an active save for a later autosave", async () => {
    vi.useFakeTimers();
    const tracker = new DirtyTracker();
    tracker.markPage("page-1");
    const pending: Array<{
      readonly snapshot: DirtySnapshot;
      readonly resolve: (result: SaveNotebookResult) => void;
    }> = [];
    const save = vi.fn(
      () =>
        new Promise<SaveNotebookResult>((resolve) => {
          pending.push({ snapshot: tracker.beginSave(), resolve });
        }),
    );
    const scheduler = new AutosaveScheduler({ delayMs: 10, dirtyTracker: tracker, save });

    scheduler.notifyActivity();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledOnce();
    tracker.markPage("page-2");
    scheduler.notifyActivity();
    const first = pending[0];
    if (!first) throw new Error("Expected an active save.");
    tracker.completeSave(first.snapshot);
    first.resolve(savedResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.status).toBe("scheduled");
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2);
    const second = pending[1];
    if (!second) throw new Error("Expected a queued save.");
    tracker.completeSave(second.snapshot);
    second.resolve(savedResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.status).toBe("saved");
  });

  it("cancels scheduled work when stopped and validates its delay", async () => {
    vi.useFakeTimers();
    const tracker = new DirtyTracker();
    tracker.markMetadata();
    const save = vi.fn(async () => savedResult);
    const scheduler = new AutosaveScheduler({ delayMs: 10, dirtyTracker: tracker, save });
    scheduler.notifyActivity();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).not.toHaveBeenCalled();
    expect(scheduler.status).toBe("stopped");
    expect(() => new AutosaveScheduler({ delayMs: -1, dirtyTracker: tracker, save })).toThrow(
      RangeError,
    );
  });
});
