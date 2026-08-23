import { describe, expect, it, vi } from "vitest";
import { TranslationPreviewRenderer } from "../translation-preview-renderer";
import type { AnimationFrameAdapter } from "../types";
import { Viewport } from "../viewport";

function harness() {
  let nextFrame = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const animationFrameAdapter: AnimationFrameAdapter = {
    request(callback) {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      frames.delete(handle);
    },
  };
  const context = {
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio: 2,
  });
  viewport.centerPage();
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const renderer = new TranslationPreviewRenderer({
    context,
    viewport,
    canvas,
    animationFrameAdapter,
  });
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(16));
  };
  return { canvas, context, frames, flush, renderer, viewport };
}

describe("TranslationPreviewRenderer", () => {
  it("draws a cached visual at an absolute page translation on demand", () => {
    const { renderer, flush, context, canvas } = harness();
    const draw = vi.fn();
    const translation = Object.freeze({ x: 30, y: -5 });
    renderer.setPreview({
      objectId: "object-1",
      bounds: Object.freeze({ x: 10, y: 20, width: 100, height: 40 }),
      translation,
      visual: { draw },
    });
    flush();
    expect(draw).toHaveBeenCalledWith(context);
    expect(context.translate).toHaveBeenCalledWith(30, -5);
    expect(canvas.dataset.manipulationPreviewState).toBe("active");
    expect(renderer.snapshot()).toMatchObject({
      objectId: "object-1",
      translation: { x: 30, y: -5 },
      renderCount: 1,
      invalidationCount: 1,
    });
    expect(renderer.snapshot().translation).toBe(translation);
  });

  it("coalesces frames into one full transient-overlay clear", () => {
    const { renderer, flush, context, frames } = harness();
    const visual = { draw: vi.fn() };
    const base = { objectId: "object", bounds: { x: 0, y: 0, width: 20, height: 10 }, visual };
    renderer.setPreview({ ...base, translation: { x: 5, y: 5 } });
    renderer.setPreview({ ...base, translation: { x: 400, y: 300 } });
    expect(frames.size).toBe(1);
    flush();
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1_000, 800);
    expect(renderer.snapshot().renderCount).toBe(1);
  });

  it("does not invalidate identical previews and clears after commit or cancel", () => {
    const { renderer, flush, frames, canvas } = harness();
    const visual = { draw: vi.fn() };
    const target = Object.freeze({
      objectId: "object",
      bounds: Object.freeze({ x: 0, y: 0, width: 20, height: 10 }),
      translation: Object.freeze({ x: 5, y: 5 }),
      visual,
    });
    renderer.setPreview(target);
    flush();
    const snapshot = renderer.snapshot();
    renderer.setPreview(target);
    expect(renderer.snapshot()).toEqual(snapshot);
    expect(frames.size).toBe(0);
    renderer.setPreview(null);
    flush();
    expect(canvas.dataset.manipulationPreviewState).toBe("empty");
  });

  it("redraws after resize and releases pending work on destroy", () => {
    const { renderer, viewport, frames } = harness();
    renderer.setPreview({
      objectId: "object",
      bounds: { x: 0, y: 0, width: 20, height: 10 },
      translation: { x: 0, y: 0 },
      visual: { draw: vi.fn() },
    });
    viewport.resize({ width: 800, height: 600 }, 3);
    renderer.redraw();
    expect(frames.size).toBe(1);
    renderer.destroy();
    renderer.destroy();
    expect(frames.size).toBe(0);
    expect(() => renderer.redraw()).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
  });
});
