import { describe, expect, it } from "vitest";
import {
  createProfessionalInkPath,
  filterAdaptiveStrokePoints,
  type ProfessionalInkPath,
  type ProfessionalInkSegment,
} from "../internal/professional-ink-path";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePoint, StrokePointInput } from "../types";

describe("professional finalized ink paths", () => {
  it("fits redundant jitter with far fewer error-bounded curves without moving endpoints", () => {
    const source = createPoints(
      Array.from({ length: 401 }, (_, index) => [index * 0.2, Math.sin(index * 0.8) * 0.04]),
      1,
    );

    const path = createProfessionalInkPath(source);

    expect(path.points.length).toBeLessThan(source.length * 0.8);
    expect(path.segments.length).toBeLessThan(path.points.length / 10);
    expect(path.points[0]).toBe(source[0]);
    expect(path.points.at(-1)).toBe(source.at(-1));
    expect(path.segments[0]?.start).toBe(source[0]);
    expect(path.segments.at(-1)?.end).toBe(source.at(-1));
    expect(maximumApproximateError(path)).toBeLessThan(1);
    expect(Object.isFrozen(path)).toBe(true);
    expect(Object.isFrozen(path.points)).toBe(true);
    expect(path.segments.every(Object.isFrozen)).toBe(true);
  });

  it("samples slow motion more precisely than the same fast motion", () => {
    const geometry = Array.from({ length: 200 }, (_, index) => [index * 0.4, 0]);
    const slow = filterAdaptiveStrokePoints(createPoints(geometry, 30));
    const fast = filterAdaptiveStrokePoints(createPoints(geometry, 1));

    expect(slow.length).toBeGreaterThan(fast.length);
    expect(slow.length).toBeGreaterThan(150);
    expect(fast.length).toBeLessThan(150);
  });

  it("preserves sharp handwriting corners as explicit curve boundaries", () => {
    const geometry = [
      ...lineSamples([0, 20], [20, 0], 40, false),
      ...lineSamples([20, 0], [40, 20], 40, true),
    ];
    const source = createPoints(geometry, 4);
    const corner = source[40];
    const path = createProfessionalInkPath(source);
    const incomingIndex = path.segments.findIndex(({ end }) => end === corner);

    expect(corner).toBeDefined();
    expect(path.points).toContain(corner);
    expect(incomingIndex).toBeGreaterThanOrEqual(0);
    expect(path.segments[incomingIndex + 1]?.start).toBe(corner);
    expect(path.segments[0]?.start).toBe(source[0]);
    expect(path.segments.at(-1)?.end).toBe(source.at(-1));
  });

  it("retains the defining corners of small W-shaped handwriting", () => {
    const vertices = [
      [0, 0],
      [4, 12],
      [8, 3],
      [12, 12],
      [16, 0],
    ] as const;
    const geometry = vertices.flatMap((vertex, index) => {
      const next = vertices[index + 1];
      return next === undefined ? [] : lineSamples(vertex, next, 12, index > 0);
    });
    const source = createPoints(geometry, 12);
    const path = createProfessionalInkPath(source);
    const expectedCorners = vertices.slice(1, -1).map((_, index) => source[(index + 1) * 12]);

    for (const corner of expectedCorners) {
      expect(corner).toBeDefined();
      expect(path.points).toContain(corner);
      expect(path.segments.some(({ start, end }) => start === corner || end === corner)).toBe(true);
    }
    expect(maximumApproximateError(path)).toBeLessThan(1.5);
  });

  it("uses error-tolerance segmentation for long smooth arcs", () => {
    const source = createPoints(
      Array.from({ length: 241 }, (_, index) => {
        const progress = index / 240;
        return [progress * 240, Math.sin(progress * Math.PI) * 80];
      }),
      8,
    );
    const path = createProfessionalInkPath(source);

    expect(path.segments.length).toBeGreaterThan(1);
    expect(path.segments.length).toBeLessThan(path.points.length / 8);
    expect(maximumApproximateError(path)).toBeLessThan(2);
    expect(hasControlOutsideEndpointEnvelope(path.segments)).toBe(true);
    expect(pathSelfIntersects(path)).toBe(false);
  });

  it("maintains continuous tangent direction across smooth fitted segments", () => {
    const source = createPoints(
      Array.from({ length: 300 }, (_, index) => [index, Math.sin(index / 32) * 30]),
      5,
    );
    const path = createProfessionalInkPath(source);

    expect(path.segments.length).toBeGreaterThan(1);
    for (let index = 0; index < path.segments.length - 1; index += 1) {
      const current = path.segments[index];
      const next = path.segments[index + 1];
      expect(current?.end).toBe(next?.start);
      if (current === undefined || next === undefined) continue;
      const incoming = {
        x: current.end.x - current.control2X,
        y: current.end.y - current.control2Y,
      };
      const outgoing = {
        x: next.control1X - next.start.x,
        y: next.control1Y - next.start.y,
      };
      expect(directionCosine(incoming, outgoing)).toBeGreaterThan(0.98);
    }
  });

  it("keeps fast and slow versions of the same handwriting within geometric tolerance", () => {
    const geometry = Array.from({ length: 180 }, (_, index) => [
      index * 0.7,
      Math.sin(index / 15) * 12 + Math.sin(index / 4) * 0.15,
    ]);
    const fast = createProfessionalInkPath(createPoints(geometry, 1));
    const slow = createProfessionalInkPath(createPoints(geometry, 30));

    expect(fast.segments.length).toBeLessThan(fast.points.length);
    expect(slow.segments.length).toBeLessThan(slow.points.length);
    expect(maximumApproximateError(fast)).toBeLessThan(1.5);
    expect(maximumApproximateError(slow)).toBeLessThan(1.5);
    expect(fast.segments[0]?.start).toMatchObject({
      x: slow.segments[0]?.start.x,
      y: slow.segments[0]?.start.y,
    });
    expect(fast.segments.at(-1)?.end).toMatchObject({
      x: slow.segments.at(-1)?.end.x,
      y: slow.segments.at(-1)?.end.y,
    });
  });

  it("handles dots and very short strokes without endpoint artifacts", () => {
    const dot = createPoints([[4, 7]], 5);
    const shortStroke = createPoints(
      [
        [4, 7],
        [9, 11],
      ],
      5,
    );

    const dotPath = createProfessionalInkPath(dot);
    const shortPath = createProfessionalInkPath(shortStroke);
    expect(dotPath.points[0]).toBe(dot[0]);
    expect(dotPath.segments).toEqual([]);
    expect(shortPath.segments).toMatchObject([{ start: { x: 4, y: 7 }, end: { x: 9, y: 11 } }]);
    expect(shortPath.segments[0]?.start).toBe(shortStroke[0]);
    expect(shortPath.segments[0]?.end).toBe(shortStroke[1]);
  });

  it("fits a very long rapid stroke with bounded time and compact cached geometry", () => {
    const source = createPoints(
      Array.from({ length: 10_000 }, (_, index) => [index * 0.15, Math.sin(index / 35) * 60]),
      1,
    );
    const startedAt = performance.now();

    const path = createProfessionalInkPath(source);
    const duration = performance.now() - startedAt;

    expect(duration).toBeLessThan(2_000);
    expect(path.points.length).toBeLessThan(source.length);
    expect(path.segments.length).toBeLessThan(path.points.length / 8);
    expect(path.segments[0]?.start).toBe(source[0]);
    expect(path.segments.at(-1)?.end).toBe(source.at(-1));
  });

  it("keeps zero-percent smoothing identical to the accepted Phase 17B path", () => {
    const source = createPoints(
      Array.from({ length: 80 }, (_, index) => [index * 1.2, Math.sin(index / 5) * 8]),
      4,
    );
    const baseline = createProfessionalInkPath(source);
    const zero = createProfessionalInkPath(source, { mode: "average", amount: 0 });

    expect(zero.points).toEqual(baseline.points);
    expect(zero.segments).toEqual(baseline.segments);
    expect(zero.sourceProgress).toEqual(baseline.sourceProgress);
    zero.sourcePoints.forEach((point, index) => expect(point).toBe(source[index]));
  });

  it("makes low and high smoothing visibly distinct without mutating source samples", () => {
    const source = createPoints(
      Array.from({ length: 121 }, (_, index) => [
        index,
        Math.sin(index / 10) * 10 + (index % 2 === 0 ? 1.8 : -1.8),
      ]),
      4,
    );
    const before = JSON.stringify(source);
    const low = createProfessionalInkPath(source, { mode: "average", amount: 0.15 });
    const high = createProfessionalInkPath(source, { mode: "average", amount: 0.9 });

    expect(high.points).not.toEqual(low.points);
    expect(polylineRoughness(high.points)).toBeLessThan(polylineRoughness(low.points));
    expect(JSON.stringify(source)).toBe(before);
    expect(high.sourcePoints).toHaveLength(source.length);
    high.sourcePoints.forEach((point, index) => expect(point).toBe(source[index]));
  });

  it("is deterministic, endpoint-safe, and corner-aware at high smoothing", () => {
    const geometry = [
      ...lineSamples([0, 0], [30, 0], 20, false),
      ...lineSamples([30, 0], [30, 30], 20, true),
    ];
    const source = createPoints(geometry, 4);
    const smoothing = { mode: "average" as const, amount: 1 };
    const first = createProfessionalInkPath(source, smoothing);
    const second = createProfessionalInkPath(source, smoothing);
    const corner = source[20];
    if (corner === undefined) throw new Error("Corner sample is unavailable.");
    const nearestCorner = first.points.reduce((nearest, point) =>
      Math.hypot(point.x - corner.x, point.y - corner.y) <
      Math.hypot(nearest.x - corner.x, nearest.y - corner.y)
        ? point
        : nearest,
    );

    expect(first.segments).toEqual(second.segments);
    expect(first.points[0]).toBe(source[0]);
    expect(first.points.at(-1)).toBe(source.at(-1));
    expect(Math.hypot(nearestCorner.x - corner.x, nearestCorner.y - corner.y)).toBeLessThan(1);
    expect(pathSelfIntersects(first)).toBe(false);
  });
});

function createPoints(
  geometry: ReadonlyArray<readonly [number, number] | readonly number[]>,
  interval: number,
): readonly StrokePoint[] {
  const builder = new StrokeBuilder({
    id: `professional-${geometry.length}-${interval}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  geometry.forEach((coordinates, index) => {
    const [x, y] = coordinates;
    if (x === undefined || y === undefined) throw new Error("Expected two coordinates.");
    builder.addPoint(point(x, y, index * interval));
  });
  return builder.finalize().points;
}

function point(x: number, y: number, timestamp: number): StrokePointInput {
  return {
    x,
    y,
    timestamp,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function lineSamples(
  start: readonly [number, number],
  end: readonly [number, number],
  segmentCount: number,
  excludeStart: boolean,
): readonly (readonly [number, number])[] {
  return Array.from({ length: segmentCount + 1 - (excludeStart ? 1 : 0) }, (_, index) => {
    const progress = (index + (excludeStart ? 1 : 0)) / segmentCount;
    return [
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress,
    ] as const;
  });
}

function maximumApproximateError(path: ProfessionalInkPath): number {
  let maximum = 0;
  for (const point of path.points) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const segment of path.segments) {
      for (let sample = 0; sample <= 48; sample += 1) {
        const curvePoint = evaluateSegment(segment, sample / 48);
        nearest = Math.min(nearest, Math.hypot(curvePoint.x - point.x, curvePoint.y - point.y));
      }
    }
    maximum = Math.max(maximum, nearest);
  }
  return maximum;
}

function hasControlOutsideEndpointEnvelope(segments: readonly ProfessionalInkSegment[]): boolean {
  return segments.some((segment) => {
    const minX = Math.min(segment.start.x, segment.end.x);
    const maxX = Math.max(segment.start.x, segment.end.x);
    const minY = Math.min(segment.start.y, segment.end.y);
    const maxY = Math.max(segment.start.y, segment.end.y);
    return (
      segment.control1X < minX ||
      segment.control1X > maxX ||
      segment.control1Y < minY ||
      segment.control1Y > maxY ||
      segment.control2X < minX ||
      segment.control2X > maxX ||
      segment.control2Y < minY ||
      segment.control2Y > maxY
    );
  });
}

function pathSelfIntersects(path: ProfessionalInkPath): boolean {
  const samples = path.segments.flatMap((segment, segmentIndex) =>
    Array.from({ length: 17 }, (_, index) => evaluateSegment(segment, index / 16)).filter(
      (_, index) => segmentIndex === 0 || index > 0,
    ),
  );
  for (let first = 0; first < samples.length - 1; first += 1) {
    for (let second = first + 2; second < samples.length - 1; second += 1) {
      if (
        properlyIntersects(
          samples[first]!,
          samples[first + 1]!,
          samples[second]!,
          samples[second + 1]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function properlyIntersects(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
  third: Readonly<{ x: number; y: number }>,
  fourth: Readonly<{ x: number; y: number }>,
): boolean {
  const firstSide = cross(subtract(second, first), subtract(third, first));
  const secondSide = cross(subtract(second, first), subtract(fourth, first));
  const thirdSide = cross(subtract(fourth, third), subtract(first, third));
  const fourthSide = cross(subtract(fourth, third), subtract(second, third));
  return firstSide * secondSide < -0.000_001 && thirdSide * fourthSide < -0.000_001;
}

function evaluateSegment(
  segment: ProfessionalInkSegment,
  parameter: number,
): Readonly<{ x: number; y: number }> {
  const inverse = 1 - parameter;
  const b0 = inverse * inverse * inverse;
  const b1 = 3 * parameter * inverse * inverse;
  const b2 = 3 * parameter * parameter * inverse;
  const b3 = parameter * parameter * parameter;
  return {
    x: segment.start.x * b0 + segment.control1X * b1 + segment.control2X * b2 + segment.end.x * b3,
    y: segment.start.y * b0 + segment.control1Y * b1 + segment.control2Y * b2 + segment.end.y * b3,
  };
}

function directionCosine(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): number {
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  return denominator === 0 ? 1 : (first.x * second.x + first.y * second.y) / denominator;
}

function subtract(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return { x: first.x - second.x, y: first.y - second.y };
}

function cross(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): number {
  return first.x * second.y - first.y * second.x;
}

function polylineRoughness(points: readonly StrokePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (previous === undefined || current === undefined || next === undefined) continue;
    total += Math.abs(next.y - current.y * 2 + previous.y);
  }
  return total;
}
