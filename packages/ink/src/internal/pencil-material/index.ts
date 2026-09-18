/**
 * The hybrid textured Pencil material foundation.
 *
 * One module boundary for a model with four parts that must not drift apart:
 * the built-in resources a mark is made of, the equation that deposits them,
 * the tiles and index that make deposited material cacheable, and the runtime
 * that owns the cache. Read {@link ./deposition.ts} first -- everything else
 * exists to feed it or to store what it produced.
 *
 * Nothing here is durable. Nothing here touches a `Canvas`. Nothing here is
 * reachable from a `Stroke`.
 */

export { PencilMaterialAccumulator, type CommittedPencilMaterial } from "./accumulator";
export {
  PencilDabIndex,
  createMutableDab,
  type MaterialTileMembership,
  type MutableMaterialDab,
} from "./dab-index";
export {
  collectDabTiles,
  dabTileSupport,
  depositDab,
  fineTipBoost,
  type DabTileSupport,
  type MaterialDab,
  type MaterialDepositionContext,
} from "./deposition";
export {
  MaterialFieldCache,
  clumpByte,
  clumpCellSize,
  paperToothByte,
  type MaterialFieldTile,
} from "./fields";
export { clampUnit, materialHash, materialNoise } from "./material-hash";
export {
  PencilDabPlacement,
  pencilDabSpacing,
  placePencilDabs,
  type PlacedDabs,
} from "./placement";
export {
  createPencilMaterialProgram,
  materialAppearanceKey,
  type PencilMaterialProgram,
} from "./program";
export {
  createReconstructionScratch,
  materialTileCoordinate,
  reconstructMaterial,
  reconstructMaterialTile,
  type MaterialReconstructionScratch,
} from "./reconstruction";
export {
  pencilMaterialResources,
  registeredMaterialResources,
  releaseMaterialResources,
  resolveMaterialResource,
  type MaterialResource,
  type MaterialResourceId,
  type PencilMaterialResources,
} from "./resources";
export {
  DEFAULT_INDEX_BUDGET_BYTES,
  DEFAULT_MATERIAL_BUDGET_BYTES,
  PencilMaterialRuntime,
  type MaterialDisplayHandle,
  type PencilMaterialRuntimeOptions,
  type PencilMaterialRuntimeStats,
} from "./runtime";
export {
  INLINE_INDEX_SAMPLE_LIMIT,
  MAXIMUM_CONCURRENT_JOBS,
  MaterialPriority,
  PencilReconstructionScheduler,
  SLICE_BUDGET_MS,
  type MaterialPriorityValue,
  type MaterialSchedulerHost,
  type MaterialSchedulerStats,
  type MaterialTileRequest,
} from "./scheduler";
export {
  ACTIVE_TILE_BYTES,
  COMMITTED_TILE_BYTES,
  MATERIAL_RESOLUTION,
  TILE_CELLS,
  TILE_CELL_COUNT,
  TILE_PAGE_UNITS,
  commitMaterialTile,
  createActiveMaterialTile,
  isBlankMaterialTile,
  materialTileKey,
  parseMaterialTileKey,
  resetActiveMaterialTile,
  type ActiveMaterialTile,
  type CommittedMaterialTile,
  type MaterialTileCoordinate,
  type MaterialTileKey,
} from "./tiles";
