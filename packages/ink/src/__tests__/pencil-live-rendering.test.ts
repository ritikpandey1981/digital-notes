import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { createResolvedBrushSnapshot, type ResolvedBrushSnapshot } from "../brush-model";
import { resolveStrokeRenderGeometry } from "../internal/brush-render-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeRenderer } from "../stroke-renderer";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";

/**
 * The live half of the Pencil contract, through the real renderer.
 *
 * The two properties the pens had to earn apply unchanged, and one is new. A
 * frame must cost the open tail rather than the stroke. The picture a stroke
 * has while it is drawn must be the picture it keeps when it commits. And the
 * grain in that picture must be the *same* grain, which is only true because
 * the seed comes from the stroke id the builder fixed before the first sample
 * rather than from anything the finalized stroke supplies later.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function pencil(smoothingAmount = 0.2): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pencil-hb",
    presetVersion: 1,
    family: "pencil",
    color: "#343434",
    size: 2,
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

interface RecordedCommand {
  readonly kind: "move" | "line" | "arc" | "fill";
  readonly values: readonly (number | boolean)[];
}

const STROKE_ID = "live-pencil";

function createHarness(brush: ResolvedBrushSnapshot, strokeId = STROKE_ID) {
  const commands: RecordedCommand[] = [];
  const stack: number[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(() => stack.push(context.globalAlpha)),
    restore: vi.fn(() => {
      context.globalAlpha = stack.pop() ?? 1;
    }),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    arc: vi.fn((...values: (number | boolean)[]) => commands.push({ kind: "arc", values })),
    fill: vi.fn(() => commands.push({ kind: "fill", values: [context.globalAlpha] })),
    moveTo: vi.fn((x: number, y: number) => commands.push({ kind: "move", values: [x, y] })),
    lineTo: vi.fn((x: number, y: number) => commands.push({ kind: "line", values: [x, y] })),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
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

  return { context, renderer, builder, flush, commands };
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

/** Every path command a painter received, in order, with the alpha each fill ran under. */
function paintedPath(commands: readonly RecordedCommand[]): readonly string[] {
  return commands.map(
    (entry) =>
      `${entry.kind}:${entry.values
        .map((value) => (typeof value === "number" ? value.toFixed(9) : String(value)))
        .join(",")}`,
  );
}

function drawWhole(
  harness: ReturnType<typeof createHarness>,
  inputs: readonly StrokePointInput[],
): void {
  const first = harness.builder.addPoint(requireInput(inputs, 0));
  if (first === null || first === undefined)
    throw new Error("The first sample must start a stroke.");
  harness.renderer.beginStroke(first);
  harness.flush();
  for (const input of inputs.slice(1)) {
    const update = harness.builder.addPoint(input);
    if (update !== null) harness.renderer.updateStroke(update);
    harness.flush();
  }
}

describe("Pencil live rendering", () => {
  it.each([0, 0.2, 1])("converges on the committed graphite at smoothing %s", (amount) => {
    const harness = createHarness(pencil(amount));
    drawWhole(harness, curvedSamples(90, ramp(90)));

    harness.commands.length = 0;
    harness.renderer.redraw();
    const live = paintedPath(harness.commands);

    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);
    const committed = paintedPath(harness.commands);

    // Not a near-match: lifting the pencil must move no mark, change no grain
    // and change no tone.
    expect(committed).toEqual(live);
    expect(committed.length).toBeGreaterThan(100);
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "stamps") throw new Error("Expected stamps geometry.");
    expect(committed.filter((entry) => entry.startsWith("fill"))).toHaveLength(1);
    expect(committed.filter((entry) => entry.startsWith("move"))).toHaveLength(geometry.markCount);
  });

  it("seeds live grain from the stroke id the builder already fixed", () => {
    // The whole reason the id is threaded into the renderer: a live evaluator
    // that seeded itself from anything else would draw one grain and commit
    // another.
    const harness = createHarness(pencil(), "seeded-stroke");
    drawWhole(harness, curvedSamples(60, ramp(60)));
    harness.commands.length = 0;
    harness.renderer.redraw();
    const live = paintedPath(harness.commands);

    const other = createHarness(pencil(), "a-different-stroke");
    drawWhole(other, curvedSamples(60, ramp(60)));
    other.commands.length = 0;
    other.renderer.redraw();
    expect(paintedPath(other.commands)).not.toEqual(live);
  });

  it("paints the whole stroke under one alpha, once", () => {
    const brush = pencil();
    const harness = createHarness(brush);
    drawWhole(harness, curvedSamples(120, ramp(120)));
    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);

    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "stamps") throw new Error("Expected stamps geometry.");
    const alphas = harness.commands
      .filter((entry) => entry.kind === "fill")
      .map((entry) => Number(entry.values[0] ?? 0));
    expect(alphas).toEqual([brush.opacity]);
    expect(geometry.alpha).toBe(brush.opacity);
  });

  it("evaluates only the open tail once a prefix has settled", () => {
    // Structural, not timed: the evaluator counts how many samples it has ever
    // settled, so a per-frame rebuild would push that far above the sample count.
    const harness = createHarness(pencil());
    const inputs = curvedSamples(300, ramp(300));

    const first = harness.builder.addPoint(requireInput(inputs, 0));
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
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
    // Settled stamps dominate: what the last frame regenerated is a handful.
    expect(snapshot.settledSegmentCount).toBeGreaterThan(400);
    expect(snapshot.segmentCount - snapshot.settledSegmentCount).toBeLessThan(20);
  });

  it("discards the evaluator when a stroke is cancelled", () => {
    const harness = createHarness(pencil());
    drawWhole(harness, curvedSamples(12, ramp(12)));
    expect(harness.renderer.liveEvaluationSnapshot()).not.toBeNull();

    harness.renderer.cancelStroke(null);
    expect(harness.renderer.liveEvaluationSnapshot()).toBeNull();
    expect(harness.renderer.snapshot().finalizedStrokeCount).toBe(0);
  });

  it("paints a tap as one tip-sized dot", () => {
    const harness = createHarness(pencil());
    const first = harness.builder.addPoint(sample(120, 150, 0, 0.25));
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
    harness.flush();

    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "stamps") throw new Error("Expected stamps geometry.");
    expect(geometry.dot).not.toBeNull();
    expect(harness.context.arc).toHaveBeenCalledWith(
      120,
      150,
      geometry.dot?.radius,
      0,
      Math.PI * 2,
    );
  });
});
