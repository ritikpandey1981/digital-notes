import type { PencilDabIndex } from "./dab-index";
import { createMutableDab } from "./dab-index";
import { dabTileSupport, depositDab } from "./deposition";
import type { MaterialFieldCache } from "./fields";
import type { PencilMaterialProgram } from "./program";
import {
  commitMaterialTile,
  createActiveMaterialTile,
  isBlankMaterialTile,
  parseMaterialTileKey,
  resetActiveMaterialTile,
  type ActiveMaterialTile,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "./tiles";

/**
 * Rebuilding finished material from nothing but the artwork.
 *
 * This is the function the whole cache design rests on. Because one tile can be
 * rebuilt **independently, exactly, and without replaying the stroke**, the
 * runtime is free to throw material away whenever it likes: under memory
 * pressure, on a page switch, on a window close. Artwork stays authoritative
 * because the pixels were never authoritative.
 *
 * Exactness is not incidental. A tile's membership list is in the order the
 * stroke placed its dabs, and the accumulation rule reads only the cell it is
 * writing, so depositing just that list into a blank tile lands on the same
 * bytes a full build lands on. There is no build order to get wrong and no
 * neighbouring tile to consult.
 */

/** A reusable scratch tile, so rebuilding many tiles allocates one. */
export interface MaterialReconstructionScratch {
  tile: ActiveMaterialTile | null;
}

export function createReconstructionScratch(): MaterialReconstructionScratch {
  return { tile: null };
}

/**
 * Rebuilds exactly one tile of one stroke's material.
 *
 * Returns `null` for a tile no dab of this stroke reaches, and for a tile whose
 * dabs all declined -- an empty tile is not worth a cache entry.
 */
export function reconstructMaterialTile(
  key: MaterialTileKey,
  index: PencilDabIndex,
  program: PencilMaterialProgram,
  fields: MaterialFieldCache,
  scratch: MaterialReconstructionScratch = createReconstructionScratch(),
): CommittedMaterialTile | null {
  const membership = index.membership(key);
  if (membership === null) return null;
  const tile =
    scratch.tile === null
      ? createActiveMaterialTile(membership.tx, membership.ty)
      : resetActiveMaterialTile(scratch.tile, membership.tx, membership.ty);
  scratch.tile = tile;
  const dab = createMutableDab();
  for (const id of membership.ids) {
    index.readDab(id, dab);
    const support = dabTileSupport(dab, tile.tx, tile.ty);
    if (support.x1 < support.x0 || support.y1 < support.y0) continue;
    const field = fields.region(
      tile.tx,
      tile.ty,
      program.fieldCellSize,
      support.x0,
      support.y0,
      support.x1,
      support.y1,
    );
    depositDab(tile, dab, field, support, program.deposition);
  }
  if (isBlankMaterialTile(tile.alpha)) return null;
  return commitMaterialTile(tile);
}

/**
 * Rebuilds every tile one stroke's material occupies.
 *
 * One scratch tile serves all of them, which is what keeps a full rebuild's
 * peak allocation at one tile rather than at the whole mark. This is the
 * synchronous form; slicing it across frames is E4.2B's job, and it is a
 * scheduling question rather than a material one -- the per-tile call above is
 * already the unit of work a scheduler would hand out.
 */
export function reconstructMaterial(
  index: PencilDabIndex,
  program: PencilMaterialProgram,
  fields: MaterialFieldCache,
): Map<MaterialTileKey, CommittedMaterialTile> {
  const scratch = createReconstructionScratch();
  const material = new Map<MaterialTileKey, CommittedMaterialTile>();
  for (const key of index.tileKeys()) {
    const tile = reconstructMaterialTile(key, index, program, fields, scratch);
    if (tile !== null) material.set(key, tile);
  }
  return material;
}

/** The tile coordinate one key names, for callers that only have the key. */
export function materialTileCoordinate(key: MaterialTileKey): { tx: number; ty: number } {
  return parseMaterialTileKey(key);
}
