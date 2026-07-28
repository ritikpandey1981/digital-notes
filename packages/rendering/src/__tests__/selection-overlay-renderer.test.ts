import { describe, expect, it } from "vitest";
import {
  SelectionOverlayRenderer,
  type SelectionOverlayTarget,
} from "../selection-overlay-renderer";
import type { AnimationFrameAdapter } from "../types";
import { Viewport } from "../viewport";

function createAnimationFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const adapter: AnimationFrameAdapter = {
    request(callback) {
      const handle = nextHandle++;
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
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(16));
    },
  };
}

function createContextHarness() {
  const calls: string[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    setTransform: (...values: number[]) => calls.push(`transform:${values.join(",")}`),
    clearRect: (...values: number[]) => calls.push(`clear:${values.join(",")}`),
    beginPath: () => calls.push("begin"),
    rect: (...values: number[]) => calls.push(`rect:${values.join(",")}`),
    clip: () => calls.push("clip"),
    fillRect: (...values: number[]) => calls.push(`fill:${values.join(",")}`),
    strokeRect: (...values: number[]) => calls.push(`stroke:${values.join(",")}`),
    moveTo: (...values: number[]) => calls.push(`move:${values.join(",")}`),
    lineTo: (...values: number[]) => calls.push(`line:${values.join(",")}`),
    arc: (...values: number[]) => calls.push(`arc:${values.join(",")}`),
    fill: () => calls.push("fill-path"),
    stroke: () => calls.push("stroke-path"),
    translate: (...values: number[]) => calls.push(`translate:${values.join(",")}`),
    scale: (...values: number[]) => calls.push(`scale:${values.join(",")}`),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

function createHarness() {
  const frames = createAnimationFrameHarness();
  const drawing = createContextHarness();
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio: 2,
  });
  viewport.centerPage();
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const renderer = new SelectionOverlayRenderer({
    context: drawing.context,
    canvas,
    viewport,
    animationFrameAdapter: frames.adapter,
  });
  return { ...frames, ...drawing, canvas, renderer, viewport };
}

const target: SelectionOverlayTarget = Object.freeze({
  objectId: "object-1",
  bounds: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
});

describe("SelectionOverlayRenderer", () => {
  it("coalesces invalidation and draws a HiDPI outline plus highlight", () => {
    const { renderer, callbacks, flush, calls, canvas } = createHarness();
    renderer.setSelection(target);
    renderer.redraw();
    expect(callbacks.size).toBe(1);
    flush();
    expect(calls).toContain("transform:2,0,0,2,0,0");
    expect(calls.some((call) => call.startsWith("fill:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("stroke:"))).toBe(true);
    expect(calls.some((call) => call.startsWith("arc:"))).toBe(true);
    expect(renderer.snapshot()).toMatchObject({
      selectedObjectId: "object-1",
      renderCount: 1,
      invalidationCount: 2,
      hasPendingRender: false,
    });
    expect(canvas.dataset.selectionState).toBe("selected");
    expect(canvas.dataset.selectionHandles).toBe("visible");
  });

  it("does not invalidate for the same identity and cached bounds", () => {
    const { renderer, callbacks, flush } = createHarness();
    renderer.setSelection(target);
    flush();
    const snapshot = renderer.snapshot();
    renderer.setSelection({ objectId: target.objectId, bounds: { ...target.bounds } });
    expect(renderer.snapshot()).toEqual(snapshot);
    expect(callbacks.size).toBe(0);
  });

  it("clears only the affected overlay region when selection is removed", () => {
    const { renderer, flush, calls, canvas } = createHarness();
    renderer.setSelection(target);
    flush();
    const clearCount = calls.filter((call) => call.startsWith("clear:")).length;
    renderer.setSelection(null);
    flush();
    expect(calls.filter((call) => call.startsWith("clear:")).length).toBe(clearCount + 1);
    expect(canvas.dataset.selectionState).toBe("empty");
    expect(canvas.dataset.selectionHandles).toBe("hidden");
    expect(renderer.snapshot().selectedObjectId).toBeNull();
  });

  it("clears distant previous and next targets as separate dirty regions", () => {
    const { renderer, flush, calls } = createHarness();
    renderer.setSelection(target);
    flush();
    const clearCount = calls.filter((call) => call.startsWith("clear:")).length;

    renderer.setSelection({
      objectId: "object-2",
      bounds: Object.freeze({ x: 500, y: 600, width: 40, height: 20 }),
    });
    flush();

    const newClears = calls.filter((call) => call.startsWith("clear:")).slice(clearCount);
    expect(newClears).toHaveLength(2);
    expect(newClears.every((call) => Number(call.split(",")[2]) < 200)).toBe(true);
  });

  it("redraws cached selection after viewport resize without changing the target", () => {
    const { renderer, viewport, flush, calls } = createHarness();
    renderer.setSelection(target);
    flush();
    viewport.resize({ width: 800, height: 600 }, 1.5);
    renderer.redraw();
    flush();
    expect(calls).toContain("transform:1.5,0,0,1.5,0,0");
    expect(renderer.snapshot().selectedObjectId).toBe("object-1");
  });

  it("forces pending work, validates inputs, and destroys idempotently", () => {
    const { renderer, callbacks } = createHarness();
    expect(() => renderer.setSelection({ objectId: "", bounds: target.bounds })).toThrowError(
      expect.objectContaining({ code: "INVALID_GEOMETRY" }),
    );
    renderer.setSelection(target);
    renderer.forceRender();
    expect(callbacks.size).toBe(0);
    renderer.destroy();
    renderer.destroy();
    expect(() => renderer.redraw()).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
  });

  it("rejects invalid visual configuration", () => {
    const { context } = createContextHarness();
    const viewport = new Viewport({
      size: { width: 10, height: 10 },
      pageRect: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(
      () => new SelectionOverlayRenderer({ context, viewport, style: { outlineWidth: 0 } }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GEOMETRY" }));
  });
});
