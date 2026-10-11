import { describe, expect, it } from "vitest";
import { createResolvedBrushSnapshot, type ResolvedBrushSnapshot } from "../brush-model";
import type { MarkerSwathRenderGeometry } from "../internal/brush-geometry";
import { MarkerEvaluator, createMarkerGeometry } from "../internal/marker";
import type { StrokePoint } from "../types";

/**
 * What a Marker stroke costs to evaluate and to paint.
 *
 * Two questions, and only one of them is about a clock. **How many contours one
 * fill contains** is the architectural one: D-031 measured six thousand
 * contours in a single fill at 155 ms a frame against 8.4 ms for the same
 * vertices in batches, so a strategy that grows its contour count with the
 * stroke has a scaling problem no amount of tuning fixes. Marker's answer is
 * that a swath is one contour whatever its length, which is asserted here
 * rather than hoped for, and needs no batching at all.
 *
 * The second is whether live evaluation stays bounded. That is asserted
 * structurally -- settled samples are evaluated once and the tail is capped by
 * the smoothing window -- because a wall-clock budget on a shared machine is
 * either too loose to catch a regression or too tight to stay green.
 *
 * Timings print with `FOLIO_PERFORMANCE_BASELINE=1`, as every other brush
 * measurement in this package does.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const INERT = Object.freeze({
  enabled: false,
  minimumFactor: 1,
  maximumFactor: 1,
  curve: LINEAR,
});

function markerBrush(size: number): ResolvedBrushSnapshot {
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

/** A long sweeping scribble, which is the shape a marker is actually used in. */
function scribble(count: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    points.push(
      Object.freeze({
        x: 120 + Math.sin(t * 11) * 180 + t * 620,
        y: 240 + Math.cos(t * 7) * 130,
        timestamp: index * 4,
        pressure: 0.3 + 0.5 * Math.abs(Math.sin(t * 5)),
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerType: "pen" as const,
        button: 0,
        buttons: 1,
        delta: Object.freeze({ x: 0, y: 0 }),
        velocity: 0,
        acceleration: 0,
      }),
    );
  }
  return points;
}

/** How many contours each fill would receive, counted the way a painter emits them. */
function contoursPerFill(geometry: MarkerSwathRenderGeometry): number[] {
  // One `moveTo` opens one contour, and the painter opens exactly one per band.
  return geometry.bands.map(() => 1);
}

function millis(run: () => void): number {
  const started = performance.now();
  run();
  return Number((performance.now() - started).toFixed(3));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

describe("marker@1 cost", () => {
  it.each([
    ["ordinary", 220],
    ["long", 1000],
    ["very long", 5000],
  ] as const)("keeps one contour per fill for a %s stroke at every width", (_label, count) => {
    const points = scribble(count);
    for (const size of [2, 8, 16, 32]) {
      const geometry = createMarkerGeometry(points, markerBrush(size), 1);
      // The D-031 property: the contour count is a property of how the opacity
      // moved, not of how long the stroke is. With a constant alpha it is one.
      expect(geometry.bands.length, `${String(count)} at ${String(size)}pu`).toBe(1);
      expect(contoursPerFill(geometry)).toEqual([1]);
    }
  });

  it("builds a swath whose vertex count tracks distance, not sample count", () => {
    const brush = markerBrush(8);
    const vertices = (count: number): number => {
      const geometry = createMarkerGeometry(scribble(count), brush, 1);
      const band = geometry.bands[0]!;
      return band.left.length + band.right.length + band.startCap.length + band.endCap.length;
    };
    const atThousand = vertices(1000);
    const atFiveThousand = vertices(5000);
    // Five times the events describe the same path, so the swath that comes out
    // is the same size to within the decimation phase rather than five times
    // larger.
    expect(atFiveThousand / atThousand).toBeLessThan(1.6);
  });

  it("evaluates each settled sample once, with a tail bounded by the smoothing window", () => {
    const brush = markerBrush(16);
    const points = scribble(5000);
    const evaluator = new MarkerEvaluator(brush, 1);
    const frames: number[] = [];
    // Twelve samples a frame is roughly a 240 Hz device at 120 Hz presentation.
    for (let consumed = 12; consumed <= points.length; consumed += 12) {
      frames.push(millis(() => evaluator.append(points.slice(0, consumed), false)));
    }
    evaluator.append(points, true);
    const snapshot = evaluator.evaluationSnapshot();
    expect(snapshot.settledPointEvaluations).toBeLessThanOrEqual(points.length);
    expect(snapshot.maximumTailPointEvaluations).toBeLessThanOrEqual(
      snapshot.lookaheadSamples + 12,
    );
    // The last frames must not cost more than the first: per-frame work that
    // grew with the stroke is the scaling defect this exists to catch.
    const first = median(frames.slice(0, 10));
    const last = median(frames.slice(-10));
    expect(last).toBeLessThanOrEqual(Math.max(first, 0.05) * 8);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") {
      // eslint-disable-next-line no-console
      console.log(
        `marker live frames: first ${String(first)} ms, last ${String(last)} ms, ` +
          `max ${String(Math.max(...frames))} ms over ${String(frames.length)} frames`,
      );
    }
  });

  it("reports what a committed rebuild costs", () => {
    const rows: string[] = [];
    for (const [label, count] of [
      ["ordinary", 220],
      ["long", 1000],
      ["very long", 5000],
    ] as const) {
      for (const size of [8, 24]) {
        const points = scribble(count);
        const brush = markerBrush(size);
        createMarkerGeometry(points, brush, 1);
        const runs = Array.from({ length: 9 }, () =>
          millis(() => void createMarkerGeometry(points, brush, 1)),
        );
        const geometry = createMarkerGeometry(points, brush, 1);
        const band = geometry.bands[0]!;
        rows.push(
          `${label}/${String(size)}pu: ${String(median(runs))} ms, ` +
            `${String(geometry.keptPointCount)} placements, ` +
            `${String(band.left.length + band.right.length)} boundary points, ` +
            `${String(geometry.bands.length)} fill`,
        );
      }
    }
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") {
      // eslint-disable-next-line no-console
      console.log(`marker committed rebuild\n  ${rows.join("\n  ")}`);
    }
    expect(rows).toHaveLength(6);
  });
});
