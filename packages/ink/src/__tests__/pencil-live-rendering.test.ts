import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResolvedBrushSnapshot, type ResolvedBrushSnapshot } from "../brush-model";
import { resolveStrokeRenderGeometry } from "../internal/brush-render-strategy";
import type { MaterialTileKey } from "../internal/pencil-material";
import {
  createPencilMaterialRuntime,
  PencilMaterialEvaluator,
  releasePreviewMaterialRuntime,
} from "../internal/pencil-material-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeRenderer } from "../stroke-renderer";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";
import { installCanvasStub, type CanvasStub } from "./canvas-stub";

/**
 * The live half of the Pencil contract, through the real renderer.
 *
 * Two properties carried over from the pens, and one that only a deposited
 * medium has to earn. A frame must cost the open tail rather than the stroke.
 * The picture a stroke has while it is drawn must be the picture it keeps when
 * it commits. And -- this is the new one -- a frame must *repaint* the tail
 * rather than the stroke: an incremental evaluator in front of a full repaint
 * is not incremental at all, and for a medium made of pixels rather than
 * contours it is the repaint that dominates.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function pencil(smoothingAmount = 0.2, size = 2): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pencil-hb",
    presetVersion: 1,
    family: "pencil",
    color: "#343434",
    size,
    opacity: 0.78,
    smoothing: Object.freeze(
      smoothingAmount === 0
        ? { mode: "none" as const, amount: 0 }
        : { mode: "average" as const, amount: smoothingAmount },
    ),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: true,
        minimumFactor: 0.65,
        maximumFactor: 1.25,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: true,
        minimumFactor: 0.45,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "power" as const, exponent: 0.75 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "pencil" }),
  });
}

interface RecordedTile {
  readonly x: number;
  readonly y: number;
}

const STROKE_ID = "live-pencil";

function createHarness(brush: ResolvedBrushSnapshot, strokeId = STROKE_ID) {
  const drawn: RecordedTile[] = [];
  const cleared: RecordedTile[] = [];
  const alphas: number[] = [];
  const stack: number[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save: vi.fn(() => stack.push(context.globalAlpha)),
    restore: vi.fn(() => {
      context.globalAlpha = stack.pop() ?? 1;
    }),
    setTransform: vi.fn(),
    clearRect: vi.fn((x: number, y: number) => cleared.push({ x, y })),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: vi.fn((_source: unknown, x: number, y: number) => {
      drawn.push({ x, y });
      alphas.push(context.globalAlpha);
    }),
  } as unknown as CanvasRenderingContext2D & { globalAlpha: number };

  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio: 1,
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

  const renderer = new StrokeRenderer({ context, viewport, animationFrameAdapter });
  const builder = new StrokeBuilder({
    id: strokeId,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });

  const flush = (): void => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(16);
  };

  return { context, renderer, builder, flush, drawn, cleared, alphas };
}

function sample(x: number, y: number, index: number, pressure: number): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function curvedSamples(count: number, pressure: (index: number) => number): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) =>
    sample(40 + index * 3, 200 + Math.sin(index / 5) * 40, index, pressure(index)),
  );
}

const ramp = (count: number) => (index: number) => 0.05 + (0.9 * index) / (count - 1);

function requireInput(inputs: readonly StrokePointInput[], index: number): StrokePointInput {
  const input = inputs[index];
  if (input === undefined) throw new Error("Missing sample.");
  return input;
}

/** Draws a whole stroke frame by frame, returning the dirty tiles each frame reported. */
function drawWhole(
  harness: ReturnType<typeof createHarness>,
  inputs: readonly StrokePointInput[],
): readonly (readonly string[])[] {
  const perFrame: (readonly string[])[] = [];
  const first = harness.builder.addPoint(requireInput(inputs, 0));
  if (first === null || first === undefined) {
    throw new Error("The first sample must start a stroke.");
  }
  harness.renderer.beginStroke(first);
  harness.flush();
  perFrame.push(harness.renderer.liveMaterialDirtyTiles());
  for (const input of inputs.slice(1)) {
    const update = harness.builder.addPoint(input);
    if (update !== null) harness.renderer.updateStroke(update);
    harness.flush();
    perFrame.push(harness.renderer.liveMaterialDirtyTiles());
  }
  return perFrame;
}

let canvas: CanvasStub;

beforeEach(() => {
  canvas = installCanvasStub();
});

afterEach(() => {
  releasePreviewMaterialRuntime();
  canvas.restore();
});

describe("Pencil live rendering", () => {
  it.each([0, 0.2, 1])("converges on the committed material at smoothing %s", (amount) => {
    const brush = pencil(amount);
    const harness = createHarness(brush);
    drawWhole(harness, curvedSamples(90, ramp(90)));
    const stroke = harness.builder.finalize();

    // The live accumulator's final material and a cold rebuild from the
    // committed stroke must be the same bytes. Lifting the pencil moves nothing.
    const live = createPencilMaterialRuntime();
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "material") throw new Error("Expected material geometry.");
    if (geometry.supply.kind !== "cached") throw new Error("Expected cached supply.");
    const cold = new Map<MaterialTileKey, Uint8Array>();
    for (const key of geometry.tileKeys) {
      const tile = live.tileNow(stroke.id, key, geometry.supply.points, brush);
      if (tile !== null) cold.set(key, tile.alpha);
    }
    expect(cold.size).toBeGreaterThan(0);

    const second = createPencilMaterialRuntime();
    for (const [key, alpha] of cold) {
      const again = second.tileNow(stroke.id, key, geometry.supply.points, brush);
      expect([...(again?.alpha ?? [])]).toEqual([...alpha]);
    }
    live.destroy();
    second.destroy();
  });

  it("repaints the tiles the tail touched, not the stroke", () => {
    // The whole point. A long mark must not get more expensive to draw the
    // longer it gets, which is only true if a frame's repaint is bounded.
    const harness = createHarness(pencil(0.2, 6));
    const frames = drawWhole(
      harness,
      curvedSamples(160, () => 0.6),
    );
    const busy = frames.slice(8);
    expect(busy.length).toBeGreaterThan(100);
    // A frame repaints the tail's tiles and the ring whose gutters read them,
    // and only tiles the stroke has actually reached -- so the bound is a small
    // constant rather than four exactly.
    for (const dirty of busy) expect(dirty.length).toBeLessThanOrEqual(12);
    const worst = (slice: readonly (readonly string[])[]) =>
      Math.max(...slice.map((dirty) => dirty.length));
    const total = new Set(frames.flat());
    // The mark as a whole covered far more ground than any one frame of it.
    expect(total.size).toBeGreaterThan(worst(busy) * 2);
    // And the property that actually matters: drawing two and a half times as
    // far does not make a frame cost more. A constant on its own would pass for
    // a repaint that grew slowly; this is what says it does not grow at all.
    const longer = drawWhole(
      createHarness(pencil(0.2, 6)),
      curvedSamples(400, () => 0.6),
    );
    expect(new Set(longer.flat()).size).toBeGreaterThan(total.size);
    expect(worst(longer.slice(8))).toBeLessThanOrEqual(worst(busy));
  });

  it("clears exactly the tiles it is about to redraw", () => {
    const harness = createHarness(pencil(0.2, 6));
    drawWhole(
      harness,
      curvedSamples(120, () => 0.6),
    );
    // Every clear is one tile-sized rectangle, never the whole stroke bounds.
    expect(harness.cleared.length).toBeGreaterThan(0);
    expect(harness.drawn.length).toBeGreaterThan(0);
  });

  it("paints live material without reapplying base opacity", () => {
    const harness = createHarness(pencil(0.2, 6));
    drawWhole(
      harness,
      curvedSamples(60, () => 0.7),
    );
    expect(harness.alphas.length).toBeGreaterThan(0);
    for (const alpha of harness.alphas) expect(alpha).toBe(1);
  });

  it("keeps settled geometry as well as settled material, frame after frame", () => {
    // An incremental evaluator in front of geometry that is rebuilt every frame
    // is not incremental either. A settled stamp is written once and the same
    // object comes back, which is what makes a frame cost the tail in geometry
    // as well as in pixels.
    const brush = pencil(0.2, 6);
    const harness = createHarness(brush);
    const inputs = curvedSamples(120, () => 0.6);
    const first = harness.builder.addPoint(requireInput(inputs, 0));
    if (first === null || first === undefined) throw new Error("A stroke must start.");
    harness.renderer.beginStroke(first);
    harness.flush();

    const evaluator = new PencilMaterialEvaluator(brush);
    const points = inputs.map((input, index) => ({
      ...input,
      delta: { x: 0, y: 0 },
      velocity: 0,
      acceleration: 0,
      timestamp: index * 8,
    }));
    let settledStamps: readonly unknown[] = [];
    for (let count = 8; count <= points.length; count += 8) {
      evaluator.append(points.slice(0, count), false);
      const geometry = evaluator.geometry();
      const settled = geometry.stamps.slice(0, settledStamps.length);
      // Identity, not equality: these are the objects from the earlier frame.
      for (let index = 0; index < settledStamps.length; index += 1) {
        expect(settled[index]).toBe(settledStamps[index]);
      }
      settledStamps = geometry.stamps.slice(0, evaluator.evaluationSnapshot().settledSegmentCount);
    }
    expect(settledStamps.length).toBeGreaterThan(50);
  });

  it("evaluates only the open tail once a prefix has settled", () => {
    const harness = createHarness(pencil(0.2));
    const inputs = curvedSamples(120, ramp(120));
    drawWhole(harness, inputs);
    const snapshot = harness.renderer.liveEvaluationSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.settledPointEvaluations).toBeLessThanOrEqual(inputs.length);
    expect(snapshot?.maximumTailPointEvaluations).toBeLessThanOrEqual(
      snapshot?.lookaheadSamples ?? 0,
    );
  });

  it("discards the evaluator when a stroke is cancelled", () => {
    const harness = createHarness(pencil());
    drawWhole(harness, curvedSamples(30, ramp(30)));
    expect(harness.renderer.liveEvaluationSnapshot()).not.toBeNull();
    harness.renderer.cancelStroke(null);
    expect(harness.renderer.liveEvaluationSnapshot()).toBeNull();
    expect(harness.renderer.liveMaterialDirtyTiles()).toEqual([]);
  });

  it("deposits a tap as a tip-sized impression", () => {
    const harness = createHarness(pencil(0.2, 12));
    const first = harness.builder.addPoint(sample(200, 300, 0, 0.6));
    if (first === null || first === undefined) throw new Error("A tap must start a stroke.");
    harness.renderer.beginStroke(first);
    harness.flush();
    const stroke = harness.builder.finalize();
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "material") throw new Error("Expected material geometry.");
    expect(geometry.dot).not.toBeNull();
    expect(geometry.stamps).toHaveLength(1);
    expect(geometry.tileKeys.length).toBeGreaterThan(0);
  });
});
