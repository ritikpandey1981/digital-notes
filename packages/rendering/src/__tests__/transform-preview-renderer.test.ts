import { describe, expect, it, vi } from "vitest";
import { TransformPreviewRenderer } from "../transform-preview-renderer";
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
    rotate: vi.fn(),
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
  const renderer = new TransformPreviewRenderer({
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
  return { canvas, context, frames, flush, renderer };
}

describe("TransformPreviewRenderer", () => {
  it("draws translated, rotated, and scaled previews around the visual center", () => {
    const { renderer, flush, context, canvas } = harness();
    const draw = vi.fn();
    renderer.setPreview({
      objectId: "object-1",
      bounds: { x: 10, y: 20, width: 100, height: 40 },
      transform: {
        translation: { x: 30, y: -5 },
        rotation: Math.PI / 2,
        scale: 2,
      },
      visual: { draw },
    });
    flush();

    expect(draw).toHaveBeenCalledWith(context);
    expect(context.translate).toHaveBeenCalledWith(30, -5);
    expect(context.translate).toHaveBeenCalledWith(60, 40);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.scale).toHaveBeenCalledWith(2, 2);
    expect(renderer.snapshot().transform).toMatchObject({ rotation: Math.PI / 2, scale: 2 });
    expect(canvas.dataset.manipulationRotation).toBe(String(Math.PI / 2));
    expect(canvas.dataset.manipulationScale).toBe("2");
  });

  it("coalesces transform invalidation and releases lifecycle state", () => {
    const { renderer, flush, frames, canvas, context } = harness();
    const visual = { draw: vi.fn() };
    const base = { objectId: "object", bounds: { x: 0, y: 0, width: 20, height: 10 }, visual };
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 0, y: 0 }, rotation: 0.2, scale: 1 },
    });
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 0, y: 0 }, rotation: 0.4, scale: 1.5 },
    });
    expect(frames.size).toBe(1);
    flush();
    expect(renderer.snapshot().renderCount).toBe(1);
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 0, y: 0 }, rotation: 0.4, scale: 0.1 },
    });
    flush();
    vi.mocked(context.clearRect).mockClear();
    renderer.setPreview(null);
    flush();
    expect(canvas.dataset.manipulationPreviewState).toBe("empty");
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1_000, 800);
    renderer.destroy();
    renderer.destroy();
    expect(() => renderer.redraw()).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
  });

  it("fully clears the transient overlay before every coalesced active preview frame", () => {
    const { renderer, flush, frames, context } = harness();
    const draw = vi.fn();
    const base = {
      objectId: "thick-preview",
      bounds: { x: 80, y: 60, width: 420, height: 260 },
      visual: { draw },
    };
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 0, y: 0 }, rotation: 0, scale: 1.5 },
    });
    flush();

    vi.mocked(context.clearRect).mockClear();
    draw.mockClear();
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 70, y: 45 }, rotation: 0.2, scale: 0.35 },
    });
    renderer.setPreview({
      ...base,
      transform: { translation: { x: 95, y: 65 }, rotation: 0.35, scale: 0.1 },
    });

    expect(frames.size).toBe(1);
    flush();
    expect(context.clearRect).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1_000, 800);
    expect(draw).toHaveBeenCalledOnce();
    expect(vi.mocked(context.clearRect).mock.invocationCallOrder[0]).toBeLessThan(
      draw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects invalid transform previews", () => {
    const { renderer } = harness();
    expect(() =>
      renderer.setPreview({
        objectId: "object",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        transform: { translation: { x: 0, y: 0 }, rotation: 0, scale: 0 },
        visual: { draw: vi.fn() },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GEOMETRY" }));
  });
});
