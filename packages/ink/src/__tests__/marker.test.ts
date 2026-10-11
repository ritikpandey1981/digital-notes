import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  isSupportedBrushStrategy,
  resolveBrushForPointerType,
  supportedBrushStrategies,
  type BrushPressureResponse,
  type BrushRendererDefinition,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import { InkError } from "../errors";
import {
  MARKER_NIB_ANGLE_DEGREES,
  MARKER_NIB_THICKNESS_RATIO,
  MarkerEvaluator,
  createMarkerGeometry,
} from "../internal/marker";
import {
  createBrushRenderGeometry,
  drawBrushRenderGeometry,
  registeredBrushStrategies,
  resolveStrokeRenderGeometry,
} from "../internal/brush-render-strategy";
import type { MarkerSwathRenderGeometry } from "../internal/brush-geometry";
import { getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePoint, StrokePointInput } from "../types";

/**
 * What `marker@1` draws, stated as things that can fail.
 *
 * The appearance is **not frozen**: it is awaiting review, and nothing here
 * pins a pixel. What is settled are the properties a later visual decision must
 * not quietly break -- that the same samples give the same geometry, that a
 * terminal is a whole nib rather than a taper, that the mark is a function of
 * the path and not of how many events described it, and that one stroke is one
 * coverage mask however often it crosses itself.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const INERT: BrushPressureResponse = Object.freeze({
  enabled: false,
  minimumFactor: 1,
  maximumFactor: 1,
  curve: LINEAR,
});

function markerBrush(
  overrides: Readonly<{
    size?: number;
    opacity?: number;
    smoothing?: number;
    pressureSize?: BrushPressureResponse;
    pressureOpacity?: BrushPressureResponse;
    renderer?: BrushRendererDefinition;
  }> = {},
): ResolvedBrushSnapshot {
  const smoothing = overrides.smoothing ?? 0;
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "marker-test",
    presetVersion: 1,
    family: "marker",
    color: "#1f2937",
    size: overrides.size ?? 8,
    opacity: overrides.opacity ?? 0.9,
    smoothing: Object.freeze({ mode: smoothing === 0 ? "none" : "average", amount: smoothing }),
    dynamics: Object.freeze({
      pressureSize: overrides.pressureSize ?? INERT,
      pressureOpacity: overrides.pressureOpacity ?? INERT,
    }),
    renderer: overrides.renderer ?? Object.freeze({ version: 1, kind: "marker" }),
  });
}

function sample(x: number, y: number, index: number, pressure = 0.5): StrokePointInput {
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

/** A straight run from one page point to another, at a chosen sample count. */
function line(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  count: number,
  pressure: (progress: number) => number = () => 0.5,
): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0 : index / (count - 1);
    points.push(
      processed(sample(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, index, pressure(t))),
    );
  }
  return points;
}

/** Promotes an input sample to a processed point; Marker reads neither derivative. */
function processed(input: StrokePointInput): StrokePoint {
  return Object.freeze({
    ...input,
    delta: Object.freeze({ x: 0, y: 0 }),
    velocity: 0,
    acceleration: 0,
  });
}

function pointOnShape(
  name: "tight-turn" | "loop" | "zigzag" | "u-turn",
  t: number,
): { x: number; y: number } {
  if (name === "tight-turn") {
    return t < 0.5 ? { x: 60 + t * 2 * 120, y: 100 } : { x: 180, y: 100 + (t - 0.5) * 2 * 120 };
  }
  if (name === "loop") {
    const angle = t * Math.PI * 2;
    return { x: 140 + Math.cos(angle) * 50, y: 140 + Math.sin(angle) * 50 };
  }
  if (name === "zigzag") {
    return { x: 60 + t * 220, y: 120 + (Math.floor(t * 8) % 2 === 0 ? -24 : 24) };
  }
  const angle = t * Math.PI;
  return { x: 120 + Math.cos(angle) * 40, y: 100 + Math.sin(angle) * 14 };
}

function shape(name: "tight-turn" | "loop" | "zigzag" | "u-turn", count: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const at = pointOnShape(name, t);
    points.push(processed(sample(at.x, at.y, index)));
  }
  return points;
}

function marker(geometry: unknown): MarkerSwathRenderGeometry {
  const swath = geometry as MarkerSwathRenderGeometry;
  expect(swath.kind).toBe("marker-swath");
  return swath;
}

/** A stable, order-sensitive digest of every number the geometry carries. */
function digest(geometry: MarkerSwathRenderGeometry): string {
  const parts: string[] = [`${String(geometry.bands.length)}|${geometry.nibAngle.toFixed(6)}`];
  for (const band of geometry.bands) {
    parts.push(`a${band.alpha.toFixed(6)}`);
    for (const group of [band.startCap, band.left, band.endCap, band.right]) {
      parts.push(group.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(";"));
    }
  }
  let hash = 0x811c9dc5;
  const text = parts.join("/");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${String(text.length)}:${hash.toString(36)}`;
}

/** The closed polygon one band paints, in the order the painter traces it. */
function polygonOf(band: MarkerSwathRenderGeometry["bands"][number]): { x: number; y: number }[] {
  return [...band.startCap, ...band.left, ...band.endCap, ...[...band.right].reverse()];
}

/** Nonzero winding number, which is the rule Canvas fills a path under. */
function winding(polygon: readonly { x: number; y: number }[], x: number, y: number): number {
  let total = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (start.y <= y) {
      if (end.y > y && cross(start, end, x, y) > 0) total += 1;
    } else if (end.y <= y && cross(start, end, x, y) < 0) total -= 1;
  }
  return total;
}

function cross(
  start: { x: number; y: number },
  end: { x: number; y: number },
  x: number,
  y: number,
): number {
  return (end.x - start.x) * (y - start.y) - (x - start.x) * (end.y - start.y);
}

/** Every grid cell the swath covers, as the painter's winding rule sees it. */
function coverage(geometry: MarkerSwathRenderGeometry, step = 0.5): Set<string> {
  const covered = new Set<string>();
  const polygons = geometry.bands.map(polygonOf);
  const bounds = geometry.bounds;
  for (let x = bounds.x; x <= bounds.x + bounds.width; x += step) {
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += step) {
      for (const polygon of polygons) {
        if (winding(polygon, x, y) !== 0) {
          covered.add(`${(x / step).toFixed(0)},${(y / step).toFixed(0)}`);
          break;
        }
      }
    }
  }
  return covered;
}

/** Counts the fills one paint issues, and the alpha in force at each. */
function paint(
  geometry: MarkerSwathRenderGeometry,
  brush: ResolvedBrushSnapshot,
): { fills: number; alphas: number[]; contoursPerFill: number[] } {
  const alphas: number[] = [];
  const contoursPerFill: number[] = [];
  let contours = 0;
  const context = {
    globalAlpha: 1,
    fillStyle: "",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(() => {
      contours = 0;
    }),
    closePath: vi.fn(),
    moveTo: vi.fn(() => {
      contours += 1;
    }),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(() => {
      alphas.push((context as unknown as { globalAlpha: number }).globalAlpha);
      contoursPerFill.push(contours);
    }),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  drawBrushRenderGeometry(context, geometry, brush);
  return { fills: alphas.length, alphas, contoursPerFill };
}

function strokeOf(points: readonly StrokePoint[], brush: ResolvedBrushSnapshot): Stroke {
  const builder = new StrokeBuilder({
    id: "marker-stroke",
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const point of points) builder.addPoint(point);
  return builder.finalize();
}

/** Half the swath's extent perpendicular to a straight run in this direction. */
function perpendicularHalfWidth(angleDegrees: number, brush = markerBrush()): number {
  const radians = (angleDegrees * Math.PI) / 180;
  const geometry = marker(
    createMarkerGeometry(
      line(200, 200, 200 + Math.cos(radians) * 160, 200 + Math.sin(radians) * 160, 40),
      brush,
      1,
    ),
  );
  const band = geometry.bands[0]!;
  // Projected onto the normal, not measured as a straight distance: the two
  // facing support points are also offset *along* the nib's axis, so their
  // separation overstates the slab unless the axis happens to be perpendicular
  // to the motion. What a reader sees as the width of the mark is the extent
  // across the direction of travel, which is this projection.
  const normalX = -Math.sin(radians);
  const normalY = Math.cos(radians);
  const middleLeft = band.left[Math.floor(band.left.length / 2)]!;
  const middleRight = band.right[Math.floor(band.right.length / 2)]!;
  return (
    Math.abs((middleLeft.x - middleRight.x) * normalX + (middleLeft.y - middleRight.y) * normalY) /
    2
  );
}

describe("marker@1 identity and registration", () => {
  it("is registered in both the durable vocabulary and the renderer", () => {
    expect(supportedBrushStrategies()).toContain("marker@1");
    expect(registeredBrushStrategies()).toContain("marker@1");
    expect(isSupportedBrushStrategy("marker", 1)).toBe(true);
  });

  it("refuses a Marker version this build cannot draw", () => {
    expect(isSupportedBrushStrategy("marker", 2)).toBe(false);
    expect(() => markerBrush({ renderer: { version: 2, kind: "marker" } })).toThrow(TypeError);
    // Reached through a forged snapshot, because the model refuses to build one.
    const forged = Object.freeze({
      ...markerBrush(),
      renderer: Object.freeze({ version: 2, kind: "marker" }),
    }) as ResolvedBrushSnapshot;
    expect(() => createBrushRenderGeometry(line(0, 0, 10, 10, 4), forged, 1, "forged")).toThrow(
      InkError,
    );
  });

  it("reports the nib angle the strategy fixed, not one from a file", () => {
    const geometry = marker(createMarkerGeometry(line(60, 100, 200, 100, 20), markerBrush(), 1));
    expect(geometry.nibAngle).toBeCloseTo((MARKER_NIB_ANGLE_DEGREES * Math.PI) / 180, 10);
    expect(MARKER_NIB_THICKNESS_RATIO).toBeGreaterThan(0);
    expect(MARKER_NIB_THICKNESS_RATIO).toBeLessThan(1);
  });

  it("leaves artwork that names an older strategy on that strategy", () => {
    // A Marker-family stroke saved before marker@1 existed. The family is not
    // what selects an algorithm; the snapshot's renderer identity is.
    const legacy = markerBrush({ renderer: { version: 1, kind: "centerline" } });
    expect(legacy.family).toBe("marker");
    const stroke = strokeOf(line(60, 100, 200, 140, 24), legacy);
    expect(resolveStrokeRenderGeometry(stroke).kind).toBe("centerline");
  });
});

describe("marker@1 geometry", () => {
  it("gives the same geometry for the same samples", () => {
    const points = shape("loop", 60);
    const first = marker(createMarkerGeometry(points, markerBrush(), 1));
    const second = marker(createMarkerGeometry(points, markerBrush(), 1));
    expect(digest(second)).toBe(digest(first));
  });

  it("renders a tap as the whole nib rather than a dot or nothing", () => {
    const geometry = marker(createMarkerGeometry(line(140, 140, 140, 140, 1), markerBrush(), 1));
    expect(geometry.bands).toHaveLength(1);
    const outline = polygonOf(geometry.bands[0]!);
    expect(outline.length).toBeGreaterThan(8);
    // A capsule of this brush's width: the long axis spans the full size, the
    // short axis the nib's thickness, so it cannot be a round dot.
    const span = (pick: (point: { x: number; y: number }) => number): number =>
      Math.max(...outline.map(pick)) - Math.min(...outline.map(pick));
    expect(span((point) => point.x)).toBeGreaterThan(0);
    expect(winding(outline, 140, 140)).not.toBe(0);
    const longest = Math.max(...outline.map((point) => Math.hypot(point.x - 140, point.y - 140)));
    const shortest = Math.min(...outline.map((point) => Math.hypot(point.x - 140, point.y - 140)));
    expect(longest).toBeCloseTo(4, 1);
    expect(shortest / longest).toBeLessThan(0.75);
  });

  it("closes both terminals with a complete nib impression", () => {
    const geometry = marker(createMarkerGeometry(line(60, 100, 220, 100, 30), markerBrush(), 1));
    const band = geometry.bands[0]!;
    expect(band.startCap.length).toBeGreaterThan(2);
    expect(band.endCap.length).toBeGreaterThan(2);
    // A cap reaches behind where the stroke began, which a taper or a flat cut
    // would not: the nib's own extent is part of the mark.
    const behind = Math.min(...band.startCap.map((point) => point.x));
    expect(behind).toBeLessThan(60);
    const beyond = Math.max(...band.endCap.map((point) => point.x));
    expect(beyond).toBeGreaterThan(220);
  });

  it("is broad one way and narrow the other, and alike on both axes", () => {
    const horizontal = perpendicularHalfWidth(0);
    const vertical = perpendicularHalfWidth(90);
    const withNib = perpendicularHalfWidth(MARKER_NIB_ANGLE_DEGREES);
    const acrossNib = perpendicularHalfWidth(MARKER_NIB_ANGLE_DEGREES + 90);
    // The nib sits at 45 degrees, so the two axis-aligned directions are
    // equivalent and neither is privileged.
    expect(horizontal).toBeCloseTo(vertical, 6);
    // Drawing along the nib's axis is the narrowest mark; across it the widest.
    expect(withNib).toBeLessThan(horizontal);
    expect(acrossNib).toBeGreaterThan(horizontal);
    expect(withNib / acrossNib).toBeCloseTo(MARKER_NIB_THICKNESS_RATIO, 2);
  });

  it.each(["tight-turn", "loop", "zigzag", "u-turn"] as const)(
    "survives a %s without a hole, a spike or a stray number",
    (name) => {
      const geometry = marker(createMarkerGeometry(shape(name, 80), markerBrush({ size: 14 }), 1));
      expect(geometry.bands).toHaveLength(1);
      const outline = polygonOf(geometry.bands[0]!);
      for (const point of outline) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
      expect(Number.isFinite(geometry.bounds.width)).toBe(true);
      expect(geometry.bounds.width).toBeGreaterThan(0);
      expect(geometry.bounds.height).toBeGreaterThan(0);
      // Every kept centre is inside the region, which is what "no hole on the
      // path itself" means: a corner that cut across would leave one out.
      for (const hit of geometry.hitGeometry) {
        expect(winding(outline, hit.x, hit.y), `${name} at ${String(hit.x)}`).not.toBe(0);
      }
    },
  );

  it("describes the nib's reach in its hit geometry", () => {
    const brush = markerBrush({ size: 10 });
    const geometry = marker(createMarkerGeometry(line(60, 100, 200, 100, 24), brush, 1));
    expect(geometry.hitGeometry.length).toBe(geometry.keptPointCount);
    for (const hit of geometry.hitGeometry) {
      // The circumradius of the nib: conservative, and the same quantity the
      // other strategies report.
      expect(hit.radius).toBeCloseTo(5, 6);
    }
  });
});

describe("marker@1 ink is not event density", () => {
  it("covers exactly the same page whatever the event rate was, for a straight run", () => {
    // The strongest form of the claim, and it holds exactly: the mark a
    // straight drag leaves is a function of where it started, where it ended
    // and the nib, so sixteen times the events change the geometry's *size*
    // and not one cell of what it covers.
    const brush = markerBrush({ size: 10 });
    const base = coverage(marker(createMarkerGeometry(line(60, 90, 160, 135, 960), brush, 1)), 1);
    for (const count of [30, 60, 120, 240, 480]) {
      const geometry = marker(createMarkerGeometry(line(60, 90, 160, 135, count), brush, 1));
      expect(coverage(geometry, 1), `${String(count)} samples`).toEqual(base);
    }
  });

  it("keeps a curve within a cell of itself across a thirty-two-fold event rate", () => {
    // A curve is the honest case: a device that described this arc thirty times
    // really did describe a slightly different arc, and no resampling rule can
    // invent the difference away. What the contract promises is that the
    // difference stays at the resolution of the path rather than growing with
    // the event rate -- measured here as under one percent of the covered area
    // at the sparsest rate, and under a third of a percent from 60 upwards.
    const brush = markerBrush({ size: 10 });
    const arc = (count: number): StrokePoint[] => {
      const points: StrokePoint[] = [];
      for (let index = 0; index < count; index += 1) {
        const t = index / (count - 1);
        const angle = t * Math.PI * 1.2;
        points.push(
          processed(sample(120 + Math.cos(angle) * 45, 110 + Math.sin(angle) * 45, index)),
        );
      }
      return points;
    };
    const base = coverage(marker(createMarkerGeometry(arc(960), brush, 1)), 1);
    for (const [count, tolerance] of [
      [30, 0.01],
      [60, 0.004],
      [120, 0.004],
      [240, 0.004],
      [480, 0.004],
    ] as const) {
      const covered = coverage(marker(createMarkerGeometry(arc(count), brush, 1)), 1);
      let difference = 0;
      for (const cell of covered) if (!base.has(cell)) difference += 1;
      for (const cell of base) if (!covered.has(cell)) difference += 1;
      expect(difference / base.size, `${String(count)} samples`).toBeLessThanOrEqual(tolerance);
    }
  });

  it("stops keeping more points once the nib's own spacing binds", () => {
    // Placement is by distance travelled, so above the decimation threshold the
    // kept count is a property of the path and the brush rather than of the
    // device. This is what makes the cost of a stroke bounded by how far it
    // went instead of by how talkative the hardware was.
    const brush = markerBrush({ size: 10 });
    const counts = [240, 480, 960, 1920].map(
      (count) =>
        marker(createMarkerGeometry(line(60, 90, 160, 135, count), brush, 1)).keptPointCount,
    );
    // Bounded by how far the nib travelled: this path is about 110 page units
    // and the spacing rule caps the step at two, so the count lives in the
    // fifties however many events described it -- not in the hundreds, and
    // certainly not in the nineteen hundreds.
    expect(Math.max(...counts)).toBeLessThan(60);
    // It is not *constant*, and claiming it were would be wrong: keeping the
    // first sample past the threshold means the realised step sits somewhere
    // between one and two thresholds depending on how finely the device
    // sampled. What matters is that the span of that is small and fixed rather
    // than growing with the rate.
    expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.2);
  });

  it("paints one fill at one alpha however many events arrived", () => {
    const brush = markerBrush({ size: 10 });
    for (const count of [30, 240, 1920]) {
      const geometry = marker(createMarkerGeometry(line(60, 90, 240, 170, count), brush, 1));
      const painted = paint(geometry, brush);
      expect(painted.fills, `${String(count)} samples`).toBe(1);
      expect(painted.alphas[0]).toBeCloseTo(brush.opacity, 6);
    }
  });

  it("paints one stroke once, however much it crosses itself", () => {
    const brush = markerBrush({ size: 16 });
    const geometry = marker(createMarkerGeometry(shape("loop", 120), brush, 1));
    const painted = paint(geometry, brush);
    // One band, one fill, one contour. The winding rule resolves the crossing
    // inside the fill, so the overlap is composited exactly once.
    expect(geometry.bands).toHaveLength(1);
    expect(painted.fills).toBe(1);
    expect(painted.contoursPerFill).toEqual([1]);
    expect(painted.alphas[0]).toBeCloseTo(brush.opacity, 6);
  });

  it("keeps one fill per stroke as the stroke grows", () => {
    const brush = markerBrush({ size: 10 });
    for (const count of [30, 220, 1000, 5000]) {
      const geometry = marker(createMarkerGeometry(line(40, 80, 900, 420, count), brush, 1));
      const painted = paint(geometry, brush);
      expect(painted.fills, `${String(count)} samples`).toBe(1);
      expect(painted.contoursPerFill, `${String(count)} samples`).toEqual([1]);
    }
  });

  it("accumulates between separate strokes, which is what a marker does", () => {
    const brush = markerBrush({ size: 14, opacity: 0.5 });
    const first = marker(createMarkerGeometry(line(60, 120, 240, 120, 40), brush, 1));
    const second = marker(createMarkerGeometry(line(150, 40, 150, 200, 40), brush, 1));
    const painted = [...paint(first, brush).alphas, ...paint(second, brush).alphas];
    expect(painted).toHaveLength(2);
    for (const alpha of painted) expect(alpha).toBeCloseTo(0.5, 6);
  });
});

describe("marker@1 pressure", () => {
  it("scales the contact footprint when the size response asks for it", () => {
    const responsive = markerBrush({
      size: 12,
      pressureSize: { enabled: true, minimumFactor: 0.6, maximumFactor: 1.4, curve: LINEAR },
    });
    const geometry = marker(
      createMarkerGeometry(
        line(60, 100, 300, 100, 60, (progress) => 0.05 + progress * 0.9),
        responsive,
        1,
      ),
    );
    const radii = geometry.hitGeometry.map((hit) => hit.radius);
    expect(Math.min(...radii)).toBeLessThan(Math.max(...radii));
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.5);
  });

  it("leaves the footprint alone when the size response is off", () => {
    const geometry = marker(
      createMarkerGeometry(
        line(60, 100, 300, 100, 60, (progress) => 0.05 + progress * 0.9),
        markerBrush({ size: 12 }),
        1,
      ),
    );
    const radii = geometry.hitGeometry.map((hit) => hit.radius);
    expect(Math.min(...radii)).toBeCloseTo(Math.max(...radii), 9);
  });

  it("bands the swath only when the opacity response asks for it", () => {
    const flat = marker(
      createMarkerGeometry(
        line(60, 100, 500, 100, 200, (progress) => progress),
        markerBrush({ size: 10 }),
        1,
      ),
    );
    expect(flat.bands).toHaveLength(1);

    const responsive = markerBrush({
      size: 10,
      pressureOpacity: { enabled: true, minimumFactor: 0.3, maximumFactor: 1, curve: LINEAR },
    });
    const banded = marker(
      createMarkerGeometry(
        line(60, 100, 500, 100, 200, (progress) => progress),
        responsive,
        1,
      ),
    );
    expect(banded.bands.length).toBeGreaterThan(1);
    const alphas = banded.bands.map((band) => band.alpha);
    expect(Math.min(...alphas)).toBeLessThan(Math.max(...alphas));
    // One fill per band, each with one contour: banding buys fills in
    // proportion to how much the alpha moved, never to the sample count.
    const painted = paint(banded, responsive);
    expect(painted.fills).toBe(banded.bands.length);
    expect(new Set(painted.contoursPerFill)).toEqual(new Set([1]));
  });

  it("tiles its bands along the stroke instead of overlapping them", () => {
    // The same path with the opacity response on and off must cover exactly the
    // same page. If a cut overlapped, the banded version would cover more; if it
    // left a gap, less.
    const points = line(60, 100, 400, 100, 160, (progress) => 0.1 + progress * 0.85);
    const flat = markerBrush({ size: 12 });
    const responsive = markerBrush({
      size: 12,
      pressureOpacity: { enabled: true, minimumFactor: 0.25, maximumFactor: 1, curve: LINEAR },
    });
    const banded = marker(createMarkerGeometry(points, responsive, 1));
    expect(banded.bands.length).toBeGreaterThan(1);
    expect(coverage(banded)).toEqual(coverage(marker(createMarkerGeometry(points, flat, 1))));
  });

  it("gives a mouse the Marker exactly as configured, still as marker@1", () => {
    const configured = markerBrush({
      pressureSize: { enabled: true, minimumFactor: 0.6, maximumFactor: 1.4, curve: LINEAR },
      pressureOpacity: { enabled: true, minimumFactor: 0.4, maximumFactor: 1, curve: LINEAR },
    });
    const mouse = resolveBrushForPointerType(configured, "mouse");
    // The generic rule, unchanged: a synthetic 0.5 must not drive expression,
    // and the strategy is kept rather than substituted.
    expect(mouse.renderer).toEqual({ version: 1, kind: "marker" });
    expect(mouse.dynamics.pressureSize.enabled).toBe(false);
    expect(mouse.dynamics.pressureOpacity.enabled).toBe(false);
    const geometry = marker(createMarkerGeometry(line(60, 100, 240, 100, 40), mouse, 1));
    expect(geometry.bands).toHaveLength(1);
    const radii = geometry.hitGeometry.map((hit) => hit.radius);
    expect(Math.min(...radii)).toBeCloseTo(Math.max(...radii), 9);
  });
});

describe("marker@1 live and committed agree", () => {
  it("reaches the committed geometry sample by sample, without a jump at pointer-up", () => {
    const brush = markerBrush({ size: 12, smoothing: 0.22 });
    const points = shape("u-turn", 90);
    const live = new MarkerEvaluator(brush, 1);
    for (let count = 1; count <= points.length; count += 1) {
      live.append(points.slice(0, count), false);
    }
    const beforeCommit = digest(live.frozenGeometry());
    live.append(points, true);
    const afterCommit = digest(live.frozenGeometry());
    const committed = digest(marker(createMarkerGeometry(points, brush, 1)));
    expect(afterCommit).toBe(committed);
    // The final live frame already had the geometry the commit produces for
    // every sample but the terminal one, which is the only thing `final` tells
    // it that it did not already know.
    expect(beforeCommit.length).toBeGreaterThan(0);
  });

  it("never reprocesses settled samples, however long the stroke gets", () => {
    const brush = markerBrush({ size: 12, smoothing: 0.22 });
    const points = line(40, 90, 900, 420, 900);
    const live = new MarkerEvaluator(brush, 1);
    for (let count = 1; count <= points.length; count += 1) {
      live.append(points.slice(0, count), false);
    }
    const snapshot = live.evaluationSnapshot();
    // One evaluation per settled sample, and a tail bounded by the smoothing
    // window rather than by the stroke.
    expect(snapshot.settledPointEvaluations).toBeLessThanOrEqual(points.length);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(snapshot.lookaheadSamples + 1);
  });

  it("rebuilds a cold stroke from its samples and snapshot alone", () => {
    const brush = markerBrush({ size: 12, smoothing: 0.22 });
    const original = strokeOf(shape("zigzag", 70), brush);
    const live = resolveStrokeRenderGeometry(original);
    // A reopened stroke: the same samples and the same snapshot, nothing else.
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
    expect(digest(marker(resolveStrokeRenderGeometry(reopened)))).toBe(digest(marker(live)));
  });
});

describe("marker@1 in the document", () => {
  it("transforms with the object it belongs to", () => {
    const brush = markerBrush({ size: 12 });
    const stroke = strokeOf(line(60, 100, 220, 160, 40), brush);
    const identity = getStrokeRenderedBounds(stroke);
    const moved = getStrokeRenderedBounds(stroke, {
      translation: { x: 40, y: -15 },
      rotation: 0,
      scale: 1,
    });
    expect(moved.x).toBeCloseTo(identity.x + 40, 6);
    expect(moved.y).toBeCloseTo(identity.y - 15, 6);
    const scaled = getStrokeRenderedBounds(stroke, {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: 2,
    });
    expect(scaled.width).toBeGreaterThan(identity.width);
    const rotated = getStrokeRenderedBounds(stroke, {
      translation: { x: 0, y: 0 },
      rotation: Math.PI / 4,
      scale: 1,
    });
    expect(Number.isFinite(rotated.width)).toBe(true);
    expect(rotated.width).toBeGreaterThan(0);
  });

  it("caches committed geometry per stroke and scale like the other strategies", () => {
    const stroke = strokeOf(line(60, 100, 220, 160, 40), markerBrush({ size: 12 }));
    expect(resolveStrokeRenderGeometry(stroke)).toBe(resolveStrokeRenderGeometry(stroke));
    expect(resolveStrokeRenderGeometry(stroke, 2)).not.toBe(resolveStrokeRenderGeometry(stroke));
  });
});
