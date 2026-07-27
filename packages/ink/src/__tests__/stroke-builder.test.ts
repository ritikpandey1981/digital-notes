import { describe, expect, it } from "vitest";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePointInput } from "../types";

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

  it("supports a two-point stroke and computes its incremental dirty rectangle", () => {
    const builder = unsmoothedBuilder();
    const first = builder.addPoint(point(10, 10, 100));
    const second = builder.addPoint(point(30, 20, 120));
    expect(first?.dirtyRect.width).toBeGreaterThan(0);
    expect(second?.dirtyRect).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(second?.dirtyRect.width).toBeLessThan(30);
    expect(builder.finalize().length).toBeCloseTo(Math.hypot(20, 10));
  });

  it("filters duplicate positions without allocating another stroke point", () => {
    const builder = unsmoothedBuilder();
    builder.addPoint(point(1, 2, 100));
    expect(builder.addPoint(point(1, 2, 110, 0.9))).toBeNull();
    expect(builder.pointCount).toBe(1);
    expect(builder.finalize().pointCount).toBe(1);
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
    expect(elapsed).toBeLessThan(1_500);
  });
});
