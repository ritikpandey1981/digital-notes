import { describe, expect, it, vi } from "vitest";
import {
  createResolvedBrushSnapshot,
  type BrushRendererKind,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  createBrushRenderGeometry,
  drawBrushRenderGeometry,
  getStrokeRenderCacheSnapshot,
  resolveStrokeRenderGeometry,
  type OutlineRenderGeometry,
} from "../internal/brush-render-strategy";
import { getStrokeRenderedBounds } from "../rendered-stroke-bounds";
import type { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { InkPointerType, StrokePointInput } from "../types";

const NONE = Object.freeze({ mode: "none" as const, amount: 0 });

function brush(
  kind: BrushRendererKind = "outline",
  options: Partial<Pick<ResolvedBrushSnapshot, "size" | "opacity" | "family" | "smoothing">> = {},
): ResolvedBrushSnapshot {
  const family = options.family ?? (kind === "outline" ? "pen" : "highlighter");
  const pressureEnabled = family === "pen";
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `test-${family}-${kind}`,
    presetVersion: 1,
    family,
    color: family === "highlighter" ? "#facc15" : "#111111",
    size: options.size ?? 10,
    opacity: options.opacity ?? (family === "highlighter" ? 0.34 : 1),
    smoothing: options.smoothing ?? NONE,
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: pressureEnabled,
        minimumFactor: pressureEnabled ? 0.5 : 1,
        maximumFactor: pressureEnabled ? 1.5 : 1,
        curve: Object.freeze({ kind: "linear" as const, exponent: 1 }),
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "linear" as const, exponent: 1 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind }),
  });
}

function point(
  x: number,
  y: number,
  timestamp: number,
  pressure: number,
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

function strokeFromPressures(
  pressures: readonly number[],
  resolvedBrush = brush(),
  coordinates: (index: number) => Readonly<{ x: number; y: number }> = (index) => ({
    x: index * 20,
    y: 0,
  }),
  id = `stroke-${pressures.join("-")}`,
  pointerType: InkPointerType = "pen",
): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush: resolvedBrush,
    style: {
      color: resolvedBrush.color,
      width: resolvedBrush.size,
      opacity: resolvedBrush.opacity,
      pressureEnabled: resolvedBrush.dynamics.pressureSize.enabled,
    },
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  pressures.forEach((pressure, index) => {
    const coordinate = coordinates(index);
    builder.addPoint(point(coordinate.x, coordinate.y, index * 8, pressure, pointerType));
  });
  return builder.finalize();
}

function outline(geometry: ReturnType<typeof createBrushRenderGeometry>): OutlineRenderGeometry {
  if (geometry.kind !== "outline") throw new Error("Expected outline geometry.");
  return geometry;
}

function radiiAtSourceProgress(geometry: OutlineRenderGeometry): readonly number[] {
  const sourceProgress = geometry.path.sourceProgress;
  return sourceProgress.map((progress) => {
    const sample = geometry.outline.centerline.reduce((nearest, candidate) =>
      Math.abs(candidate.progress - progress) < Math.abs(nearest.progress - progress)
        ? candidate
        : nearest,
    );
    return sample.radius;
  });
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

describe("Phase 17B brush rendering", () => {
  it("uses identical smoothed geometry for live and committed centerline strokes", () => {
    const resolved = brush("centerline", {
      family: "marker",
      smoothing: { mode: "average", amount: 0.8 },
    });
    const stroke = strokeFromPressures(
      Array.from({ length: 50 }, () => 0.5),
      resolved,
      (index) => ({ x: index * 2, y: Math.sin(index / 5) * 8 + (index % 2 ? 1 : -1) }),
      "smoothed-live-final",
    );

    const live = createBrushRenderGeometry(stroke.points, stroke.brush);
    const committed = resolveStrokeRenderGeometry(stroke);

    expect(live.kind).toBe("centerline");
    expect(committed.kind).toBe("centerline");
    expect(live.path.points).toEqual(committed.path.points);
    expect(live.path.segments).toEqual(committed.path.segments);
    expect(live.path.sourcePoints).toEqual(stroke.points);
  });

  it.each([
    ["constant", [0.5, 0.5, 0.5]],
    ["increasing", [0.1, 0.3, 0.6, 1]],
    ["decreasing", [1, 0.6, 0.3, 0.1]],
    ["wave", [0.2, 0.8, 0.3, 1, 0.2]],
  ] as const)("keeps %s live and committed width profiles identical", (_, pressures) => {
    const stroke = strokeFromPressures(pressures);
    const live = outline(createBrushRenderGeometry(stroke.points, stroke.brush));
    const committed = outline(resolveStrokeRenderGeometry(stroke));

    expect(radiiAtSourceProgress(live)).toEqual(radiiAtSourceProgress(committed));
    expect(live.outline.boundary).toEqual(committed.outline.boundary);
    expect(committed.outline.boundary[0]).toEqual(committed.outline.boundary.at(-1));
  });

  it("uses the shared dynamics evaluator for minimum, mouse-nominal, and maximum widths", () => {
    const resolved = brush("outline", { size: 12 });
    const stroke = strokeFromPressures([0, 0.5, 1], resolved);
    const geometry = outline(resolveStrokeRenderGeometry(stroke));

    expect(stroke.widthAtPressure(0)).toBe(6);
    expect(stroke.widthAtPressure(0.5)).toBe(12);
    expect(stroke.widthAtPressure(1)).toBe(18);
    expect(radiiAtSourceProgress(geometry)).toEqual([3, 6, 9]);
  });

  it.each([
    ["low-pressure pen dot", 0.1, 3],
    ["mouse dot", 0.5, 5],
    ["high-pressure pen dot", 1, 7.5],
  ] as const)("renders a parity-safe %s", (_, pressure, expectedRadius) => {
    const stroke = strokeFromPressures([pressure]);
    const live = outline(createBrushRenderGeometry(stroke.points, stroke.brush));
    const final = outline(resolveStrokeRenderGeometry(stroke));

    expect(live.outline.dot).toEqual(final.outline.dot);
    expect(final.outline.dot?.radius).toBeCloseTo(expectedRadius);
    expect(final.bounds.width).toBeCloseTo(expectedRadius * 2);
    expect(final.bounds.height).toBeCloseTo(expectedRadius * 2);
  });

  it("handles two-point, curved, cornered, looped, and self-crossing silhouettes", () => {
    const cases = [
      (index: number) => ({ x: index * 30, y: 0 }),
      (index: number) => ({ x: index * 12, y: Math.sin(index / 2) * 24 }),
      (index: number) => ({ x: index < 3 ? index * 15 : 30, y: index < 3 ? 0 : (index - 2) * 15 }),
      (index: number) => ({
        x: 40 + Math.cos((index / 7) * Math.PI * 2) * 30,
        y: 40 + Math.sin((index / 7) * Math.PI * 2) * 25,
      }),
      (index: number) => ({ x: index % 2 === 0 ? 0 : 40, y: index * 12 }),
    ];
    for (const [caseIndex, coordinates] of cases.entries()) {
      const count = caseIndex === 0 ? 2 : 8;
      const stroke = strokeFromPressures(
        Array.from({ length: count }, (_, index) => 0.2 + (index % 4) * 0.25),
        brush(),
        coordinates,
        `geometry-case-${caseIndex}`,
      );
      const geometry = outline(resolveStrokeRenderGeometry(stroke)).outline;
      expect(geometry.boundary.length).toBeGreaterThan(10);
      expect(geometry.boundary[0]).toEqual(geometry.boundary.at(-1));
      expect(geometry.boundary.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(
        true,
      );
      expect(geometry.bounds.width).toBeLessThan(500);
      expect(geometry.bounds.height).toBeLessThan(500);
    }
  });

  it.each([
    [
      "90-degree corner",
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
    ],
    [
      "acute corner",
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 12, y: 12 },
      ],
    ],
    [
      "near-180-degree reversal",
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 1, y: 1 },
      ],
    ],
    [
      "zig-zag",
      [
        { x: 0, y: 0 },
        { x: 30, y: 30 },
        { x: 60, y: 0 },
        { x: 90, y: 30 },
        { x: 120, y: 0 },
      ],
    ],
    [
      "sparse samples",
      [
        { x: 0, y: 0 },
        { x: 180, y: 10 },
        { x: 260, y: 150 },
      ],
    ],
    [
      "tight loop",
      Array.from({ length: 13 }, (_, index) => ({
        x: 40 + Math.cos((index / 12) * Math.PI * 2) * 24,
        y: 40 + Math.sin((index / 12) * Math.PI * 2) * 18,
      })),
    ],
    [
      "repeated alternating directions",
      [
        { x: 0, y: 0 },
        { x: 45, y: 0 },
        { x: 2, y: 3 },
        { x: 45, y: 6 },
        { x: 2, y: 9 },
        { x: 45, y: 12 },
      ],
    ],
  ] as const)("keeps %s outline joins bounded and finite", (name, coordinates) => {
    const resolved = brush("outline", { size: 12 });
    const stroke = strokeFromPressures(
      coordinates.map((_, index) => 0.15 + (index % 4) * 0.25),
      resolved,
      (index) => coordinates[index] ?? coordinates[coordinates.length - 1]!,
      `robust-${name}`,
    );
    const geometry = outline(resolveStrokeRenderGeometry(stroke)).outline;
    const maximumRadius = Math.max(...geometry.centerline.map(({ radius }) => radius));
    const minimumX = Math.min(...geometry.centerline.map(({ x }) => x)) - maximumRadius;
    const minimumY = Math.min(...geometry.centerline.map(({ y }) => y)) - maximumRadius;
    const maximumX = Math.max(...geometry.centerline.map(({ x }) => x)) + maximumRadius;
    const maximumY = Math.max(...geometry.centerline.map(({ y }) => y)) + maximumRadius;

    expect(geometry.boundary[0]).toEqual(geometry.boundary.at(-1));
    expect(geometry.boundary.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(
      true,
    );
    expect(geometry.bounds.x).toBeGreaterThanOrEqual(minimumX - 0.000_001);
    expect(geometry.bounds.y).toBeGreaterThanOrEqual(minimumY - 0.000_001);
    expect(geometry.bounds.x + geometry.bounds.width).toBeLessThanOrEqual(maximumX + 0.000_001);
    expect(geometry.bounds.y + geometry.bounds.height).toBeLessThanOrEqual(maximumY + 0.000_001);

    const rightStart = geometry.centerline.length + 9;
    geometry.centerline.forEach((sample, index) => {
      const left = geometry.boundary[index]!;
      const right = geometry.boundary[rightStart + geometry.centerline.length - 1 - index]!;
      expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeCloseTo(sample.radius * 2, 6);
    });
  });

  it.each([0.5, 1, 2, 4])(
    "spatially resamples sparse outline geometry at rendered scale %s",
    (renderedScale) => {
      const stroke = strokeFromPressures(
        [0.1, 0.7, 1],
        brush("outline", { size: 10 }),
        (index) =>
          [
            { x: 0, y: 0 },
            { x: 180, y: 20 },
            { x: 260, y: 150 },
          ][index]!,
      );
      const geometry = outline(resolveStrokeRenderGeometry(stroke, renderedScale)).outline;
      for (let index = 1; index < geometry.centerline.length; index += 1) {
        const previous = geometry.centerline[index - 1]!;
        const current = geometry.centerline[index]!;
        expect(
          Math.hypot(current.x - previous.x, current.y - previous.y) * renderedScale,
        ).toBeLessThanOrEqual(3.000_001);
      }
    },
  );

  it.each([
    [
      "straight",
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    ],
    [
      "slow curve",
      [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
        { x: 80, y: 0 },
      ],
    ],
    [
      "sharp corner",
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
    ],
    [
      "zig-zag",
      [
        { x: 0, y: 0 },
        { x: 30, y: 25 },
        { x: 60, y: 0 },
        { x: 90, y: 25 },
      ],
    ],
    [
      "loop",
      Array.from({ length: 9 }, (_, index) => ({
        x: 40 + Math.cos((index / 8) * Math.PI * 2) * 30,
        y: 40 + Math.sin((index / 8) * Math.PI * 2) * 24,
      })),
    ],
  ] as const)("keeps mouse %s at fixed nominal centerline width", (name, coordinates) => {
    const resolved = brush("centerline", { family: "pen", size: 12 });
    const stroke = strokeFromPressures(
      coordinates.map(() => 0.5),
      resolved,
      (index) => coordinates[index] ?? coordinates[coordinates.length - 1]!,
      `mouse-${name}`,
      "mouse",
    );
    const live = createBrushRenderGeometry(stroke.points, stroke.brush);
    const committed = resolveStrokeRenderGeometry(stroke);
    const liveCanvas = context();
    const finalCanvas = context();

    expect(live.kind).toBe("centerline");
    expect(committed.kind).toBe("centerline");
    expect(live.path.segments).toEqual(committed.path.segments);
    expect(stroke.widthAtPressure(0.5)).toBe(12);
    drawBrushRenderGeometry(liveCanvas, live, stroke.brush);
    drawBrushRenderGeometry(finalCanvas, committed, stroke.brush);
    expect(liveCanvas.lineWidth).toBe(12);
    expect(finalCanvas.lineWidth).toBe(12);
  });

  it("applies outline opacity once for the complete stroke silhouette", () => {
    const resolved = brush("outline", { opacity: 0.4 });
    const stroke = strokeFromPressures([0.2, 0.8, 0.3, 1], resolved);
    const canvas = context();
    drawBrushRenderGeometry(canvas, resolveStrokeRenderGeometry(stroke), stroke.brush);

    expect(canvas.globalAlpha).toBe(0.4);
    expect(canvas.fillStyle).toBe("#111111");
    expect(canvas.fill).toHaveBeenCalledOnce();
    expect(canvas.stroke).not.toHaveBeenCalled();
  });

  it("keeps renderer snapshots authoritative for legacy centerline and Highlighter strokes", () => {
    const legacy = strokeFromPressures([0.1, 1], brush("centerline", { family: "pen", size: 8 }));
    const highlighter = strokeFromPressures(
      [0.1, 1],
      brush("centerline", { family: "highlighter", size: 12, opacity: 0.34 }),
      undefined,
      "highlighter-centerline",
    );
    const legacyGeometry = resolveStrokeRenderGeometry(legacy);
    const highlighterGeometry = resolveStrokeRenderGeometry(highlighter);
    const canvas = context();

    expect(legacyGeometry.kind).toBe("centerline");
    expect(highlighterGeometry.kind).toBe("centerline");
    expect(highlighter.widthAtPressure(0.1)).toBe(12);
    expect(highlighter.widthAtPressure(1)).toBe(12);
    drawBrushRenderGeometry(canvas, highlighterGeometry, highlighter.brush);
    expect(canvas.lineWidth).toBe(12);
    expect(canvas.globalAlpha).toBe(0.34);
    expect(canvas.stroke).toHaveBeenCalledOnce();
  });

  it("caches immutable fitted and outline geometry only by Stroke and required scale", () => {
    const stroke = strokeFromPressures([0.2, 0.8, 0.3, 1]);
    const identity = resolveStrokeRenderGeometry(stroke, 1);
    expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(identity);
    const doubled = resolveStrokeRenderGeometry(stroke, 2);
    expect(doubled).not.toBe(identity);
    expect(resolveStrokeRenderGeometry(stroke, 2)).toBe(doubled);
    expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(identity);
    expect(getStrokeRenderCacheSnapshot(stroke)).toEqual({
      pathBuildCount: 1,
      outlineBuildCount: 2,
      outlineScaleCount: 2,
    });
    for (let scale = 3; scale <= 12; scale += 1) resolveStrokeRenderGeometry(stroke, scale);
    expect(getStrokeRenderCacheSnapshot(stroke).outlineScaleCount).toBe(8);
  });

  it.each([
    ["outline", 0.5],
    ["outline", 2],
    ["outline", 4],
    ["centerline", 0.5],
    ["centerline", 2],
    ["centerline", 4],
  ] as const)("keeps %s brush width unscaled while geometry scales by %s", (kind, scale) => {
    const stroke = strokeFromPressures([0.5, 0.5], brush(kind, { family: "pen", size: 10 }));
    const bounds = getStrokeRenderedBounds(stroke, {
      translation: { x: 12, y: -7 },
      rotation: 0,
      scale,
    });
    expect(bounds.width).toBeCloseTo(20 * scale + 14, 5);
    expect(bounds.height).toBeCloseTo(14, 5);
  });

  it("returns finite conservative bounds after rotation and translation", () => {
    const stroke = strokeFromPressures(
      [0.2, 0.8, 0.3, 1],
      brush("outline", { size: 14 }),
      (index) => ({ x: index * 18, y: Math.sin(index) * 20 }),
    );
    const bounds = getStrokeRenderedBounds(stroke, {
      translation: { x: 80, y: -30 },
      rotation: Math.PI / 3,
      scale: 2,
    });
    expect(Object.values(bounds).every(Number.isFinite)).toBe(true);
    expect(bounds.width).toBeGreaterThan(14);
    expect(bounds.height).toBeGreaterThan(14);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(stroke.bounds.center.x + 80);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(stroke.bounds.center.y - 30);
  });

  it("prepares 100 through 10,000-point strategy geometry within sanity ceilings", () => {
    const observations: Record<number, Readonly<{ centerline: number; outline: number }>> = {};
    for (const pointCount of [100, 1_000, 5_000, 10_000]) {
      const stroke = strokeFromPressures(
        Array.from({ length: pointCount }, (_, index) => 0.2 + (index % 9) / 12),
        brush("outline", { size: 6 }),
        (index) => ({ x: index * 0.35, y: Math.sin(index / 25) * 12 }),
        `performance-${pointCount}`,
      );
      const centerlineStarted = performance.now();
      const centerline = createBrushRenderGeometry(
        stroke.points,
        brush("centerline", { family: "pen", size: 6 }),
      );
      const centerlineDuration = performance.now() - centerlineStarted;
      const outlineStarted = performance.now();
      const geometry = outline(createBrushRenderGeometry(stroke.points, stroke.brush));
      const outlineDuration = performance.now() - outlineStarted;
      observations[pointCount] = Object.freeze({
        centerline: centerlineDuration,
        outline: outlineDuration,
      });
      expect(centerline.kind).toBe("centerline");
      expect(geometry.outline.vertexCount).toBeLessThan(pointCount * 3 + 500);
      if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
        expect(centerlineDuration).toBeLessThan(4_000);
      if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
        expect(outlineDuration).toBeLessThan(4_000);
    }
    console.info("Phase 17B strategy geometry preparation (ms)", observations);
  });
});
