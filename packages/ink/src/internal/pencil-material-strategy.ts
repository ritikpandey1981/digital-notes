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
  materialAppearanceKey,
  materialTileKey,
  placePencilDabs,
  resolveMaterialResource,
  type CommittedPencilMaterial,
  type MaterialDab,
  type MaterialDisplayHandle,
  type MaterialTileKey,
  type PencilMaterialRuntimeOptions,
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

/**
 * What building committed Pencil geometry has cost, for the diagnostics.
 *
 * A deposited stroke's geometry is its dab stream, and placing it is the one
 * step whose cost is proportional to the whole mark rather than to the tail --
 * so it is the first thing to look at when a frame is long.
 */
const geometryDiagnostics = { builds: 0, dabs: 0, millisecondsTotal: 0, longestMilliseconds: 0 };

export function pencilGeometryDiagnostics(): Readonly<{
  builds: number;
  dabs: number;
  millisecondsTotal: number;
  longestMilliseconds: number;
}> {
  return Object.freeze({ ...geometryDiagnostics });
}

/** Geometry for one finished stroke, whose material the runtime supplies. */
export function createPencilMaterialGeometry(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
  strokeId: string,
): MaterialRenderGeometry {
  const started = performance.now();
  const dabs = placePencilDabs(points, brush);
  const geometry = materialGeometry(
    dabs,
    brush,
    { kind: "cached", cacheId: pencilMaterialCacheId(strokeId, brush), points },
    points.length,
  );
  const elapsed = performance.now() - started;
  geometryDiagnostics.builds += 1;
  geometryDiagnostics.dabs += dabs.length;
  geometryDiagnostics.millisecondsTotal += elapsed;
  geometryDiagnostics.longestMilliseconds = Math.max(
    geometryDiagnostics.longestMilliseconds,
    elapsed,
  );
  return geometry;
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

/**
 * The scratch a live tile is tinted through, allocated once for the process.
 *
 * A live frame repaints one or two tiles, and it repaints them again on the
 * next frame, so everything here is reused rather than made: one canvas, one
 * context, one `ImageData`. That last one is the point. `createImageData` hands
 * back 64 KiB, and a frame that made one per dirty tile produced megabytes of
 * garbage a second at a hundred and twenty frames -- which does not show up as
 * a slow function but as an occasional two-hundred-millisecond pause while the
 * collector catches up. It was the largest single allocator in the live path.
 *
 * Reusing the buffer is safe because every alpha byte is written on every use
 * and the colour channels are never written at all: they stay zero, which is
 * exactly what `source-in` needs.
 */
interface TileScratch {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly image: ImageData;
}

let liveScratch: TileScratch | null = null;

function tileScratch(): TileScratch {
  if (liveScratch !== null) return liveScratch;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_CELLS;
  canvas.height = TILE_CELLS;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A material tile needs a 2D context.");
  liveScratch = { canvas, context, image: context.createImageData(TILE_CELLS, TILE_CELLS) };
  return liveScratch;
}

function scratchTileCanvas(alpha: Uint8Array, color: string): HTMLCanvasElement {
  const scratch = tileScratch();
  const context = scratch.context;
  const data = scratch.image.data;
  for (let cell = 0; cell < alpha.length; cell += 1) data[cell * 4 + 3] = alpha[cell] ?? 0;
  // Writes every pixel, so the canvas needs no clearing first.
  context.globalCompositeOperation = "source-over";
  context.putImageData(scratch.image, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, TILE_CELLS, TILE_CELLS);
  context.globalCompositeOperation = "source-over";
  return scratch.canvas;
}

/** Drops the shared scratch, so a test can prove it is shared rather than made. */
export function releaseTileScratch(): void {
  if (liveScratch === null) return;
  liveScratch.canvas.width = 0;
  liveScratch = null;
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
  previewRuntime ??= createPencilMaterialRuntime({
    materialBudgetBytes: PREVIEW_MATERIAL_BUDGET_BYTES,
    indexBudgetBytes: PREVIEW_MATERIAL_BUDGET_BYTES,
  });
  return previewRuntime;
}

/**
 * A material runtime that knows how to present what it holds.
 *
 * The one place the painter and the cache are introduced to each other. The
 * material model stays free of Canvas; the runtime pays for the presentation,
 * owns its lifetime and schedules its creation, and still never learns what it
 * is made of.
 */
export function createPencilMaterialRuntime(
  options: Omit<PencilMaterialRuntimeOptions, "presentation"> = {},
): PencilMaterialRuntime {
  return new PencilMaterialRuntime({
    ...options,
    presentation: (tile, color) => createTileDisplay(tile.alpha, color),
  });
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
    color,
    bytes: TILE_CELLS * TILE_CELLS * 4,
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

/**
 * The identity one stroke's material is cached under.
 *
 * Not the stroke id alone. A restyled stroke keeps its id and changes its
 * width, opacity or colour, so identity alone would serve the graphite of a
 * mark that no longer exists -- and width and opacity are both inside the
 * deposited bytes.
 */
export function pencilMaterialCacheId(strokeId: string, brush: ResolvedBrushSnapshot): string {
  return `${strokeId}#${materialAppearanceKey(brush)}`;
}

/**
 * Presentations a single paint may build before handing the rest to the
 * scheduler.
 *
 * Measured at about 0.2 ms each in the mounted editor, so eight is under two
 * milliseconds -- comfortably inside a frame, and more than an ordinary stroke
 * occupies. Sending those few through a task hop would cost a blank frame to
 * save nothing.
 *
 * The limit is what stops that reasoning from scaling badly. A cold viewport of
 * a large project wants hundreds of tiles at once, and hundreds of them is tens
 * of milliseconds in one frame; past the limit they are requested instead and
 * arrive progressively, exactly as reconstructed material does.
 */
const PRESENTATION_INLINE_LIMIT = 8;

/**
 * The limit while a stroke is being handed over, which is deliberately much
 * higher.
 *
 * The ordinary limit protects a cold viewport of a large project, where
 * hundreds of tiles want presenting at once and none of them is urgent. The
 * frame that first paints a mark the artist has just finished drawing is the
 * opposite case in every respect: the tiles are few, their material is already
 * in hand because it was adopted rather than rebuilt, and a tile left bare is a
 * hole in artwork that was whole a moment ago.
 *
 * Measured on a 720 pixel mark at 26 page units: about 17 tiles, which at the
 * measured 0.2 ms each is between three and four milliseconds -- inside one
 * frame at 120 Hz. Rationing them instead paints 46% of the mark and fills the
 * rest in over the following 20 ms, which is the flicker. The limit is kept
 * because it still has to bound the pathological case; it is set where a mark
 * far larger than anyone draws in one gesture still arrives whole.
 */
const PRESENTATION_HANDOFF_LIMIT = 96;

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
  let built = 0;
  const smoothing = context.imageSmoothingEnabled;
  context.imageSmoothingEnabled = true;
  // Established once for the whole stroke: the transform does not change
  // between its tiles, and neither should the grid they are placed on.
  const grid = deviceGrid(context);
  if (grid !== null) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
  // A stroke still being handed over from the live layer finishes in this
  // frame rather than being rationed a tile at a time.
  const handingOver =
    supply.kind === "cached" && runtime !== null && runtime.isHandingOver(supply.cacheId);
  const inlineLimit = handingOver ? PRESENTATION_HANDOFF_LIMIT : PRESENTATION_INLINE_LIMIT;
  for (const key of geometry.tileKeys) {
    if (only !== undefined && !only.has(key)) continue;
    if (supply.kind === "live") {
      const alpha = supply.tiles.get(key);
      if (alpha === undefined) continue;
      drawTile(context, scratchTileCanvas(alpha, brush.color), key, grid);
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
        ? cache.tileNow(supply.cacheId, key, supply.points, brush)
        : cache.tile(supply.cacheId, key);
    if (tile === null) {
      missing.push(key);
      continue;
    }
    let display = cache.display(supply.cacheId, key) as TileDisplay | null;
    // A presentation tinted with a colour the brush no longer has is stale.
    // Only the tint is rebuilt; the graphite underneath it is untouched.
    if (display !== null && display.color !== brush.color) display = null;
    if (display === null) {
      if (runtime !== null && built >= inlineLimit) {
        // Past the fast path this frame. Ask for it and leave the tile bare
        // rather than spending the rest of the frame tinting.
        missing.push(key);
        continue;
      }
      const started = performance.now();
      display = createTileDisplay(tile.alpha, brush.color);
      cache.notePresentationBuild(performance.now() - started);
      cache.attachDisplay(supply.cacheId, key, display);
      display = (cache.display(supply.cacheId, key) as TileDisplay | null) ?? display;
      built += 1;
    }
    if (display.canvas.width === 0) {
      missing.push(key);
      continue;
    }
    drawTile(context, display.canvas, key, grid);
    painted += 1;
  }
  if (grid !== null) context.restore();
  context.imageSmoothingEnabled = smoothing;
  // Painted whole, so it is an ordinary cached mark from here on. A local
  // repaint of a few tiles says nothing about the rest of the mark and must
  // not end the handover on their behalf.
  if (handingOver && only === undefined && missing.length === 0 && supply.kind === "cached") {
    runtime?.endHandover(supply.cacheId);
  }
  return { painted, missing };
}

/**
 * How a run of tiles is put on the canvas.
 *
 * Adjacent tiles abut *exactly* in page space -- tile `t` ends at `t * 64` and
 * tile `t + 1` begins there -- and that is not enough. Each `drawImage` is
 * rasterized on its own, so when the shared boundary falls between two device
 * pixels the straddled pixel is covered partly by the left tile and then partly
 * by the right one. Two partial coverages composited with `source-over` do not
 * add up to one: a pixel that should have been solid graphite comes out
 * lighter, and the result is a pale line along every tile boundary -- the grid
 * a person sees through broad Pencil.
 *
 * Measured directly, with uniform tiles so that nothing but the compositor can
 * vary: body tone 80, seam tone 86-118, at exactly `floor(n x pitch)`. It
 * appears wherever the pitch is fractional -- 64 x 1.93 = 123.52 -- and,
 * because panning is continuous, at *every* zoom once the camera sits on a
 * fractional offset. At 0.8 the boundaries that happen to land on whole pixels
 * (5 x 51.2 = 256) have no seam at all, which is the mechanism confirming
 * itself.
 *
 * The rule that removes it: a tile is placed by **whole device pixels**, and
 * both neighbours derive their shared edge from the same page coordinate
 * through the same rounding. They therefore agree on it exactly, by
 * construction rather than by luck, and no pixel is ever left partly covered.
 *
 * Placing them means drawing under the identity transform, which is also why
 * the edges agree to the bit: going back to page space to express the rectangle
 * would reassociate the arithmetic, and `(l - e) / a + (r - l) / a` is not
 * `(r - e) / a` in floating point. A clip is held in device space and is
 * unaffected by the transform change.
 *
 * `null` means draw exactly, in page space: either the canvas cannot say what
 * transform it is under, or that transform is rotated or skewed. Under rotation
 * there is no device axis to snap to and the seam is not an axis-aligned line
 * anyway.
 */
interface DeviceGrid {
  readonly a: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

function deviceGrid(context: CanvasRenderingContext2D): DeviceGrid | null {
  if (typeof context.getTransform !== "function") return null;
  const matrix = context.getTransform();
  if (matrix.b !== 0 || matrix.c !== 0 || matrix.a === 0 || matrix.d === 0) return null;
  return { a: matrix.a, d: matrix.d, e: matrix.e, f: matrix.f };
}

/** One tile's rectangle on the canvas, in whole device pixels. */
export function materialTileDeviceRect(
  grid: DeviceGrid,
  key: MaterialTileKey,
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const comma = key.indexOf(",");
  const left = Number(key.slice(0, comma)) * TILE_PAGE_UNITS;
  const top = Number(key.slice(comma + 1)) * TILE_PAGE_UNITS;
  const x = Math.round(grid.a * left + grid.e);
  const y = Math.round(grid.d * top + grid.f);
  const right = Math.round(grid.a * (left + TILE_PAGE_UNITS) + grid.e);
  const bottom = Math.round(grid.d * (top + TILE_PAGE_UNITS) + grid.f);
  // A tile scaled below a pixel would round away to nothing and take its
  // material with it. One pixel is wrong by less than one pixel; a tile that
  // vanishes is wrong by a tile.
  return {
    x: Math.min(x, right),
    y: Math.min(y, bottom),
    width: Math.max(1, Math.abs(right - x)),
    height: Math.max(1, Math.abs(bottom - y)),
  };
}

function drawTile(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  key: MaterialTileKey,
  grid: DeviceGrid | null,
): void {
  if (grid === null) {
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
    return;
  }
  const rect = materialTileDeviceRect(grid, key);
  context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height);
}

/**
 * The device grid a context is drawing on, for the tests and the diagnostic.
 *
 * Exported so that "adjacent tiles cover continuously" is asserted as
 * arithmetic on the rectangles rather than as a comparison of screenshots.
 */
export function materialTileGrid(context: CanvasRenderingContext2D): DeviceGrid | null {
  return deviceGrid(context);
}

/**
 * Draws the material tile lattice over the artwork.
 *
 * A development instrument, never enabled in a build: it exists so that a
 * reported "grid" can be held against the real tile boundaries, and the two
 * either line up or they do not. It is what established that the seam this
 * module now places away was tile-aligned rather than something in the
 * deposited material.
 */
export function drawMaterialTileGrid(
  context: CanvasRenderingContext2D,
  keys: Iterable<MaterialTileKey>,
  color = "#ff00ff",
): void {
  const grid = deviceGrid(context);
  if (grid === null) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.strokeStyle = color;
  context.lineWidth = 1;
  for (const key of keys) {
    const rect = materialTileDeviceRect(grid, key);
    context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }
  context.restore();
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
