import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeRenderer } from "../stroke-renderer";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput, StrokeStyle, StrokeUpdate } from "../types";

function createContext(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function point(x: number, y: number, timestamp: number, pressure = 0.5): StrokePointInput {
  return {
    x,
    y,
    timestamp,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function createHarness(style: Partial<StrokeStyle> = {}) {
  const context = createContext();
  const canvas = { dataset: {} as DOMStringMap } as HTMLCanvasElement;
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio: 2,
  });
  viewport.centerPage();
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
  const invalidations: Array<{ x: number; y: number; width: number; height: number }> = [];
  const renderer = new StrokeRenderer({
    context,
    viewport,
    canvas,
    animationFrameAdapter,
    onInvalidate: (dirtyRect) => invalidations.push(dirtyRect),
  });
  const builder = new StrokeBuilder({
    id: "renderer-stroke",
    timestamp: 0,
    style,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  const flush = (timestamp = 16) => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(timestamp));
  };
  const add = (input: StrokePointInput): StrokeUpdate => {
    const update = builder.addPoint(input);
    if (update === null) throw new Error("Expected a distinct point.");
    return update;
  };
  return { context, canvas, viewport, renderer, builder, frames, invalidations, flush, add };
}

function createStroke(id = "shared-stroke") {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint(point(10, 10, 0));
  builder.addPoint(point(30, 20, 10));
  return builder.finalize();
}

describe("StrokeRenderer", () => {
  it("coalesces live updates and draws only invalidated page regions", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    harness.renderer.updateStroke(harness.add(point(20, 20, 10)));
    harness.renderer.updateStroke(harness.add(point(30, 25, 20)));

    expect(harness.frames.size).toBe(1);
    expect(harness.invalidations).toHaveLength(3);
    expect(harness.context.clearRect).not.toHaveBeenCalled();
    harness.flush();

    expect(harness.renderer.snapshot()).toMatchObject({
      livePointCount: 3,
      renderCount: 1,
      invalidationCount: 3,
    });
    expect(harness.context.rect).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(harness.context.stroke).toHaveBeenCalledTimes(2);
    expect(harness.frames.size).toBe(0);
  });

  it("renders pressure-sensitive round segments and single-point dots", () => {
    const harness = createHarness({ width: 10 });
    harness.renderer.beginStroke(harness.add(point(5, 5, 0, 0)));
    harness.flush();
    expect(harness.context.arc).toHaveBeenCalled();
    expect(harness.context.lineCap).toBe("round");
    expect(harness.context.lineJoin).toBe("round");

    harness.renderer.updateStroke(harness.add(point(15, 5, 10, 1)));
    harness.flush();
    expect(harness.context.lineWidth).toBe(10);
  });

  it("finalizes session strokes without scheduling a continuous render loop", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    harness.renderer.updateStroke(harness.add(point(20, 20, 10)));
    const stroke = harness.builder.finalize();
    harness.renderer.finalizeStroke(stroke);

    expect(harness.frames.size).toBe(0);
    expect(harness.renderer.snapshot()).toMatchObject({
      finalizedStrokeCount: 1,
      finalizedPointCount: 2,
      livePointCount: 0,
      renderCount: 1,
    });
    expect(harness.context.stroke).toHaveBeenCalledOnce();
    expect(harness.canvas.dataset.inkStrokeCount).toBe("1");
  });

  it("cancels temporary ink by clearing only its dirty region", () => {
    const harness = createHarness();
    const update = harness.add(point(100, 100, 0));
    harness.renderer.beginStroke(update);
    harness.flush();
    const dirtyRect = harness.builder.cancel();
    harness.renderer.cancelStroke(dirtyRect);

    expect(harness.context.clearRect).toHaveBeenCalledOnce();
    const [, , width, height] = vi.mocked(harness.context.clearRect).mock.calls[0] ?? [];
    expect(width).toBeLessThan(harness.viewport.size.width);
    expect(height).toBeLessThan(harness.viewport.size.height);
    expect(harness.renderer.snapshot().livePointCount).toBe(0);
  });

  it("redraws finalized session strokes after a resize without losing them", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    harness.renderer.updateStroke(harness.add(point(20, 20, 10)));
    harness.renderer.finalizeStroke(harness.builder.finalize());
    const strokeCalls = vi.mocked(harness.context.stroke).mock.calls.length;

    harness.viewport.resize({ width: 1_200, height: 900 }, 1.5);
    harness.viewport.centerPage();
    harness.renderer.redraw();

    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(1);
    expect(vi.mocked(harness.context.clearRect).mock.calls.at(-1)).toEqual([0, 0, 1_200, 900]);
    expect(vi.mocked(harness.context.stroke).mock.calls.length).toBeGreaterThan(strokeCalls);
  });

  it("translates one finalized stroke without mutating its immutable geometry", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    const stroke = harness.builder.finalize();
    harness.renderer.finalizeStroke(stroke);
    const clears = vi.mocked(harness.context.clearRect).mock.calls.length;

    expect(harness.renderer.setStrokeTranslation(stroke.id, { x: 30, y: -12 })).toBe(true);
    expect(stroke.points[0]).toMatchObject({ x: 10, y: 10 });
    expect(harness.context.translate).toHaveBeenCalledWith(30, -12);
    expect(vi.mocked(harness.context.clearRect).mock.calls.length).toBe(clears + 1);
    expect(harness.renderer.setStrokeTranslation(stroke.id, { x: 30, y: -12 })).toBe(false);
    expect(harness.renderer.setStrokeTranslation("missing", { x: 1, y: 1 })).toBe(false);
  });

  it("rotates and scales finalized strokes through one absolute transform update", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    harness.renderer.updateStroke(harness.add(point(30, 10, 10)));
    const stroke = harness.builder.finalize();
    harness.renderer.finalizeStroke(stroke);
    const clears = vi.mocked(harness.context.clearRect).mock.calls.length;

    expect(
      harness.renderer.setStrokeTransform(stroke.id, {
        translation: { x: 5, y: -2 },
        rotation: Math.PI / 2,
        scale: 2,
      }),
    ).toBe(true);
    expect(harness.context.translate).toHaveBeenCalledWith(5, -2);
    expect(harness.context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(harness.context.scale).toHaveBeenCalledWith(2, 2);
    expect(vi.mocked(harness.context.clearRect).mock.calls.length).toBe(clears + 1);
    expect(stroke.points[0]).toMatchObject({ x: 10, y: 10 });
    expect(
      harness.renderer.setStrokeTransform(stroke.id, {
        translation: { x: 5, y: -2 },
        rotation: Math.PI / 2,
        scale: 2,
      }),
    ).toBe(false);
  });

  it("synchronizes independently identified visuals that reuse one immutable stroke", () => {
    const harness = createHarness();
    const stroke = createStroke();
    const visuals = Object.freeze([
      Object.freeze({
        id: "object-a",
        stroke,
        transform: Object.freeze({
          translation: Object.freeze({ x: 0, y: 0 }),
          rotation: 0,
          scale: 1,
        }),
      }),
      Object.freeze({
        id: "object-b",
        stroke,
        transform: Object.freeze({
          translation: Object.freeze({ x: 20, y: 10 }),
          rotation: Math.PI / 4,
          scale: 2,
        }),
      }),
    ]);

    expect(harness.renderer.replaceFinalizedStrokes(visuals)).toBe(true);
    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(2);
    expect(harness.renderer.snapshot().finalizedPointCount).toBe(stroke.pointCount * 2);
    expect(harness.renderer.replaceFinalizedStrokes(visuals)).toBe(false);
    expect(harness.renderer.replaceFinalizedStrokes(Object.freeze([visuals[1]!]))).toBe(true);
    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(1);
  });

  it("rejects duplicate retained visual identities", () => {
    const harness = createHarness();
    const stroke = createStroke();
    const transform = Object.freeze({
      translation: Object.freeze({ x: 0, y: 0 }),
      rotation: 0,
      scale: 1,
    });
    expect(() =>
      harness.renderer.replaceFinalizedStrokes([
        { id: "same", stroke, transform },
        { id: "same", stroke, transform },
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_STROKE" }));
  });

  it("keeps temporary and finalized stroke lifecycles separate", () => {
    const permanent = createHarness();
    permanent.renderer.beginStroke(permanent.add(point(10, 10, 0)));
    permanent.renderer.finalizeStroke(permanent.builder.finalize());

    const liveBuilder = new StrokeBuilder({
      id: "second-stroke",
      timestamp: 10,
      smoother: new StrokeSmoother({ mode: "none" }),
    });
    const update = liveBuilder.addPoint(point(40, 40, 10));
    if (update === null) throw new Error("Expected live point.");
    permanent.renderer.beginStroke(update);
    permanent.flush();
    permanent.renderer.cancelStroke(liveBuilder.cancel());

    expect(permanent.renderer.snapshot()).toMatchObject({
      finalizedStrokeCount: 1,
      livePointCount: 0,
    });
  });

  it("cancels pending frames, releases retained strokes, and rejects use after destroy", () => {
    const harness = createHarness();
    harness.renderer.beginStroke(harness.add(point(10, 10, 0)));
    expect(harness.frames.size).toBe(1);
    harness.renderer.destroy();
    harness.renderer.destroy();
    expect(harness.frames.size).toBe(0);
    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(0);
    expect(() => harness.renderer.redraw()).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
  });
});
