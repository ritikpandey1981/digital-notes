import { describe, expect, it } from "vitest";
import {
  createResolvedBrushSnapshot,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  createBrushRenderGeometry,
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import { brushSizeAtPressure } from "../internal/brush-dynamics";
import { createOutlineStrokeGeometry } from "../internal/outline-geometry";
import { createProfessionalInkPath } from "../internal/professional-ink-path";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePoint, StrokePointInput } from "../types";

/**
 * `centerline@1` and `outline@1` draw artwork that already exists on disk, so
 * what they produce is frozen. Two independent gates protect that here.
 *
 * The first compares the registry against a local transcription of the dispatch
 * it replaced, which catches a routing mistake. The second pins a digest of the
 * geometry itself, which catches a change inside the builders the routing reaches.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const NONE: BrushSmoothing = Object.freeze({ mode: "none", amount: 0 });

function legacyBrush(
  kind: "centerline" | "outline",
  smoothing: BrushSmoothing = NONE,
  pressureEnabled = kind === "outline",
): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `legacy-${kind}`,
    presetVersion: 1,
    family: kind === "outline" ? "pen" : "marker",
    color: "#111111",
    size: 8,
    opacity: 0.9,
    smoothing,
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: pressureEnabled,
        minimumFactor: pressureEnabled ? 0.5 : 1,
        maximumFactor: pressureEnabled ? 1.5 : 1,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    }),
    renderer: Object.freeze({ version: 1, kind }),
  });
}

function sample(x: number, y: number, index: number, pressure: number): StrokePointInput {
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

function strokeOf(brush: ResolvedBrushSnapshot, id: string, count = 24): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < count; index += 1) {
    builder.addPoint(
      sample(
        index * 7 + Math.sin(index / 3) * 4,
        Math.cos(index / 2.5) * 22,
        index,
        0.15 + ((index * 0.11) % 0.8),
      ),
    );
  }
  return builder.finalize();
}

/** The dispatch that existed before the strategy registry, transcribed verbatim. */
function preRegistryGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): BrushRenderGeometry {
  const path = createProfessionalInkPath(points, brush.smoothing);
  if (brush.renderer.kind === "outline") {
    const outline = createOutlineStrokeGeometry(path, brush, renderedScale);
    return { kind: "outline", path, outline, renderedScale, bounds: outline.bounds };
  }
  return {
    kind: "centerline",
    path,
    renderedScale,
    bounds: legacyCenterlineBounds(path, brush, renderedScale),
  };
}

/** The legacy centerline bounds rule, transcribed: one averaged width for the whole stroke. */
function legacyCenterlineBounds(
  path: ReturnType<typeof createProfessionalInkPath>,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): { x: number; y: number; width: number; height: number } {
  const coordinates: Array<Readonly<{ x: number; y: number }>> = [];
  for (const segment of path.segments) {
    coordinates.push(
      segment.start,
      { x: segment.control1X, y: segment.control1Y },
      { x: segment.control2X, y: segment.control2Y },
      segment.end,
    );
  }
  if (coordinates.length === 0 && path.points[0] !== undefined) coordinates.push(path.points[0]);
  if (coordinates.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const coordinate of coordinates) {
    minimumX = Math.min(minimumX, coordinate.x);
    minimumY = Math.min(minimumY, coordinate.y);
    maximumX = Math.max(maximumX, coordinate.x);
    maximumY = Math.max(maximumY, coordinate.y);
  }
  const averageDiameter =
    path.sourcePoints.reduce(
      (total, point) => total + brushSizeAtPressure(brush, point.pressure),
      0,
    ) / Math.max(path.sourcePoints.length, 1);
  const radius = averageDiameter / (renderedScale * 2);
  return {
    x: minimumX - radius,
    y: minimumY - radius,
    width: maximumX - minimumX + radius * 2,
    height: maximumY - minimumY + radius * 2,
  };
}

function digest(geometry: BrushRenderGeometry): string {
  const round = (value: number): string => value.toFixed(6);
  const parts = [
    geometry.kind,
    round(geometry.bounds.x),
    round(geometry.bounds.y),
    round(geometry.bounds.width),
    round(geometry.bounds.height),
  ];
  if (geometry.kind === "centerline" || geometry.kind === "outline") {
    parts.push(String(geometry.path.points.length), String(geometry.path.segments.length));
    for (const segment of geometry.path.segments) {
      parts.push(
        round(segment.start.x),
        round(segment.start.y),
        round(segment.control1X),
        round(segment.control1Y),
        round(segment.control2X),
        round(segment.control2Y),
        round(segment.end.x),
        round(segment.end.y),
      );
    }
  }
  if (geometry.kind === "outline") {
    parts.push(String(geometry.outline.vertexCount), String(geometry.outline.roundJoins.length));
    for (const vertex of geometry.outline.boundary) parts.push(round(vertex.x), round(vertex.y));
  }
  return parts.join("|");
}

describe("frozen legacy brush strategies", () => {
  it.each([
    ["centerline", NONE],
    ["centerline", Object.freeze({ mode: "average", amount: 0.4 }) as BrushSmoothing],
    ["outline", NONE],
    ["outline", Object.freeze({ mode: "average", amount: 0.4 }) as BrushSmoothing],
  ] as const)(
    "routes %s at smoothing %o exactly as the pre-registry dispatch did",
    (kind, smoothing) => {
      const brush = legacyBrush(kind, smoothing);
      const stroke = strokeOf(brush, `freeze-${kind}-${smoothing.amount}`);

      for (const renderedScale of [1, 0.5, 2.5]) {
        expect(digest(createBrushRenderGeometry(stroke.points, brush, renderedScale))).toBe(
          digest(preRegistryGeometry(stroke.points, brush, renderedScale)),
        );
        expect(digest(resolveStrokeRenderGeometry(stroke, renderedScale))).toBe(
          digest(preRegistryGeometry(stroke.points, brush, renderedScale)),
        );
      }
    },
  );

  it("keeps the centerline stroke-wide average width rather than varying it", () => {
    // The flattening is a defect in newer terms and is deliberately preserved:
    // artwork saved before the engine had strategies renders through this path.
    const brush = legacyBrush("centerline", NONE, true);
    const stroke = strokeOf(brush, "freeze-centerline-average");
    const geometry = resolveStrokeRenderGeometry(stroke);
    expect(geometry.kind).toBe("centerline");

    const widths = stroke.points.map((point) => stroke.widthAtPressure(point.pressure));
    expect(Math.min(...widths)).toBeLessThan(Math.max(...widths));
  });

  it("pins the exact geometry both frozen strategies produce", () => {
    const cases = [
      ["centerline", legacyBrush("centerline")],
      ["outline", legacyBrush("outline")],
    ] as const;
    const digests = cases.map(([name, brush]) => {
      const stroke = strokeOf(brush, `golden-${name}`, 16);
      return `${name}:${hash(digest(resolveStrokeRenderGeometry(stroke)))}`;
    });

    // Regenerating these to make a failing run pass would defeat the gate. A
    // change here means saved artwork would look different than it used to.
    expect(digests).toEqual(["centerline:13xinti", "outline:q2vnyz"]);
  });
});

/** Compact, order-sensitive digest so a golden expectation stays readable. */
function hash(value: string): string {
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return (accumulator >>> 0).toString(36);
}
