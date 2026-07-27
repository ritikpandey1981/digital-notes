import { describe, expect, it, vi } from "vitest";
import { Diagnostics } from "../diagnostics";
import { RenderScheduler } from "../render-scheduler";
import type { AnimationFrameAdapter } from "../types";

function createAnimationFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const adapter: AnimationFrameAdapter = {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  };
  return {
    adapter,
    callbacks,
    flush(timestamp = 16) {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of entries) callback(timestamp);
    },
  };
}

describe("RenderScheduler", () => {
  it("coalesces requests into one animation frame and remains demand-driven", () => {
    const harness = createAnimationFrameHarness();
    const render = vi.fn();
    const scheduler = new RenderScheduler(render, harness.adapter);

    scheduler.requestRender();
    scheduler.requestRender();
    scheduler.requestRender();
    expect(scheduler.pending).toBe(true);
    expect(harness.callbacks.size).toBe(1);
    harness.flush(42);
    expect(render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(42);
    expect(scheduler.pending).toBe(false);
    expect(harness.callbacks.size).toBe(0);
  });

  it("cancels pending frames", () => {
    const harness = createAnimationFrameHarness();
    const render = vi.fn();
    const scheduler = new RenderScheduler(render, harness.adapter);
    scheduler.requestRender();
    scheduler.cancelRender();
    harness.flush();
    expect(render).not.toHaveBeenCalled();
  });

  it("forces an immediate frame after canceling a pending request", () => {
    const harness = createAnimationFrameHarness();
    const render = vi.fn();
    const scheduler = new RenderScheduler(render, harness.adapter);
    scheduler.requestRender();
    scheduler.forceRender(99);
    expect(render).toHaveBeenCalledExactlyOnceWith(99);
    expect(harness.callbacks.size).toBe(0);
  });

  it("cancels on destroy, is idempotent, and rejects later work", () => {
    const harness = createAnimationFrameHarness();
    const scheduler = new RenderScheduler(vi.fn(), harness.adapter);
    scheduler.requestRender();
    scheduler.destroy();
    scheduler.destroy();
    expect(harness.callbacks.size).toBe(0);
    expect(() => scheduler.requestRender()).toThrowError(
      expect.objectContaining({ code: "SCHEDULER_DESTROYED" }),
    );
    expect(() => scheduler.cancelRender()).toThrowError(
      expect.objectContaining({ code: "SCHEDULER_DESTROYED" }),
    );
  });
});

describe("Diagnostics", () => {
  it("tracks frames, rendering, invalidation, context loss, and resize metrics", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordInvalidation();
    diagnostics.recordInvalidation();
    diagnostics.recordContextLoss();
    diagnostics.recordFrame(4, true);
    diagnostics.recordFrame(10, false);
    diagnostics.recordResize(
      { width: 800, height: 600 },
      { width: 800, height: 600 },
      { width: 1_600, height: 1_200 },
      2,
    );

    expect(diagnostics.snapshot()).toEqual({
      frameCount: 2,
      renderCount: 1,
      invalidationCount: 2,
      contextLossCount: 1,
      lastFrameDurationMs: 10,
      averageFrameDurationMs: 7,
      maxFrameDurationMs: 10,
      viewportSize: { width: 800, height: 600 },
      canvasLogicalSize: { width: 800, height: 600 },
      canvasPhysicalSize: { width: 1_600, height: 1_200 },
      devicePixelRatio: 2,
    });
    expect(Object.isFrozen(diagnostics.snapshot())).toBe(true);
  });

  it("resets counters without losing current size information", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordResize(
      { width: 10, height: 20 },
      { width: 10, height: 20 },
      { width: 20, height: 40 },
      2,
    );
    diagnostics.recordFrame(5, true);
    diagnostics.recordInvalidation();
    diagnostics.reset();
    expect(diagnostics.snapshot()).toMatchObject({
      frameCount: 0,
      renderCount: 0,
      invalidationCount: 0,
      viewportSize: { width: 10, height: 20 },
      devicePixelRatio: 2,
    });
  });
});
