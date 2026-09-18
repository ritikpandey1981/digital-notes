import type { ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import type { CommittedPencilMaterial } from "./accumulator";
import { PencilDabIndex } from "./dab-index";
import { MaterialFieldCache } from "./fields";
import { createPencilMaterialProgram, type PencilMaterialProgram } from "./program";
import { reconstructMaterialTile, type MaterialReconstructionScratch } from "./reconstruction";
import { createReconstructionScratch } from "./reconstruction";
import { resolveMaterialResource } from "./resources";
import { COMMITTED_TILE_BYTES, type CommittedMaterialTile, type MaterialTileKey } from "./tiles";

/**
 * Who owns deposited material, and what happens when they stop.
 *
 * **The runtime owns it. Nothing else may.** Not `Stroke`, not `PageDocument`,
 * not `SketchbookDocument`, not History, not `ResolvedBrushSnapshot`, and not
 * the codec. The reason is not tidiness: the moment a tile is reachable from
 * any of those, dropping it stops being free, undo has pixels in it, and a save
 * has a cache in it. Every guarantee the material model makes -- deterministic
 * rebuild, bounded memory, transient pixels -- follows from this one boundary.
 *
 * What that buys is stated as a single invariant, and the tests assert it
 * directly: **clearing this runtime changes nothing an artist can see a
 * difference in, once the material is rebuilt.** The artwork is the source
 * samples and the resolved snapshot; everything here is a consequence of them
 * that happens to have been computed already.
 *
 * Deliberately absent, and E4.2B's work rather than an oversight: a byte
 * budget, an eviction policy, visibility tracking, a cooperative scheduler,
 * cancellation, and cross-stroke fairness. The prototype evidence settles what
 * those should be -- 64 MiB of material, 16 MiB of index, a 4 ms slice,
 * rotate between active jobs -- and none of them changes a pixel, which is
 * exactly why they can be added on top of a foundation that is already exact.
 */

/** One stroke's runtime material: the index, and whichever tiles are resident. */
interface StrokeMaterial {
  readonly program: PencilMaterialProgram;
  readonly index: PencilDabIndex;
  readonly tiles: Map<MaterialTileKey, CommittedMaterialTile>;
}

export interface PencilMaterialRuntimeStats {
  readonly strokes: number;
  readonly residentTiles: number;
  readonly residentMaterialBytes: number;
  readonly residentIndexBytes: number;
  readonly fieldTiles: number;
  readonly fieldBytes: number;
  readonly reconstructedTiles: number;
}

export class PencilMaterialRuntime {
  readonly #strokes = new Map<string, StrokeMaterial>();
  readonly #fields = new Map<string, MaterialFieldCache>();
  readonly #scratch: MaterialReconstructionScratch = createReconstructionScratch();
  #reconstructedTiles = 0;

  /**
   * The index for one stroke, built from its samples if it is not resident.
   *
   * Indexes are cached separately from material and are two orders of magnitude
   * smaller, which is why they get their own lifetime: keeping one costs
   * kilobytes and saves every tile of that stroke a full re-placement.
   */
  index(
    strokeId: string,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
  ): PencilDabIndex {
    return this.#material(strokeId, points, brush).index;
  }

  /**
   * One tile of one stroke's material, reconstructed if it is not resident.
   *
   * Returns `null` for a tile the stroke does not reach. A hit and a miss
   * produce identical bytes -- the only difference is how long the call took.
   */
  tile(
    strokeId: string,
    key: MaterialTileKey,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
  ): CommittedMaterialTile | null {
    const material = this.#material(strokeId, points, brush);
    const resident = material.tiles.get(key);
    if (resident !== undefined) return resident;
    const tile = reconstructMaterialTile(
      key,
      material.index,
      material.program,
      this.#fieldCache(material.program),
      this.#scratch,
    );
    if (tile === null) return null;
    this.#reconstructedTiles += 1;
    material.tiles.set(key, tile);
    return tile;
  }

  /**
   * Takes over material a stroke has just finished depositing.
   *
   * The live accumulator has already computed every tile it touched, so
   * throwing them away at commit only to rebuild them on the next frame would
   * be the most expensive possible moment to have an empty cache.
   */
  adopt(strokeId: string, committed: CommittedPencilMaterial): void {
    const tiles = new Map<MaterialTileKey, CommittedMaterialTile>(committed.tiles);
    this.#strokes.set(strokeId, {
      program: committed.program,
      index: committed.index.seal(),
      tiles,
    });
  }

  /** Forgets one stroke's material and index. The stroke itself is untouched. */
  releaseStroke(strokeId: string): void {
    this.#strokes.delete(strokeId);
  }

  /** Drops every cached byte: material, indexes and fields. */
  clear(): void {
    this.#strokes.clear();
    for (const cache of this.#fields.values()) cache.clear();
    this.#fields.clear();
    this.#scratch.tile = null;
  }

  stats(): PencilMaterialRuntimeStats {
    let residentTiles = 0;
    let indexBytes = 0;
    for (const material of this.#strokes.values()) {
      residentTiles += material.tiles.size;
      indexBytes += material.index.retainedBytes;
    }
    let fieldTiles = 0;
    let fieldBytes = 0;
    for (const cache of this.#fields.values()) {
      fieldTiles += cache.residentTiles;
      fieldBytes += cache.residentBytes;
    }
    return Object.freeze({
      strokes: this.#strokes.size,
      residentTiles,
      residentMaterialBytes: residentTiles * COMMITTED_TILE_BYTES,
      residentIndexBytes: indexBytes,
      fieldTiles,
      fieldBytes,
      reconstructedTiles: this.#reconstructedTiles,
    });
  }

  #material(
    strokeId: string,
    points: readonly StrokePoint[],
    brush: ResolvedBrushSnapshot,
  ): StrokeMaterial {
    const resident = this.#strokes.get(strokeId);
    if (resident !== undefined) return resident;
    const program = createPencilMaterialProgram(brush);
    const material: StrokeMaterial = {
      program,
      index: PencilDabIndex.build(points, brush),
      tiles: new Map(),
    };
    this.#strokes.set(strokeId, material);
    return material;
  }

  /**
   * One field cache per sheet, shared by every stroke drawn on it.
   *
   * The fields are a property of the page, not of a mark, so a per-stroke cache
   * would hold as many copies of one patch of paper as there were strokes over
   * it -- which is the same mistake as a per-stroke copy of the paper resource,
   * one level down.
   */
  #fieldCache(program: PencilMaterialProgram): MaterialFieldCache {
    let cache = this.#fields.get(program.paperResourceId);
    if (cache === undefined) {
      cache = new MaterialFieldCache(resolveMaterialResource(program.paperResourceId));
      this.#fields.set(program.paperResourceId, cache);
    }
    return cache;
  }

  /** The shared field cache for one program, for callers driving a live stroke. */
  fieldsFor(program: PencilMaterialProgram): MaterialFieldCache {
    return this.#fieldCache(program);
  }
}
