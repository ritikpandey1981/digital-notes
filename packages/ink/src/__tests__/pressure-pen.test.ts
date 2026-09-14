import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  evaluatePressureResponse,
  resolveBrushForPointerType,
  type BrushPressureCurve,
  type BrushPressureResponse,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import type { FilledPathRenderGeometry } from "../internal/brush-geometry";
import {
  createBrushRenderGeometry,
  createLiveBrushEvaluator,
  drawBrushRenderGeometry,
  registeredBrushStrategies,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import { PressurePenEvaluator } from "../internal/pressure-pen";
import { getStrokeLocalRenderBounds } from "../rendered-stroke-bounds";
import type { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePoint, StrokePointInput } from "../types";

/**
 * `pressure-pen@1`, as geometry.
 *
 * Three things are being defended here and they are worth naming, because the
 * rest is detail. Pressure must reach width and opacity through the durable
 * response already in the model rather than through a second one. A prefix that
 * has settled must stay settled however hard the pen presses afterwards. And
 * two alpha bands must meet on a shared edge, because a silhouette that
 * overlaps itself between two fills reads as a dark rung across the stroke.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const NO_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "none", amount: 0 });
const PRESET_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "average", amount: 0.3 });

const OFF: BrushPressureResponse = Object.freeze({
  enabled: false,
  minimumFactor: 1,
  maximumFactor: 1,
  curve: LINEAR,
});

function response(
  minimumFactor: number,
  maximumFactor: number,
  curve: BrushPressureCurve = LINEAR,
): BrushPressureResponse {
  return Object.freeze({ enabled: true, minimumFactor, maximumFactor, curve });
}

interface PressurePenOptions {
  readonly smoothing?: BrushSmoothing;
  readonly size?: number;
  readonly opacity?: number;
  readonly pressureSize?: BrushPressureResponse;
  readonly pressureOpacity?: BrushPressureResponse;
}

function pressurePen(options: PressurePenOptions = {}): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-brush",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: options.size ?? 6,
    opacity: options.opacity ?? 1,
    smoothing: options.smoothing ?? NO_SMOOTHING,
    dynamics: Object.freeze({
      pressureSize: options.pressureSize ?? response(0.35, 1.65),
      pressureOpacity: options.pressureOpacity ?? OFF,
    }),
    renderer: Object.freeze({ version: 1, kind: "pressure-pen" }),
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
  pressure?: (index: number, count: number) => number,
): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) => {
    const point = shapeAt(shape, index);
    return sample(point.x, point.y, index, pressure?.(index, count) ?? 0.5);
  });
}

const rampUp = (index: number, count: number): number =>
  count < 2 ? 0.5 : 0.05 + (0.9 * index) / (count - 1);
const rampDown = (index: number, count: number): number => rampUp(count - 1 - index, count);

function strokeOf(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  id = "pressure-stroke",
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

function pointsOf(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
): readonly StrokePoint[] {
  return strokeOf(brush, inputs).points;
}

function filledPath(geometry: BrushRenderGeometry): FilledPathRenderGeometry {
  if (geometry.kind !== "filled-path") {
    throw new Error(`Expected filled-path geometry, received ${geometry.kind}.`);
  }
  return geometry;
}

function evaluate(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  renderedScale = 1,
): FilledPathRenderGeometry {
  return filledPath(createBrushRenderGeometry(pointsOf(brush, inputs), brush, renderedScale));
}

/** Every number a painter would read, so equality here means identical pixels. */
function digest(geometry: FilledPathRenderGeometry): string {
  const round = (value: number): string => value.toFixed(9);
  const point = (value: Readonly<{ x: number; y: number }>): string =>
    `${round(value.x)},${round(value.y)}`;
  return geometry.bands
    .map((band) =>
      [
        round(band.alpha),
        band.roundStart ? "s" : "-",
        band.roundEnd ? "e" : "-",
        point(band.startCenter),
        round(band.startRadius),
        point(band.endCenter),
        round(band.endRadius),
        band.left.map(point).join(" "),
        band.right.map(point).join(" "),
      ].join("|"),
    )
    .join("\n");
}

/** Every boundary point plus both caps, which is everything a repaint can touch. */
function inkExtremes(geometry: FilledPathRenderGeometry): readonly Readonly<{
  x: number;
  y: number;
}>[] {
  const points: Array<Readonly<{ x: number; y: number }>> = [];
  if (geometry.dot !== null) {
    const { center, radius } = geometry.dot;
    points.push(
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
    );
  }
  for (const band of geometry.bands) {
    points.push(...band.left, ...band.right);
    if (band.roundStart) {
      points.push(
        { x: band.startCenter.x - band.startRadius, y: band.startCenter.y - band.startRadius },
        { x: band.startCenter.x + band.startRadius, y: band.startCenter.y + band.startRadius },
      );
    }
    if (band.roundEnd) {
      points.push(
        { x: band.endCenter.x - band.endRadius, y: band.endCenter.y - band.endRadius },
        { x: band.endCenter.x + band.endRadius, y: band.endCenter.y + band.endRadius },
      );
    }
  }
  return points;
}

function copyCenterline(
  geometry: FilledPathRenderGeometry,
): readonly Readonly<{ x: number; y: number; radius: number }>[] {
  return geometry.hitGeometry.map((entry) => ({ x: entry.x, y: entry.y, radius: entry.radius }));
}

function createFakeContext(): CanvasRenderingContext2D {
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
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    bezierCurveTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("Pressure Pen geometry", () => {
  it("is a registered strategy that emits a filled silhouette", () => {
    expect(registeredBrushStrategies()).toContain("pressure-pen@1");
    const geometry = evaluate(pressurePen(), samplesFor("curved", 40));
    expect(geometry.kind).toBe("filled-path");
    expect(geometry.bands.length).toBeGreaterThan(0);
    expect(geometry.dot).toBeNull();
  });

  it("produces identical geometry from identical samples and snapshot", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING, pressureOpacity: response(0.4, 1) });
    const inputs = samplesFor("curved", 90, rampUp);
    expect(digest(evaluate(brush, inputs))).toBe(digest(evaluate(brush, inputs)));
    // And through the finalized-stroke path, which caches by stroke identity.
    const stroke = strokeOf(brush, inputs);
    expect(digest(filledPath(resolveStrokeRenderGeometry(stroke)))).toBe(
      digest(evaluate(brush, inputs)),
    );
  });
});

describe("Pressure Pen width", () => {
  it("holds a constant width at a constant pressure", () => {
    const brush = pressurePen();
    const geometry = evaluate(
      brush,
      samplesFor("curved", 60, () => 0.5),
    );
    const expected = (brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, 0.5)) / 2;
    for (const entry of geometry.hitGeometry) expect(entry.radius).toBeCloseTo(expected, 9);
  });

  it("widens continuously as pressure rises and narrows as it falls", () => {
    const brush = pressurePen();
    const rising = evaluate(brush, samplesFor("straight", 80, rampUp)).hitGeometry;
    const falling = evaluate(brush, samplesFor("straight", 80, rampDown)).hitGeometry;
    expect(rising.length).toBeGreaterThan(10);

    for (let index = 1; index < rising.length; index += 1) {
      expect(rising[index]?.radius ?? 0).toBeGreaterThan(rising[index - 1]?.radius ?? 0);
      expect(falling[index]?.radius ?? 0).toBeLessThan(falling[index - 1]?.radius ?? 0);
    }
    // A rise and a mirrored fall span the same widths, so the response is a
    // function of pressure and not of where along the stroke it arrived.
    expect(rising.at(-1)?.radius).toBeCloseTo(falling[0]?.radius ?? 0, 9);
  });

  it("reads the durable curve rather than a second one of its own", () => {
    const curve = Object.freeze({ kind: "power" as const, exponent: 2.5 });
    const brush = pressurePen({ size: 8, pressureSize: response(0.2, 2, curve) });
    const geometry = evaluate(
      brush,
      samplesFor("straight", 40, (index) => index / 39),
    );
    for (const [index, entry] of geometry.hitGeometry.entries()) {
      // Decimation keeps a subset, so each kept sample is matched by value.
      const pressure = geometry.hitGeometry.length === 40 ? index / 39 : null;
      if (pressure === null) break;
      expect(entry.radius).toBeCloseTo(
        (brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, pressure)) / 2,
        9,
      );
    }
    // The extremes are exact whatever decimation kept.
    expect(geometry.hitGeometry[0]?.radius).toBeCloseTo((8 * 0.2) / 2, 9);
    expect(geometry.hitGeometry.at(-1)?.radius).toBeCloseTo((8 * 2) / 2, 9);
  });

  it("ignores pressure entirely when the snapshot disables the response", () => {
    const brush = pressurePen({ pressureSize: OFF });
    const geometry = evaluate(brush, samplesFor("curved", 50, rampUp));
    for (const entry of geometry.hitGeometry) expect(entry.radius).toBeCloseTo(3, 9);
  });

  it("keeps width independent of the rendered scale", () => {
    const brush = pressurePen();
    const inputs = samplesFor("straight", 40, rampUp);
    const plain = evaluate(brush, inputs, 1);
    const zoomed = evaluate(brush, inputs, 4);
    // Radii are divided by the scale the canvas will multiply back, so the
    // painted width is the same page width at every zoom.
    expect((zoomed.hitGeometry[0]?.radius ?? 0) * 4).toBeCloseTo(
      plain.hitGeometry[0]?.radius ?? 0,
      9,
    );
  });

  it("never produces a negative or non-finite radius, even at zero pressure", () => {
    const brush = pressurePen({ pressureSize: response(0, 1.5) });
    const geometry = evaluate(
      brush,
      samplesFor("curved", 40, () => 0),
    );
    for (const entry of geometry.hitGeometry) {
      expect(Number.isFinite(entry.radius)).toBe(true);
      expect(entry.radius).toBeGreaterThan(0);
    }
    expect(Number.isFinite(geometry.bounds.width)).toBe(true);
  });
});

describe("Pressure Pen opacity", () => {
  it("paints one band at the brush's own opacity when the response is off", () => {
    const brush = pressurePen({ opacity: 0.45 });
    const geometry = evaluate(brush, samplesFor("curved", 120, rampUp));
    expect(geometry.bands).toHaveLength(1);
    expect(geometry.bands[0]?.alpha).toBeCloseTo(0.45, 9);
  });

  it("resolves alpha as base opacity times the pressure response", () => {
    const brush = pressurePen({ opacity: 0.8, pressureOpacity: response(0.5, 1) });
    const geometry = evaluate(brush, samplesFor("straight", 120, rampUp));
    expect(geometry.bands.length).toBeGreaterThan(1);
    const first = geometry.bands[0]?.alpha ?? 0;
    const last = geometry.bands.at(-1)?.alpha ?? 0;
    expect(first).toBeCloseTo(
      0.8 * evaluatePressureResponse(brush.dynamics.pressureOpacity, 0.05),
      3,
    );
    // A band carries the alpha of the sample it opened on, so the last band
    // sits within the band tolerance of where the stroke actually ended rather
    // than exactly on it.
    const ending = 0.8 * evaluatePressureResponse(brush.dynamics.pressureOpacity, 0.95);
    expect(last).toBeLessThanOrEqual(ending + 1e-9);
    expect(ending - last).toBeLessThan(1 / 32);
    for (let index = 1; index < geometry.bands.length; index += 1) {
      const alpha = geometry.bands[index]?.alpha ?? 0;
      expect(alpha).toBeGreaterThan(geometry.bands[index - 1]?.alpha ?? 0);
      expect(alpha).toBeLessThanOrEqual(0.8 + 1e-9);
    }
  });

  it("keeps the two responses independent", () => {
    // The failure this guards against is the one the vector renderer already
    // made once: one alpha quietly multiplying a channel it does not own.
    const inputs = samplesFor("straight", 120, rampUp);
    const widthOnly = evaluate(pressurePen({ pressureOpacity: OFF }), inputs);
    const bothOn = evaluate(pressurePen({ pressureOpacity: response(0.4, 1) }), inputs);
    expect(bothOn.hitGeometry.map(({ radius }) => radius)).toEqual(
      widthOnly.hitGeometry.map(({ radius }) => radius),
    );

    const opacityOnly = evaluate(
      pressurePen({ pressureSize: OFF, pressureOpacity: response(0.4, 1) }),
      inputs,
    );
    expect(opacityOnly.bands.map(({ alpha }) => alpha)).toEqual(
      bothOn.bands.map(({ alpha }) => alpha),
    );
  });

  it("cuts bands on a shared cross-section so two alphas meet without overlapping", () => {
    const brush = pressurePen({ pressureOpacity: response(0.3, 1) });
    const geometry = evaluate(brush, samplesFor("curved", 200, rampUp));
    expect(geometry.bands.length).toBeGreaterThan(4);

    for (let index = 1; index < geometry.bands.length; index += 1) {
      const previous = geometry.bands[index - 1];
      const current = geometry.bands[index];
      if (previous === undefined || current === undefined) continue;
      expect(current.left[0]).toEqual(previous.left.at(-1));
      expect(current.right[0]).toEqual(previous.right.at(-1));
      expect(current.roundStart).toBe(false);
      expect(previous.roundEnd).toBe(false);
    }
    expect(geometry.bands[0]?.roundStart).toBe(true);
    expect(geometry.bands.at(-1)?.roundEnd).toBe(true);
  });

  it("keeps the band count bounded when pressure is noisy", () => {
    // A deadband plus a minimum band length: neither alone would stop an
    // oscillating signal from buying one fill per sample.
    const brush = pressurePen({ pressureOpacity: response(0.2, 1) });
    const noisy = samplesFor("curved", 400, (index) => (index % 2 === 0 ? 0.15 : 0.95));
    const geometry = evaluate(brush, noisy);
    expect(geometry.bands.length).toBeLessThanOrEqual(Math.ceil(geometry.keptPointCount / 4) + 1);
    expect(geometry.bands.length).toBeLessThan(geometry.keptPointCount);
  });

  it("applies a band's alpha once per fill", () => {
    const brush = pressurePen({ opacity: 0.5, pressureOpacity: response(0.5, 1) });
    const geometry = evaluate(brush, samplesFor("straight", 120, rampUp));
    const context = createFakeContext();
    context.globalAlpha = 1;
    const alphas: number[] = [];
    const fill = vi.fn(() => alphas.push(context.globalAlpha));
    (context as unknown as { fill: () => void }).fill = fill;

    drawBrushRenderGeometry(context, geometry, brush);

    expect(fill).toHaveBeenCalledTimes(geometry.bands.length);
    expect(alphas).toEqual(geometry.bands.map(({ alpha }) => alpha));
    // Each band is one path, so a join inside it composites once.
    expect((context.beginPath as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
      geometry.bands.length,
    );
  });
});

describe("Pressure Pen incremental evaluation", () => {
  it.each([0, 0.3, 1])("converges on the committed silhouette at smoothing %s", (amount) => {
    const brush = pressurePen({
      smoothing: amount === 0 ? NO_SMOOTHING : Object.freeze({ mode: "average", amount }),
      pressureOpacity: response(0.35, 1),
    });
    const points = pointsOf(brush, samplesFor("curved", 150, rampUp));

    for (const samplesPerFrame of [1, 3, 16]) {
      const live = new PressurePenEvaluator(brush, 1);
      for (let count = 1; count <= points.length; count += 1) {
        if (count % samplesPerFrame === 0 || count === points.length) {
          live.append(points.slice(0, count), false);
        }
      }
      const beforeCommit = digest(live.frozenGeometry());
      live.append(points, true);
      expect(digest(live.geometry())).toBe(beforeCommit);

      const committed = new PressurePenEvaluator(brush, 1);
      committed.append(points, true);
      expect(digest(live.geometry())).toBe(digest(committed.geometry()));
    }
  });

  it.each(["straight", "curved", "sharp-turn", "loop"] as const)(
    "converges on %s strokes under every pressure profile",
    (shape) => {
      const brush = pressurePen({
        smoothing: PRESET_SMOOTHING,
        pressureOpacity: response(0.35, 1),
      });
      const profiles = {
        constant: () => 0.6,
        up: rampUp,
        down: rampDown,
        alternating: (index: number) => (index % 3 === 0 ? 0.2 : 0.85),
        lowStart: (index: number, count: number) => (index < count / 4 ? 0.08 : 0.9),
      };
      for (const profile of Object.values(profiles)) {
        const points = pointsOf(brush, samplesFor(shape, 96, profile));
        const live = new PressurePenEvaluator(brush, 1);
        for (let count = 1; count <= points.length; count += 1)
          live.append(points.slice(0, count), false);
        const beforeCommit = digest(live.frozenGeometry());
        live.append(points, true);
        expect(digest(live.geometry())).toBe(beforeCommit);
      }
    },
  );

  it("keeps a settled prefix identical however hard the pen presses afterwards", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING, pressureOpacity: response(0.3, 1) });
    const opening = samplesFor("curved", 60, () => 0.5);

    for (const prefixLength of [12, 30, 55]) {
      const evaluator = new PressurePenEvaluator(brush, 1);
      evaluator.append(pointsOf(brush, opening.slice(0, prefixLength)), false);
      const settledSpans = evaluator.evaluationSnapshot().settledSegmentCount;
      expect(settledSpans).toBeGreaterThan(0);
      const settled = copyCenterline(evaluator.geometry()).slice(0, settledSpans + 1);

      // The continuation is deliberately hostile: a pressure slam, a reversal,
      // and far more samples than the prefix had.
      const continued = [
        ...opening,
        ...samplesFor("sharp-turn", 80, (index) => (index % 2 === 0 ? 0.02 : 1)).map(
          (input, index) =>
            sample(input.x + 300, input.y + 120, opening.length + index, input.pressure),
        ),
      ];
      evaluator.append(pointsOf(brush, continued), true);
      expect(copyCenterline(evaluator.geometry()).slice(0, settledSpans + 1)).toEqual(settled);
    }
  });

  it("settles every sample exactly once and keeps per-frame work bounded", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING, pressureOpacity: response(0.3, 1) });
    const points = pointsOf(brush, samplesFor("curved", 400, rampUp));
    const evaluator = new PressurePenEvaluator(brush, 1);

    for (let count = 1; count <= points.length; count += 1)
      evaluator.append(points.slice(0, count), false);
    const snapshot = evaluator.evaluationSnapshot();

    expect(snapshot.settledPointEvaluations).toBe(points.length - snapshot.lookaheadSamples);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples + 1);
    expect(snapshot.lookaheadSamples).toBeLessThanOrEqual(5);
    expect(snapshot.settledSegmentCount).toBeGreaterThan(200);
  });

  it("exposes an evaluator through the registry", () => {
    expect(createLiveBrushEvaluator(pressurePen())).toBeInstanceOf(PressurePenEvaluator);
  });
});

describe("Pressure Pen ends", () => {
  it("keeps the terminal sample's own position and pressure", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING });
    const inputs = samplesFor("curved", 60, rampUp);
    const last = inputs.at(-1);
    expect(last).toBeDefined();
    if (last === undefined) return;

    const geometry = evaluate(brush, inputs);
    const terminal = geometry.hitGeometry.at(-1);
    expect(terminal?.x).toBeCloseTo(last.x, 9);
    expect(terminal?.y).toBeCloseTo(last.y, 9);
    expect(terminal?.radius).toBeCloseTo(
      (brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, last.pressure)) / 2,
      9,
    );
  });

  it("draws a tap as one disc at the pressure it was pressed with", () => {
    const brush = pressurePen({ opacity: 0.9, pressureOpacity: response(0.4, 1) });
    const geometry = evaluate(brush, [sample(120, 150, 0, 0.25)]);

    expect(geometry.bands).toHaveLength(0);
    expect(geometry.dot).not.toBeNull();
    expect(geometry.dot?.radius).toBeCloseTo(
      (brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, 0.25)) / 2,
      9,
    );
    expect(geometry.dot?.alpha).toBeCloseTo(
      0.9 * evaluatePressureResponse(brush.dynamics.pressureOpacity, 0.25),
      9,
    );
    expect(geometry.bounds.width).toBeCloseTo((geometry.dot?.radius ?? 0) * 2, 9);
    expect(Number.isFinite(geometry.bounds.x)).toBe(true);

    const context = createFakeContext();
    drawBrushRenderGeometry(context, geometry, brush);
    expect(context.arc).toHaveBeenCalledWith(120, 150, geometry.dot?.radius, 0, Math.PI * 2);
  });

  it("draws a two-point stroke as a single capped band", () => {
    const brush = pressurePen();
    const geometry = evaluate(brush, [sample(40, 40, 0, 0.3), sample(80, 40, 1, 0.9)]);
    expect(geometry.bands).toHaveLength(1);
    expect(geometry.bands[0]?.roundStart).toBe(true);
    expect(geometry.bands[0]?.roundEnd).toBe(true);
    expect(geometry.hitGeometry).toHaveLength(2);
    expect(geometry.hitGeometry[1]?.radius).toBeGreaterThan(geometry.hitGeometry[0]?.radius ?? 0);
  });

  it("treats a cancelled gesture's samples as an ordinary prefix", () => {
    // A pointercancel simply stops delivering samples; nothing is finalized, so
    // the last preview must still be a valid silhouette.
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING });
    const points = pointsOf(brush, samplesFor("curved", 25, rampUp));
    const evaluator = new PressurePenEvaluator(brush, 1);
    evaluator.append(points.slice(0, 14), false);
    const geometry = evaluator.geometry();
    expect(geometry.bands.length).toBeGreaterThan(0);
    expect(geometry.bands.at(-1)?.roundEnd).toBe(true);
    expect(Number.isFinite(geometry.bounds.width)).toBe(true);
  });
});

describe("Pressure Pen bounds and hit geometry", () => {
  it.each(["straight", "curved", "sharp-turn", "loop"] as const)(
    "contains every painted point on %s strokes",
    (shape) => {
      for (const profile of [rampUp, rampDown, () => 0.5]) {
        const brush = pressurePen({ smoothing: PRESET_SMOOTHING });
        const geometry = evaluate(brush, samplesFor(shape, 80, profile));
        const bounds = geometry.bounds;
        for (const point of inkExtremes(geometry)) {
          expect(point.x).toBeGreaterThanOrEqual(bounds.x - 1e-9);
          expect(point.y).toBeGreaterThanOrEqual(bounds.y - 1e-9);
          expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
          expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-9);
        }
      }
    },
  );

  it("grows its bounds with a high-pressure end", () => {
    const brush = pressurePen();
    const light = evaluate(
      brush,
      samplesFor("straight", 60, () => 0.05),
    );
    const heavy = evaluate(brush, samplesFor("straight", 60, rampUp));
    expect(heavy.bounds.height).toBeGreaterThan(light.bounds.height);
  });

  it("reports live and committed bounds identically", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING });
    const points = pointsOf(brush, samplesFor("curved", 90, rampUp));
    const live = new PressurePenEvaluator(brush, 1);
    for (let count = 1; count <= points.length; count += 1)
      live.append(points.slice(0, count), false);
    const previewBounds = { ...live.geometry().bounds };
    live.append(points, true);
    expect(live.geometry().bounds).toEqual(previewBounds);
  });

  it("offers a variable-radius centerline rather than one radius for the stroke", () => {
    const brush = pressurePen();
    const geometry = evaluate(brush, samplesFor("straight", 80, rampUp));
    const radii = geometry.hitGeometry.map(({ radius }) => radius);
    expect(geometry.hitGeometry).toHaveLength(geometry.keptPointCount);
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii) * 2);
    // A press near the light end must not be caught by the heavy end's radius.
    expect(radii[0]).toBeLessThan((brush.size * 1.65) / 2);
  });

  it("keeps the stroke's rendered bounds finite through the shared helper", () => {
    const brush = pressurePen({ smoothing: PRESET_SMOOTHING });
    const stroke = strokeOf(brush, samplesFor("loop", 60, rampUp));
    const bounds = getStrokeLocalRenderBounds(stroke);
    expect(Number.isFinite(bounds.width)).toBe(true);
    expect(bounds.width).toBeGreaterThan(0);
  });
});

describe("Pressure Pen input handling", () => {
  it("is not downgraded for a mouse, and draws a predictable mark at synthetic pressure", () => {
    const brush = pressurePen({ pressureOpacity: response(0.5, 1) });
    const resolved = resolveBrushForPointerType(brush, "mouse");
    expect(resolved.renderer).toEqual({ version: 1, kind: "pressure-pen" });

    const geometry = evaluate(
      resolved,
      samplesFor("curved", 50, () => 0.5),
    );
    const expected = (brush.size * evaluatePressureResponse(brush.dynamics.pressureSize, 0.5)) / 2;
    for (const entry of geometry.hitGeometry) expect(entry.radius).toBeCloseTo(expected, 9);
    expect(geometry.bands).toHaveLength(1);
  });

  it("survives device-edge pressure without producing invalid geometry", () => {
    // The builder already rejects these at the Stroke boundary; the strategy is
    // also reachable directly, and a NaN radius would poison every bound above.
    const brush = pressurePen({ pressureOpacity: response(0.3, 1) });
    const raw = samplesFor("curved", 40).map((input, index) => ({
      ...input,
      pressure: [Number.NaN, -1, 2, 0, 1][index % 5] ?? 0.5,
      delta: { x: 0, y: 0 },
      velocity: 0,
      acceleration: 0,
    })) as unknown as readonly StrokePoint[];

    const geometry = filledPath(createBrushRenderGeometry(raw, brush, 1));
    for (const entry of geometry.hitGeometry) {
      expect(Number.isFinite(entry.radius)).toBe(true);
      expect(entry.radius).toBeGreaterThan(0);
    }
    for (const band of geometry.bands) {
      expect(band.alpha).toBeGreaterThanOrEqual(0);
      expect(band.alpha).toBeLessThanOrEqual(1);
    }
    expect(Number.isFinite(geometry.bounds.width)).toBe(true);
  });
});
