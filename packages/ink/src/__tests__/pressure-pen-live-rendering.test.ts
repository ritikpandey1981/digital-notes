import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { createResolvedBrushSnapshot, type ResolvedBrushSnapshot } from "../brush-model";
import { resolveStrokeRenderGeometry } from "../internal/brush-render-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeRenderer } from "../stroke-renderer";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";

/**
 * The live half of the Pressure Pen contract, through the real renderer.
 *
 * Two things have to hold at once, and they are the same two Technical Pen
 * had to hold: a frame must cost the open tail rather than the stroke, and the
 * picture a stroke has while it is being drawn must be the picture it keeps
 * when it commits. Varying width and varying alpha make the second harder, not
 * different -- a band cut in the wrong place at commit would move ink that was
 * already on screen.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function pressurePen(smoothingAmount = 0.18): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-brush",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: 6,
    opacity: 1,
    smoothing: Object.freeze(
      smoothingAmount === 0
        ? { mode: "none" as const, amount: 0 }
        : { mode: "average" as const, amount: smoothingAmount },
    ),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: true,
        minimumFactor: 0.35,
        maximumFactor: 1.65,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: true,
        minimumFactor: 0.5,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "pressure-pen" }),
  });
}

interface RecordedCommand {
  readonly kind: "move" | "line" | "arc" | "fill";
  readonly values: readonly (number | boolean)[];
}

function createHarness(brush: ResolvedBrushSnapshot) {
  const commands: RecordedCommand[] = [];
  // A real save/restore stack, because the whole point of these assertions is
  // the alpha each fill ran under and a no-op restore would let one band's
  // alpha leak into the next painter call.
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
    id: "live-pressure-pen",
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

describe("Pressure Pen live rendering", () => {
  it.each([0, 0.18, 1])("converges on the committed silhouette at smoothing %s", (amount) => {
    const brush = pressurePen(amount);
    const harness = createHarness(brush);
    const inputs = curvedSamples(90, ramp(90));

    const first = harness.builder.addPoint(requireInput(inputs, 0));
    expect(first).not.toBeNull();
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
    harness.flush();
    for (const input of inputs.slice(1)) {
      const update = harness.builder.addPoint(input);
      if (update !== null) harness.renderer.updateStroke(update);
      harness.flush();
    }
    harness.commands.length = 0;
    harness.renderer.redraw();
    const live = paintedPath(harness.commands);

    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);
    const committed = paintedPath(harness.commands);

    expect(committed).toEqual(live);
    // And the painted picture really is the strategy's committed geometry.
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "filled-path") throw new Error("Expected filled-path geometry.");
    expect(committed.filter((entry) => entry.startsWith("fill"))).toHaveLength(
      geometry.bands.length,
    );
  });

  it("paints every band under its own alpha, once", () => {
    const brush = pressurePen();
    const harness = createHarness(brush);
    const inputs = curvedSamples(120, ramp(120));

    const first = harness.builder.addPoint(requireInput(inputs, 0));
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
    for (const input of inputs.slice(1)) {
      const update = harness.builder.addPoint(input);
      if (update !== null) harness.renderer.updateStroke(update);
    }
    harness.flush();
    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);

    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "filled-path") throw new Error("Expected filled-path geometry.");
    expect(geometry.bands.length).toBeGreaterThan(1);
    const alphas = harness.commands
      .filter((entry) => entry.kind === "fill")
      .map((entry) => Number(entry.values[0] ?? 0));
    expect(alphas).toEqual(geometry.bands.map(({ alpha }) => alpha));
  });

  it("evaluates only the open tail once a prefix has settled", () => {
    // Structural, not timed: the evaluator counts how many samples it has ever
    // settled, so a per-frame rebuild would push that far above the sample count.
    const brush = pressurePen();
    const harness = createHarness(brush);
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
    expect(snapshot.settledSegmentCount).toBeGreaterThan(200);
  });

  it("discards the evaluator when a stroke is cancelled", () => {
    const harness = createHarness(pressurePen());
    const inputs = curvedSamples(12, ramp(12));
    const first = harness.builder.addPoint(requireInput(inputs, 0));
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
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

  it("paints a tap as one disc sized and shaded by its pressure", () => {
    const brush = pressurePen();
    const harness = createHarness(brush);
    const first = harness.builder.addPoint(sample(120, 150, 0, 0.25));
    if (first === null || first === undefined) return;
    harness.renderer.beginStroke(first);
    harness.flush();

    const stroke = harness.builder.finalize();
    harness.commands.length = 0;
    harness.renderer.finalizeStroke(stroke);
    const geometry = resolveStrokeRenderGeometry(stroke);
    if (geometry.kind !== "filled-path") throw new Error("Expected filled-path geometry.");
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
