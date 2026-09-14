import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { createResolvedBrushSnapshot, type ResolvedBrushSnapshot } from "../brush-model";
import { resolveStrokeRenderGeometry } from "../internal/brush-render-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeRenderer } from "../stroke-renderer";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";

/**
 * The live half of the Technical Pen contract, exercised through the real
 * renderer rather than through the evaluator alone.
 *
 * Two things have to hold at once. A frame must cost the open tail rather than
 * the stroke, and the picture a stroke has while it is being drawn must be the
 * picture it keeps when it commits -- so committing replaces nothing.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function technicalPen(smoothingAmount = 0.3): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-technical",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: 4,
    opacity: 1,
    smoothing: Object.freeze(
      smoothingAmount === 0
        ? { mode: "none" as const, amount: 0 }
        : { mode: "average" as const, amount: smoothingAmount },
    ),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "technical-pen" }),
  });
}

interface RecordedCurve {
  readonly kind: "move" | "curve";
  readonly values: readonly number[];
}

function createHarness(brush: ResolvedBrushSnapshot) {
  const curves: RecordedCurve[] = [];
  const context = {
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
    moveTo: vi.fn((x: number, y: number) => curves.push({ kind: "move", values: [x, y] })),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn((...values: number[]) => curves.push({ kind: "curve", values })),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

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
    id: "live-technical-pen",
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });

  const flush = (): void => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(16);
  };

  return { context, renderer, builder, flush, curves };
}

function sample(x: number, y: number, index: number): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure: 0.3 + ((index * 0.07) % 0.6),
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function curvedSamples(count: number): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) =>
    sample(40 + index * 3, 200 + Math.sin(index / 5) * 40, index),
  );
}

/** Every path command a painter received, in order. */
function paintedPath(curves: readonly RecordedCurve[]): readonly number[][] {
  return curves.map((entry) => [...entry.values]);
}

describe("Technical Pen live rendering", () => {
  it.each([0, 0.3, 1])("converges on the committed path at smoothing %s", (amount) => {
    const brush = technicalPen(amount);
    const harness = createHarness(brush);
    const inputs = curvedSamples(60);

    const first = harness.builder.addPoint(inputs[0]!);
    harness.renderer.beginStroke(first!);
    harness.flush();
    for (const input of inputs.slice(1)) {
      const update = harness.builder.addPoint(input);
      if (update !== null) harness.renderer.updateStroke(update);
      harness.flush();
    }
    harness.curves.length = 0;
    harness.renderer.redraw();
    const live = paintedPath(harness.curves);
    const liveWidth = harness.context.lineWidth;

    const stroke = harness.builder.finalize();
    harness.curves.length = 0;
    harness.renderer.finalizeStroke(stroke);
    const committed = paintedPath(harness.curves);

    expect(committed).toEqual(live);
    expect(harness.context.lineWidth).toBe(liveWidth);
    // And the painted path really is the strategy's committed geometry.
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "stroked-path") throw new Error("Expected stroked-path geometry.");
    expect(committed).toHaveLength(geometry.segments.length + 1);
  });

  it("evaluates only the open tail once a prefix has settled", () => {
    // Structural, not timed: the evaluator counts how many samples it has ever
    // settled, so a per-frame rebuild would push that far above the sample count.
    const brush = technicalPen();
    const harness = createHarness(brush);
    const inputs = curvedSamples(300);

    const first = harness.builder.addPoint(inputs[0]!);
    harness.renderer.beginStroke(first!);
    harness.flush();
    let delivered = 1;
    for (const input of inputs.slice(1)) {
      const update = harness.builder.addPoint(input);
      if (update !== null) {
        harness.renderer.updateStroke(update);
        delivered += 1;
      }
      harness.flush();
    }

    const snapshot = harness.renderer.liveEvaluationSnapshot();
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;
    expect(snapshot.settledPointEvaluations).toBe(delivered - snapshot.lookaheadSamples);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples + 1);
    expect(snapshot.settledSegmentCount).toBeGreaterThan(200);
  });

  it("reports no live evaluator for a frozen legacy strategy", () => {
    const legacy = createResolvedBrushSnapshot({
      ...technicalPen(),
      renderer: Object.freeze({ version: 1, kind: "centerline" }),
    });
    const harness = createHarness(legacy);
    const first = harness.builder.addPoint(curvedSamples(2)[0]!);
    harness.renderer.beginStroke(first!);
    harness.flush();

    expect(harness.renderer.liveEvaluationSnapshot()).toBeNull();
  });

  it("discards the evaluator when a stroke is cancelled", () => {
    const harness = createHarness(technicalPen());
    const inputs = curvedSamples(12);
    const first = harness.builder.addPoint(inputs[0]!);
    harness.renderer.beginStroke(first!);
    for (const input of inputs.slice(1)) {
      const update = harness.builder.addPoint(input);
      if (update !== null) harness.renderer.updateStroke(update);
    }
    harness.flush();
    expect(harness.renderer.liveEvaluationSnapshot()).not.toBeNull();

    harness.renderer.cancelStroke(null);
    expect(harness.renderer.liveEvaluationSnapshot()).toBeNull();
    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(0);
  });

  it("paints a tap without opening a path", () => {
    const harness = createHarness(technicalPen());
    const first = harness.builder.addPoint(sample(120, 150, 0));
    harness.renderer.beginStroke(first!);
    harness.flush();

    const stroke = harness.builder.finalize();
    harness.renderer.finalizeStroke(stroke);
    expect(harness.context.arc).toHaveBeenCalledWith(120, 150, 2, 0, Math.PI * 2);
  });
});
