import type { ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import type { CommittedPencilMaterial } from "./accumulator";
import { PencilDabIndex } from "./dab-index";
import { MaterialFieldCache } from "./fields";
import { createPencilMaterialProgram, type PencilMaterialProgram } from "./program";
import {
  createReconstructionScratch,
  reconstructMaterialTile,
  type MaterialReconstructionScratch,
} from "./reconstruction";
import { resolveMaterialResource } from "./resources";
import {
  MaterialPriority,
  PencilReconstructionScheduler,
  type MaterialPriorityValue,
  type MaterialSchedulerHost,
  type MaterialSchedulerStats,
  type MaterialTileRequest,
} from "./scheduler";
import { COMMITTED_TILE_BYTES, type CommittedMaterialTile, type MaterialTileKey } from "./tiles";

/**
 * Who owns deposited material, what it may cost, and what happens when they
 * stop.
 *
 * **The runtime owns it. Nothing else may.** Not `Stroke`, not `PageDocument`,
 * not `SketchbookDocument`, not History, not `ResolvedBrushSnapshot`, and not
 * the codec. The reason is not tidiness: the moment a tile is reachable from
 * any of those, dropping it stops being free, undo has pixels in it, and a save
 * has a cache in it. Every guarantee the material model makes -- deterministic
 * rebuild, bounded memory, transient pixels -- follows from this one boundary.
 *
 * The invariant is stated as a test rather than as a comment: **clearing this
 * runtime changes nothing an artist can see, once the material is rebuilt.**
 *
 * Two budgets, not one. Material is pixels and is measured in tens of
 * megabytes; an index is coordinates and is measured in single ones. Sharing a
 * cap between them would let a pan evict indexes it is about to rebuild, which
 * is the most expensive possible thing to forget.
 */

/**
 * Desktop budgets, from the project-scale simulations.
 *
 * 64 MiB of material holds a thousand-stroke navigation at four-fifths hit
 * rate. 128 MiB removes eviction entirely and needs ninety resident megabytes
 * to save reconstruction that is already spread across frames; 32 MiB works and
 * pays about a fifth more on every navigation.
 *
 * 16 MiB of index is headroom rather than a constraint -- the measured peak was
 * under 2.5 MiB with no eviction at any size -- and is set here so that a
 * denser project than the simulated one still never evicts coordinates that
 * material could have had instead.
 */
export const DEFAULT_MATERIAL_BUDGET_BYTES = 64 * 1024 * 1024;
export const DEFAULT_INDEX_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * A painter's cached presentation of one tile, held by the cache that pays for
 * it.
 *
 * The material model is typed arrays and integers; a display handle is whatever
 * a backend needs to actually put one on screen, which for Canvas 2D is a
 * canvas. Keeping it opaque is what lets the runtime charge for it -- a
 * displayed tile is 80 KiB, not 16, and a budget that ignored the other 64
 * would be wrong by a factor of five -- without the material model learning
 * what a canvas is.
 */
export interface MaterialDisplayHandle {
  readonly bytes: number;
  release(): void;
}

interface MaterialEntry {
  readonly tile: CommittedMaterialTile;
  display: MaterialDisplayHandle | null;
  bytes: number;
  visible: boolean;
}

interface IndexEntry {
  readonly index: PencilDabIndex;
  readonly bytes: number;
}

export interface PencilMaterialRuntimeOptions {
  /** False once the owning project runtime has been retired. */
  readonly isActive?: () => boolean;
  readonly materialBudgetBytes?: number;
  readonly indexBudgetBytes?: number;
  /** Called when reconstruction finishes tiles, so the compositor can repaint them. */
  readonly onMaterialPublished?: (strokeId: string, keys: readonly MaterialTileKey[]) => void;
  readonly scheduler?: (host: MaterialSchedulerHost) => PencilReconstructionScheduler;
}

export interface PencilMaterialRuntimeStats {
  readonly strokes: number;
  readonly residentTiles: number;
  readonly residentMaterialBytes: number;
  readonly materialBudgetBytes: number;
  readonly materialEvictions: number;
  readonly materialHits: number;
  readonly materialMisses: number;
  readonly residentIndexes: number;
  readonly residentIndexBytes: number;
  readonly indexBudgetBytes: number;
  readonly indexEvictions: number;
  readonly fieldTiles: number;
  readonly fieldBytes: number;
  readonly reconstructedTiles: number;
  readonly scheduler: MaterialSchedulerStats;
}

export class PencilMaterialRuntime {
  /** `strokeId` -> `tileKey` -> entry. Nested so releasing a stroke is one delete. */
  readonly #material = new Map<string, Map<MaterialTileKey, MaterialEntry>>();
  /** Flat least-recently-used order over the same entries. */
  readonly #order = new Map<string, { strokeId: string; key: MaterialTileKey }>();
  readonly #indexes = new Map<string, IndexEntry>();
  readonly #fields = new Map<string, MaterialFieldCache>();
  readonly #scratch: MaterialReconstructionScratch = createReconstructionScratch();
  readonly #isActive: () => boolean;
  readonly #materialBudget: number;
  readonly #indexBudget: number;
  readonly #onPublished: ((strokeId: string, keys: readonly MaterialTileKey[]) => void) | undefined;
  readonly #scheduler: PencilReconstructionScheduler;
  #materialBytes = 0;
  #indexBytes = 0;
  #materialEvictions = 0;
  #indexEvictions = 0;
  #hits = 0;
  #misses = 0;
  #reconstructed = 0;
  #retired = false;

  constructor(options: PencilMaterialRuntimeOptions = {}) {
    this.#isActive = options.isActive ?? (() => true);
    this.#materialBudget = options.materialBudgetBytes ?? DEFAULT_MATERIAL_BUDGET_BYTES;
    this.#indexBudget = options.indexBudgetBytes ?? DEFAULT_INDEX_BUDGET_BYTES;
    this.#onPublished = options.onMaterialPublished;
    const host: MaterialSchedulerHost = {
      isActive: () => this.active,
      fieldsFor: (program) => this.fieldsFor(program),
      index: (strokeId) => this.#indexes.get(strokeId)?.index ?? null,
      adoptIndex: (strokeId, index) => this.#storeIndex(strokeId, index),
      publish: (strokeId, tile) => this.#store(strokeId, tile, true),
      resident: (strokeId, key) => this.#material.get(strokeId)?.has(key) === true,
      onPublished: (strokeId, keys) => this.#onPublished?.(strokeId, keys),
    };
    this.#scheduler = options.scheduler?.(host) ?? new PencilReconstructionScheduler(host);
  }

  get active(): boolean {
    return !this.#retired && this.#isActive();
  }

  get scheduler(): PencilReconstructionScheduler {
    return this.#scheduler;
  }

  /**
   * A resident tile, or null.
   *
   * The hot path, and deliberately the shortest one in the file: no scheduler,
   * no index, no reconstruction and no task hop. A cache that made a hit cost a
   * frame would be worse than no cache.
   */
  tile(strokeId: string, key: MaterialTileKey): CommittedMaterialTile | null {
    const entry = this.#touch(strokeId, key);
    if (entry === null) {
      this.#misses += 1;
      return null;
    }
    this.#hits += 1;
    return entry.tile;
  }

  /** A resident tile's cached presentation, if the painter has made one. */
  display(strokeId: string, key: MaterialTileKey): MaterialDisplayHandle | null {
    return this.#touch(strokeId, key)?.display ?? null;
  }

  /** Attaches a painter's presentation to a resident tile, and charges for it. */
  attachDisplay(strokeId: string, key: MaterialTileKey, handle: MaterialDisplayHandle): void {
    const entry = this.#material.get(strokeId)?.get(key);
    if (entry === undefined) {
      handle.release();
      return;
    }
    entry.display?.release();
    this.#materialBytes -= entry.bytes;
    entry.display = handle;
    entry.bytes = COMMITTED_TILE_BYTES + handle.bytes;
    this.#materialBytes += entry.bytes;
    this.#trimMaterial();
  }

  /** Marks which tiles are on screen, so eviction can prefer the ones that are not. */
  markVisible(visible: Iterable<Readonly<{ strokeId: string; key: MaterialTileKey }>>): void {
    for (const tiles of this.#material.values()) {
      for (const entry of tiles.values()) entry.visible = false;
    }
    for (const { strokeId, key } of visible) {
      const entry = this.#material.get(strokeId)?.get(key);
      if (entry !== undefined) entry.visible = true;
    }
  }

  /**
   * Asks for material that is not resident, cooperatively.
   *
   * The request is the whole answer to "what should exist now", so it replaces
   * the last one rather than adding to it -- see the scheduler, where that is
   * what makes a pan cancel its own obsolete work.
   */
  requestVisible(requests: readonly MaterialTileRequest[]): void {
    if (!this.active) return;
    this.#scheduler.request(requests);
  }

  /** Builds one request for a stroke, resolving its material program. */
  createRequest(
    strokeId: string,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
    tileKeys: readonly MaterialTileKey[],
    priority: MaterialPriorityValue = MaterialPriority.VisibleCenter,
  ): MaterialTileRequest {
    return {
      strokeId,
      points,
      brush,
      program: createPencilMaterialProgram(brush),
      priority,
      tileKeys,
    };
  }

  /**
   * One tile, reconstructed synchronously if it is not resident.
   *
   * For callers that cannot come back later -- a thumbnail, an export, a test.
   * The interactive path uses {@link tile} plus {@link requestVisible} instead,
   * because a viewport that reconstructed synchronously would be a freeze.
   */
  tileNow(
    strokeId: string,
    key: MaterialTileKey,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
  ): CommittedMaterialTile | null {
    const resident = this.tile(strokeId, key);
    if (resident !== null) return resident;
    const program = createPencilMaterialProgram(brush);
    const tile = reconstructMaterialTile(
      key,
      this.index(strokeId, points, brush),
      program,
      this.fieldsFor(program),
      this.#scratch,
    );
    if (tile === null) return null;
    this.#reconstructed += 1;
    this.#store(strokeId, tile, false);
    return tile;
  }

  /** The index for one stroke, built from its samples if it is not resident. */
  index(
    strokeId: string,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
  ): PencilDabIndex {
    const resident = this.#indexes.get(strokeId);
    if (resident !== undefined) {
      // Least-recently-used last.
      this.#indexes.delete(strokeId);
      this.#indexes.set(strokeId, resident);
      return resident.index;
    }
    const index = PencilDabIndex.build(points, brush);
    this.#storeIndex(strokeId, index);
    return index;
  }

  /** True when this stroke's index is already resident, for the cold/warm tests. */
  hasIndex(strokeId: string): boolean {
    return this.#indexes.has(strokeId);
  }

  /**
   * Takes over material a stroke has just finished depositing.
   *
   * The live accumulator has already computed every tile it touched, so
   * throwing them away at commit only to rebuild them on the next frame would
   * be the most expensive possible moment to have an empty cache.
   */
  adopt(strokeId: string, committed: CommittedPencilMaterial): void {
    this.#storeIndex(strokeId, committed.index.seal());
    for (const tile of committed.tiles.values()) this.#store(strokeId, tile, true);
  }

  /** Forgets one stroke's material and index. The stroke itself is untouched. */
  releaseStroke(strokeId: string): void {
    this.#scheduler.cancelStroke(strokeId);
    const tiles = this.#material.get(strokeId);
    if (tiles !== undefined) {
      for (const [key, entry] of tiles) {
        entry.display?.release();
        this.#materialBytes -= entry.bytes;
        this.#order.delete(orderKey(strokeId, key));
      }
      this.#material.delete(strokeId);
    }
    const index = this.#indexes.get(strokeId);
    if (index !== undefined) {
      this.#indexBytes -= index.bytes;
      this.#indexes.delete(strokeId);
    }
  }

  /** Drops every cached byte and every pending job. */
  clear(): void {
    this.#scheduler.cancelAll();
    for (const tiles of this.#material.values()) {
      for (const entry of tiles.values()) entry.display?.release();
    }
    this.#material.clear();
    this.#order.clear();
    this.#indexes.clear();
    for (const cache of this.#fields.values()) cache.clear();
    this.#fields.clear();
    this.#materialBytes = 0;
    this.#indexBytes = 0;
    this.#scratch.tile = null;
  }

  /**
   * Retires the runtime with the project that owned it.
   *
   * Afterwards `active` is false for ever, so a slice already in flight
   * publishes nothing into the successor.
   */
  destroy(): void {
    this.#retired = true;
    this.#scheduler.destroy();
    this.clear();
  }

  /**
   * One field cache per sheet, shared by every stroke drawn on it.
   *
   * The fields are a property of the page, not of a mark, so a per-stroke cache
   * would hold as many copies of one patch of paper as there were strokes over
   * it -- the same mistake as a per-stroke copy of the paper resource, one
   * level down.
   */
  fieldsFor(program: PencilMaterialProgram): MaterialFieldCache {
    let cache = this.#fields.get(program.paperResourceId);
    if (cache === undefined) {
      cache = new MaterialFieldCache(resolveMaterialResource(program.paperResourceId));
      this.#fields.set(program.paperResourceId, cache);
    }
    return cache;
  }

  stats(): PencilMaterialRuntimeStats {
    let residentTiles = 0;
    for (const tiles of this.#material.values()) residentTiles += tiles.size;
    let fieldTiles = 0;
    let fieldBytes = 0;
    for (const cache of this.#fields.values()) {
      fieldTiles += cache.residentTiles;
      fieldBytes += cache.residentBytes;
    }
    return Object.freeze({
      strokes: this.#material.size,
      residentTiles,
      residentMaterialBytes: this.#materialBytes,
      materialBudgetBytes: this.#materialBudget,
      materialEvictions: this.#materialEvictions,
      materialHits: this.#hits,
      materialMisses: this.#misses,
      residentIndexes: this.#indexes.size,
      residentIndexBytes: this.#indexBytes,
      indexBudgetBytes: this.#indexBudget,
      indexEvictions: this.#indexEvictions,
      fieldTiles,
      fieldBytes,
      reconstructedTiles: this.#reconstructed,
      scheduler: this.#scheduler.stats(),
    });
  }

  #touch(strokeId: string, key: MaterialTileKey): MaterialEntry | null {
    const entry = this.#material.get(strokeId)?.get(key);
    if (entry === undefined) return null;
    const order = orderKey(strokeId, key);
    const position = this.#order.get(order);
    if (position !== undefined) {
      this.#order.delete(order);
      this.#order.set(order, position);
    }
    return entry;
  }

  #store(strokeId: string, tile: CommittedMaterialTile, visible: boolean): void {
    let tiles = this.#material.get(strokeId);
    if (tiles === undefined) {
      tiles = new Map<MaterialTileKey, MaterialEntry>();
      this.#material.set(strokeId, tiles);
    }
    const key = `${String(tile.tx)},${String(tile.ty)}`;
    const existing = tiles.get(key);
    if (existing !== undefined) {
      existing.display?.release();
      this.#materialBytes -= existing.bytes;
    }
    tiles.set(key, { tile, display: null, bytes: COMMITTED_TILE_BYTES, visible });
    this.#materialBytes += COMMITTED_TILE_BYTES;
    this.#order.delete(orderKey(strokeId, key));
    this.#order.set(orderKey(strokeId, key), { strokeId, key });
    this.#trimMaterial();
  }

  /**
   * Evicts until the cap holds, offscreen material first.
   *
   * The cap is hard: a visible working set larger than the budget will thrash
   * rather than overrun, because a cache that quietly exceeded its budget is
   * not a budget. Nothing evicted is lost -- it is reconstructable, which is
   * the whole reason eviction is allowed to be this blunt.
   */
  #trimMaterial(): void {
    if (this.#materialBytes <= this.#materialBudget) return;
    for (const pass of [false, true]) {
      for (const [order, { strokeId, key }] of [...this.#order]) {
        if (this.#materialBytes <= this.#materialBudget) return;
        const entry = this.#material.get(strokeId)?.get(key);
        if (entry === undefined) {
          this.#order.delete(order);
          continue;
        }
        if (!pass && entry.visible) continue;
        entry.display?.release();
        this.#materialBytes -= entry.bytes;
        this.#material.get(strokeId)?.delete(key);
        if (this.#material.get(strokeId)?.size === 0) this.#material.delete(strokeId);
        this.#order.delete(order);
        this.#materialEvictions += 1;
      }
    }
  }

  #storeIndex(strokeId: string, index: PencilDabIndex): void {
    const existing = this.#indexes.get(strokeId);
    if (existing !== undefined) this.#indexBytes -= existing.bytes;
    const bytes = index.retainedBytes;
    this.#indexes.delete(strokeId);
    this.#indexes.set(strokeId, { index, bytes });
    this.#indexBytes += bytes;
    while (this.#indexBytes > this.#indexBudget && this.#indexes.size > 1) {
      const oldest = this.#indexes.keys().next().value;
      if (oldest === undefined || oldest === strokeId) break;
      const entry = this.#indexes.get(oldest);
      if (entry === undefined) break;
      this.#indexBytes -= entry.bytes;
      this.#indexes.delete(oldest);
      this.#indexEvictions += 1;
    }
  }
}

function orderKey(strokeId: string, key: MaterialTileKey): string {
  return `${strokeId}|${key}`;
}
