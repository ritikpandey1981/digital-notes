import type { ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import { collectDabTiles, type MaterialDab } from "./deposition";
import { PencilDabPlacement } from "./placement";
import { materialTileKey, type MaterialTileKey } from "./tiles";

/**
 * Which dabs reach which tile, packed.
 *
 * This is the structure that makes one tile reconstructable **without replaying
 * the stroke**. Without it, redrawing a single visible tile of a long mark
 * means walking every dab the stroke ever placed and discarding almost all of
 * them; with it, the tile's own membership list is read directly and only its
 * dabs are deposited.
 *
 * Three properties are load-bearing:
 *
 * - **Derived, never durable.** Nothing here is saved. It is a pure function of
 *   the source samples and the resolved snapshot, so it can be dropped under
 *   memory pressure and rebuilt to the byte.
 * - **No pixels.** Positions and radii only. The index is orders of magnitude
 *   smaller than the material it addresses, which is why it gets its own
 *   lifetime and its own budget rather than competing with material for one.
 * - **Ordered.** A tile's members are in the order the stroke placed them, so
 *   replaying just that list deposits them in the same sequence a full build
 *   would -- which is what makes single-tile reconstruction exact rather than
 *   merely close.
 *
 * Coordinates are `Float64Array`, not `Float32Array`. The dab stream is the
 * input to a threshold on a hashed lattice, so narrowing it would move
 * individual grains: the storage width is part of the material, not a tuning
 * choice.
 */

/** Values stored per dab: x, y, radius, coverage, arc. */
const STRIDE = 5;
const INITIAL_CAPACITY = 256;

/** A dab read out of the index in place, so a replay allocates nothing. */
export interface MutableMaterialDab {
  x: number;
  y: number;
  radius: number;
  coverage: number;
  arc: number;
}

export function createMutableDab(): MutableMaterialDab {
  return { x: 0, y: 0, radius: 0, coverage: 0, arc: 0 };
}

/** One tile, and the dabs that reach it. */
export interface MaterialTileMembership {
  readonly tx: number;
  readonly ty: number;
  /** Ascending dab ordinals: the order the stroke placed them. */
  readonly ids: Uint32Array;
}

interface MutableMembership {
  readonly tx: number;
  readonly ty: number;
  ids: number[] | Uint32Array;
}

export class PencilDabIndex {
  #data: Float64Array = new Float64Array(STRIDE * INITIAL_CAPACITY);
  #count = 0;
  #references = 0;
  #sealed = false;
  readonly #tiles = new Map<MaterialTileKey, MutableMembership>();
  readonly #scratch: number[] = [];

  get dabCount(): number {
    return this.#count;
  }

  get tileCount(): number {
    return this.#tiles.size;
  }

  get sealed(): boolean {
    return this.#sealed;
  }

  /** Packed bytes actually retained: coordinates plus membership. */
  get retainedBytes(): number {
    let bytes = this.#count * STRIDE * Float64Array.BYTES_PER_ELEMENT;
    for (const membership of this.#tiles.values()) {
      bytes +=
        membership.ids instanceof Uint32Array
          ? membership.ids.byteLength
          : membership.ids.length * Uint32Array.BYTES_PER_ELEMENT;
    }
    return bytes;
  }

  append(dabs: readonly MaterialDab[]): void {
    if (this.#sealed) throw new RangeError("A sealed dab index cannot take more dabs.");
    for (const dab of dabs) {
      if ((this.#count + 1) * STRIDE > this.#data.length) {
        const grown = new Float64Array(this.#data.length * 2);
        grown.set(this.#data);
        this.#data = grown;
      }
      const id = this.#count;
      this.#count = id + 1;
      const offset = id * STRIDE;
      this.#data[offset] = dab.x;
      this.#data[offset + 1] = dab.y;
      this.#data[offset + 2] = dab.radius;
      this.#data[offset + 3] = dab.coverage;
      this.#data[offset + 4] = dab.arc;
      const pairs = collectDabTiles(dab, this.#scratch);
      for (let pair = 0; pair < pairs.length; pair += 2) {
        const tx = pairs[pair] ?? 0;
        const ty = pairs[pair + 1] ?? 0;
        const key = materialTileKey(tx, ty);
        let membership = this.#tiles.get(key);
        if (membership === undefined) {
          membership = { tx, ty, ids: [] };
          this.#tiles.set(key, membership);
        }
        (membership.ids as number[]).push(id);
        this.#references += 1;
      }
    }
  }

  /** Trims to size and narrows every membership list. No dab may be added after. */
  seal(): this {
    if (this.#sealed) return this;
    this.#data = this.#data.slice(0, this.#count * STRIDE);
    for (const membership of this.#tiles.values()) {
      membership.ids = Uint32Array.from(membership.ids as number[]);
    }
    this.#sealed = true;
    return this;
  }

  readDab(id: number, into: MutableMaterialDab): MutableMaterialDab {
    if (id < 0 || id >= this.#count) throw new RangeError(`Dab ${String(id)} is not in the index.`);
    const offset = id * STRIDE;
    const data = this.#data;
    into.x = data[offset] ?? 0;
    into.y = data[offset + 1] ?? 0;
    into.radius = data[offset + 2] ?? 0;
    into.coverage = data[offset + 3] ?? 0;
    into.arc = data[offset + 4] ?? 0;
    return into;
  }

  membership(key: MaterialTileKey): MaterialTileMembership | null {
    const membership = this.#tiles.get(key);
    if (membership === undefined) return null;
    const ids =
      membership.ids instanceof Uint32Array
        ? membership.ids
        : Uint32Array.from(membership.ids as number[]);
    return { tx: membership.tx, ty: membership.ty, ids };
  }

  tileKeys(): readonly MaterialTileKey[] {
    return [...this.#tiles.keys()];
  }

  /** How many `(tile, dab)` pairs exist, for the memory accounting tests. */
  get referenceCount(): number {
    return this.#references;
  }

  /**
   * Builds a complete sealed index from source samples.
   *
   * Placement runs in sample batches rather than over one array of every dab,
   * so the temporary dab objects a build allocates are bounded by the batch
   * rather than by the length of the stroke.
   */
  static build(
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
    batchSize = INITIAL_CAPACITY,
  ): PencilDabIndex {
    const index = new PencilDabIndex();
    const placement = new PencilDabPlacement(brush);
    const consumed: StrokePoint[] = [];
    for (let start = 0; start < points.length; start += batchSize) {
      for (let offset = start; offset < Math.min(start + batchSize, points.length); offset += 1) {
        const point = points[offset];
        if (point !== undefined) consumed.push(point);
      }
      index.append(placement.append(consumed, consumed.length === points.length).settled);
    }
    if (points.length === 0) index.append(placement.append(consumed, true).settled);
    return index.seal();
  }
}
