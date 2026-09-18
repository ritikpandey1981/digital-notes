import { clampUnit, materialHash, materialNoise } from "./material-hash";
import type { MaterialResource } from "./resources";
import { TILE_CELL_COUNT, TILE_CELLS } from "./tiles";

/**
 * The two fields a dab is deposited *through*, both of them properties of the
 * page rather than of the stroke.
 *
 * This is the coordinate rule the whole material model rests on, and it is the
 * one thing a future transform implementation must not quietly reinterpret:
 *
 * - **The nib moves with the dab.** It is addressed in the tip's own frame, so
 *   it is the same mask wherever the tip lands.
 * - **The paper and the clumping are addressed in page space.** Two strokes
 *   crossing the same patch of sheet find the same tooth, a pass that comes
 *   back over its own mark finds the paper it already found, and pressing
 *   harder reveals more of *the same* sheet rather than dealing a new one.
 *
 * Because the sheet is a field and not a stored image, it has no period at all.
 * The paper resource is a *distribution* indexed by a spatial hash of the page
 * coordinate, not a texture tiled across the page, so there is no offset at
 * which a repeat appears.
 *
 * Clumping is a second, smoother field on top of it: real graphite crumbs, so
 * neighbouring patches take it and leave it together. Its cell size is scaled
 * against the nominal tip, because a cluster wider than the tip gates the whole
 * mark at once and a small pencil would come out dashed.
 */

const PAPER_ADDRESS_SEED = 701;
const CLUMP_COARSE_SEED = 317;
const CLUMP_FINE_SEED = 509;
const CLUMP_COARSE_WEIGHT = 0.72;
const CLUMP_FINE_WEIGHT = 0.28;
const CLUMP_FINE_RATIO = 0.43;
const CLUMP_TIP_FACTOR = 0.12;
const CLUMP_CELL_FLOOR = 0.65;
const CLUMP_CELL_CEILING = 3.2;

/**
 * The sheet's tooth at one material cell, as the byte the equations read.
 *
 * The spatial hash picks an entry from the distribution; the entry *is* the
 * byte, because the stored samples and the field's range are the same 0..255.
 */
export function paperToothByte(cellX: number, cellY: number, paper: MaterialResource): number {
  const samples = paper.samples;
  const index = Math.floor(materialHash(cellX, cellY, PAPER_ADDRESS_SEED) * samples.length);
  return samples[index] ?? 0;
}

/** How much graphite gathers at one material cell, as a byte. */
export function clumpByte(cellX: number, cellY: number, cellSize: number): number {
  const coarse = materialNoise(cellX / cellSize, cellY / cellSize, CLUMP_COARSE_SEED);
  const fine = materialNoise(
    cellX / (cellSize * CLUMP_FINE_RATIO),
    cellY / (cellSize * CLUMP_FINE_RATIO),
    CLUMP_FINE_SEED,
  );
  return Math.round(255 * clampUnit(CLUMP_COARSE_WEIGHT * coarse + CLUMP_FINE_WEIGHT * fine));
}

/**
 * The clump field's cell size in material cells, for one nominal brush size.
 *
 * Read from the nominal size and never from the pressure-varied one: a field
 * whose scale moved with the hand would reshuffle the sheet mid-stroke, which
 * is the one thing addressing it in page space exists to prevent.
 */
export function clumpCellSize(brushSize: number, resolution: number): number {
  const page = Math.min(
    CLUMP_CELL_CEILING,
    Math.max(CLUMP_CELL_FLOOR, brushSize * CLUMP_TIP_FACTOR),
  );
  return page * resolution;
}

/** One tile's worth of both fields, generated only where a dab has asked. */
export interface MaterialFieldTile {
  readonly tooth: Uint8Array;
  readonly clump: Uint8Array;
  /** Per row, the span already generated. `right < left` means "none yet". */
  readonly generatedLeft: Int16Array;
  readonly generatedRight: Int16Array;
}

/**
 * Field tiles, generated lazily by row interval and shared across strokes.
 *
 * Two properties earn this its own cache rather than being recomputed per dab.
 * The fields are **stroke-independent** -- they are the sheet, so every stroke
 * over one patch of page wants the same bytes -- and a dab covers a *narrow*
 * part of a tile, so generating the whole 128-square for a four-pixel line
 * would be most of the work and none of the result.
 *
 * It is a pure accelerator: a hit and a miss produce identical bytes, and
 * clearing it changes nothing but the time the next dab takes. Ownership sits
 * with the runtime, never with a `Stroke`.
 */
export class MaterialFieldCache {
  readonly #tiles = new Map<string, MaterialFieldTile>();
  readonly #paper: MaterialResource;
  readonly #limit: number;
  #generatedCells = 0;

  constructor(paper: MaterialResource, limit = 64) {
    this.#paper = paper;
    this.#limit = Math.max(1, limit);
  }

  /** How many field cells have actually been computed, for the memory tests. */
  get generatedCells(): number {
    return this.#generatedCells;
  }

  get residentTiles(): number {
    return this.#tiles.size;
  }

  get residentBytes(): number {
    return this.#tiles.size * (TILE_CELL_COUNT * 2 + TILE_CELLS * 4);
  }

  clear(): void {
    this.#tiles.clear();
  }

  /**
   * Both fields over one rectangle of one tile, generating only what is new.
   *
   * The rectangle is inclusive on all four sides and is expected to be a dab's
   * clipped support, which is why coverage is tracked as one interval per row:
   * a dab is convex, so a row it touches it touches contiguously, and the union
   * of successive dabs over a row stays an interval far more often than not.
   */
  region(
    tx: number,
    ty: number,
    cellSize: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): MaterialFieldTile {
    const key = `${String(tx)},${String(ty)},${String(cellSize)}`;
    let tile = this.#tiles.get(key);
    if (tile === undefined) {
      tile = {
        tooth: new Uint8Array(TILE_CELL_COUNT),
        clump: new Uint8Array(TILE_CELL_COUNT),
        generatedLeft: new Int16Array(TILE_CELLS).fill(TILE_CELLS),
        generatedRight: new Int16Array(TILE_CELLS).fill(-1),
      };
    } else {
      // Least-recently used last, so the eviction below drops the coldest tile.
      this.#tiles.delete(key);
    }
    this.#tiles.set(key, tile);
    if (this.#tiles.size > this.#limit) {
      const coldest = this.#tiles.keys().next().value;
      if (coldest !== undefined && coldest !== key) this.#tiles.delete(coldest);
    }

    const originX = tx * TILE_CELLS;
    const originY = ty * TILE_CELLS;
    for (let y = y0; y <= y1; y += 1) {
      const left = tile.generatedLeft[y] ?? TILE_CELLS;
      const right = tile.generatedRight[y] ?? -1;
      if (right < left) {
        this.#fillRow(tile, originX, originY, cellSize, y, x0, x1);
      } else {
        if (x0 < left) this.#fillRow(tile, originX, originY, cellSize, y, x0, left - 1);
        if (x1 > right) this.#fillRow(tile, originX, originY, cellSize, y, right + 1, x1);
      }
      tile.generatedLeft[y] = Math.min(left, x0);
      tile.generatedRight[y] = Math.max(right, x1);
    }
    return tile;
  }

  #fillRow(
    tile: MaterialFieldTile,
    originX: number,
    originY: number,
    cellSize: number,
    y: number,
    x0: number,
    x1: number,
  ): void {
    const cellY = originY + y;
    const rowStart = y * TILE_CELLS;
    for (let x = x0; x <= x1; x += 1) {
      const cellX = originX + x;
      tile.tooth[rowStart + x] = paperToothByte(cellX, cellY, this.#paper);
      tile.clump[rowStart + x] = clumpByte(cellX, cellY, cellSize);
      this.#generatedCells += 1;
    }
  }
}
