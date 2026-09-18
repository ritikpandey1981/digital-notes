import type { ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import { PencilDabIndex } from "./dab-index";
import { collectDabTiles, dabTileSupport, depositDab, type MaterialDab } from "./deposition";
import type { MaterialFieldCache } from "./fields";
import { PencilDabPlacement } from "./placement";
import { createPencilMaterialProgram, type PencilMaterialProgram } from "./program";
import {
  commitMaterialTile,
  createActiveMaterialTile,
  isBlankMaterialTile,
  materialTileKey,
  TILE_CELLS,
  type ActiveMaterialTile,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "./tiles";

/**
 * Material for a stroke still being drawn.
 *
 * It is the same material as the cold path -- the same program, the same
 * `depositDab`, the same accumulation rule -- and the difference is only
 * *when*. Live, the tail has not settled yet, so the dabs it produces are
 * provisional and have to be undone before the next frame re-derives them.
 *
 * Undoing them is a **region rollback**: before the tail is deposited, the
 * cells it will touch are copied out of the active tiles, and the next frame
 * copies them back. Seven bytes per touched cell, for the area the tail covers
 * rather than for every tile it lands in. The alternative -- cloning whole
 * tiles, or re-depositing the settled prefix -- is either allocation
 * proportional to the tail's tiles or work proportional to the stroke.
 *
 * What this class is *not*: a painter, a compositor and a cache. It produces
 * material and an index; who draws them, who keeps them and when is E4.2B's
 * question and deliberately not answered here.
 */

/** One rectangle of one tile, saved so the tail can be rolled back. */
interface RegionBackup {
  key: MaterialTileKey;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  alpha: Uint8Array;
  base: Uint8Array;
  peak: Uint8Array;
  last: Float32Array;
}

interface TailRect {
  readonly tx: number;
  readonly ty: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Finished material, plus the index that can rebuild any of it. */
export interface CommittedPencilMaterial {
  readonly tiles: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>;
  readonly index: PencilDabIndex;
  readonly program: PencilMaterialProgram;
}

export class PencilMaterialAccumulator {
  readonly #program: PencilMaterialProgram;
  readonly #fields: MaterialFieldCache;
  readonly #placement: PencilDabPlacement;
  readonly #index = new PencilDabIndex();
  readonly #tiles = new Map<MaterialTileKey, ActiveMaterialTile>();
  readonly #backups: RegionBackup[] = [];
  readonly #pool: RegionBackup[] = [];
  readonly #scratch: number[] = [];
  #tailKeys: Set<MaterialTileKey> = new Set();
  #finalized = false;

  constructor(brush: ResolvedBrushSnapshot, fields: MaterialFieldCache) {
    this.#program = createPencilMaterialProgram(brush);
    this.#fields = fields;
    this.#placement = new PencilDabPlacement(brush);
  }

  get program(): PencilMaterialProgram {
    return this.#program;
  }

  get index(): PencilDabIndex {
    return this.#index;
  }

  get residentTileCount(): number {
    return this.#tiles.size;
  }

  get finalized(): boolean {
    return this.#finalized;
  }

  /**
   * Consumes every sample not yet consumed, then re-walks only the open tail.
   *
   * Returns the tiles whose material changed, which is what a local repaint
   * would redraw. The set includes the previous frame's tail tiles, because
   * rolling those back changed them too.
   */
  append(points: readonly StrokePoint[], final: boolean): ReadonlySet<MaterialTileKey> {
    if (this.#finalized) return new Set();
    const dirty = new Set<MaterialTileKey>(this.#tailKeys);
    this.#rollback();

    const { settled, tail } = this.#placement.append(points, final);
    for (const dab of settled) this.#deposit(dab, dirty);
    this.#index.append(settled);

    this.#tailKeys = this.#saveTail(tail);
    for (const dab of tail) this.#deposit(dab, dirty);

    if (final) {
      this.#finalized = true;
      this.#tailKeys = new Set();
    }
    return dirty;
  }

  /** The live material of one tile, for a painter. Valid until the next append. */
  tile(key: MaterialTileKey): ActiveMaterialTile | null {
    return this.#tiles.get(key) ?? null;
  }

  tileKeys(): readonly MaterialTileKey[] {
    return [...this.#tiles.keys()];
  }

  /**
   * Hands over the finished material and drops the accumulation state.
   *
   * Only the alpha survives. `base`, `peak` and `last` exist to answer
   * questions about a stroke *in progress* -- which passage is this, how much
   * did it deposit, when was this cell last touched -- and a finished stroke has
   * no next dab to ask them on behalf of. Keeping them would be 96 KiB a tile
   * of answers to questions nobody can ask again.
   */
  commit(): CommittedPencilMaterial {
    if (!this.#finalized) {
      throw new RangeError("Pencil material must be finalized before it is committed.");
    }
    const tiles = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const [key, tile] of this.#tiles) {
      if (isBlankMaterialTile(tile.alpha)) continue;
      tiles.set(key, commitMaterialTile(tile));
    }
    this.#tiles.clear();
    this.#backups.length = 0;
    this.#pool.length = 0;
    return { tiles, index: this.#index.seal(), program: this.#program };
  }

  /** Drops every byte of active state. The index and the artwork are untouched. */
  dispose(): void {
    this.#tiles.clear();
    this.#backups.length = 0;
    this.#pool.length = 0;
    this.#tailKeys = new Set();
  }

  #deposit(dab: MaterialDab, dirty: Set<MaterialTileKey>): void {
    const pairs = collectDabTiles(dab, this.#scratch);
    for (let pair = 0; pair < pairs.length; pair += 2) {
      const tx = pairs[pair] ?? 0;
      const ty = pairs[pair + 1] ?? 0;
      const support = dabTileSupport(dab, tx, ty);
      if (support.x1 < support.x0 || support.y1 < support.y0) continue;
      const key = materialTileKey(tx, ty);
      const tile = this.#tile(key, tx, ty);
      const field = this.#fields.region(
        tx,
        ty,
        this.#program.fieldCellSize,
        support.x0,
        support.y0,
        support.x1,
        support.y1,
      );
      depositDab(tile, dab, field, support, this.#program.deposition);
      dirty.add(key);
    }
  }

  #tile(key: MaterialTileKey, tx: number, ty: number): ActiveMaterialTile {
    let tile = this.#tiles.get(key);
    if (tile === undefined) {
      tile = createActiveMaterialTile(tx, ty);
      this.#tiles.set(key, tile);
    }
    return tile;
  }

  /**
   * Copies out every cell the tail is about to touch.
   *
   * One rectangle per tile rather than one per dab: a tail is a short run of
   * overlapping dabs, so their union is close to their bounding box and the
   * bookkeeping for keeping them separate would cost more than the cells it
   * saved.
   */
  #saveTail(tail: readonly MaterialDab[]): Set<MaterialTileKey> {
    const rects = new Map<MaterialTileKey, TailRect>();
    for (const dab of tail) {
      const pairs = collectDabTiles(dab, this.#scratch);
      for (let pair = 0; pair < pairs.length; pair += 2) {
        const tx = pairs[pair] ?? 0;
        const ty = pairs[pair + 1] ?? 0;
        const support = dabTileSupport(dab, tx, ty);
        if (support.x1 < support.x0 || support.y1 < support.y0) continue;
        const key = materialTileKey(tx, ty);
        const rect = rects.get(key);
        if (rect === undefined) {
          rects.set(key, { tx, ty, ...support });
          continue;
        }
        rect.x0 = Math.min(rect.x0, support.x0);
        rect.y0 = Math.min(rect.y0, support.y0);
        rect.x1 = Math.max(rect.x1, support.x1);
        rect.y1 = Math.max(rect.y1, support.y1);
      }
    }
    for (const [key, rect] of rects) {
      const tile = this.#tile(key, rect.tx, rect.ty);
      const width = rect.x1 - rect.x0 + 1;
      const height = rect.y1 - rect.y0 + 1;
      const backup = this.#borrowBackup(width * height);
      backup.key = key;
      backup.x0 = rect.x0;
      backup.y0 = rect.y0;
      backup.x1 = rect.x1;
      backup.y1 = rect.y1;
      let offset = 0;
      for (let y = rect.y0; y <= rect.y1; y += 1) {
        const row = y * TILE_CELLS;
        for (let x = rect.x0; x <= rect.x1; x += 1) {
          const cell = row + x;
          backup.alpha[offset] = tile.alpha[cell] ?? 0;
          backup.base[offset] = tile.base[cell] ?? 0;
          backup.peak[offset] = tile.peak[cell] ?? 0;
          backup.last[offset] = tile.last[cell] ?? 0;
          offset += 1;
        }
      }
      this.#backups.push(backup);
    }
    return new Set(rects.keys());
  }

  #rollback(): void {
    for (const backup of this.#backups) {
      const tile = this.#tiles.get(backup.key);
      if (tile === undefined) continue;
      let offset = 0;
      for (let y = backup.y0; y <= backup.y1; y += 1) {
        const row = y * TILE_CELLS;
        for (let x = backup.x0; x <= backup.x1; x += 1) {
          const cell = row + x;
          tile.alpha[cell] = backup.alpha[offset] ?? 0;
          tile.base[cell] = backup.base[offset] ?? 0;
          tile.peak[cell] = backup.peak[offset] ?? 0;
          tile.last[cell] = backup.last[offset] ?? 0;
          offset += 1;
        }
      }
      this.#pool.push(backup);
    }
    this.#backups.length = 0;
  }

  #borrowBackup(cells: number): RegionBackup {
    const reused = this.#pool.pop();
    if (reused !== undefined && reused.alpha.length >= cells) return reused;
    return {
      key: "",
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      alpha: new Uint8Array(cells),
      base: new Uint8Array(cells),
      peak: new Uint8Array(cells),
      last: new Float32Array(cells),
    };
  }
}
