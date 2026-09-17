import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  resolveBrushForPointerType,
  type BrushPressureCurve,
  type BrushPressureResponse,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import type { BrushStamp, StampsRenderGeometry } from "../internal/brush-geometry";
import { brushSeed } from "../internal/brush-random";
import {
  createBrushRenderGeometry,
  createLiveBrushEvaluator,
  drawBrushRenderGeometry,
  registeredBrushStrategies,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import { PencilEvaluator } from "../internal/pencil";
import { getStrokeLocalRenderBounds, getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePoint, StrokePointInput } from "../types";

/**
 * `pencil@1`, as geometry.
 *
 * Four properties are being defended, and the rest is detail. Stamps are placed
 * by distance along the path, so the same hand produces the same mark whatever
 * the device's sample rate. Grain is a field in the stroke's own space, so it
 * survives a save, a reopen, a duplicate and a transform. Pressure reaches the
 * mark only through the durable responses already in the model, and reaches
 * *coverage* rather than alpha. And a prefix that has settled stays settled,
 * however hostile the samples that follow it.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const NO_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "none", amount: 0 });
const PRESET_SMOOTHING: BrushSmoothing = Object.freeze({ mode: "average", amount: 0.2 });

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

function stamps(geometry: BrushRenderGeometry): StampsRenderGeometry {
  if (geometry.kind !== "stamps") {
    throw new Error(`Expected stamps geometry, received ${geometry.kind}.`);
  }
  return geometry;
}

function evaluate(
  brush: ResolvedBrushSnapshot,
  inputs: readonly StrokePointInput[],
  renderedScale = 1,
  id = "pencil-stroke",
): StampsRenderGeometry {
  return stamps(createBrushRenderGeometry(pointsOf(brush, inputs), brush, renderedScale, id));
}

/** Every number a painter would read, so equality here means identical pixels. */
function digest(geometry: StampsRenderGeometry): string {
  const round = (value: number): string => value.toFixed(9);
  return [
    round(geometry.alpha),
    String(geometry.markCount),
    geometry.dot === null
      ? "none"
      : `${round(geometry.dot.center.x)},${round(geometry.dot.center.y)},${round(geometry.dot.radius)}`,
    geometry.ribbons
      .map((ribbon) => `${ribbon.left.map(round).join(",")}/${ribbon.right.map(round).join(",")}`)
      .join(";"),
  ].join("|");
}

function stampDigest(stamp: BrushStamp): string {
  return [stamp.index, stamp.x, stamp.y, stamp.radius, stamp.coverage, stamp.markCount]
    .map((value) => (typeof value === "number" ? value.toFixed(9) : String(value)))
    .join(",");
}

/** Every vertex a painter would visit, in one flat list. */
function ribbonVertices(
  geometry: StampsRenderGeometry,
): readonly Readonly<{ x: number; y: number }>[] {
  const vertices: Array<Readonly<{ x: number; y: number }>> = [];
  for (const ribbon of geometry.ribbons) {
    for (const side of [ribbon.left, ribbon.right]) {
      for (let index = 0; index + 1 < side.length; index += 2) {
        vertices.push({ x: side[index] ?? 0, y: side[index + 1] ?? 0 });
      }
    }
  }
  return vertices;
}

/** One ribbon as the closed polygon the painter traces. */
function ribbonPolygon(
  ribbon: Readonly<{ left: readonly number[]; right: readonly number[] }>,
): readonly Readonly<{ x: number; y: number }>[] {
  const polygon: Array<Readonly<{ x: number; y: number }>> = [];
  for (let index = 0; index + 1 < ribbon.left.length; index += 2) {
    polygon.push({ x: ribbon.left[index] ?? 0, y: ribbon.left[index + 1] ?? 0 });
  }
  for (let index = ribbon.right.length - 2; index >= 0; index -= 2) {
    polygon.push({ x: ribbon.right[index] ?? 0, y: ribbon.right[index + 1] ?? 0 });
  }
  return polygon;
}

function containsPoint(
  polygon: readonly Readonly<{ x: number; y: number }>[],
  point: Readonly<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    previous = index;
    if (current === undefined || before === undefined) continue;
    if (current.y > point.y === before.y > point.y) continue;
    const crossing =
      ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (point.x < crossing) inside = !inside;
  }
  return inside;
}

function spacings(geometry: StampsRenderGeometry): readonly number[] {
  const values: number[] = [];
  for (let index = 1; index < geometry.stamps.length; index += 1) {
    const previous = geometry.stamps[index - 1];
    const current = geometry.stamps[index];
    if (previous === undefined || current === undefined) continue;
    values.push(Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  return values;
}

function recordingContext() {
  const calls: string[] = [];
  const stack: number[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    save: vi.fn(() => stack.push(context.globalAlpha)),
    restore: vi.fn(() => {
      context.globalAlpha = stack.pop() ?? 1;
    }),
    beginPath: vi.fn(() => calls.push("beginPath")),
    closePath: vi.fn(() => calls.push("closePath")),
    moveTo: vi.fn(() => calls.push("moveTo")),
    lineTo: vi.fn(() => calls.push("lineTo")),
    arc: vi.fn(() => calls.push("arc")),
    fill: vi.fn(() => calls.push(`fill@${context.globalAlpha.toFixed(9)}`)),
    stroke: vi.fn(() => calls.push("stroke")),
    bezierCurveTo: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { globalAlpha: number; fillStyle: string };
  return { context, calls };
}

/**
 * The advance {@link pencil}'s two-unit tip places stamps at, in page units.
 *
 * Named rather than repeated so the two tests that read it say what they are
 * checking -- that the advance is a property of the brush and the arc length,
 * not of the sample rate or the object's scale -- rather than pinning a
 * constant whose value is the strategy's business.
 */
const PAINTED_ADVANCE = 1;

describe("Pencil strategy", () => {
  it("is registered as its own durable identity and emits the stamps primitive", () => {
    const brush = pencil();
    const stroke = strokeOf(brush, curveSamples(40));
    expect(registeredBrushStrategies()).toContain("pencil@1");
    expect(stamps(createBrushRenderGeometry(stroke.points, brush, 1, stroke.id)).kind).toBe(
      "stamps",
    );
    expect(stamps(resolveStrokeRenderGeometry(stroke)).kind).toBe("stamps");
    expect(createLiveBrushEvaluator(brush, 1, stroke.id)).toBeInstanceOf(PencilEvaluator);
  });

  it("produces identical geometry for two independently built strokes", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const inputs = curveSamples(80, (progress) => 0.1 + progress * 0.8);
    const first = strokeOf(brush, inputs, "twin");
    const second = strokeOf(brush, inputs, "twin");
    expect(first).not.toBe(second);
    expect(digest(stamps(resolveStrokeRenderGeometry(first)))).toBe(
      digest(stamps(resolveStrokeRenderGeometry(second))),
    );
  });

  it("places stamps by distance rather than by sample", () => {
    // The same curve, sampled at four densities. A stamp stream driven by
    // events would quadruple; one driven by arc length must not move.
    const brush = pencil();
    const counts = [40, 80, 160, 320];
    const geometries = counts.map((count) => evaluate(brush, curveSamples(count)));
    const stampCounts = geometries.map((geometry) => geometry.stamps.length);
    const spread = Math.max(...stampCounts) - Math.min(...stampCounts);
    expect(spread).toBeLessThanOrEqual(2);
    for (const geometry of geometries) {
      const advances = spacings(geometry);
      expect(advances.length).toBeGreaterThan(50);
      // Every advance is the configured one, bar the terminal stamp that lands
      // wherever the pencil stopped. The cursor measures arc length along the
      // sampled polyline, so a stamp straddling a corner sits marginally closer
      // in a straight line than the arc it was placed along -- never further.
      for (const advance of advances.slice(0, -1)) {
        expect(advance).toBeLessThanOrEqual(PAINTED_ADVANCE + 1e-9);
        expect(advance).toBeGreaterThan(PAINTED_ADVANCE * 0.99);
      }
    }
  });

  it("keeps the painted advance constant when the object is scaled", () => {
    // Width does not scale with an object, so a scaled stroke is a longer mark
    // of the same thickness and needs proportionally more stamps.
    const brush = pencil();
    const inputs = curveSamples(120);
    const unit = evaluate(brush, inputs, 1);
    const doubled = evaluate(brush, inputs, 2);
    const half = evaluate(brush, inputs, 0.5);
    expect(doubled.stamps.length / unit.stamps.length).toBeCloseTo(2, 0);
    expect(half.stamps.length / unit.stamps.length).toBeCloseTo(0.5, 1);
    for (const [geometry, scale] of [
      [unit, 1],
      [doubled, 2],
      [half, 0.5],
    ] as const) {
      const painted = spacings(geometry)
        .slice(0, -1)
        .map((advance) => advance * scale);
      for (const advance of painted) {
        expect(advance).toBeLessThanOrEqual(PAINTED_ADVANCE + 1e-9);
        expect(advance).toBeGreaterThan(PAINTED_ADVANCE * 0.99);
      }
    }
  });

  it("lays graphite at the terminal position however the cursor happens to stand", () => {
    const brush = pencil();
    // Lengths chosen so the last advance lands short of a full step.
    for (const count of [7, 23, 24, 25, 61]) {
      const inputs = curveSamples(count);
      const geometry = evaluate(brush, inputs);
      const last = geometry.stamps.at(-1);
      const finish = inputs.at(-1);
      expect(last).toBeDefined();
      expect(finish).toBeDefined();
      if (last === undefined || finish === undefined) continue;
      expect(last.x).toBeCloseTo(finish.x, 9);
      expect(last.y).toBeCloseTo(finish.y, 9);
    }
  });

  it("marks a tap as one tip-sized dot rather than nothing", () => {
    const brush = pencil({ size: 4 });
    const geometry = evaluate(brush, [sample(120, 60, 0, 0.9)]);
    expect(geometry.stamps).toHaveLength(0);
    expect(geometry.markCount).toBe(0);
    expect(geometry.ribbons).toHaveLength(0);
    expect(geometry.dot).not.toBeNull();
    expect(geometry.dot?.center).toEqual({ x: 120, y: 60 });
    expect(geometry.dot?.radius).toBeCloseTo((4 * (0.65 + 0.6 * 0.9)) / 2, 9);
    expect(geometry.bounds.width).toBeCloseTo((geometry.dot?.radius ?? 0) * 2, 9);
  });

  it("draws a two-point stroke and a stationary drag without failing", () => {
    const brush = pencil();
    const two = evaluate(brush, [sample(10, 10, 0, 0.5), sample(24, 17, 1, 0.6)]);
    expect(two.stamps.length).toBeGreaterThan(1);
    expect(two.dot).toBeNull();

    const still = evaluate(brush, [
      sample(10, 10, 0, 0.4),
      sample(10, 10, 1, 0.6),
      sample(10, 10, 2, 0.8),
    ]);
    expect(still.stamps).toHaveLength(0);
    expect(still.dot).not.toBeNull();
  });

  it("raises coverage with pressure, and adds marks rather than moving them", () => {
    const brush = pencil();
    const light = evaluate(
      brush,
      curveSamples(120, () => 0.05),
    );
    const firm = evaluate(
      brush,
      curveSamples(120, () => 1),
    );
    expect(light.stamps.length).toBe(firm.stamps.length);
    expect(light.stamps[10]?.coverage).toBeLessThan(firm.stamps[10]?.coverage ?? 0);
    expect(firm.markCount).toBeGreaterThan(light.markCount * 1.4);

    // Monotone by construction: a lane inks when its own threshold is below
    // coverage, so pressing harder can only ever add a lane.
    let previous = 0;
    for (const pressure of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const geometry = evaluate(
        brush,
        curveSamples(120, () => pressure),
      );
      expect(geometry.markCount).toBeGreaterThanOrEqual(previous);
      previous = geometry.markCount;
    }
  });

  it("reveals more of the same paper under pressure, rather than dealing a new pattern", () => {
    // The rule E4.1 exists to make true: pressure is a threshold on one fixed
    // field, so graphite present at a lighter touch is still present at a
    // firmer one, in the same place. Width is held still for the comparison --
    // a wider tip would move the filaments and prove nothing about the field.
    const brush = pencil({ size: 9, pressureSize: OFF });
    const light = evaluate(
      brush,
      curveSamples(140, () => 0.2),
      1,
      "reveal",
    );
    const firm = evaluate(
      brush,
      curveSamples(140, () => 0.9),
      1,
      "reveal",
    );
    const lightPolygons = light.ribbons.map(ribbonPolygon);
    const firmPolygons = firm.ribbons.map(ribbonPolygon);
    const { bounds } = firm;
    let inLight = 0;
    let lost = 0;
    for (let step = 0; step < 6_000; step += 1) {
      const point = {
        x: bounds.x + ((step * 7919) % 971) * (bounds.width / 971),
        y: bounds.y + ((step * 104_729) % 89) * (bounds.height / 89),
      };
      if (!lightPolygons.some((polygon) => containsPoint(polygon, point))) continue;
      inLight += 1;
      if (!firmPolygons.some((polygon) => containsPoint(polygon, point))) lost += 1;
    }
    expect(inLight).toBeGreaterThan(200);
    expect(lost).toBe(0);
  });

  it("spreads graphite across the tip instead of settling it into lanes", () => {
    // The defect this phase was opened to fix. The tip is divided into
    // filaments, and if those divisions sat at fixed offsets they would paint
    // parallel rails down the stroke. They are carried by fields in the
    // artwork's space instead, so on a straight stroke the painted vertices
    // must *not* pile up on the nominal division grid.
    const brush = pencil({ size: 20, pressureSize: OFF });
    const inputs = Array.from({ length: 260 }, (_, index) =>
      sample(40 + index * 1.6, 120, index, 0.75),
    );
    const geometry = evaluate(brush, inputs, 1, "lanes");
    const radius = geometry.stamps[0]?.radius ?? 0;
    expect(radius).toBeCloseTo(10, 9);
    const filaments = Math.round(20 / 1.3);
    const laneWidth = (2 * radius) / filaments;
    const grid = Array.from(
      { length: filaments + 1 },
      (_, index) => 120 + ((index * 2) / filaments - 1) * radius,
    );
    const offsets = ribbonVertices(geometry)
      .map((vertex) => Math.min(...grid.map((line) => Math.abs(vertex.y - line))))
      .filter((distance) => Number.isFinite(distance));
    expect(offsets.length).toBeGreaterThan(500);
    const mean = offsets.reduce((total, value) => total + value, 0) / offsets.length;
    // Fixed divisions would put every vertex on a grid line. A quarter of a
    // filament's width away on average is a set of divisions that has moved.
    expect(mean).toBeGreaterThan(laneWidth * 0.18);
    expect(Math.max(...offsets)).toBeGreaterThan(laneWidth * 0.5);
  });

  it("keeps one grain through a change of colour or opacity", () => {
    // Neither reaches deposition: colour is the painter's, opacity is one alpha
    // over the whole stroke. A grain that moved when either changed would mean
    // the field was reading something it has no business reading.
    const base = evaluate(pencil({ size: 7 }), curveSamples(90), 1, "stable");
    for (const variant of [
      pencil({ size: 7, color: "#0b7285" }),
      pencil({ size: 7, opacity: 0.31 }),
      pencil({ size: 7, color: "#991b1b", opacity: 1 }),
    ]) {
      const other = evaluate(variant, curveSamples(90), 1, "stable");
      expect(other.markCount).toBe(base.markCount);
      expect(other.ribbons.length).toBe(base.ribbons.length);
      expect(
        other.ribbons.map((ribbon) => ribbon.left.map((value) => value.toFixed(9)).join(",")),
      ).toEqual(
        base.ribbons.map((ribbon) => ribbon.left.map((value) => value.toFixed(9)).join(",")),
      );
    }
  });

  it("builds its variation from addressed hashes and nothing else", () => {
    // Cheap to write, and it catches the one change that would quietly destroy
    // every determinism guarantee above: reaching for a clock or a global
    // generator because it was convenient in the moment.
    const sources = ["../internal/pencil.ts", "../internal/brush-random.ts"].map((relative) =>
      readFileSync(new URL(relative, import.meta.url), "utf8"),
    );
    for (const source of sources) {
      expect(source).not.toMatch(/Math\.random\s*\(/);
      expect(source).not.toMatch(/Date\.now\s*\(/);
      expect(source).not.toMatch(/performance\.now\s*\(/);
      expect(source).not.toMatch(/crypto\.\w/);
    }
  });

  it("never covers the whole tip, so even a hard press leaves paper showing", () => {
    const geometry = evaluate(
      pencil(),
      curveSamples(200, () => 1),
    );
    for (const stamp of geometry.stamps) expect(stamp.coverage).toBeLessThan(1);
    const lanes = Math.max(...geometry.stamps.map(({ markCount }) => markCount));
    expect(geometry.markCount).toBeLessThan(geometry.stamps.length * lanes);
  });

  it("widens the tip through the durable pressure-size response and nothing else", () => {
    const brush = pencil({ pressureSize: response(0.5, 2) });
    const light = evaluate(
      brush,
      curveSamples(90, () => 0),
    );
    const firm = evaluate(
      brush,
      curveSamples(90, () => 1),
    );
    expect(light.stamps[20]?.radius).toBeCloseTo((2 * 0.5) / 2, 9);
    expect(firm.stamps[20]?.radius).toBeCloseTo((2 * 2) / 2, 9);

    const fixed = evaluate(
      pencil({ pressureSize: OFF }),
      curveSamples(90, (p) => p),
    );
    for (const stamp of fixed.stamps) expect(stamp.radius).toBeCloseTo(1, 9);
  });

  it("carries base opacity exactly once, as one alpha for every fill", () => {
    for (const opacity of [0.25, 0.78, 1]) {
      const geometry = evaluate(pencil({ opacity }), curveSamples(60));
      expect(geometry.alpha).toBe(opacity);
    }
    // And the painter applies it to the inherited alpha once. Runs are painted
    // in batches, so there is more than one fill on a long stroke -- but every
    // one of them runs at the same single alpha, and the context is left as it
    // was found.
    const { context, calls } = recordingContext();
    context.globalAlpha = 0.5;
    const brush = pencil({ opacity: 0.4 });
    const geometry = evaluate(brush, curveSamples(60));
    drawBrushRenderGeometry(context, geometry, brush);
    const fills = calls.filter((entry) => entry.startsWith("fill@"));
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set([`fill@${(0.5 * 0.4).toFixed(9)}`]));
    expect(context.globalAlpha).toBe(0.5);
  });

  it("paints runs in bounded batches, one contour per run and one alpha throughout", () => {
    const { context, calls } = recordingContext();
    const brush = pencil();
    const inputs = Array.from({ length: 200 }, (_, index) =>
      sample(
        120 + Math.cos((index / 25) * Math.PI * 2) * 40,
        120 + Math.sin((index / 25) * Math.PI * 2) * 40,
        index,
        0.8,
      ),
    );
    const geometry = evaluate(brush, inputs);
    drawBrushRenderGeometry(context, geometry, brush);
    expect(geometry.markCount).toBeGreaterThan(200);
    // One contour per run, however the painter groups them, and a bounded
    // number of contours per fill -- which is what keeps the rasterizer's
    // quadratic contour resolution from ever becoming the cost of a frame.
    expect(calls.filter((entry) => entry === "closePath")).toHaveLength(geometry.ribbons.length);
    const fills = calls.filter((entry) => entry.startsWith("fill@")).length;
    expect(fills).toBeGreaterThan(0);
    expect(fills).toBeLessThanOrEqual(Math.ceil(geometry.ribbons.length / 48));
    expect(geometry.ribbons.length / fills).toBeGreaterThan(8);
  });

  it("lays runs that never overlap, so batching them cannot darken anything", () => {
    // The invariant the batching rests on, checked where it actually matters:
    // on the paper. A lane's mark is narrowed before it is moved, and a run
    // stops short of the next run in its lane, so no point of a stroke that
    // does not cross itself is covered twice.
    const brush = pencil({ size: 5, smoothing: PRESET_SMOOTHING });
    const geometry = evaluate(
      brush,
      curveSamples(90, (progress) => 0.25 + progress * 0.6),
    );
    const polygons = geometry.ribbons.map(ribbonPolygon);
    expect(polygons.length).toBeGreaterThan(10);
    const { bounds } = geometry;
    let covered = 0;
    let doubled = 0;
    for (let step = 0; step < 24_000; step += 1) {
      const point = {
        x: bounds.x + ((step * 7919) % 1000) * (bounds.width / 1000),
        y: bounds.y + ((step * 104_729) % 97) * (bounds.height / 97),
      };
      let hits = 0;
      for (const polygon of polygons) if (containsPoint(polygon, point)) hits += 1;
      if (hits > 0) covered += 1;
      if (hits > 1) doubled += 1;
    }
    expect(covered).toBeGreaterThan(100);
    expect(doubled).toBe(0);
  });

  it("tints graphite with the selected colour rather than a hardcoded grey", () => {
    const { context } = recordingContext();
    const brush = pencil({ color: "#2b6cb0" });
    const geometry = evaluate(brush, curveSamples(40));
    drawBrushRenderGeometry(context, geometry, brush);
    expect(context.fillStyle).toBe("#2b6cb0");
    // Colour is not in the geometry at all, so it cannot disagree with it.
    expect(JSON.stringify(geometry)).not.toContain("#2b6cb0");
    const grey = evaluate(pencil({ color: "#343434" }), curveSamples(40));
    expect(digest(geometry)).toBe(digest(grey));
  });

  it("gives every stroke its own grain, and the same stroke the same grain", () => {
    const brush = pencil();
    const inputs = curveSamples(100, (progress) => 0.2 + progress * 0.6);
    const first = digest(evaluate(brush, inputs, 1, "grain-a"));
    const again = digest(evaluate(brush, inputs, 1, "grain-a"));
    const other = digest(evaluate(brush, inputs, 1, "grain-b"));
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("anchors grain in the stroke's own space, so the same shape drawn twice differs", () => {
    // Grain is a property of a patch of paper, not of a position in a stream:
    // the same seed asked about a different place answers differently.
    const brush = pencil();
    const here = evaluate(brush, curveSamples(90), 1, "anchored");
    const there = evaluate(
      brush,
      curveSamples(90).map((input) => ({ ...input, x: input.x + 37.5, y: input.y + 21.5 })),
      1,
      "anchored",
    );
    expect(here.stamps.length).toBe(there.stamps.length);
    expect(here.stamps.map(({ markCount }) => markCount)).not.toEqual(
      there.stamps.map(({ markCount }) => markCount),
    );
  });

  it("keeps a stamp's grain attached to the stamp, not to its index", () => {
    const brush = pencil();
    const short = evaluate(brush, curveSamples(60).slice(0, 30), 1, "attached");
    const long = evaluate(brush, curveSamples(60), 1, "attached");
    const shared = short.stamps.length - 1;
    expect(shared).toBeGreaterThan(5);
    for (let index = 0; index < shared; index += 1) {
      const before = short.stamps[index];
      const after = long.stamps[index];
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      if (before === undefined || after === undefined) continue;
      expect(stampDigest(after)).toBe(stampDigest(before));
    }
  });

  it("holds a settled prefix byte-for-byte against hostile continuations", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const prefix = curveSamples(70, (progress) => 0.3 + progress * 0.2);
    const evaluator = new PencilEvaluator(brush, 1, brushSeed("prefix"));
    const prefixPoints = pointsOf(brush, prefix);
    evaluator.append(prefixPoints, false);
    const settled = evaluator.evaluationSnapshot().settledSegmentCount;
    expect(settled).toBeGreaterThan(50);
    const before = evaluator
      .frozenGeometry()
      .stamps.slice(0, settled)
      .map((stamp) => stampDigest(stamp));

    const continuations: Readonly<Record<string, StrokePointInput[]>> = {
      reversal: Array.from({ length: 40 }, (_, index) =>
        sample(300 - index * 6, 90 - index * 4, 70 + index, 0.9),
      ),
      "pressure slam": Array.from({ length: 40 }, (_, index) =>
        sample(300 + index * 4, 120 + index, 70 + index, index % 2 === 0 ? 0.02 : 1),
      ),
      "long jump": [sample(900, 700, 70, 0.7), sample(905, 705, 71, 0.7)],
      dense: Array.from({ length: 200 }, (_, index) =>
        sample(300 + index * 0.05, 90 + index * 0.03, 70 + index, 0.5),
      ),
      sparse: [sample(420, 300, 70, 0.4), sample(700, 60, 71, 0.8), sample(760, 400, 72, 0.2)],
    };

    for (const [name, suffix] of Object.entries(continuations)) {
      const continued = new PencilEvaluator(brush, 1, brushSeed("prefix"));
      const whole = pointsOf(brush, [...prefix, ...suffix]);
      continued.append(whole, true);
      const after = continued
        .frozenGeometry()
        .stamps.slice(0, settled)
        .map((stamp) => stampDigest(stamp));
      expect(after, `settled prefix moved under a ${name}`).toEqual(before);
    }
  });

  it("evaluates a settled sample once however the samples are delivered", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const inputs = curveSamples(240, (progress) => 0.2 + progress * 0.7);
    const points = pointsOf(brush, inputs);
    const incremental = new PencilEvaluator(brush, 1, brushSeed("bounded"));
    for (let count = 1; count <= points.length; count += 1) {
      incremental.append(points.slice(0, count), false);
    }
    incremental.append(points, true);
    const snapshot = incremental.evaluationSnapshot();
    expect(snapshot.settledPointEvaluations).toBe(points.length);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples + 1);

    const wholesale = new PencilEvaluator(brush, 1, brushSeed("bounded"));
    wholesale.append(points, true);
    expect(digest(incremental.frozenGeometry())).toBe(digest(wholesale.frozenGeometry()));
  });

  it("converges on the committed stamp stream when the last sample arrives", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const inputs = curveSamples(150, (progress) => 0.05 + progress * 0.9);
    const stroke = strokeOf(brush, inputs, "converge");
    const points = stroke.points;
    const live = new PencilEvaluator(brush, 1, brushSeed("converge"));
    for (let count = 2; count < points.length; count += 7)
      live.append(points.slice(0, count), false);
    live.append(points, true);
    expect(digest(live.frozenGeometry())).toBe(digest(stamps(resolveStrokeRenderGeometry(stroke))));
  });

  it("stays finite and bounded under noisy and out-of-range pressure", () => {
    const brush = pencil();
    const noisy = curveSamples(160).map((input, index) =>
      Object.freeze({ ...input, pressure: [0, 1, 0.5, 0.02, 0.99][index % 5] ?? 0.5 }),
    );
    const geometry = evaluate(brush, noisy);
    for (const stamp of geometry.stamps) {
      expect(Number.isFinite(stamp.radius)).toBe(true);
      expect(stamp.radius).toBeGreaterThan(0);
      expect(stamp.coverage).toBeGreaterThanOrEqual(0);
      expect(stamp.coverage).toBeLessThanOrEqual(1);
    }
    for (const vertex of ribbonVertices(geometry)) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
    }

    // The strategy is reachable directly, so a device-edge pressure the builder
    // would have refused must still resolve to something finite.
    const forged = new PencilEvaluator(brush, 1, 7);
    forged.append(
      [
        {
          ...sample(0, 0, 0),
          pressure: Number.NaN,
          delta: { x: 0, y: 0 },
          velocity: 0,
          acceleration: 0,
        },
        {
          ...sample(30, 12, 1),
          pressure: -4,
          delta: { x: 30, y: 12 },
          velocity: 0,
          acceleration: 0,
        },
        {
          ...sample(70, 40, 2),
          pressure: 9,
          delta: { x: 40, y: 28 },
          velocity: 0,
          acceleration: 0,
        },
      ] as readonly StrokePoint[],
      true,
    );
    for (const vertex of ribbonVertices(forged.frozenGeometry())) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
    }
  });

  it("bounds everything it paints, including the grain's own excursion", () => {
    const brush = pencil({ size: 6, smoothing: PRESET_SMOOTHING });
    const geometry = evaluate(
      brush,
      curveSamples(180, (progress) => 0.1 + progress * 0.85),
    );
    const { bounds } = geometry;
    expect(Number.isFinite(bounds.width)).toBe(true);
    expect(bounds.width).toBeGreaterThan(0);
    const vertices = ribbonVertices(geometry);
    expect(vertices.length).toBeGreaterThan(100);
    for (const vertex of vertices) {
      expect(vertex.x).toBeGreaterThanOrEqual(bounds.x);
      expect(vertex.x).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(vertex.y).toBeGreaterThanOrEqual(bounds.y);
      expect(vertex.y).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    // And the nominal tip too, so a bound never under-reports where coverage
    // happened to drop every lane.
    for (const stamp of geometry.stamps) {
      expect(stamp.x - stamp.radius).toBeGreaterThanOrEqual(bounds.x - 1e-9);
      expect(stamp.x + stamp.radius).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
    }
  });

  it("offers a centerline hit geometry the editor can use without knowing about grain", () => {
    const brush = pencil({ size: 5 });
    const geometry = evaluate(
      brush,
      curveSamples(120, (progress) => 0.2 + progress * 0.7),
    );
    expect(geometry.hitGeometry).toBe(geometry.stamps);
    expect(geometry.hitGeometry.length).toBe(geometry.stamps.length);
    for (const entry of geometry.hitGeometry) {
      expect(entry.radius).toBeGreaterThan(0);
      expect(Number.isFinite(entry.x)).toBe(true);
    }
    // Every painted vertex sits within a tip's reach of some hit sample, so a
    // hit test against the centerline cannot miss visible graphite by much.
    const reach = Math.max(...geometry.hitGeometry.map(({ radius }) => radius)) * 3;
    for (const vertex of ribbonVertices(geometry)) {
      const nearest = Math.min(
        ...geometry.hitGeometry.map((entry) => Math.hypot(entry.x - vertex.x, entry.y - vertex.y)),
      );
      expect(nearest).toBeLessThanOrEqual(reach);
    }
  });

  it("carries its grain through translation, rotation and scale", () => {
    const brush = pencil({ size: 3, smoothing: PRESET_SMOOTHING });
    const stroke = strokeOf(
      brush,
      curveSamples(120, (progress) => 0.3 + progress * 0.5),
      "moved",
    );
    const local = digest(stamps(resolveStrokeRenderGeometry(stroke, 1)));

    // Translation and rotation are canvas transforms: geometry is not rebuilt,
    // so the grain is carried rather than recomputed.
    for (const transform of [
      { translation: { x: 240, y: -90 }, rotation: 0, scale: 1 },
      { translation: { x: 0, y: 0 }, rotation: Math.PI / 3, scale: 1 },
      { translation: { x: 80, y: 80 }, rotation: -0.9, scale: 1 },
    ]) {
      const rendered = getStrokeRenderedBounds(stroke, transform);
      expect(Number.isFinite(rendered.width)).toBe(true);
      expect(digest(stamps(resolveStrokeRenderGeometry(stroke, 1)))).toBe(local);
    }

    // A uniform scale does rebuild, because the mark gets longer at the same
    // painted width. The grain stays the same physical size rather than
    // magnifying with the object.
    const scaled = stamps(resolveStrokeRenderGeometry(stroke, 2));
    expect(scaled.stamps.length).toBeGreaterThan(stroke.points.length / 4);
    const paintedRadii = scaled.stamps.map(({ radius }) => radius * 2);
    const unitRadii = stamps(resolveStrokeRenderGeometry(stroke, 1)).stamps.map(
      ({ radius }) => radius,
    );
    expect(Math.max(...paintedRadii)).toBeCloseTo(Math.max(...unitRadii), 6);
  });

  it("caches committed geometry by stroke identity, so Undo and Redo repaint the same grain", () => {
    const brush = pencil();
    const stroke = strokeOf(
      brush,
      curveSamples(90, (progress) => 0.2 + progress * 0.6),
      "undone",
    );
    const first = resolveStrokeRenderGeometry(stroke, 1);
    // History carries whole immutable objects, so redo restores this reference.
    expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(first);
    expect(digest(stamps(first))).toBe(
      digest(stamps(createBrushRenderGeometry(stroke.points, brush, 1, stroke.id))),
    );
  });

  it("reproduces a reopened stroke exactly from its samples, snapshot and id", () => {
    const brush = pencil({ smoothing: PRESET_SMOOTHING });
    const original = strokeOf(
      brush,
      curveSamples(140, (progress) => 0.1 + progress * 0.8),
      "saved",
    );
    // What a decode produces: a different instance carrying the same durable
    // data, and no generated stamp, mark or grain value anywhere in it.
    const reopened = new Stroke({
      id: original.id,
      timestamp: original.timestamp,
      points: original.points,
      sourceSamples: original.sourceSamples,
      style: original.style,
      brush: original.brush,
      metrics: original.metrics,
      statistics: original.statistics,
    });
    expect(reopened).not.toBe(original);
    expect(digest(stamps(resolveStrokeRenderGeometry(reopened)))).toBe(
      digest(stamps(resolveStrokeRenderGeometry(original))),
    );
  });

  it("is not built on the dead brushTextureId field", () => {
    const brush = pencil();
    const inputs = curveSamples(60);
    const plain = strokeOf(brush, inputs, "texture");
    const withTextureId = new Stroke({
      id: plain.id,
      timestamp: plain.timestamp,
      points: plain.points,
      sourceSamples: plain.sourceSamples,
      style: { ...plain.style, brushTextureId: "texture-graphite-v1" },
      brush: plain.brush,
      metrics: plain.metrics,
      statistics: plain.statistics,
    });
    expect(withTextureId.style.brushTextureId).toBe("texture-graphite-v1");
    expect(digest(stamps(resolveStrokeRenderGeometry(withTextureId)))).toBe(
      digest(stamps(resolveStrokeRenderGeometry(plain))),
    );
  });

  it("gives a mouse the brush exactly as configured, still as pencil@1", () => {
    const configured = pencil();
    const resolved = resolveBrushForPointerType(configured, "mouse");
    expect(resolved.renderer).toEqual({ version: 1, kind: "pencil" });
    expect(resolved.dynamics.pressureSize.enabled).toBe(false);
    expect(resolved.dynamics.pressureOpacity.enabled).toBe(false);

    const inputs = curveSamples(90, () => 0.5).map((input) =>
      Object.freeze({ ...input, pointerType: "mouse" as const }),
    );
    const geometry = evaluate(resolved, inputs);
    const radii = new Set(geometry.stamps.map(({ radius }) => radius.toFixed(9)));
    const coverages = new Set(geometry.stamps.map(({ coverage }) => coverage.toFixed(9)));
    // One width and one coverage: a synthetic 0.5 never lands halfway up
    // somebody's curve.
    expect(radii.size).toBe(1);
    expect(coverages.size).toBe(1);
    expect(radii.has((2 / 2).toFixed(9))).toBe(true);

    // Pen and touch keep the preset's full expression.
    for (const pointerType of ["pen", "touch"] as const) {
      expect(
        resolveBrushForPointerType(configured, pointerType).dynamics.pressureSize.enabled,
      ).toBe(true);
    }
  });

  it("refuses a rendered scale that is not a positive finite number", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new PencilEvaluator(pencil(), scale, 1)).toThrow(RangeError);
    }
  });

  it("keeps local render bounds finite and centred on the transform pivot", () => {
    const brush = pencil({ size: 4 });
    const stroke = strokeOf(
      brush,
      curveSamples(100, (progress) => progress),
      "bounded-local",
    );
    const local = getStrokeLocalRenderBounds(stroke, 1);
    const pivot = stroke.bounds.center;
    expect(Number.isFinite(local.width)).toBe(true);
    expect(local.x + local.width / 2).toBeCloseTo(pivot.x, 9);
    expect(local.y + local.height / 2).toBeCloseTo(pivot.y, 9);
  });
});
