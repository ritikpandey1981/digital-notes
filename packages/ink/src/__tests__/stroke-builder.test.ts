import { describe, expect, it } from "vitest";
import { createResolvedBrushSnapshot } from "../brush-model";
import { StrokeBuilder } from "../stroke-builder";
import { Stroke } from "../stroke";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokeBuilderOptions, StrokePointInput } from "../types";

function point(
  x: number,
  y: number,
  timestamp: number,
  pressure = 0.5,
  pointerType: InkPointerType = "pen",
): StrokePointInput {
  return {
    x,
    y,
    timestamp,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType,
    button: 0,
    buttons: 1,
  };
}

function unsmoothedBuilder() {
  return new StrokeBuilder({
    id: "stroke-1",
    timestamp: 100,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
}

describe("StrokeBuilder", () => {
  it("builds an immutable stroke with geometry, pressure, velocity, and acceleration metrics", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(0, 0, 100, 0.25));
    const update = builder.addPoint(point(3, 4, 200, 0.75));
    const stroke = builder.finalize();

    expect(update?.point).toMatchObject({
      delta: { x: 3, y: 4 },
      velocity: 50,
      acceleration: 500,
    });
    expect(stroke).toMatchObject({
      id: "stroke-1",
      timestamp: 100,
      pointCount: 2,
      length: 5,
      duration: 100,
      bounds: { x: 0, y: 0, width: 3, height: 4, center: { x: 1.5, y: 2 } },
      statistics: {
        averagePressure: 0.5,
        minimumPressure: 0.25,
        maximumPressure: 0.75,
        averageVelocity: 50,
        minimumVelocity: 50,
        maximumVelocity: 50,
      },
    });
    expect(stroke.inflatedBounds.width).toBeGreaterThan(stroke.bounds.width);
    expect(Object.isFrozen(stroke)).toBe(true);
    expect(Object.isFrozen(stroke.points)).toBe(true);
    expect(Object.isFrozen(stroke.points[0]?.delta)).toBe(true);
    expect(Object.isFrozen(stroke.metrics.bounds.center)).toBe(true);
    expect(stroke.widthAtPressure(0.25)).toBe(1.5);
    expect(stroke.widthAtPressure(0.75)).toBe(2.5);
    expect(builder.pointCount).toBe(0);
  });

  it("keeps finalized pressure behavior in serializable resolved brush data", () => {
    const brush = createResolvedBrushSnapshot({
      schemaVersion: 1,
      presetId: "durable-power-brush",
      presetVersion: 3,
      family: "pen",
      color: "#123456",
      size: 8,
      opacity: 0.7,
      smoothing: { mode: "average", amount: 0.4 },
      dynamics: {
        pressureSize: {
          enabled: true,
          minimumFactor: 0.5,
          maximumFactor: 1.5,
          curve: { kind: "power", exponent: 2 },
        },
        pressureOpacity: {
          enabled: true,
          minimumFactor: 0.2,
          maximumFactor: 1,
          curve: { kind: "linear", exponent: 1 },
        },
      },
      renderer: { version: 1, kind: "outline" },
    });
    const builder = new StrokeBuilder({
      id: "durable-stroke",
      timestamp: 100,
      brush,
      style: { color: brush.color, width: brush.size, opacity: brush.opacity },
      smoother: new StrokeSmoother({ mode: "none" }),
    });
    builder.addPoint(point(0, 0, 100, 0.5));
    const stroke = builder.finalize();

    expect([0, 0.25, 0.5, 0.75, 1].map((pressure) => stroke.widthAtPressure(pressure))).toEqual([
      4, 4.5, 6, 8.5, 12,
    ]);
    expect(stroke.brush).toEqual(brush);
    expect(containsFunctionInOwnState(stroke)).toBe(false);
  });

  it("rejects the removed executable pressure callback at the runtime boundary", () => {
    const options: StrokeBuilderOptions = {
      style: {
        // @ts-expect-error Finalized StrokeStyle no longer accepts executable pressure behavior.
        pressureCurve: (pressure: number) => pressure * pressure,
      },
    };

    expect(() => new StrokeBuilder(options)).toThrowError(
      expect.objectContaining({ code: "INVALID_STYLE" }),
    );
  });

  it("supports a single-point stroke with finite zero-valued motion metrics", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(10, 20, 100));
    const stroke = builder.finalize();
    expect(stroke).toMatchObject({ length: 0, duration: 0, pointCount: 1 });
    expect(stroke.statistics).toMatchObject({
      averageVelocity: 0,
      minimumVelocity: 0,
      maximumVelocity: 0,
      averageAcceleration: 0,
    });
    expect(stroke.bounds).toMatchObject({ x: 10, y: 20, width: 0, height: 0 });
  });

  it("keeps the public StrokeData constructor compatible with pre-17A inputs", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(10, 20, 100));
    const original = builder.finalize();
    const compatible = new Stroke({
      id: "compatible-stroke",
      timestamp: original.timestamp,
      points: original.points,
      style: original.style,
      metrics: original.metrics,
      statistics: original.statistics,
    });

    expect(compatible.sourceSamples).toHaveLength(1);
    expect(compatible.brush).toMatchObject({
      presetId: "legacy-stroke-style",
      renderer: { kind: "centerline" },
    });
    expect([0, 0.25, 0.5, 0.75, 1].map((pressure) => compatible.widthAtPressure(pressure))).toEqual(
      [1, 1.5, 2, 2.5, 3],
    );
    expect(JSON.parse(JSON.stringify(compatible.brush))).toEqual(compatible.brush);
  });

  it("supports a two-point stroke and computes its incremental dirty rectangle", () => {
    const builder = unsmoothedBuilder();
    const first = builder.addPoint(point(10, 10, 100));
    const second = builder.addPoint(point(30, 20, 120));
    expect(first?.dirtyRect.width).toBeGreaterThan(0);
    expect(second?.dirtyRect).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(second?.dirtyRect.width).toBeLessThan(30);
    expect(builder.finalize().length).toBeCloseTo(Math.hypot(20, 10));
  });

  it("retains meaningful stationary source input without adding render geometry", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(1, 2, 100));
    expect(builder.addPoint(point(1, 2, 110, 0.9))).toBeNull();
    expect(builder.pointCount).toBe(1);
    const stroke = builder.finalize();
    expect(stroke.pointCount).toBe(1);
    expect(stroke.sourceSampleCount).toBe(2);
    expect(stroke.sourceSamples.map(({ pressure }) => pressure)).toEqual([0.5, 0.9]);
    expect(stroke.duration).toBe(10);
  });

  it("bounds useless stationary duplicate spam while preserving dwell and terminal timing", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(1, 2, 100));
    for (let timestamp = 101; timestamp < 200; timestamp += 1) {
      builder.addPoint(point(1, 2, timestamp));
    }
    builder.addPoint(point(1, 2, 200), { phase: "terminal" });
    const stroke = builder.finalize();

    expect(stroke.pointCount).toBe(1);
    expect(stroke.sourceSampleCount).toBeLessThanOrEqual(8);
    expect(stroke.sourceSamples.at(-1)?.timestamp).toBe(200);
    expect(stroke.duration).toBe(100);
  });

  it("bounds a ten-thousand-event stationary stream without growing render geometry", () => {
    const builder = unsmoothedBuilder();
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      builder.addPoint(point(1, 2, 100 + index));
    }
    const stroke = builder.finalize();
    const elapsed = performance.now() - started;

    expect(stroke.pointCount).toBe(1);
    expect(stroke.sourceSampleCount).toBeLessThanOrEqual(626);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") expect(elapsed).toBeLessThan(1_000);
  });

  it("retains stationary tilt and twist changes in immutable source samples", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(1, 2, 100));
    builder.addPoint({ ...point(1, 2, 104), tiltX: 2, tiltY: -3, twist: 5 });
    const stroke = builder.finalize();

    expect(stroke.sourceSampleCount).toBe(2);
    expect(stroke.sourceSamples[1]).toMatchObject({ tiltX: 2, tiltY: -3, twist: 5 });
    expect(Object.isFrozen(stroke.sourceSamples)).toBe(true);
    expect(Object.isFrozen(stroke.sourceSamples[1])).toBe(true);
  });

  it("calculates finite statistics for very fast and very slow segments", () => {
    const fast = unsmoothedBuilder();
    fast.addPoint(point(0, 0, 100));
    fast.addPoint(point(1_000, 0, 100.001));
    const fastStroke = fast.finalize();
    expect(fastStroke.statistics.maximumVelocity).toBeCloseTo(1_000_000_000, -3);
    expect(Number.isFinite(fastStroke.statistics.maximumAcceleration)).toBe(true);

    const slow = unsmoothedBuilder();
    slow.addPoint(point(0, 0, 100));
    slow.addPoint(point(1_000, 0, 1_000_100));
    expect(slow.finalize().statistics.averageVelocity).toBeCloseTo(1);
  });

  it("normalizes mouse, pen, and touch metadata into the final point model", () => {
    for (const pointerType of ["mouse", "pen", "touch"] as const) {
      const builder = unsmoothedBuilder();
      builder.addPoint({
        ...point(1, 2, 100, 0.5, pointerType),
        tiltX: 12,
        tiltY: -8,
        twist: 45,
        altitudeAngle: 0.8,
        azimuthAngle: 1.4,
      });
      expect(builder.finalize().points[0]).toMatchObject({
        pointerType,
        tiltX: 12,
        tiltY: -8,
        twist: 45,
        altitudeAngle: 0.8,
        azimuthAngle: 1.4,
      });
    }
  });

  it("rejects impossible coordinates, pressure, and timestamp ordering with structured errors", () => {
    const builder = unsmoothedBuilder();
    expect(() => builder.addPoint(point(Number.NaN, 0, 1))).toThrowError(
      expect.objectContaining({ code: "INVALID_POINTER_DATA" }),
    );
    expect(() => builder.addPoint(point(0, 0, 1, 2))).toThrowError(
      expect.objectContaining({ code: "INVALID_PRESSURE" }),
    );
    builder.addPoint(point(0, 0, 100));
    expect(() => builder.addPoint(point(1, 1, 99))).toThrowError(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }),
    );
    builder.addPoint(point(0, 0, 110));
    expect(() => builder.addPoint(point(0, 0, 105))).toThrowError(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }),
    );
  });

  it("rejects invalid styles and lifecycle misuse", () => {
    expect(() => new StrokeBuilder({ style: { width: 0 } })).toThrowError(
      expect.objectContaining({ code: "INVALID_STYLE" }),
    );
    const empty = unsmoothedBuilder();
    expect(() => empty.finalize()).toThrowError(
      expect.objectContaining({ code: "NO_ACTIVE_STROKE" }),
    );
    const finalized = unsmoothedBuilder();
    finalized.addPoint(point(0, 0, 1));
    finalized.finalize();
    expect(() => finalized.addPoint(point(1, 1, 2))).toThrowError(
      expect.objectContaining({ code: "BUILDER_FINALIZED" }),
    );
    const cancelled = unsmoothedBuilder();
    cancelled.addPoint(point(0, 0, 1));
    expect(cancelled.cancel()).not.toBeNull();
    expect(cancelled.pointCount).toBe(0);
    expect(() => cancelled.finalize()).toThrowError(
      expect.objectContaining({ code: "BUILDER_CANCELLED" }),
    );
  });

  it("handles a ten-thousand-point stroke within a bounded performance sanity budget", () => {
    const builder = unsmoothedBuilder();
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      builder.addPoint(point(index, index % 17, 100 + index * 8));
    }
    const stroke = builder.finalize();
    const elapsed = performance.now() - started;
    expect(stroke.pointCount).toBe(10_000);
    expect(stroke.length).toBeGreaterThan(10_000);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") expect(elapsed).toBeLessThan(1_500);
  });
});

function containsFunctionInOwnState(value: unknown, visited = new Set<object>()): boolean {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((item) => containsFunctionInOwnState(item, visited));
}
