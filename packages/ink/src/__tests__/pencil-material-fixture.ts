import {
  createResolvedBrushSnapshot,
  type BrushPressureResponse,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  MATERIAL_RESOLUTION,
  MaterialFieldCache,
  PencilDabIndex,
  TILE_CELLS,
  createPencilMaterialProgram,
  reconstructMaterial,
  resolveMaterialResource,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "../internal/pencil-material";
import type { StrokePoint } from "../types";

/** Shared fixtures for the Pencil material suites. Not a test file. */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function expressive(minimum: number, maximum: number, exponent: number): BrushPressureResponse {
  return Object.freeze({
    enabled: true,
    minimumFactor: minimum,
    maximumFactor: maximum,
    curve: exponent === 1 ? LINEAR : Object.freeze({ kind: "power" as const, exponent }),
  });
}

export function pencilBrush(
  overrides: Partial<Pick<ResolvedBrushSnapshot, "size" | "opacity" | "color">> & {
    smoothing?: number;
  } = {},
): ResolvedBrushSnapshot {
  const smoothing = overrides.smoothing ?? 0.2;
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "material-hb",
    presetVersion: 1,
    family: "pencil",
    color: overrides.color ?? "#343434",
    size: overrides.size ?? 12,
    opacity: overrides.opacity ?? 0.78,
    smoothing: { mode: smoothing > 0 ? "average" : "none", amount: smoothing },
    dynamics: {
      pressureSize: expressive(0.65, 1.25, 1),
      pressureOpacity: expressive(0.45, 1, 0.75),
    },
    renderer: { version: 1, kind: "pencil" },
  });
}

export function samplePoint(x: number, y: number, pressure: number): StrokePoint {
  return {
    x,
    y,
    timestamp: 0,
    pressure,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    delta: { x: 0, y: 0 },
    velocity: 0,
    acceleration: 0,
  };
}

/** A straight run at one constant pressure: one passage, no retrace. */
export function straight(pressure: number, length = 90, y = 100): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < 60; index += 1) {
    points.push(samplePoint(60 + (index / 59) * length, y, pressure));
  }
  return points;
}

export function buildMaterial(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
): Map<MaterialTileKey, CommittedMaterialTile> {
  const program = createPencilMaterialProgram(brush);
  const fields = new MaterialFieldCache(resolveMaterialResource(program.paperResourceId));
  return reconstructMaterial(PencilDabIndex.build(points, brush), program, fields);
}

/** Reads one page-space point out of a tiled material. */
export function alphaAt(
  material: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>,
  pageX: number,
  pageY: number,
): number {
  const cellX = Math.floor(pageX * MATERIAL_RESOLUTION);
  const cellY = Math.floor(pageY * MATERIAL_RESOLUTION);
  const tx = Math.floor(cellX / TILE_CELLS);
  const ty = Math.floor(cellY / TILE_CELLS);
  const tile = material.get(`${String(tx)},${String(ty)}`);
  if (tile === undefined) return 0;
  return tile.alpha[(cellY - ty * TILE_CELLS) * TILE_CELLS + (cellX - tx * TILE_CELLS)] ?? 0;
}

export function totalAlpha(material: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>): number {
  let total = 0;
  for (const tile of material.values()) {
    for (const value of tile.alpha) total += value;
  }
  return total;
}

export function inkedCells(
  material: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>,
): Set<string> {
  const cells = new Set<string>();
  for (const tile of material.values()) {
    for (let index = 0; index < tile.alpha.length; index += 1) {
      if ((tile.alpha[index] ?? 0) === 0) continue;
      const x = tile.tx * TILE_CELLS + (index % TILE_CELLS);
      const y = tile.ty * TILE_CELLS + Math.floor(index / TILE_CELLS);
      cells.add(`${String(x)}:${String(y)}`);
    }
  }
  return cells;
}
