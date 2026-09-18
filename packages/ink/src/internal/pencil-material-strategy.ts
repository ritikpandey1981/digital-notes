import type { Rect } from "@folio/rendering";
import type { ResolvedBrushSnapshot } from "../brush-model";
import type { StrokePoint } from "../types";
import type {
  BrushStamp,
  LiveBrushEvaluator,
  LiveEvaluationSnapshot,
  MaterialRenderGeometry,
  MaterialTileSupply,
} from "./brush-geometry";
import {
  MATERIAL_RESOLUTION,
  MaterialFieldCache,
  PencilMaterialAccumulator,
  PencilMaterialRuntime,
  TILE_CELLS,
  TILE_PAGE_UNITS,
  collectDabTiles,
  createPencilMaterialProgram,
  materialTileKey,
  placePencilDabs,
  resolveMaterialResource,
  type CommittedPencilMaterial,
  type MaterialDab,
  type MaterialDisplayHandle,
  type MaterialTileKey,
} from "./pencil-material";

/**
 * `pencil@1` as a deposited medium: how a stroke becomes material, and how
 * material becomes pixels.
 *
 * This is the half of the strategy that faces the engine. The material itself
 * lives in `pencil-material/`, knows nothing about Canvas, and is the same
 * whether it is being drawn or redrawn; this module decides *where the tiles
 * come from* -- a live accumulator while the pencil is down, the runtime cache
 * afterwards -- and paints them.
 *
 * Two consequences of depositing rather than drawing, and both are deliberate:
 *
 * - **Scale is not a parameter.** Material is deposited once, in the frame the
 *   artist drew it in, and an object transform is applied to the finished
 *   material when it is painted. So a scaled Pencil object scales its graphite,
 *   the way scaling a photograph of a drawing does, rather than keeping one
 *   painted width and growing more paper between the marks. The alternative --
 *   redepositing at the new scale -- would resample the sheet, which means an
 *   object that was only resized would come back a different drawing.
 * - **A tile may not be ready.** Reconstruction is cooperative, so painting is
 *   "draw the material that exists" plus a request for the rest. A tile that is
 *   not resident is left bare until its exact bytes arrive; there is no
 *   approximate Pencil, because an approximation of a texture is a different
 *   texture.
 */

/** Page-space padding folded into material bounds, matching the tile support. */
const BOUNDS_PADDING = 0.5;

function stampFromDab(dab: MaterialDab, index: number): BrushStamp {
  return Object.freeze({
    x: dab.x,
    y: dab.y,
    radius: dab.radius,
    index,
    coverage: dab.coverage,
    // One dab is one contact. What survives of it is the sheet's business, and
    // is not knowable without depositing it.
    markCount: 1,
  });
}

interface Extent {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
}

function emptyExtent(): Extent {
  return {
    minimumX: Number.POSITIVE_INFINITY,
    minimumY: Number.POSITIVE_INFINITY,
    maximumX: Number.NEGATIVE_INFINITY,
    maximumY: Number.NEGATIVE_INFINITY,
  };
}

function foldDab(extent: Extent, dab: MaterialDab): void {
  extent.minimumX = Math.min(extent.minimumX, dab.x - dab.radius);
  extent.minimumY = Math.min(extent.minimumY, dab.y - dab.radius);
  extent.maximumX = Math.max(extent.maximumX, dab.x + dab.radius);
  extent.maximumY = Math.max(extent.maximumY, dab.y + dab.radius);
}

function unionExtent(target: Extent, other: Extent): void {
  target.minimumX = Math.min(target.minimumX, other.minimumX);
  target.minimumY = Math.min(target.minimumY, other.minimumY);
  target.maximumX = Math.max(target.maximumX, other.maximumX);
  target.maximumY = Math.max(target.maximumY, other.maximumY);
}

function extentRect(extent: Extent): Rect {
  if (!Number.isFinite(extent.minimumX)) return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  return Object.freeze({
    x: extent.minimumX - BOUNDS_PADDING,
    y: extent.minimumY - BOUNDS_PADDING,
    width: extent.maximumX - extent.minimumX + BOUNDS_PADDING * 2,
    height: extent.maximumY - extent.minimumY + BOUNDS_PADDING * 2,
  });
}

function boundsFromDabs(dabs: readonly MaterialDab[]): Rect {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const dab of dabs) {
    minimumX = Math.min(minimumX, dab.x - dab.radius);
    minimumY = Math.min(minimumY, dab.y - dab.radius);
    maximumX = Math.max(maximumX, dab.x + dab.radius);
    maximumY = Math.max(maximumY, dab.y + dab.radius);
  }
  if (!Number.isFinite(minimumX)) return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  return Object.freeze({
    x: minimumX - BOUNDS_PADDING,
    y: minimumY - BOUNDS_PADDING,
    width: maximumX - minimumX + BOUNDS_PADDING * 2,
    height: maximumY - minimumY + BOUNDS_PADDING * 2,
  });
}

/** Every tile one dab stream occupies, in the order the stroke first reached them. */
export function materialTileKeysFor(dabs: readonly MaterialDab[]): readonly MaterialTileKey[] {
  const keys: MaterialTileKey[] = [];
  const seen = new Set<MaterialTileKey>();
  const scratch: number[] = [];
  for (const dab of dabs) {
    const pairs = collectDabTiles(dab, scratch);
    for (let pair = 0; pair < pairs.length; pair += 2) {
      const key = materialTileKey(pairs[pair] ?? 0, pairs[pair + 1] ?? 0);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return Object.freeze(keys);
}

function materialGeometry(
  dabs: readonly MaterialDab[],
  brush: ResolvedBrushSnapshot,
  supply: MaterialTileSupply,
  sourcePointCount: number,
  tileKeys?: readonly MaterialTileKey[],
): MaterialRenderGeometry {
  const stamps = Object.freeze(dabs.map(stampFromDab));
  const resting = dabs.length === 1 ? dabs[0] : undefined;
  return Object.freeze({
    kind: "material",
    supply,
    tileKeys: tileKeys ?? materialTileKeysFor(dabs),
    stamps,
    markCount: dabs.length,
    alpha: brush.opacity,
    dot:
      resting === undefined
        ? null
        : Object.freeze({
            center: Object.freeze({ x: resting.x, y: resting.y }),
            radius: resting.radius,
          }),
    hitGeometry: stamps,
    // Material is deposited in the artwork's own frame, so there is no scale in
    // it; the object transform is applied when it is painted.
    renderedScale: 1,
    bounds: boundsFromDabs(dabs),
    sourcePointCount,
    keptPointCount: dabs.length,
  });
}

/** Geometry for one finished stroke, whose material the runtime supplies. */
export function createPencilMaterialGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  strokeId: string,
): MaterialRenderGeometry {
  const dabs = placePencilDabs(points, brush);
  return materialGeometry(dabs, brush, { kind: "cached", strokeId, points }, points.length);
}

/**
 * The live evaluator: one accumulator, fed a growing sample array.
 *
 * It satisfies the same settled-prefix contract every engine strategy does, and
 * for the same reason -- a frame costs the open tail rather than the stroke --
 * but what it settles is deposited material rather than contours, so a frame
 * also *repaints* only the tiles that changed. {@link dirtyTiles} is how the
 * renderer learns which those were.
 */
export class PencilMaterialEvaluator implements LiveBrushEvaluator {
  readonly #brush: ResolvedBrushSnapshot;
  readonly #accumulator: PencilMaterialAccumulator;
  #dirty: ReadonlySet<MaterialTileKey> = new Set();
  /** Settled stamps, then this frame's tail. Truncated on rewind, never revised. */
  readonly #stamps: BrushStamp[] = [];
  readonly #settledExtent: Extent = emptyExtent();
  #settledStamps = 0;
  #sourcePointCount = 0;
  #settledEvaluations = 0;
  #tailEvaluations = 0;
  #maximumTailEvaluations = 0;
  #finalized = false;

  constructor(brush: ResolvedBrushSnapshot, fields?: MaterialFieldCache) {
    this.#brush = brush;
    const program = createPencilMaterialProgram(brush);
    this.#accumulator = new PencilMaterialAccumulator(
      brush,
      fields ?? new MaterialFieldCache(resolveMaterialResource(program.paperResourceId)),
    );
  }

  /** The tiles the last `append` changed. Exactly what a local repaint must redraw. */
  get dirtyTiles(): ReadonlySet<MaterialTileKey> {
    return this.#dirty;
  }

  get finalized(): boolean {
    return this.#accumulator.finalized;
  }

  append(points: readonly StrokePoint[], final: boolean): void {
    if (this.#finalized) return;
    const settledBefore = this.#accumulator.settledSampleCount;
    this.#sourcePointCount = points.length;
    this.#dirty = this.#accumulator.append(points, final);
    this.#settledEvaluations += this.#accumulator.settledSampleCount - settledBefore;
    this.#tailEvaluations = points.length - this.#accumulator.settledSampleCount;
    this.#maximumTailEvaluations = Math.max(this.#maximumTailEvaluations, this.#tailEvaluations);
    if (final) this.#finalized = true;
  }

  /**
   * The stroke as a painter and the editor see it, rebuilt from the tail alone.
   *
   * Everything here is incremental for the same reason the material is: a frame
   * that mapped every dab to a stamp, or folded every dab into the bounds,
   * would be O(total stroke) whatever the evaluator underneath it did. Settled
   * stamps are appended once and never revisited, and the settled extent is
   * only ever grown -- so a frame costs the tail, in geometry as well as in
   * pixels.
   */
  geometry(): MaterialRenderGeometry {
    const dabs = this.#accumulator.dabs;
    const settled = this.#accumulator.settledDabCount;
    // The tail was rewound, so anything past the settled watermark is stale.
    if (this.#stamps.length > this.#settledStamps) this.#stamps.length = this.#settledStamps;
    for (let index = this.#stamps.length; index < settled; index += 1) {
      const dab = dabs[index];
      if (dab === undefined) break;
      this.#stamps.push(stampFromDab(dab, index));
      foldDab(this.#settledExtent, dab);
    }
    this.#settledStamps = this.#stamps.length;
    const tail = emptyExtent();
    for (let index = settled; index < dabs.length; index += 1) {
      const dab = dabs[index];
      if (dab === undefined) break;
      this.#stamps.push(stampFromDab(dab, index));
      foldDab(tail, dab);
    }
    unionExtent(tail, this.#settledExtent);

    const tiles = new Map<MaterialTileKey, Uint8Array>();
    for (const key of this.#accumulator.tileKeys()) {
      const tile = this.#accumulator.tile(key);
      if (tile !== null) tiles.set(key, tile.alpha);
    }
    const stamps = this.#stamps as readonly BrushStamp[];
    const resting = dabs.length === 1 ? dabs[0] : undefined;
    return Object.freeze({
      kind: "material",
      supply: Object.freeze({ kind: "live" as const, tiles }),
      tileKeys: [...tiles.keys()],
      stamps,
      markCount: dabs.length,
      alpha: this.#brush.opacity,
      dot:
        resting === undefined
          ? null
          : Object.freeze({
              center: Object.freeze({ x: resting.x, y: resting.y }),
              radius: resting.radius,
            }),
      hitGeometry: stamps,
      renderedScale: 1,
      bounds: extentRect(tail),
      sourcePointCount: this.#sourcePointCount,
      keptPointCount: dabs.length,
    });
  }

  evaluationSnapshot(): LiveEvaluationSnapshot {
    return Object.freeze({
      settledPointEvaluations: this.#settledEvaluations,
      tailPointEvaluations: this.#tailEvaluations,
      maximumTailPointEvaluations: this.#maximumTailEvaluations,
      settledSegmentCount: this.#accumulator.settledDabCount,
      segmentCount: this.#accumulator.dabs.length,
      keptPointCount: this.#accumulator.dabs.length,
      lookaheadSamples: this.#accumulator.lookaheadSamples,
    });
  }

  /** Hands the finished material to the runtime that will keep it. */
  commit(): CommittedPencilMaterial {
    return this.#accumulator.commit();
  }

  dispose(): void {
    this.#accumulator.dispose();
  }
}

/**
 * A tile's presentation: its alpha, tinted with the stroke's colour.
 *
 * Colour is applied here and never in the material, so one cached tile serves
 * every colour and no pigment is baked into a cache. Base opacity is already
 * inside the alpha bytes and is deliberately *not* applied again -- a painter
 * that reapplied it would darken the mark at every redraw.
 *
 * `source-in` rather than a parsed colour: it hands the whole of CSS colour
 * syntax to the engine that already implements it, and costs one fill of a
 * 128-square.
 */
function paintTileCanvas(alpha: Uint8Array, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_CELLS;
  canvas.height = TILE_CELLS;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A material tile needs a 2D context.");
  const image = context.createImageData(TILE_CELLS, TILE_CELLS);
  const data = image.data;
  for (let cell = 0; cell < alpha.length; cell += 1) data[cell * 4 + 3] = alpha[cell] ?? 0;
  context.putImageData(image, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, TILE_CELLS, TILE_CELLS);
  return canvas;
}

/** One scratch canvas for live tiles, whose bytes change every frame anyway. */
let liveScratch: HTMLCanvasElement | null = null;

function scratchTileCanvas(alpha: Uint8Array, color: string): HTMLCanvasElement {
  const canvas = liveScratch ?? paintTileCanvas(alpha, color);
  if (liveScratch === null) {
    liveScratch = canvas;
    return canvas;
  }
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A material tile needs a 2D context.");
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, TILE_CELLS, TILE_CELLS);
  const image = context.createImageData(TILE_CELLS, TILE_CELLS);
  const data = image.data;
  for (let cell = 0; cell < alpha.length; cell += 1) data[cell * 4 + 3] = alpha[cell] ?? 0;
  context.putImageData(image, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, TILE_CELLS, TILE_CELLS);
  context.globalCompositeOperation = "source-over";
  return canvas;
}

/**
 * The material cache for callers that are not the editor.
 *
 * Layer thumbnails, page previews and exports all paint artwork without a
 * project runtime in hand, and all of them are off the interactive path. They
 * share one small bounded cache rather than rebuilding every tile per call or
 * inventing a runtime each time. The editor never reaches this: it owns its
 * own runtime, which is the ownership rule that actually matters.
 */
const PREVIEW_MATERIAL_BUDGET_BYTES = 8 * 1024 * 1024;
let previewRuntime: PencilMaterialRuntime | null = null;

export function previewMaterialRuntime(): PencilMaterialRuntime {
  previewRuntime ??= new PencilMaterialRuntime({
    materialBudgetBytes: PREVIEW_MATERIAL_BUDGET_BYTES,
    indexBudgetBytes: PREVIEW_MATERIAL_BUDGET_BYTES,
  });
  return previewRuntime;
}

export function releasePreviewMaterialRuntime(): void {
  previewRuntime?.destroy();
  previewRuntime = null;
}

/** A cached tile presentation, and what the cache is charged for holding it. */
interface TileDisplay extends MaterialDisplayHandle {
  readonly canvas: HTMLCanvasElement;
}

function createTileDisplay(alpha: Uint8Array, color: string): TileDisplay {
  const canvas = paintTileCanvas(alpha, color);
  return {
    canvas,
    bytes: TILE_CELLS * TILE_CELLS * 4,
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/** What a material paint actually managed to draw, for the renderer's diagnostics. */
export interface MaterialPaintResult {
  readonly painted: number;
  readonly missing: readonly MaterialTileKey[];
}

/**
 * Paints one stroke's material.
 *
 * A cached supply draws what the runtime holds and reports what it does not, so
 * the caller can ask for the rest; nothing approximate is drawn in the
 * meantime. A live supply draws the accumulator's own tiles, which are always
 * complete because the accumulator is synchronous.
 */
export function drawPencilMaterial(
  context: CanvasRenderingContext2D,
  geometry: MaterialRenderGeometry,
  brush: ResolvedBrushSnapshot,
  runtime: PencilMaterialRuntime | null,
  only?: ReadonlySet<MaterialTileKey>,
): MaterialPaintResult {
  const supply = geometry.supply;
  const missing: MaterialTileKey[] = [];
  let painted = 0;
  const smoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = true;
  for (const key of geometry.tileKeys) {
    if (only !== undefined && !only.has(key)) continue;
    if (supply.kind === "live") {
      const alpha = supply.tiles.get(key);
      if (alpha === undefined) continue;
      drawTile(context, scratchTileCanvas(alpha, brush.color), key);
      painted += 1;
      continue;
    }
    // A caller with no runtime is off the interactive path by definition -- a
    // thumbnail, a preview, an export -- and cannot come back when a tile
    // arrives. It gets the shared preview cache and waits; the editor supplies
    // its own runtime and is told what to ask for instead.
    const cache = runtime ?? previewMaterialRuntime();
    const tile =
      runtime === null
        ? cache.tileNow(supply.strokeId, key, supply.points, brush)
        : cache.tile(supply.strokeId, key);
    if (tile === null) {
      missing.push(key);
      continue;
    }
    let display = cache.display(supply.strokeId, key) as TileDisplay | null;
    if (display === null) {
      display = createTileDisplay(tile.alpha, brush.color);
      cache.attachDisplay(supply.strokeId, key, display);
      display = (cache.display(supply.strokeId, key) as TileDisplay | null) ?? display;
    }
    if (display.canvas.width === 0) {
      missing.push(key);
      continue;
    }
    drawTile(context, display.canvas, key);
    painted += 1;
  }
  context.imageSmoothingEnabled = smoothing;
  return { painted, missing };
}

function drawTile(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  key: MaterialTileKey,
): void {
  const comma = key.indexOf(",");
  const tx = Number(key.slice(0, comma));
  const ty = Number(key.slice(comma + 1));
  context.drawImage(
    canvas,
    tx * TILE_PAGE_UNITS,
    ty * TILE_PAGE_UNITS,
    TILE_PAGE_UNITS,
    TILE_PAGE_UNITS,
  );
}

/** The page rectangle one material tile covers, for dirty-region invalidation. */
export function materialTileRect(key: MaterialTileKey): Rect {
  const comma = key.indexOf(",");
  const tx = Number(key.slice(0, comma));
  const ty = Number(key.slice(comma + 1));
  return Object.freeze({
    x: tx * TILE_PAGE_UNITS,
    y: ty * TILE_PAGE_UNITS,
    width: TILE_PAGE_UNITS,
    height: TILE_PAGE_UNITS,
  });
}

/** Cells per page unit, re-exported so the renderer can size its clears. */
export { MATERIAL_RESOLUTION, TILE_PAGE_UNITS };
