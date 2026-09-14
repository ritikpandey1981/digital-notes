import {
  CoordinateConverter,
  RenderScheduler,
  Viewport,
  type AnimationFrameAdapter,
} from "@folio/rendering";
import { describe, expect, it } from "vitest";
import {
  createResolvedBrushSnapshot,
  type BrushRendererKind,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  createBrushRenderGeometry,
  getStrokeRenderCacheSnapshot,
  resolveStrokeRenderGeometry,
} from "../internal/brush-render-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePoint } from "../types";

const POINT_COUNTS = [100, 1_000, 5_000, 10_000, 25_000] as const;
const SMOOTHING_AMOUNTS = [0, 0.25, 1] as const;

describe("Phase 17D brush performance and device validation", () => {
  it("coalesces 60, 120, and 240 Hz synthetic sample rates to one geometry build per frame", () => {
    const observations: Record<
      number,
      Readonly<{
        samplesProcessed: number;
        framesRendered: number;
        geometryBuilds: number;
        renderPoints: number;
      }>
    > = {};
    const source = syntheticPoints(240);
    const brush = createBrush("centerline", 0);

    for (const rate of [60, 120, 240] as const) {
      const callbacks = new Map<number, FrameRequestCallback>();
      let nextHandle = 1;
      let samplesProcessed = 0;
      let framesRendered = 0;
      let geometryBuilds = 0;
      let renderPoints = 0;
      const adapter: AnimationFrameAdapter = {
        request(callback) {
          const handle = nextHandle++;
          callbacks.set(handle, callback);
          return handle;
        },
        cancel(handle) {
          callbacks.delete(handle);
        },
      };
      const scheduler = new RenderScheduler(() => {
        const geometry = createBrushRenderGeometry(
          Object.freeze(source.slice(0, samplesProcessed)),
          brush,
        );
        framesRendered += 1;
        geometryBuilds += 1;
        renderPoints = geometry.path.points.length;
      }, adapter);
      const samplesPerFrame = rate / 60;

      for (let frame = 0; frame < 60; frame += 1) {
        for (let sample = 0; sample < samplesPerFrame; sample += 1) {
          samplesProcessed += 1;
          scheduler.requestRender();
        }
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(frame * (1_000 / 60)));
      }

      observations[rate] = Object.freeze({
        samplesProcessed,
        framesRendered,
        geometryBuilds,
        renderPoints,
      });
      expect(samplesProcessed).toBe(rate);
      expect(framesRendered).toBe(60);
      expect(geometryBuilds).toBe(60);
      expect(renderPoints).toBeLessThanOrEqual(samplesProcessed);
      scheduler.destroy();
    }

    console.info("Phase 17D synthetic input-rate observations", observations);
  });

  it("profiles 100 through 25,000 points across centerline, outline, and smoothing loads", () => {
    const source = syntheticPoints(25_000);
    const observations: Record<
      string,
      Readonly<{
        durationMilliseconds: number;
        sourcePoints: number;
        renderPoints: number;
        segments: number;
        vertices: number;
      }>
    > = {};

    for (const pointCount of POINT_COUNTS) {
      const points = Object.freeze(source.slice(0, pointCount));
      for (const smoothing of SMOOTHING_AMOUNTS) {
        for (const kind of ["centerline", "outline"] as const) {
          const startedAt = performance.now();
          const geometry = createBrushRenderGeometry(points, createBrush(kind, smoothing));
          const durationMilliseconds = performance.now() - startedAt;
          const vertices = geometry.kind === "outline" ? geometry.outline.vertexCount : 0;
          observations[`${pointCount}/${kind}/${Math.round(smoothing * 100)}%`] = Object.freeze({
            durationMilliseconds,
            sourcePoints: geometry.path.sourcePointCount,
            renderPoints: geometry.path.points.length,
            segments: geometry.path.segments.length,
            vertices,
          });

          if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
            expect(durationMilliseconds).toBeLessThan(10_000);
          expect(geometry.path.sourcePointCount).toBe(pointCount);
          expect(geometry.path.points.length).toBeLessThanOrEqual(pointCount);
          expect(geometry.path.segments.length).toBeLessThanOrEqual(
            Math.max(0, geometry.path.points.length - 1),
          );
          if (geometry.kind === "outline") {
            expect(geometry.outline.vertexCount).toBeLessThan(pointCount * 5 + 2_000);
          }
        }
      }
    }

    console.info("Phase 17D long-stroke geometry observations (ms/counts)", observations);
  }, 30_000);

  it("keeps stationary process data bounded while retaining pressure, tilt, and twist changes", () => {
    const builder = new StrokeBuilder({
      id: "stationary-load",
      timestamp: 0,
      brush: createBrush("outline", 0.2),
      smoother: new StrokeSmoother({ mode: "none" }),
    });
    for (let index = 0; index < 10_000; index += 1) {
      builder.addPoint(inputPoint(40, 60, index, 0.5));
    }
    builder.addPoint({
      ...inputPoint(40, 60, 10_000, 0.8),
      tiltX: 12,
      tiltY: -8,
      twist: 45,
    });
    const stroke = builder.finalize();

    expect(stroke.pointCount).toBe(1);
    expect(stroke.sourceSampleCount).toBeLessThanOrEqual(627);
    expect(stroke.sourceSamples.at(-1)).toMatchObject({
      pressure: 0.8,
      tiltX: 12,
      tiltY: -8,
      twist: 45,
    });
  });

  it("reuses committed geometry for 1,000 strokes and releases cache ownership to Stroke identity", () => {
    const startedAt = performance.now();
    const strokes = Array.from({ length: 1_000 }, (_, index) =>
      createStroke(`cache-${index}`, 3, index),
    );
    for (const stroke of strokes) {
      const first = resolveStrokeRenderGeometry(stroke, 1);
      expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(first);
      expect(getStrokeRenderCacheSnapshot(stroke)).toEqual({
        pathBuildCount: 1,
        outlineBuildCount: 1,
        outlineScaleCount: 1,
      });
    }
    const durationMilliseconds = performance.now() - startedAt;

    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
      expect(durationMilliseconds).toBeLessThan(10_000);
    console.info("Phase 17D 1,000-stroke committed-cache preparation (ms)", {
      durationMilliseconds,
      pathBuilds: strokes.length,
      cacheHits: strokes.length,
    });
  });

  it("keeps canonical geometry invariant across the 25% through 800% zoom matrix", () => {
    const stroke = createStroke("zoom-invariant", 500, 0);
    const geometry = resolveStrokeRenderGeometry(stroke, 1);
    const canonicalPoints = stroke.points;

    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
      const viewport = viewportAtDpr(1);
      viewport.camera.setZoom(zoom);
      expect(resolveStrokeRenderGeometry(stroke, 1)).toBe(geometry);
      expect(stroke.points).toBe(canonicalPoints);
      expect(viewport.camera.zoom).toBe(zoom);
    }
    expect(getStrokeRenderCacheSnapshot(stroke)).toEqual({
      pathBuildCount: 1,
      outlineBuildCount: 1,
      outlineScaleCount: 1,
    });
  });

  it("keeps screen-to-page coordinates and brush CSS width independent of DPR", () => {
    const pagePoints = [1, 1.5, 2].map((devicePixelRatio) => {
      const viewport = viewportAtDpr(devicePixelRatio);
      const point = new CoordinateConverter(viewport).screenToPage(
        { x: 500, y: 400 },
        { x: 0, y: 0, width: 1_000, height: 800 },
      );
      return {
        devicePixelRatio: viewport.snapshot().devicePixelRatio,
        point,
        cursorCssDiameter: Math.max(7, 12 * viewport.camera.zoom),
      };
    });

    expect(pagePoints.map(({ point }) => point)).toEqual([
      { x: 300, y: 350 },
      { x: 300, y: 350 },
      { x: 300, y: 350 },
    ]);
    expect(pagePoints.map(({ cursorCssDiameter }) => cursorCssDiameter)).toEqual([12, 12, 12]);
  });
});

function createBrush(kind: BrushRendererKind, smoothing: number): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `phase-17d-${kind}-${smoothing}`,
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: 6,
    opacity: 1,
    smoothing: { mode: smoothing === 0 ? "none" : "average", amount: smoothing },
    dynamics: {
      pressureSize: {
        enabled: kind === "outline",
        minimumFactor: kind === "outline" ? 0.35 : 1,
        maximumFactor: kind === "outline" ? 1.65 : 1,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    },
    renderer: { version: 1, kind },
  });
}

function syntheticPoints(count: number): readonly StrokePoint[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const previousX = index === 0 ? 0 : (index - 1) * 0.35;
      const previousY = index === 0 ? 0 : Math.sin((index - 1) / 25) * 12;
      const x = index * 0.35;
      const y = Math.sin(index / 25) * 12 + Math.sin(index / 7) * 0.4;
      return Object.freeze({
        ...inputPoint(x, y, index * 4, 0.2 + (index % 9) / 12),
        delta: Object.freeze({ x: x - previousX, y: y - previousY }),
        velocity: index === 0 ? 0 : Math.hypot(x - previousX, y - previousY) / 0.004,
        acceleration: 0,
      });
    }),
  );
}

function inputPoint(x: number, y: number, timestamp: number, pressure: number) {
  return Object.freeze({
    x,
    y,
    timestamp,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen" as const,
    button: 0,
    buttons: 1,
  });
}

function createStroke(id: string, pointCount: number, offset: number) {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush: createBrush("outline", 0.25),
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < pointCount; index += 1) {
    builder.addPoint(
      inputPoint(index * 0.5, offset * 0.01 + Math.sin(index / 12) * 8, index * 4, 0.5),
    );
  }
  return builder.finalize();
}

function viewportAtDpr(devicePixelRatio: number): Viewport {
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio,
  });
  viewport.centerPage();
  return viewport;
}
