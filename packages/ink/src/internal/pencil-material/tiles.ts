/**
 * The tile lattice deposited material is accumulated and cached in, and the two
 * shapes a tile takes.
 *
 * Backend-neutral by construction: everything here is a typed array and an
 * integer. No `Canvas`, no `ImageData`, no `ImageBitmap` and no drawing context
 * appears in this file or in anything it describes, which is what keeps the
 * material model something a second painter could consume without being
 * rewritten -- and what keeps `@folio/ink` free of new Canvas coupling outside
 * the painter.
 */

/**
 * Cells per page unit, and cells per tile edge.
 *
 * Two cells a page unit is the resolution the material was reviewed and
 * approved at: fine enough that the paper's tooth integrates into a tone rather
 * than resolving into dots at ordinary zoom, and coarse enough that a tile
 * covers a useful area of page. 128 cells a side then makes a tile exactly 64
 * page units square, which is the unit every measurement of occupancy, budget
 * and reconstruction cost in the prototype evidence is expressed in.
 */
export const MATERIAL_RESOLUTION = 2;
export const TILE_CELLS = 128;
export const TILE_CELL_COUNT = TILE_CELLS * TILE_CELLS;
export const TILE_PAGE_UNITS = TILE_CELLS / MATERIAL_RESOLUTION;

/**
 * What one tile costs in each of its two lives.
 *
 * Active carries the accumulation state a stroke in progress needs; committed
 * carries only what reproducing the final material requires. The ratio is the
 * whole reason a runtime cache can hold a realistic working set.
 */
export const ACTIVE_TILE_BYTES = TILE_CELL_COUNT * 7;
export const COMMITTED_TILE_BYTES = TILE_CELL_COUNT;

/** Where one tile sits on the page lattice. `"tx,ty"`. */
export type MaterialTileKey = string;

export interface MaterialTileCoordinate {
  readonly tx: number;
  readonly ty: number;
}

export function materialTileKey(tx: number, ty: number): MaterialTileKey {
  return `${String(tx)},${String(ty)}`;
}

export function parseMaterialTileKey(key: MaterialTileKey): MaterialTileCoordinate {
  const comma = key.indexOf(",");
  if (comma < 0) throw new RangeError(`Material tile key '${key}' is malformed.`);
  const tx = Number(key.slice(0, comma));
  const ty = Number(key.slice(comma + 1));
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty)) {
    throw new RangeError(`Material tile key '${key}' is malformed.`);
  }
  return { tx, ty };
}

/**
 * Accumulation state for one tile of a stroke still being deposited.
 *
 * Four parallel fields, and each one answers a question the others cannot.
 * `alpha` is the material so far. `base` is what it was when the current
 * passage over this cell began, `peak` is the most any single contact in that
 * passage has deposited, and `last` is how far along the stroke the tip last
 * touched the cell -- which is what tells a retrace from an overlap between
 * neighbouring taps of one continuous pass. See `depositDab` for the rule they
 * serve; none of them survives the commit.
 */
export interface ActiveMaterialTile {
  readonly tx: number;
  readonly ty: number;
  readonly alpha: Uint8Array;
  readonly base: Uint8Array;
  readonly peak: Uint8Array;
  readonly last: Float32Array;
}

/**
 * One tile of finished material: the alpha, and where it goes.
 *
 * Nothing else, and deliberately nothing else. Colour is applied when the tile
 * is painted, not when it is deposited, so one stored tile serves every colour
 * and the material model never has a pigment baked into it. Base opacity is
 * already inside these bytes and is applied exactly once -- a painter that
 * applied it again would darken the mark at every redraw.
 *
 * This is a **derived cache**, never artwork. It can be dropped at any moment
 * and rebuilt exactly from the source samples and the resolved snapshot.
 */
export interface CommittedMaterialTile {
  readonly tx: number;
  readonly ty: number;
  readonly alpha: Uint8Array;
}

/** A tile with its accumulation state zeroed, ready to receive a stroke. */
export function createActiveMaterialTile(tx: number, ty: number): ActiveMaterialTile {
  const tile: ActiveMaterialTile = {
    tx,
    ty,
    alpha: new Uint8Array(TILE_CELL_COUNT),
    base: new Uint8Array(TILE_CELL_COUNT),
    peak: new Uint8Array(TILE_CELL_COUNT),
    last: new Float32Array(TILE_CELL_COUNT),
  };
  tile.last.fill(NEVER_CONTACTED);
  return tile;
}

/** Reuses one scratch tile at another coordinate, allocating nothing. */
export function resetActiveMaterialTile(
  tile: ActiveMaterialTile,
  tx: number,
  ty: number,
): ActiveMaterialTile {
  tile.alpha.fill(0);
  tile.base.fill(0);
  tile.peak.fill(0);
  tile.last.fill(NEVER_CONTACTED);
  return { ...tile, tx, ty };
}

/**
 * An arc distance no stroke can reach, so the first contact with a cell always
 * opens a passage rather than extending one that never happened.
 */
export const NEVER_CONTACTED = -1e9;

/** Drops the accumulation state and keeps the material. */
export function commitMaterialTile(tile: ActiveMaterialTile): CommittedMaterialTile {
  return Object.freeze({ tx: tile.tx, ty: tile.ty, alpha: tile.alpha.slice() });
}

/** True when a tile holds no material at all and is therefore not worth keeping. */
export function isBlankMaterialTile(alpha: Uint8Array): boolean {
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] !== 0) return false;
  }
  return true;
}
