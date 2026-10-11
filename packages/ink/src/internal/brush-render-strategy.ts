import type { Rect } from "@folio/rendering";
import { brushStrategyKey, type BrushStrategyId, type ResolvedBrushSnapshot } from "../brush-model";
import { InkError } from "../errors";
import type { Stroke } from "../stroke";
import type { StrokePoint } from "../types";
import { brushSizeAtPressure } from "./brush-dynamics";
import type { LiveBrushEvaluator, LiveRenderGeometry } from "./brush-geometry";
import { brushSeed } from "./brush-random";
import {
  drawFilledPath,
  drawMarkerSwath,
  drawSmoothStrokeSegments,
  drawStrokedPath,
} from "./draw-stroke";
import { createOutlineStrokeGeometry, type OutlineStrokeGeometry } from "./outline-geometry";
import type { PencilMaterialRuntime } from "./pencil-material";
import {
  PencilMaterialEvaluator,
  createPencilMaterialGeometry,
  drawPencilMaterial,
} from "./pencil-material-strategy";
import { MarkerEvaluator, createMarkerGeometry } from "./marker";
import { PressurePenEvaluator, createPressurePenGeometry } from "./pressure-pen";
import { createProfessionalInkPath, type ProfessionalInkPath } from "./professional-ink-path";
import { TechnicalPenEvaluator, createTechnicalPenGeometry } from "./technical-pen";

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
  CenterlineRenderGeometry | OutlineRenderGeometry | LiveRenderGeometry;

/**
 * What a painter needs beyond the geometry itself.
 *
 * Only a deposited medium has one: its pixels live in a runtime cache rather
 * than in the geometry, so the painter has to be told which cache. Everything
 * else describes itself completely and ignores this.
 */
export interface BrushPaintContext {
  readonly materialRuntime: PencilMaterialRuntime | null;
  /** Restricts the paint to these material tiles, for a local repaint. */
  readonly tiles?: ReadonlySet<string>;
  /** Told which tiles the cache did not have, so the caller can ask for them. */
  readonly onMissing?: (keys: readonly string[]) => void;
}

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
const evaluatedCaches = new WeakMap<Stroke, Map<string, LiveRenderGeometry>>();
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
    seed: number,
    strokeId: string,
  ) => BrushRenderGeometry;
  /** Geometry for one finalized stroke, cached by immutable Stroke identity and scale. */
  readonly resolveGeometry: (stroke: Stroke, renderedScale: number) => BrushRenderGeometry;
  readonly draw: (
    context: CanvasRenderingContext2D,
    geometry: BrushRenderGeometry,
    brush: ResolvedBrushSnapshot,
    paint?: BrushPaintContext,
  ) => void;
  /**
   * An incremental evaluator, for a strategy whose live path can reuse settled
   * work. A strategy without one is simply rebuilt each frame, as both frozen
   * legacy strategies still are.
   */
  readonly createLiveEvaluator?: (
    brush: ResolvedBrushSnapshot,
    renderedScale: number,
    seed: number,
    strokeId: string,
  ) => LiveBrushEvaluator;
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
  resolveGeometry: (stroke, renderedScale) =>
    cachedEvaluatedGeometry(stroke, "technical-pen", renderedScale, () =>
      createTechnicalPenGeometry(stroke.points, stroke.brush, renderedScale),
    ),
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "stroked-path") return;
    drawStrokedPath(context, geometry, brush);
  },
  createLiveEvaluator: (brush, renderedScale) => new TechnicalPenEvaluator(brush, renderedScale),
});

/**
 * The same settled-prefix contract as Technical Pen, with pressure driving
 * width and opacity and a filled silhouette in place of a stroked path.
 */
const PRESSURE_PEN_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "pressure-pen",
  version: 1,
  createGeometry: (points, brush, renderedScale) =>
    createPressurePenGeometry(points, brush, renderedScale),
  resolveGeometry: (stroke, renderedScale) =>
    cachedEvaluatedGeometry(stroke, "pressure-pen", renderedScale, () =>
      createPressurePenGeometry(stroke.points, stroke.brush, renderedScale),
    ),
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "filled-path") return;
    drawFilledPath(context, geometry, brush);
  },
  createLiveEvaluator: (brush, renderedScale) => new PressurePenEvaluator(brush, renderedScale),
});

/**
 * The same settled-prefix contract again, over a stream of tip placements
 * rather than a continuous shape, with pressure driving how much of each tip
 * inks rather than how dark it is.
 */
/**
 * `pencil@1`: graphite deposited into a material raster, not drawn as contours.
 *
 * The only strategy whose pixels do not come out of its geometry. Geometry here
 * is the dab stream -- where the tip touched, how wide it was, how much it was
 * carrying -- which is what bounds, hit testing and the eraser read; the marks
 * themselves are deposited per cell and cached by the runtime.
 *
 * Scale is deliberately absent. Material is deposited once in the artwork's own
 * frame and an object transform is applied when it is painted, so the cache key
 * is one geometry per stroke rather than one per zoom level.
 */
const PENCIL_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "pencil",
  version: 1,
  createGeometry: (points, brush, _renderedScale, _seed, strokeId) =>
    createPencilMaterialGeometry(points, brush, strokeId),
  resolveGeometry: (stroke) =>
    cachedEvaluatedGeometry(stroke, "pencil", 1, () =>
      createPencilMaterialGeometry(stroke.points, stroke.brush, stroke.id),
    ),
  draw: (context, geometry, brush, paint) => {
    if (geometry.kind !== "material") return;
    const result = drawPencilMaterial(
      context,
      geometry,
      brush,
      paint?.materialRuntime ?? null,
      paint?.tiles,
    );
    paint?.onMissing?.(result.missing);
  },
  createLiveEvaluator: (brush) => new PencilMaterialEvaluator(brush),
});

/**
 * `marker@1`: a solid felt nib of fixed page-space orientation, swept.
 *
 * The same settled-prefix contract as the two pens, over a swath rather than a
 * path or a silhouette. Its character is the shape being dragged: the nib is
 * oriented, so one diagonal is the widest mark the brush can make and the other
 * is the narrowest, while horizontal and vertical come out alike.
 *
 * Not a deposited medium. It has no material, no cache and no runtime state
 * beyond the geometry every strategy keeps, and one stroke is one closed
 * contour filled once -- which is where its accumulation semantics come from
 * rather than from a rule applied afterwards.
 */
const MARKER_STRATEGY: BrushRenderStrategy = Object.freeze<BrushRenderStrategy>({
  id: "marker",
  version: 1,
  createGeometry: (points, brush, renderedScale) =>
    createMarkerGeometry(points, brush, renderedScale),
  resolveGeometry: (stroke, renderedScale) =>
    cachedEvaluatedGeometry(stroke, "marker", renderedScale, () =>
      createMarkerGeometry(stroke.points, stroke.brush, renderedScale),
    ),
  draw: (context, geometry, brush) => {
    if (geometry.kind !== "marker-swath") return;
    drawMarkerSwath(context, geometry, brush);
  },
  createLiveEvaluator: (brush, renderedScale) => new MarkerEvaluator(brush, renderedScale),
});

const BRUSH_RENDER_STRATEGIES: ReadonlyMap<string, BrushRenderStrategy> = new Map(
  [
    LEGACY_CENTERLINE_STRATEGY,
    LEGACY_OUTLINE_STRATEGY,
    TECHNICAL_PEN_STRATEGY,
    PRESSURE_PEN_STRATEGY,
    PENCIL_STRATEGY,
    MARKER_STRATEGY,
  ].map((strategy) => [brushStrategyKey(strategy.id, strategy.version), strategy]),
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

/**
 * Builds transient geometry for the latest active-stroke points.
 *
 * `strokeId` is the identity a strategy with deterministic variation seeds
 * itself from. It is an argument rather than something read off a `Stroke`
 * because live drawing has no finalized stroke yet -- only the id the builder
 * fixed before the first sample, which is exactly the id the committed stroke
 * will carry. That is what makes the live and committed grain the same grain.
 */
export function createBrushRenderGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  renderedScale = 1,
  strokeId = "",
): BrushRenderGeometry {
  assertScale(renderedScale);
  return requireBrushRenderStrategy(brush).createGeometry(
    points,
    brush,
    renderedScale,
    brushSeed(strokeId),
    strokeId,
  );
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
export function createLiveBrushEvaluator(
  brush: ResolvedBrushSnapshot,
  renderedScale = 1,
  strokeId = "",
): LiveBrushEvaluator | null {
  assertScale(renderedScale);
  return (
    requireBrushRenderStrategy(brush).createLiveEvaluator?.(
      brush,
      renderedScale,
      brushSeed(strokeId),
      strokeId,
    ) ?? null
  );
}

/**
 * Geometry for one finalized stroke under one strategy and scale.
 *
 * Keyed by both, because a stroke outlives a zoom. An eight-entry window per
 * stroke is what stops a pinch-zoom from rebuilding every visible stroke on
 * every frame, and what stops a long session from retaining every scale it
 * ever passed through.
 */
function cachedEvaluatedGeometry(
  stroke: Stroke,
  id: BrushStrategyId,
  renderedScale: number,
  build: () => LiveRenderGeometry,
): LiveRenderGeometry {
  let byScale = evaluatedCaches.get(stroke);
  if (byScale === undefined) {
    byScale = new Map<string, LiveRenderGeometry>();
    evaluatedCaches.set(stroke, byScale);
  }
  const key = `${id}:${renderedScale}`;
  const cached = byScale.get(key);
  if (cached !== undefined) return cached;
  const geometry = build();
  if (byScale.size >= MAX_OUTLINE_SCALE_CACHE_ENTRIES) {
    const oldest = byScale.keys().next().value as string | undefined;
    if (oldest !== undefined) byScale.delete(oldest);
  }
  byScale.set(key, geometry);
  return geometry;
}

export function drawBrushRenderGeometry(
  context: CanvasRenderingContext2D,
  geometry: BrushRenderGeometry,
  brush: ResolvedBrushSnapshot,
  paint?: BrushPaintContext,
): void {
  requireBrushRenderStrategy(brush).draw(context, geometry, brush, paint);
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
