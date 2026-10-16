import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  resolveBrushForPointerType,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  MARKER_NIB_ANGLE_DEGREES,
  MARKER_NIB_THICKNESS_RATIO,
  MarkerEvaluator,
  createMarkerGeometry,
} from "../internal/marker";
import {
  drawBrushRenderGeometry,
  resolveStrokeRenderGeometry,
} from "../internal/brush-render-strategy";
import { getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import type { MarkerSwathRenderGeometry } from "../internal/brush-geometry";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePoint } from "../types";

/**
 * `marker@1` draws the marks it draws today, for ever.
 *
 * The appearance has been looked at and approved, so what the nib leaves on the
 * page is artwork's business now rather than the engine's. What is still open
 * is everything underneath -- how the swath is evaluated, how placement is
 * decided, what is cached, how it is painted. This file is what makes changing
 * any of that safe: it pins the *result*, so a refactor that moves a boundary
 * point fails here and nowhere subtler.
 *
 * It does not duplicate [`marker.test.ts`](marker.test.ts). That suite says
 * *why* the mark is right -- a tap is a whole nib rather than a dot, a terminal
 * reaches past where the hand stopped, the mark is a function of the path and
 * not of how many events described it, one stroke is one coverage mask. Those
 * are the gate on whether a *proposed* appearance is acceptable, and they would
 * every one of them still pass if a change moved the whole swath by a tenth of
 * a unit. What this file adds is the only thing they cannot give: the absolute
 * value.
 *
 * Three deliberate choices about how it is built.
 *
 * **The brush is the shipped one, transcribed.** `marker-felt` at twelve page
 * units, 0.9 opacity, 0.22 average smoothing, both pressure responses off --
 * the configuration a person actually approved, written out here rather than
 * imported, because a fixture another suite can edit for its own reasons is a
 * way for this gate to report that Marker changed when it did not.
 *
 * **Shapes, not a cross-product.** Thirteen marks, each present because it can
 * fail differently: the terminals, the four directions the fixed nib treats
 * differently, the turns where a swept boundary would fold, and the two
 * crossing cases that must not darken. More sizes would not find more bugs.
 *
 * **Numbers where a digest would hide the point.** The nib's proportions, the
 * reach of a cap and the extent of a tap are asserted as quantities as well as
 * folded into digests, so a failure says *what* moved rather than only that
 * something did.
 */

/** Compact, order-sensitive digest, the convention the other freeze gates use. */
function hash(value: string): string {
  let accumulator = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x0100_0193);
  }
  return (accumulator >>> 0).toString(36);
}

/** Every number a painter would read off the swath, in the order it reads them. */
function digest(geometry: MarkerSwathRenderGeometry): string {
  const parts: string[] = [`${String(geometry.bands.length)}|${geometry.nibAngle.toFixed(6)}`];
  for (const band of geometry.bands) {
    parts.push(`a${band.alpha.toFixed(6)}`);
    for (const group of [band.startCap, band.left, band.endCap, band.right]) {
      parts.push(group.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(";"));
    }
  }
  const text = parts.join("/");
  return `${String(text.length)}:${hash(text)}`;
}

const INERT = Object.freeze({
  enabled: false,
  minimumFactor: 1,
  maximumFactor: 1,
  curve: Object.freeze({ kind: "linear" as const, exponent: 1 }),
});

/**
 * The shipped `marker-felt`, transcribed.
 *
 * Size is the only parameter varied across the frozen set, because it is the
 * one a person chooses. Everything else is what the Marker slot resolves by
 * default, so what is pinned here is the appearance that was approved rather
 * than a configuration nobody draws with.
 */
function frozenBrush(size: number): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "marker-felt",
    presetVersion: 1,
    family: "marker",
    color: "#1f2937",
    size,
    opacity: 0.9,
    smoothing: Object.freeze({ mode: "average", amount: 0.22 }),
    dynamics: Object.freeze({ pressureSize: INERT, pressureOpacity: INERT }),
    renderer: Object.freeze({ version: 1, kind: "marker" }),
  });
}

function point(x: number, y: number, index: number, pressure = 0.5): StrokePoint {
  return Object.freeze({
    x,
    y,
    timestamp: index * 8,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen" as const,
    button: 0,
    buttons: 1,
    delta: Object.freeze({ x: 0, y: 0 }),
    velocity: 0,
    acceleration: 0,
  });
}

function path(
  at: (progress: number) => { x: number; y: number },
  count: number,
  pressure = 0.5,
): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / (count - 1);
    const where = at(progress);
    points.push(point(where.x, where.y, index, pressure));
  }
  return points;
}

const HORIZONTAL = (): StrokePoint[] => path((t) => ({ x: 60 + t * 200, y: 100 }), 60);

/** The thirteen marks, each one able to fail in a way the others cannot. */
const SHAPES: readonly (readonly [string, number, () => StrokePoint[]])[] = Object.freeze([
  ["tap", 12, () => path(() => ({ x: 100, y: 100 }), 1)],
  ["short", 12, () => path((t) => ({ x: 60 + t * 40, y: 100 }), 12)],
  ["long", 12, () => path((t) => ({ x: 60 + t * 600, y: 120 }), 200)],
  ["horizontal", 12, HORIZONTAL],
  ["vertical", 12, () => path((t) => ({ x: 100, y: 60 + t * 200 }), 60)],
  ["along-nib", 12, () => path((t) => ({ x: 60 + t * 160, y: 60 + t * 160 }), 60)],
  ["across-nib", 12, () => path((t) => ({ x: 60 + t * 160, y: 220 - t * 160 }), 60)],
  ["curve", 12, () => path((t) => ({ x: 60 + t * 200, y: 140 - Math.sin(t * Math.PI) * 60 }), 80)],
  [
    "corner",
    12,
    () =>
      path(
        (t) =>
          t < 0.5 ? { x: 60 + t * 2 * 120, y: 100 } : { x: 180, y: 100 + (t - 0.5) * 2 * 120 },
        80,
      ),
  ],
  [
    "loop",
    12,
    () =>
      path((t) => {
        const angle = t * Math.PI * 2;
        return { x: 140 + Math.cos(angle) * 50, y: 140 + Math.sin(angle) * 50 };
      }, 120),
  ],
  [
    "self-crossing",
    12,
    () =>
      path((t) => {
        const angle = t * Math.PI * 2.4;
        return { x: 140 + Math.cos(angle) * 55, y: 140 + Math.sin(angle * 2) * 45 };
      }, 140),
  ],
  [
    "retrace",
    12,
    () => path((t) => ({ x: 60 + (t < 0.5 ? t * 2 : (1 - t) * 2) * 180, y: 100 }), 120),
  ],
  [
    "broad",
    26,
    () => path((t) => ({ x: 60 + t * 320, y: 140 + Math.sin(t * Math.PI * 1.5) * 40 }), 160),
  ],
]);

function swath(geometry: unknown): MarkerSwathRenderGeometry {
  const marker = geometry as MarkerSwathRenderGeometry;
  expect(marker.kind).toBe("marker-swath");
  return marker;
}

function geometryOf(points: readonly StrokePoint[], size = 12, scale = 1) {
  return swath(createMarkerGeometry(points, frozenBrush(size), scale));
}

function strokeOf(points: readonly StrokePoint[], size = 12): Stroke {
  const builder = new StrokeBuilder({
    id: "frozen-marker",
    timestamp: 0,
    brush: frozenBrush(size),
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const sample of points) builder.addPoint(sample);
  return builder.finalize();
}

/** The closed polygon one band paints, in the order the painter traces it. */
function polygonOf(band: MarkerSwathRenderGeometry["bands"][number]): { x: number; y: number }[] {
  return [...band.startCap, ...band.left, ...band.endCap, ...[...band.right].reverse()];
}

function cross(
  start: { x: number; y: number },
  end: { x: number; y: number },
  x: number,
  y: number,
): number {
  return (end.x - start.x) * (y - start.y) - (x - start.x) * (end.y - start.y);
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

/** Half the swath's extent perpendicular to a straight run in this direction. */
function perpendicularHalfWidth(degrees: number): number {
  const radians = (degrees * Math.PI) / 180;
  const geometry = geometryOf(
    path(
      (t) => ({
        x: 200 + Math.cos(radians) * 160 * t,
        y: 200 + Math.sin(radians) * 160 * t,
      }),
      40,
    ),
  );
  const band = geometry.bands[0]!;
  const normalX = -Math.sin(radians);
  const normalY = Math.cos(radians);
  const left = band.left[Math.floor(band.left.length / 2)]!;
  const right = band.right[Math.floor(band.right.length / 2)]!;
  return Math.abs((left.x - right.x) * normalX + (left.y - right.y) * normalY) / 2;
}

describe("the frozen marker@1 appearance", () => {
  it("leaves the same mark for every representative shape", () => {
    const digests = SHAPES.map(
      ([name, size, build]) => `${name}:${digest(geometryOf(build(), size))}`,
    );
    // Approved on inspection sheets drawn by the production renderer through
    // the real slot, preset and input path. A change here is a change to
    // somebody's artwork, so it needs a person and a new strategy version, not
    // a new expectation.
    expect(digests).toEqual([
      "tap:585:wvvz4y",
      "short:1322:13glrrr",
      "long:14889:1jaagep",
      "horizontal:4681:wcjjtl",
      "vertical:4680:17vrdmu",
      "along-nib:4726:cl0wst",
      "across-nib:4726:48peyx",
      "curve:6071:1db120r",
      "corner:6370:1pmwt6n",
      "loop:9011:20gj7d",
      "self-crossing:11217:1lj7wsk",
      "retrace:9285:nk5cez",
      "broad:11929:28h25q",
    ]);
  });

  it("leaves the same mark at the scales a resized object is drawn at", () => {
    // Geometry is rebuilt per rendered scale rather than drawn once and
    // stretched, so a resized object is its own frozen output.
    const digests = [0.5, 2.5].map(
      (scale) => `${String(scale)}:${digest(geometryOf(HORIZONTAL(), 12, scale))}`,
    );
    expect(digests).toEqual(["0.5:4681:11sfm19", "2.5:4681:q6wa17"]);
  });
});

describe("the frozen marker@1 nib", () => {
  it("holds its orientation in page space, at the angle the strategy fixed", () => {
    expect(MARKER_NIB_ANGLE_DEGREES).toBe(45);
    const radians = (45 * Math.PI) / 180;
    // Every shape reports the same angle, because the nib does not follow the
    // tangent: a corner is two slabs meeting rather than a rotating brush.
    for (const [name, size, build] of SHAPES) {
      expect(geometryOf(build(), size).nibAngle, name).toBeCloseTo(radians, 12);
    }
  });

  it("keeps the capsule's proportions, measured across the directions it is drawn in", () => {
    expect(MARKER_NIB_THICKNESS_RATIO).toBe(0.42);
    // Twelve page units across the nib, 0.42 of that along it, and the two
    // axis-aligned directions alike so neither is privileged. These are the
    // numbers behind the character; a digest would hide which one moved.
    expect(perpendicularHalfWidth(0) * 2).toBeCloseTo(9.961463, 6);
    expect(perpendicularHalfWidth(90) * 2).toBeCloseTo(9.961463, 6);
    expect(perpendicularHalfWidth(45) * 2).toBeCloseTo(5.04, 6);
    expect(perpendicularHalfWidth(135) * 2).toBeCloseTo(12, 6);
    expect(perpendicularHalfWidth(45) / perpendicularHalfWidth(135)).toBeCloseTo(0.42, 12);
  });

  it("presses a whole nib for a tap", () => {
    const geometry = geometryOf(path(() => ({ x: 100, y: 100 }), 1));
    expect(geometry.bands).toHaveLength(1);
    const outline = polygonOf(geometry.bands[0]!);
    expect(outline).toHaveLength(33);
    const reach = outline.map((p) => Math.hypot(p.x - 100, p.y - 100));
    // Six out to the ends of the capsule, 4.2966 across its waist: an angled
    // impression, not a disc and not a dot.
    expect(Math.max(...reach)).toBeCloseTo(6, 6);
    expect(Math.min(...reach)).toBeCloseTo(4.296603, 6);
    expect(winding(outline, 100, 100)).not.toBe(0);
  });

  it("closes both terminals with the nib's own reach", () => {
    const geometry = geometryOf(HORIZONTAL());
    const band = geometry.bands[0]!;
    expect(band.startCap).toHaveLength(17);
    expect(band.endCap).toHaveLength(17);
    // The stroke was drawn from x=60 to x=260 and the mark runs from 55.0193
    // to 264.9807: the nib's half-extent in this direction, behind where the
    // hand started and beyond where it stopped. A taper or a flat cut would
    // land on the endpoints instead.
    expect(Math.min(...band.startCap.map((p) => p.x))).toBeCloseTo(55.019268, 6);
    expect(Math.max(...band.endCap.map((p) => p.x))).toBeCloseTo(264.980732, 6);
  });

  it("describes the nib's reach in its hit geometry, one sample per placement", () => {
    const geometry = geometryOf(HORIZONTAL());
    expect(geometry.sourcePointCount).toBe(60);
    expect(geometry.keptPointCount).toBe(60);
    expect(geometry.hitGeometry).toHaveLength(60);
    for (const hit of geometry.hitGeometry) expect(hit.radius).toBeCloseTo(6, 12);
  });
});

describe("the frozen marker@1 ink", () => {
  it("is a function of the path and not of how many events described it", () => {
    const straight = (count: number): StrokePoint[] =>
      path((t) => ({ x: 60 + t * 200, y: 100 + t * 90 }), count);
    const base = coverage(geometryOf(straight(960)), 1);
    for (const count of [30, 60, 240, 480]) {
      expect(coverage(geometryOf(straight(count)), 1), `${String(count)} samples`).toEqual(base);
    }
  });

  it("covers the page once however much the stroke crossed itself", () => {
    for (const name of ["loop", "self-crossing", "retrace"] as const) {
      const shape = SHAPES.find(([candidate]) => candidate === name)!;
      const geometry = geometryOf(shape[2](), shape[1]);
      const painted = paint(geometry, frozenBrush(shape[1]));
      // One band, one fill, one contour. The winding rule resolves every
      // crossing inside the fill, so nothing a stroke does to itself can
      // deposit twice.
      expect(geometry.bands, name).toHaveLength(1);
      expect(painted.fills, name).toBe(1);
      expect(painted.contoursPerFill, name).toEqual([1]);
      expect(painted.alphas[0], name).toBeCloseTo(0.9, 12);
    }
  });

  it("leaves a retrace adding no ink the one-way run had not already laid", () => {
    // Out and back along the same line, in one stroke. The claim is the strong
    // one and it holds exactly: **not one cell** of the retrace falls outside
    // what the one-way run covered. Going back over your own line adds nothing,
    // anywhere.
    //
    // It is not the same *set*, and the eleven or so cells it falls short by
    // are the sampled path's own doing rather than the brush's: a hundred and
    // twenty samples mirrored about the halfway point never place one at the
    // turnaround itself, so this path tops out at 238.49 rather than 240. The
    // containment is what the semantic is, and the ratio below is here so the
    // test cannot pass by covering almost nothing.
    const out = coverage(geometryOf(path((t) => ({ x: 60 + t * 180, y: 100 }), 60)), 1);
    const back = coverage(
      geometryOf(path((t) => ({ x: 60 + (t < 0.5 ? t * 2 : (1 - t) * 2) * 180, y: 100 }), 120)),
      1,
    );
    const outside = [...back].filter((cell) => !out.has(cell));
    expect(outside).toEqual([]);
    expect(back.size / out.size).toBeGreaterThan(0.98);
  });

  it("accumulates between separate strokes, which is what a marker does", () => {
    const first = geometryOf(path((t) => ({ x: 60 + t * 180, y: 120 }), 40));
    const second = geometryOf(path((t) => ({ x: 150, y: 40 + t * 160 }), 40));
    const alphas = [
      ...paint(first, frozenBrush(12)).alphas,
      ...paint(second, frozenBrush(12)).alphas,
    ];
    // Two fills at the preset's own opacity: where they cross, the page takes
    // the second coat over the first the way any two marks do.
    expect(alphas).toHaveLength(2);
    for (const alpha of alphas) expect(alpha).toBeCloseTo(0.9, 12);
  });
});

describe("the frozen marker@1 output is reached by every path to it", () => {
  const FROZEN_HORIZONTAL = "4681:wcjjtl";

  it("is what a committed stroke resolves to", () => {
    expect(digest(swath(resolveStrokeRenderGeometry(strokeOf(HORIZONTAL()))))).toBe(
      FROZEN_HORIZONTAL,
    );
  });

  it("is what the live evaluator arrives at, sample by sample", () => {
    const live = new MarkerEvaluator(frozenBrush(12), 1);
    const points = HORIZONTAL();
    for (let count = 1; count <= points.length; count += 1)
      live.append(points.slice(0, count), false);
    live.append(points, true);
    expect(digest(swath(live.frozenGeometry()))).toBe(FROZEN_HORIZONTAL);
  });

  it("is what a reopened file rebuilds from samples and snapshot alone", () => {
    const original = strokeOf(HORIZONTAL());
    const reopened = new Stroke({
      id: original.id,
      timestamp: original.timestamp,
      points: original.points.map((sample) => ({ ...sample })),
      sourceSamples: original.sourceSamples.map((sample) => ({ ...sample })),
      style: { ...original.style },
      brush: createResolvedBrushSnapshot(original.brush),
      metrics: original.metrics,
      statistics: { ...original.statistics },
    });
    expect(digest(swath(resolveStrokeRenderGeometry(reopened)))).toBe(FROZEN_HORIZONTAL);
  });

  it("is what every pressure and both pointer types produce for this preset", () => {
    // `marker-felt` resolves neither response, so a pen pressed lightly and a
    // pen pressed hard leave the same mark, and so does a mouse. Deliberate:
    // what varies on a marker is which way it was drawn.
    for (const pressure of [0.15, 0.5, 0.95]) {
      const geometry = geometryOf(path((t) => ({ x: 60 + t * 200, y: 100 }), 60, pressure));
      expect(digest(geometry), `pen at ${String(pressure)}`).toBe(FROZEN_HORIZONTAL);
    }
    const mouse = resolveBrushForPointerType(frozenBrush(12), "mouse");
    expect(digest(swath(createMarkerGeometry(HORIZONTAL(), mouse, 1)))).toBe(FROZEN_HORIZONTAL);
  });

  it("travels with the object it belongs to", () => {
    const stroke = strokeOf(HORIZONTAL());
    const identity = getStrokeRenderedBounds(stroke);
    const moved = getStrokeRenderedBounds(stroke, {
      translation: { x: 40, y: -15 },
      rotation: 0,
      scale: 1,
    });
    expect(moved.x).toBeCloseTo(identity.x + 40, 9);
    expect(moved.y).toBeCloseTo(identity.y - 15, 9);
    expect(moved.width).toBeCloseTo(identity.width, 9);
    const rotated = getStrokeRenderedBounds(stroke, {
      translation: { x: 0, y: 0 },
      rotation: Math.PI / 4,
      scale: 1,
    });
    expect(Number.isFinite(rotated.width)).toBe(true);
    expect(rotated.width).toBeGreaterThan(0);
  });
});
