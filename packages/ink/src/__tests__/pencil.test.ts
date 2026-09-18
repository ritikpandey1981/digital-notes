import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createResolvedBrushSnapshot,
  resolveBrushForPointerType,
  type BrushPressureCurve,
  type BrushPressureResponse,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import type { MaterialRenderGeometry } from "../internal/brush-geometry";
import {
  createBrushRenderGeometry,
  createLiveBrushEvaluator,
  drawBrushRenderGeometry,
  registeredBrushStrategies,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import {
  PencilMaterialRuntime,
  TILE_PAGE_UNITS,
  type MaterialTileKey,
} from "../internal/pencil-material";
import {
  PencilMaterialEvaluator,
  releasePreviewMaterialRuntime,
} from "../internal/pencil-material-strategy";
import { getStrokeLocalRenderBounds, getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePoint, StrokePointInput } from "../types";
import { installCanvasStub, recordingContext, type CanvasStub } from "./canvas-stub";

/**
 * `pencil@1`, as the engine sees it.
 *
 * The strategy stopped describing where marks are and started describing what
 * the paper holds, so what this suite defends changed with it. Placement is
 * still by distance, so the same hand makes the same mark whatever the device's
 * sample rate. A settled prefix still stays settled. Bounds and hit geometry
 * still come out of the dab stream, so selection and the eraser never learn
 * what a tile is. What is new is that the *pixels* come from a runtime cache,
 * and the strategy's job at paint time is to draw the material that exists and
 * say which is missing -- never to approximate it.
 *
 * What the material actually looks like is settled in
 * [`pencil-material-model.test.ts`](pencil-material-model.test.ts); how it is
 * cached and rebuilt in [`pencil-material-cache.test.ts`](pencil-material-cache.test.ts).
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const NO_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "none", amount: 0 });
const PRESET_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "average", amount: 0.2 });

function response(
  minimumFactor: number,
  maximumFactor: number,
  curve: BrushPressureCurve = LINEAR,
): BrushPressureResponse {
  return Object.freeze({ enabled: true, minimumFactor, maximumFactor, curve });
}

interface PencilOptions {
  readonly smoothing?: BrushSmoothing;
  readonly size?: number;
  readonly opacity?: number;
  readonly color?: string;
  readonly pressureSize?: BrushPressureResponse;
  readonly pressureOpacity?: BrushPressureResponse;
}

/** The shipped HB configuration unless a case needs something else. */
function pencil(options: PencilOptions = {}): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pencil-hb",
    presetVersion: 1,
    family: "pencil",
    color: options.color ?? "#343434",
    size: options.size ?? 2,
    opacity: options.opacity ?? 0.78,
    smoothing: options.smoothing ?? NO_SMOOTHING,
    dynamics: Object.freeze({
      pressureSize: options.pressureSize ?? response(0.65, 1.25),
      pressureOpacity:
        options.pressureOpacity ??
        response(0.45, 1, Object.freeze({ kind: "power", exponent: 0.75 })),
    }),
    renderer: Object.freeze({ version: 1, kind: "pencil" }),
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

/** One curve of a fixed length, resampled at whatever density a case asks for. */
function curveAt(progress: number): Readonly<{ x: number; y: number }> {
  return { x: 40 + progress * 260, y: 90 + Math.sin(progress * 7) * 30 };
}

function curveSamples(
  count: number,
  pressure: (progress: number) => number = () => 0.5,
): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) => {
    const progress = count < 2 ? 0 : index / (count - 1);
    const point = curveAt(progress);
    return sample(point.x, point.y, index, pressure(progress));
  });
}

function strokeOf(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  id = "pencil-stroke",
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

function material(geometry: BrushRenderGeometry): MaterialRenderGeometry {
  if (geometry.kind !== "material") {
    throw new Error(`Expected material geometry, received ${geometry.kind}.`);
  }
  return geometry;
}

function evaluate(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  renderedScale = 1,
  id = "pencil-stroke",
): MaterialRenderGeometry {
  return material(createBrushRenderGeometry(pointsOf(brush, inputs), brush, renderedScale, id));
}

/** Every number a painter would read off the dab stream. */
function digest(geometry: MaterialRenderGeometry): string {
  const round = (value: number): string => value.toFixed(9);
  return [
    round(geometry.alpha),
    String(geometry.markCount),
    geometry.dot === null
      ? "none"
      : `${round(geometry.dot.center.x)},${round(geometry.dot.center.y)},${round(geometry.dot.radius)}`,
    geometry.stamps
      .map(
        (stamp) =>
          `${round(stamp.x)},${round(stamp.y)},${round(stamp.radius)},${round(stamp.coverage)}`,
      )
      .join(";"),
    [...geometry.tileKeys].sort().join("/"),
  ].join("|");
}

function spacings(geometry: MaterialRenderGeometry): readonly number[] {
  const values: number[] = [];
  for (let index = 1; index < geometry.stamps.length; index += 1) {
    const previous = geometry.stamps[index - 1];
    const current = geometry.stamps[index];
    if (previous === undefined || current === undefined) continue;
    values.push(Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  return values;
}

/** The advance a two-unit tip places dabs at, in page units. */
const PAINTED_ADVANCE = 1;

let canvas: CanvasStub;

beforeEach(() => {
  canvas = installCanvasStub();
});

afterEach(() => {
  releasePreviewMaterialRuntime();
  canvas.restore();
});

describe("Pencil strategy", () => {
  it("is registered as its own durable identity and emits the material primitive", () => {
    expect(registeredBrushStrategies()).toContain("pencil@1");
    const geometry = evaluate(pencil(), curveSamples(24));
    expect(geometry.kind).toBe("material");
    expect(geometry.markCount).toBeGreaterThan(0);
    expect(geometry.supply.kind).toBe("cached");
  });

  it("produces identical geometry for two independently built strokes", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const inputs = curveSamples(40, (progress) => 0.2 + progress * 0.6);
    expect(digest(evaluate(brush, inputs))).toBe(digest(evaluate(brush, inputs)));
  });

  it("places dabs by distance rather than by sample", () => {
    // The same curve, sampled at four densities. A dab stream driven by events
    // would quadruple; one driven by arc length must not move.
    const brush = pencil();
    const geometries = [40, 80, 160, 320].map((count) => evaluate(brush, curveSamples(count)));
    const counts = geometries.map((geometry) => geometry.stamps.length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    for (const geometry of geometries) {
      const advances = spacings(geometry);
      expect(advances.length).toBeGreaterThan(50);
      // Every advance is the configured one, bar the terminal dab that lands
      // wherever the pencil stopped. The cursor measures arc length along the
      // sampled polyline, so a dab straddling a corner sits marginally closer
      // in a straight line than the arc it was placed along -- never further.
      for (const advance of advances.slice(0, -1)) {
        expect(advance).toBeLessThanOrEqual(PAINTED_ADVANCE + 1e-9);
        expect(advance).toBeGreaterThan(PAINTED_ADVANCE * 0.99);
      }
    }
  });

  it("deposits in the artwork's own frame, so scale is not a material parameter", () => {
    // Material is deposited once and the object transform is applied when it is
    // painted, which is what lets a moved or resized drawing keep the marks it
    // was drawn with instead of resampling a different patch of sheet.
    const brush = pencil();
    const inputs = curveSamples(60);
    const unscaled = evaluate(brush, inputs, 1);
    const scaled = evaluate(brush, inputs, 2.5);
    expect(digest(scaled)).toBe(digest(unscaled));
    expect(scaled.renderedScale).toBe(1);
  });

  it("lays graphite at the terminal position however the cursor happens to stand", () => {
    const brush = pencil();
    for (const length of [0.7, 1, 1.3, 2.4, 3.1]) {
      const geometry = evaluate(brush, [sample(40, 90, 0), sample(40 + length, 90, 1)]);
      const last = geometry.stamps[geometry.stamps.length - 1];
      expect(last).toBeDefined();
      expect(last?.x).toBeCloseTo(40 + length, 9);
    }
  });

  it("marks a tap as one tip-sized dot rather than nothing", () => {
    const geometry = evaluate(pencil({ size: 12 }), [sample(120, 120, 0, 0.6)]);
    expect(geometry.stamps).toHaveLength(1);
    expect(geometry.dot).not.toBeNull();
    expect(geometry.dot?.radius).toBeGreaterThan(0);
    expect(geometry.tileKeys.length).toBeGreaterThan(0);
  });

  it("draws a two-point stroke and a stationary drag without failing", () => {
    const brush = pencil();
    expect(() => evaluate(brush, [sample(40, 90, 0), sample(41, 90, 1)])).not.toThrow();
    const still = evaluate(brush, [sample(40, 90, 0), sample(40, 90, 1), sample(40, 90, 2)]);
    expect(still.markCount).toBeGreaterThan(0);
  });

  it("raises coverage with pressure through the durable response and nothing else", () => {
    const brush = pencil({ size: 12 });
    const light = evaluate(
      brush,
      curveSamples(40, () => 0.15),
    );
    const firm = evaluate(
      brush,
      curveSamples(40, () => 0.95),
    );
    const coverage = (geometry: MaterialRenderGeometry): number =>
      geometry.stamps.reduce((total, stamp) => total + stamp.coverage, 0) / geometry.stamps.length;
    expect(coverage(firm)).toBeGreaterThan(coverage(light));

    const inert = pencil({
      size: 12,
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    });
    const a = evaluate(
      inert,
      curveSamples(40, () => 0.15),
    );
    const b = evaluate(
      inert,
      curveSamples(40, () => 0.95),
    );
    expect(a.stamps[0]?.coverage).toBe(b.stamps[0]?.coverage);
  });

  it("widens the tip through the durable pressure-size response and nothing else", () => {
    const brush = pencil({ size: 10, pressureSize: response(0.5, 1.5) });
    const light = evaluate(
      brush,
      curveSamples(30, () => 0),
    );
    const firm = evaluate(
      brush,
      curveSamples(30, () => 1),
    );
    expect(light.stamps[0]?.radius).toBeCloseTo((10 * 0.5) / 2, 9);
    expect(firm.stamps[0]?.radius).toBeCloseTo((10 * 1.5) / 2, 9);
  });

  it("never covers the whole tip, so even a hard press leaves paper showing", () => {
    const geometry = evaluate(
      pencil({ size: 12 }),
      curveSamples(30, () => 1),
    );
    for (const stamp of geometry.stamps) expect(stamp.coverage).toBeLessThan(1);
  });

  it("keeps one dab stream through a change of colour or opacity", () => {
    // Neither reaches placement. Colour is applied when material is painted and
    // opacity when it is deposited, so where the tip went is the same either way.
    const inputs = curveSamples(40);
    const stream = (brush: ResolvedBrushSnapshot): string =>
      digest(evaluate(brush, inputs)).split("|").slice(1).join("|");
    const base = stream(pencil());
    expect(stream(pencil({ color: "#cc3377" }))).toBe(base);
    expect(stream(pencil({ opacity: 0.3 }))).toBe(base);
  });

  it("carries base opacity in the material rather than on the painter", () => {
    const brush = pencil({ size: 12, opacity: 0.4 });
    const geometry = evaluate(brush, curveSamples(30));
    expect(geometry.alpha).toBe(0.4);
    const runtime = new PencilMaterialRuntime();
    warm(runtime, geometry, brush);
    const { context, draws, alphas } = recordingContext();
    drawBrushRenderGeometry(context, geometry, brush, { materialRuntime: runtime });
    expect(draws.length).toBeGreaterThan(0);
    // Opacity is already inside the alpha bytes. A painter that also reached
    // for globalAlpha would apply it twice and darken the mark on every redraw.
    for (const alpha of alphas) expect(alpha).toBe(1);
    runtime.destroy();
  });

  it("tints graphite with the selected colour rather than a hardcoded grey", () => {
    const brush = pencil({ size: 12, color: "#0099bb" });
    const geometry = evaluate(brush, curveSamples(30));
    const runtime = new PencilMaterialRuntime();
    warm(runtime, geometry, brush);
    const { context } = recordingContext();
    drawBrushRenderGeometry(context, geometry, brush, { materialRuntime: runtime });
    expect(canvas.fills).toContain("#0099bb");
    runtime.destroy();
  });

  it("draws the material that exists and reports the material that does not", () => {
    // There is no approximate Pencil: an approximation of a texture is a
    // different texture, so a tile that is not ready is simply left bare.
    const brush = pencil({ size: 12 });
    const geometry = evaluate(brush, curveSamples(60));
    const runtime = new PencilMaterialRuntime();
    const { context, draws } = recordingContext();
    drawBrushRenderGeometry(context, geometry, brush, { materialRuntime: runtime });
    expect(draws).toHaveLength(0);

    warm(runtime, geometry, brush);
    const second = recordingContext();
    drawBrushRenderGeometry(second.context, geometry, brush, { materialRuntime: runtime });
    expect(second.draws.length).toBe(geometry.tileKeys.length);
    for (const draw of second.draws) {
      expect(draw.width).toBe(TILE_PAGE_UNITS);
      expect(draw.height).toBe(TILE_PAGE_UNITS);
      expect(draw.x % TILE_PAGE_UNITS).toBe(0);
      expect(draw.y % TILE_PAGE_UNITS).toBe(0);
    }
    runtime.destroy();
  });

  it("paints only the tiles a local repaint asked for", () => {
    const brush = pencil({ size: 12 });
    const geometry = evaluate(brush, curveSamples(120));
    const runtime = new PencilMaterialRuntime();
    warm(runtime, geometry, brush);
    expect(geometry.tileKeys.length).toBeGreaterThan(1);
    const one = geometry.tileKeys[0];
    expect(one).toBeDefined();
    const { context, draws } = recordingContext();
    drawBrushRenderGeometry(context, geometry, brush, {
      materialRuntime: runtime,
      tiles: new Set([one as MaterialTileKey]),
    });
    expect(draws).toHaveLength(1);
    runtime.destroy();
  });

  it("holds a settled prefix byte-for-byte against hostile continuations", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING, size: 8 });
    const inputs = curveSamples(60);
    const prefix = inputs.slice(0, 30);
    const evaluator = new PencilMaterialEvaluator(brush);
    evaluator.append(pointsOf(brush, prefix), false);
    const settledAfterPrefix = evaluator.evaluationSnapshot().settledSegmentCount;
    const settledDabs = evaluator.geometry().stamps.slice(0, settledAfterPrefix);

    for (const tail of [
      inputs.slice(30),
      inputs.slice(30).map((input, index) => sample(input.x + 60, input.y - 40, 30 + index, 1)),
      [sample(400, 400, 30, 0.01)],
    ]) {
      const continued = new PencilMaterialEvaluator(brush);
      continued.append(pointsOf(brush, [...prefix, ...tail]), true);
      const stamps = continued.geometry().stamps;
      for (let index = 0; index < settledDabs.length; index += 1) {
        expect(stamps[index]?.x).toBe(settledDabs[index]?.x);
        expect(stamps[index]?.y).toBe(settledDabs[index]?.y);
        expect(stamps[index]?.radius).toBe(settledDabs[index]?.radius);
      }
    }
  });

  it("evaluates a settled sample once however the samples are delivered", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING, size: 8 });
    const inputs = curveSamples(64);
    const points = pointsOf(brush, inputs);
    const evaluator = new PencilMaterialEvaluator(brush);
    for (let count = 1; count <= points.length; count += 1) {
      evaluator.append(points.slice(0, count), count === points.length);
    }
    const snapshot = evaluator.evaluationSnapshot();
    expect(snapshot.settledPointEvaluations).toBe(points.length);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples);
  });

  it("converges on the committed material when the last sample arrives", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING, size: 8 });
    const inputs = curveSamples(50);
    const points = pointsOf(brush, inputs);
    const live = new PencilMaterialEvaluator(brush);
    for (let count = 1; count <= points.length; count += 1) {
      live.append(points.slice(0, count), count === points.length);
    }
    expect(digest(live.geometry()).split("|").slice(0, 4).join("|")).toBe(
      digest(evaluate(brush, inputs)).split("|").slice(0, 4).join("|"),
    );
  });

  it("stays finite and bounded under noisy and out-of-range pressure", () => {
    const brush = pencil({ size: 6 });
    const inputs = curveSamples(80).map((input, index) => ({
      ...input,
      pressure: [0, 1, 0.5, 0.01, 0.99][index % 5] ?? 0.5,
    }));
    const geometry = evaluate(brush, inputs);
    for (const stamp of geometry.stamps) {
      expect(Number.isFinite(stamp.x)).toBe(true);
      expect(Number.isFinite(stamp.y)).toBe(true);
      expect(stamp.radius).toBeGreaterThan(0);
      expect(stamp.coverage).toBeGreaterThanOrEqual(0);
      expect(stamp.coverage).toBeLessThanOrEqual(1);
    }
    for (const value of [geometry.bounds.x, geometry.bounds.y]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("bounds every tile its material occupies", () => {
    const brush = pencil({ size: 16 });
    const geometry = evaluate(
      brush,
      curveSamples(90, (progress) => 0.3 + progress * 0.6),
    );
    for (const key of geometry.tileKeys) {
      const comma = key.indexOf(",");
      const x = Number(key.slice(0, comma)) * TILE_PAGE_UNITS;
      const y = Number(key.slice(comma + 1)) * TILE_PAGE_UNITS;
      // A tile the stroke reaches must intersect the bounds the editor uses to
      // decide what to repaint, or a repaint would clip the mark.
      expect(x).toBeLessThan(geometry.bounds.x + geometry.bounds.width);
      expect(y).toBeLessThan(geometry.bounds.y + geometry.bounds.height);
      expect(x + TILE_PAGE_UNITS).toBeGreaterThan(geometry.bounds.x);
      expect(y + TILE_PAGE_UNITS).toBeGreaterThan(geometry.bounds.y);
    }
    for (const stamp of geometry.stamps) {
      expect(stamp.x - stamp.radius).toBeGreaterThanOrEqual(geometry.bounds.x);
      expect(stamp.x + stamp.radius).toBeLessThanOrEqual(geometry.bounds.x + geometry.bounds.width);
    }
  });

  it("offers a centerline hit geometry the editor can use without knowing about material", () => {
    const brush = pencil({ size: 14 });
    const geometry = evaluate(
      brush,
      curveSamples(50, () => 0.7),
    );
    expect(geometry.hitGeometry).toBe(geometry.stamps);
    expect(geometry.hitGeometry.length).toBeGreaterThan(4);
    for (const entry of geometry.hitGeometry) expect(entry.radius).toBeGreaterThan(0);
  });

  it("caches committed geometry by stroke identity, so Undo and Redo repaint the same mark", () => {
    const brush = pencil({ size: 10 });
    const stroke = strokeOf(brush, curveSamples(40), "undo-redo");
    const first = resolveStrokeRenderGeometry(stroke);
    const second = resolveStrokeRenderGeometry(stroke);
    expect(second).toBe(first);
    // And a scale never creates a second geometry, because there is no scale in
    // the material.
    expect(resolveStrokeRenderGeometry(stroke, 2.5)).toBe(first);
  });

  it("reproduces a reopened stroke exactly from its samples, snapshot and id", () => {
    const brush = pencil({ size: 10, smoothing: PRESET_SMOOTHING });
    const inputs = curveSamples(45, (progress) => 0.2 + progress * 0.7);
    const original = strokeOf(brush, inputs, "reopened");
    const reopened = new Stroke({
      id: original.id,
      timestamp: original.timestamp,
      points: original.points.map((point) => ({ ...point })),
      sourceSamples: original.sourceSamples.map((point) => ({ ...point })),
      style: { ...original.style },
      brush: createResolvedBrushSnapshot(original.brush),
      metrics: original.metrics,
      statistics: { ...original.statistics },
    });
    expect(digest(material(resolveStrokeRenderGeometry(reopened)))).toBe(
      digest(material(resolveStrokeRenderGeometry(original))),
    );
  });

  it("is not built on the dead brushTextureId field", () => {
    const brush = pencil({ size: 10 });
    const plain = strokeOf(brush, curveSamples(30), "texture-free");
    const withTextureId = new Stroke({
      id: plain.id,
      timestamp: plain.timestamp,
      points: plain.points.map((point) => ({ ...point })),
      sourceSamples: plain.sourceSamples.map((point) => ({ ...point })),
      style: { ...plain.style, brushTextureId: "texture-graphite-v1" },
      brush: createResolvedBrushSnapshot(plain.brush),
      metrics: plain.metrics,
      statistics: { ...plain.statistics },
    });
    expect(withTextureId.style.brushTextureId).toBe("texture-graphite-v1");
    expect(digest(material(resolveStrokeRenderGeometry(withTextureId)))).toBe(
      digest(material(resolveStrokeRenderGeometry(plain))),
    );
  });

  it("gives a mouse the brush exactly as configured, still as pencil@1", () => {
    const configured = pencil({ size: 10 });
    const mouse = resolveBrushForPointerType(configured, "mouse");
    expect(mouse.renderer).toEqual({ version: 1, kind: "pencil" });
    const inputs = curveSamples(30).map((input, index) =>
      sample(input.x, input.y, index, index / 30, "mouse"),
    );
    const geometry = evaluate(mouse, inputs);
    const first = geometry.stamps[0];
    for (const stamp of geometry.stamps) {
      expect(stamp.radius).toBe(first?.radius);
      expect(stamp.coverage).toBe(first?.coverage);
    }
    expect(first?.radius).toBe(configured.size / 2);
  });

  it("refuses a rendered scale that is not a positive finite number", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createBrushRenderGeometry([], pencil(), scale, "bad")).toThrow(RangeError);
    }
  });

  it("keeps local render bounds finite and centred on the transform pivot", () => {
    const brush = pencil({ size: 12 });
    const stroke = strokeOf(brush, curveSamples(40), "bounds");
    const local = getStrokeLocalRenderBounds(stroke);
    const pivot = stroke.bounds.center;
    expect(local.x + local.width / 2).toBeCloseTo(pivot.x, 9);
    expect(local.y + local.height / 2).toBeCloseTo(pivot.y, 9);
    const rendered = getStrokeRenderedBounds(stroke, {
      translation: { x: 30, y: -12 },
      rotation: Math.PI / 5,
      scale: 1.6,
    });
    for (const value of [rendered.x, rendered.y, rendered.width, rendered.height]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // Material scales with its object, so a scaled mark takes a larger box.
    expect(rendered.width).toBeGreaterThan(local.width);
  });

  it("hands the live path a material evaluator", () => {
    const brush = pencil({ size: 8 });
    expect(createLiveBrushEvaluator(brush, 1, "live")).toBeInstanceOf(PencilMaterialEvaluator);
  });
});

/** Fills a runtime with one geometry's material, the way a commit or a rebuild would. */
function warm(
  runtime: PencilMaterialRuntime,
  geometry: MaterialRenderGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  if (geometry.supply.kind !== "cached") throw new Error("Only cached material can be warmed.");
  for (const key of geometry.tileKeys) {
    runtime.tileNow(geometry.supply.cacheId, key, geometry.supply.points, brush);
  }
}
