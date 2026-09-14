import type { Rect } from "@folio/rendering";
import { brushStrategyKey, type BrushStrategyId, type ResolvedBrushSnapshot } from "../brush-model";
import { InkError } from "../errors";
import type { Stroke } from "../stroke";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import { drawSmoothStrokeSegments, drawStrokedPath } from "./draw-stroke";
import { createOutlineStrokeGeometry, type OutlineStrokeGeometry } from "./outline-geometry";
import { createProfessionalInkPath, type ProfessionalInkPath } from "./professional-ink-path";
import {
  TechnicalPenEvaluator,
  createTechnicalPenGeometry,
  type LiveBrushEvaluator,
  type StrokedPathRenderGeometry,
} from "./technical-pen";

export interface CenterlineRenderGeometry {
  readonly kind: "centerline";
  readonly path: ProfessionalInkPath;
  readonly renderedScale: number;
  readonly bounds: Rect;
}

export interface OutlineRenderGeometry {
  readonly kind: "outline";
  readonly path: ProfessionalInkPath;
  readonly outline: OutlineStrokeGeometry;
  readonly renderedScale: number;
  readonly bounds: Rect;
}

export type BrushRenderGeometry =
  CenterlineRenderGeometry | OutlineRenderGeometry | StrokedPathRenderGeometry;

interface StrokeRenderCache {
  readonly path: ProfessionalInkPath;
  readonly centerline: CenterlineRenderGeometry;
  readonly outlines: Map<number, OutlineRenderGeometry>;
  outlineBuildCount: number;
}

export interface StrokeRenderCacheSnapshot {
  readonly pathBuildCount: number;
  readonly outlineBuildCount: number;
  readonly outlineScaleCount: number;
}

const strokeCaches = new WeakMap<Stroke, StrokeRenderCache>();
const strokedPathCaches = new WeakMap<Stroke, Map<number, StrokedPathRenderGeometry>>();
const MAX_OUTLINE_SCALE_CACHE_ENTRIES = 8;

/**
 * One render strategy: the code that turns a resolved snapshot plus samples
 * into geometry, and the code that paints that geometry.
 *
 * A strategy is addressed only by its durable `(id, version)` identity, so
 * nothing in a saved project ever names a module or a function. Lookup is a
 * static table: this is dispatch, not a plugin system, and there is deliberately
 * no runtime registration and no third-party extension point.
 */
interface BrushRenderStrategy {
  readonly id: BrushStrategyId;
  readonly version: number;
  /** Transient geometry for the samples seen so far. */
  readonly createGeometry: (
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
    renderedScale: number,
  ) => BrushRenderGeometry;
  /** Geometry for one finalized stroke, cached by immutable Stroke identity and scale. */
  readonly resolveGeometry: (stroke: Stroke, renderedScale: number) => BrushRenderGeometry;
  readonly draw: (
    context: CanvasRenderingContext2D,
    geometry: BrushRenderGeometry,
    brush: ResolvedBrushSnapshot,
  ) => void;
  /**
   * An incremental evaluator, for a strategy whose live path can reuse settled
   * work. A strategy without one is simply rebuilt each frame, as both frozen
   * legacy strategies still are.
   */
  readonly createLiveEvaluator?: (brush: ResolvedBrushSnapshot) => LiveBrushEvaluator;
}

const LEGACY_CENTERLINE_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "centerline",
  version: 1,
  createGeometry: (points, brush, renderedScale) =>
    createCenterlineGeometry(
      createProfessionalInkPath(points, brush.smoothing),
      brush,
      renderedScale,
    ),
  resolveGeometry: (stroke, renderedScale) => {
    const cache = legacyCache(stroke);
    return renderedScale === 1
      ? cache.centerline
      : createCenterlineGeometry(cache.path, stroke.brush, renderedScale);
  },
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "centerline") return;
    drawSmoothStrokeSegments(
      context,
      geometry.path.points,
      geometry.path.segments,
      brush,
      geometry.renderedScale,
    );
  },
});

const LEGACY_OUTLINE_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "outline",
  version: 1,
  createGeometry: (points, brush, renderedScale) =>
    createOutlineGeometry(createProfessionalInkPath(points, brush.smoothing), brush, renderedScale),
  resolveGeometry: (stroke, renderedScale) => {
    const cache = legacyCache(stroke);
    let outline = cache.outlines.get(renderedScale);
    if (outline === undefined) {
      outline = createOutlineGeometry(cache.path, stroke.brush, renderedScale);
      if (cache.outlines.size >= MAX_OUTLINE_SCALE_CACHE_ENTRIES) {
        const oldestScale = cache.outlines.keys().next().value as number | undefined;
        if (oldestScale !== undefined) cache.outlines.delete(oldestScale);
      }
      cache.outlines.set(renderedScale, outline);
      cache.outlineBuildCount += 1;
    }
    return outline;
  },
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "outline") return;
    drawOutline(context, geometry.outline, brush);
  },
});

const TECHNICAL_PEN_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "technical-pen",
  version: 1,
  createGeometry: (points, brush, renderedScale) =>
    createTechnicalPenGeometry(points, brush, renderedScale),
  resolveGeometry: (stroke, renderedScale) => {
    let byScale = strokedPathCaches.get(stroke);
    if (byScale === undefined) {
      byScale = new Map<number, StrokedPathRenderGeometry>();
      strokedPathCaches.set(stroke, byScale);
    }
    let geometry = byScale.get(renderedScale);
    if (geometry === undefined) {
      geometry = createTechnicalPenGeometry(stroke.points, stroke.brush, renderedScale);
      if (byScale.size >= MAX_OUTLINE_SCALE_CACHE_ENTRIES) {
        const oldestScale = byScale.keys().next().value as number | undefined;
        if (oldestScale !== undefined) byScale.delete(oldestScale);
      }
      byScale.set(renderedScale, geometry);
    }
    return geometry;
  },
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "stroked-path") return;
    drawStrokedPath(context, geometry, brush);
  },
  createLiveEvaluator: (brush) => new TechnicalPenEvaluator(brush),
});

const BRUSH_RENDER_STRATEGIES: ReadonlyMap<string, BrushRenderStrategy> = new Map(
  [LEGACY_CENTERLINE_STRATEGY, LEGACY_OUTLINE_STRATEGY, TECHNICAL_PEN_STRATEGY].map((strategy) => [
    brushStrategyKey(strategy.id, strategy.version),
    strategy,
  ]),
);

/** Every strategy identity the renderer can actually draw, for drift tests. */
export function registeredBrushStrategies(): readonly string[] {
  return Object.freeze([...BRUSH_RENDER_STRATEGIES.keys()].sort());
}

/**
 * Resolves one durable strategy identity to the code that draws it.
 *
 * A snapshot that names something this build cannot render fails loudly.
 * Substituting a nearby strategy would silently change what saved artwork looks
 * like, which is the one outcome the versioned vocabulary exists to prevent.
 */
function requireBrushRenderStrategy(brush: ResolvedBrushSnapshot): BrushRenderStrategy {
  const key = brushStrategyKey(brush.renderer.kind, brush.renderer.version);
  const strategy = BRUSH_RENDER_STRATEGIES.get(key);
  if (strategy === undefined) {
    throw new InkError(
      "UNSUPPORTED_BRUSH_STRATEGY",
      `Brush render strategy '${key}' is not registered.`,
      { kind: brush.renderer.kind, version: brush.renderer.version },
    );
  }
  return strategy;
}

/** Builds transient geometry for the latest active-stroke points. */
export function createBrushRenderGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale = 1,
): BrushRenderGeometry {
  assertScale(renderedScale);
  return requireBrushRenderStrategy(brush).createGeometry(points, brush, renderedScale);
}

/** Reuses strategy-specific geometry derived only from one immutable Stroke snapshot. */
export function resolveStrokeRenderGeometry(
  stroke: Stroke,
  renderedScale = 1,
): BrushRenderGeometry {
  assertScale(renderedScale);
  return requireBrushRenderStrategy(stroke.brush).resolveGeometry(stroke, renderedScale);
}

/**
 * The incremental evaluator for this snapshot's strategy, or null when it has
 * none and its live path rebuilds instead.
 */
export function createLiveBrushEvaluator(brush: ResolvedBrushSnapshot): LiveBrushEvaluator | null {
  return requireBrushRenderStrategy(brush).createLiveEvaluator?.(brush) ?? null;
}

export function drawBrushRenderGeometry(
  context: CanvasRenderingContext2D,
  geometry: BrushRenderGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  requireBrushRenderStrategy(brush).draw(context, geometry, brush);
}

export function getStrokeRenderCacheSnapshot(stroke: Stroke): StrokeRenderCacheSnapshot {
  const cache = strokeCaches.get(stroke);
  return Object.freeze({
    pathBuildCount: cache === undefined ? 0 : 1,
    outlineBuildCount: cache?.outlineBuildCount ?? 0,
    outlineScaleCount: cache?.outlines.size ?? 0,
  });
}

/** The fitted path both frozen legacy strategies share, built once per Stroke. */
function legacyCache(stroke: Stroke): StrokeRenderCache {
  let cache = strokeCaches.get(stroke);
  if (cache === undefined) {
    const path = createProfessionalInkPath(stroke.points, stroke.brush.smoothing);
    const centerline = createCenterlineGeometry(path, stroke.brush, 1);
    cache = { path, centerline, outlines: new Map(), outlineBuildCount: 0 };
    strokeCaches.set(stroke, cache);
  }
  return cache;
}

function createCenterlineGeometry(
  path: ProfessionalInkPath,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): CenterlineRenderGeometry {
  return Object.freeze({
    kind: "centerline",
    path,
    renderedScale,
    bounds: centerlineBounds(path, brush, renderedScale),
  });
}

function createOutlineGeometry(
  path: ProfessionalInkPath,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): OutlineRenderGeometry {
  const outline = createOutlineStrokeGeometry(path, brush, renderedScale);
  return Object.freeze({
    kind: "outline",
    path,
    outline,
    renderedScale,
    bounds: outline.bounds,
  });
}

function drawOutline(
  context: CanvasRenderingContext2D,
  geometry: OutlineStrokeGeometry,
  brush: ResolvedBrushSnapshot,
): void {
  if (geometry.centerline.length === 0) return;
  context.save();
  context.globalAlpha *= brush.opacity;
  context.fillStyle = brush.color;
  context.beginPath();
  if (geometry.dot !== null) {
    context.arc(geometry.dot.center.x, geometry.dot.center.y, geometry.dot.radius, 0, Math.PI * 2);
  } else {
    const first = geometry.boundary[0];
    if (first === undefined) {
      context.restore();
      return;
    }
    context.moveTo(first.x, first.y);
    for (const point of geometry.boundary.slice(1)) context.lineTo(point.x, point.y);
  }
  for (const join of geometry.roundJoins) {
    context.moveTo(join.center.x + join.radius, join.center.y);
    context.arc(join.center.x, join.center.y, join.radius, 0, Math.PI * 2);
  }
  // One fill applies configured opacity once, including at joins and self-crossings.
  context.fill();
  context.restore();
}

function centerlineBounds(
  path: ProfessionalInkPath,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): Rect {
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
  if (coordinates.length === 0) return freezeRect({ x: 0, y: 0, width: 0, height: 0 });
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of coordinates) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const averageDiameter =
    path.sourcePoints.reduce(
      (total, point) => total + brushSizeAtPressure(brush, point.pressure),
      0,
    ) / Math.max(path.sourcePoints.length, 1);
  const radius = averageDiameter / (renderedScale * 2);
  return freezeRect({
    x: minimumX - radius,
    y: minimumY - radius,
    width: maximumX - minimumX + radius * 2,
    height: maximumY - minimumY + radius * 2,
  });
}

function freezeRect(rect: Rect): Rect {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function assertScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Brush render scale must be positive and finite.");
  }
}
