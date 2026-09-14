import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  resolveBrushForPointerType,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  createBrushRenderGeometry,
  createLiveBrushEvaluator,
  drawBrushRenderGeometry,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import { TechnicalPenEvaluator, type StrokedPathRenderGeometry } from "../internal/technical-pen";
import { getStrokeLocalRenderBounds, getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePoint, StrokePointInput } from "../types";

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const NO_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "none", amount: 0 });
const PRESET_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "average", amount: 0.3 });
const HEAVY_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "average", amount: 1 });

function technicalPen(
  smoothing: BrushSmoothing = PRESET_SMOOTHING,
  size = 6,
  pressureEnabled = false,
): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-technical",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size,
    opacity: 1,
    smoothing,
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: pressureEnabled,
        minimumFactor: pressureEnabled ? 0.4 : 1,
        maximumFactor: pressureEnabled ? 1.8 : 1,
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

function sample(
  x: number,
  y: number,
  index: number,
  pressure = 0.5,
  pointerType: InkPointerType = "pen",
): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType,
    button: 0,
    buttons: 1,
  };
}

type Shape = "straight" | "curved" | "sharp-turn" | "loop";

function shapeAt(shape: Shape, index: number): Readonly<{ x: number; y: number }> {
  switch (shape) {
    case "straight":
      return { x: index * 5, y: 40 };
    case "curved":
      return { x: index * 4, y: 40 + Math.sin(index / 4) * 25 };
    case "sharp-turn":
      return index < 10 ? { x: index * 6, y: 30 } : { x: 54, y: 30 + (index - 9) * 6 };
    case "loop":
      return {
        x: 80 + Math.cos((index / 18) * Math.PI * 2) * 40,
        y: 80 + Math.sin((index / 18) * Math.PI * 2) * 40,
      };
  }
}

function samplesFor(
  shape: Shape,
  count: number,
  pressure?: (index: number) => number,
): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) => {
    const point = shapeAt(shape, index);
    return sample(point.x, point.y, index, pressure?.(index) ?? 0.5);
  });
}

function strokeOf(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  id: string,
): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const input of inputs) builder.addPoint(input);
  return builder.finalize();
}

function strokedPath(geometry: BrushRenderGeometry): StrokedPathRenderGeometry {
  if (geometry.kind !== "stroked-path") {
    throw new Error(`Expected stroked-path geometry, received ${geometry.kind}.`);
  }
  return geometry;
}

/** Every number a painter would read, so equality here means identical pixels. */
function pathDigest(geometry: StrokedPathRenderGeometry): string {
  const round = (value: number): string => value.toFixed(9);
  return [
    round(geometry.width),
    round(geometry.renderedScale),
    geometry.origin === null ? "none" : `${round(geometry.origin.x)},${round(geometry.origin.y)}`,
    ...geometry.segments.map((segment) =>
      [
        segment.startX,
        segment.startY,
        segment.control1X,
        segment.control1Y,
        segment.control2X,
        segment.control2Y,
        segment.endX,
        segment.endY,
      ]
        .map(round)
        .join(","),
    ),
  ].join("|");
}

function context(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

/** Feeds an evaluator the way a live renderer does: a growing array, one frame at a time. */
function drawLive(
  brush: ResolvedBrushSnapshot,
  points: readonly StrokePoint[],
  samplesPerFrame: number,
): TechnicalPenEvaluator {
  const evaluator = new TechnicalPenEvaluator(brush);
  for (let count = 1; count <= points.length; count += 1) {
    if (count % samplesPerFrame === 0 || count === points.length) {
      evaluator.append(points.slice(0, count), false);
    }
  }
  evaluator.append(points, true);
  return evaluator;
}

describe("technical-pen@1", () => {
  it("registers as a real strategy and produces stroked-path geometry", () => {
    const brush = technicalPen();
    const stroke = strokeOf(brush, samplesFor("curved", 24), "registered");

    expect(strokedPath(createBrushRenderGeometry(stroke.points, brush)).kind).toBe("stroked-path");
    expect(strokedPath(resolveStrokeRenderGeometry(stroke)).kind).toBe("stroked-path");
    expect(createLiveBrushEvaluator(brush)).toBeInstanceOf(TechnicalPenEvaluator);
  });

  it("is deterministic across independent evaluations of the same input", () => {
    const brush = technicalPen();
    const inputs = samplesFor("loop", 30);
    const first = strokeOf(brush, inputs, "determinism-a");
    const second = strokeOf(brush, inputs, "determinism-b");

    expect(pathDigest(strokedPath(resolveStrokeRenderGeometry(first)))).toBe(
      pathDigest(strokedPath(resolveStrokeRenderGeometry(second))),
    );
  });

  it.each([
    ["straight", 12, PRESET_SMOOTHING],
    ["curved", 40, PRESET_SMOOTHING],
    ["curved", 40, NO_SMOOTHING],
    ["curved", 40, HEAVY_SMOOTHING],
    ["sharp-turn", 20, PRESET_SMOOTHING],
    ["loop", 36, HEAVY_SMOOTHING],
    ["curved", 240, PRESET_SMOOTHING],
  ] as const)(
    "converges live on committed for a %s stroke of %i samples",
    (shape, count, smoothing) => {
      const brush = technicalPen(smoothing);
      const stroke = strokeOf(brush, samplesFor(shape, count), `converge-${shape}-${count}`);
      const committed = strokedPath(resolveStrokeRenderGeometry(stroke));

      for (const samplesPerFrame of [1, 3, 16]) {
        const live = drawLive(brush, stroke.points, samplesPerFrame);
        expect(pathDigest(live.geometry(1))).toBe(pathDigest(committed));
      }
    },
  );

  it("keeps a settled prefix identical when the stroke continues", () => {
    // The gate the whole strategy is arranged around. A tolerance or a filter
    // that read the stroke's diagonal, its mean spacing, or anything else that
    // grows with the stroke would move geometry already drawn on screen.
    const brush = technicalPen();
    const inputs = samplesFor("curved", 120);

    for (const prefixLength of [8, 20, 60]) {
      const prefix = new TechnicalPenEvaluator(brush);
      prefix.append(pointsOf(brush, inputs.slice(0, prefixLength)), false);
      const settled = prefix.evaluationSnapshot().settledSegmentCount;
      expect(settled).toBeGreaterThan(0);
      const prefixSegments = prefix.geometry(1).segments.slice(0, settled);

      const extended = new TechnicalPenEvaluator(brush);
      extended.append(pointsOf(brush, inputs), true);
      expect(extended.geometry(1).segments.slice(0, settled)).toEqual(prefixSegments);
    }
  });

  it("settles every sample exactly once and keeps per-frame work bounded", () => {
    // Structural rather than timed: a rebuild would show up as repeated settled
    // evaluations, and an unbounded tail as a growing provisional count.
    const brush = technicalPen();
    const inputs = samplesFor("curved", 400);
    const points = pointsOf(brush, inputs);
    const evaluator = new TechnicalPenEvaluator(brush);

    for (let count = 1; count <= points.length; count += 1) {
      evaluator.append(points.slice(0, count), false);
    }
    evaluator.append(points, true);

    const snapshot = evaluator.evaluationSnapshot();
    expect(snapshot.settledPointEvaluations).toBe(points.length);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples + 1);
    expect(snapshot.segmentCount).toBe(snapshot.settledSegmentCount);
  });

  it("ignores pressure for width while the stroke keeps its pressure samples", () => {
    const brush = technicalPen(PRESET_SMOOTHING, 6, true);
    const inputs = samplesFor("straight", 20, (index) => 0.05 + (index / 19) * 0.9);
    const stroke = strokeOf(brush, inputs, "pressure-ignored");
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));

    expect(geometry.width).toBe(6);
    // Even a snapshot that does carry a pressure response cannot vary the width:
    // the strategy reads the nominal size, so this is structural, not configured.
    expect(brush.dynamics.pressureSize.enabled).toBe(true);
    const pressures = stroke.sourceSamples.map((entry) => entry.pressure);
    expect(Math.min(...pressures)).toBeCloseTo(0.05);
    expect(Math.max(...pressures)).toBeCloseTo(0.95);
    expect(stroke.sourceSamples).toHaveLength(inputs.length);
  });

  it("draws the same for a mouse as for a pen", () => {
    // Nothing to downgrade: the strategy never read pressure, so the mouse's
    // synthetic constant cannot change what it produces.
    const brush = technicalPen();
    expect(resolveBrushForPointerType(brush, "mouse").renderer).toEqual({
      version: 1,
      kind: "technical-pen",
    });
  });

  it.each([1, 2] as const)("keeps the terminal sample on a %i-point stroke", (count) => {
    const brush = technicalPen();
    const inputs = samplesFor("straight", Math.max(count, 1)).slice(0, count);
    const stroke = strokeOf(brush, inputs, `terminal-${count}`);
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));
    const last = inputs.at(-1)!;

    if (count === 1) {
      expect(geometry.segments).toHaveLength(0);
      expect(geometry.origin).toEqual({ x: last.x, y: last.y });
      return;
    }
    const final = geometry.segments.at(-1)!;
    expect(final.endX).toBeCloseTo(last.x, 9);
    expect(final.endY).toBeCloseTo(last.y, 9);
  });

  it("keeps a terminal sample that falls inside the decimation spacing", () => {
    const brush = technicalPen(NO_SMOOTHING, 8);
    const inputs = [
      sample(0, 0, 0),
      sample(30, 0, 1),
      sample(60, 0, 2),
      // Closer than the spacing rule admits, but it is where the pen stopped.
      sample(60.4, 0, 3),
    ];
    const stroke = strokeOf(brush, inputs, "terminal-short");
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));

    expect(geometry.segments.at(-1)!.endX).toBeCloseTo(60.4, 9);
  });

  it("leaves a round mark for a tap rather than nothing", () => {
    const brush = technicalPen(PRESET_SMOOTHING, 9);
    const stroke = strokeOf(brush, [sample(20, 30, 0)], "tap");
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));
    const canvas = context();

    drawBrushRenderGeometry(canvas, geometry, brush);
    expect(canvas.arc).toHaveBeenCalledWith(20, 30, 4.5, 0, Math.PI * 2);
    expect(canvas.fill).toHaveBeenCalledTimes(1);
    expect(canvas.stroke).not.toHaveBeenCalled();
    expect(geometry.bounds.width).toBeCloseTo(9);
    expect(geometry.bounds.height).toBeCloseTo(9);
  });

  it("paints the whole path under one alpha so joins cannot accumulate", () => {
    const brush = technicalPen();
    const stroke = strokeOf(brush, samplesFor("curved", 30), "single-alpha");
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));
    const canvas = context();

    drawBrushRenderGeometry(canvas, geometry, brush);
    expect(canvas.beginPath).toHaveBeenCalledTimes(1);
    expect(canvas.moveTo).toHaveBeenCalledTimes(1);
    expect(canvas.stroke).toHaveBeenCalledTimes(1);
    expect(canvas.bezierCurveTo).toHaveBeenCalledTimes(geometry.segments.length);
    expect(canvas.lineCap).toBe("round");
    expect(canvas.lineJoin).toBe("round");
    expect(canvas.lineWidth).toBe(6);
  });

  it("keeps painted width independent of render scale", () => {
    const brush = technicalPen(PRESET_SMOOTHING, 6);
    const stroke = strokeOf(brush, samplesFor("curved", 24), "zoom-independent");

    for (const renderedScale of [0.5, 1, 2, 4]) {
      const geometry = strokedPath(resolveStrokeRenderGeometry(stroke, renderedScale));
      const canvas = context();
      drawBrushRenderGeometry(canvas, geometry, brush);
      // The caller scales the canvas by the same factor, so a width divided by
      // it lands on the nominal page width at every zoom.
      expect(canvas.lineWidth * renderedScale).toBeCloseTo(6, 9);
      expect(geometry.segments).toEqual(
        strokedPath(resolveStrokeRenderGeometry(stroke, 1)).segments,
      );
    }
  });

  it("bounds the path with its width and never inside its own ink", () => {
    const brush = technicalPen(PRESET_SMOOTHING, 10);
    const stroke = strokeOf(brush, samplesFor("loop", 36), "bounds");
    const geometry = strokedPath(resolveStrokeRenderGeometry(stroke));

    for (const segment of geometry.segments) {
      for (const [x, y] of [
        [segment.startX, segment.startY],
        [segment.endX, segment.endY],
      ]) {
        expect(x).toBeGreaterThanOrEqual(geometry.bounds.x + 5 - 1e-6);
        expect(y).toBeGreaterThanOrEqual(geometry.bounds.y + 5 - 1e-6);
        expect(x).toBeLessThanOrEqual(geometry.bounds.x + geometry.bounds.width - 5 + 1e-6);
        expect(y).toBeLessThanOrEqual(geometry.bounds.y + geometry.bounds.height - 5 + 1e-6);
      }
    }

    const local = getStrokeLocalRenderBounds(stroke);
    const rendered = getStrokeRenderedBounds(stroke);
    for (const rect of [local, rendered]) {
      expect(Number.isFinite(rect.width)).toBe(true);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it("keeps bounds finite and stable under translation, rotation and scale", () => {
    const brush = technicalPen();
    const stroke = strokeOf(brush, samplesFor("curved", 30), "transforms");
    const base = getStrokeRenderedBounds(stroke);

    const translated = getStrokeRenderedBounds(stroke, {
      translation: { x: 40, y: -25 },
      rotation: 0,
      scale: 1,
    });
    expect(translated.x).toBeCloseTo(base.x + 40, 9);
    expect(translated.y).toBeCloseTo(base.y - 25, 9);
    expect(translated.width).toBeCloseTo(base.width, 9);

    const rotated = getStrokeRenderedBounds(stroke, {
      translation: { x: 0, y: 0 },
      rotation: Math.PI / 5,
      scale: 1,
    });
    expect(Number.isFinite(rotated.width)).toBe(true);
    expect(rotated.width).toBeGreaterThan(0);

    // Scale-compensated width: geometry grows, the painted width does not.
    const scaled = getStrokeRenderedBounds(stroke, {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: 2,
    });
    expect(scaled.width).toBeGreaterThan(base.width);
    expect(strokedPath(resolveStrokeRenderGeometry(stroke, 2)).width).toBe(6);
  });

  it("caches committed geometry per scale without rebuilding it", () => {
    const brush = technicalPen();
    const stroke = strokeOf(brush, samplesFor("curved", 40), "cache");

    expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(resolveStrokeRenderGeometry(stroke, 1));
    expect(resolveStrokeRenderGeometry(stroke, 2)).not.toBe(resolveStrokeRenderGeometry(stroke, 1));
  });

  it("hands out an immutable committed path and a live view that may be reused", () => {
    const brush = technicalPen();
    const stroke = strokeOf(brush, samplesFor("curved", 20), "immutability");
    const committed = strokedPath(resolveStrokeRenderGeometry(stroke));

    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.segments)).toBe(true);
    for (const segment of committed.segments) expect(Object.isFrozen(segment)).toBe(true);
  });
});

/** Runs samples through StrokeBuilder so tests evaluate the same points the renderer sees. */
function pointsOf(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
): readonly StrokePoint[] {
  return strokeOf(brush, inputs, `points-${inputs.length}`).points;
}
