import { describe, expect, it } from "vitest";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import {
  ACTIVE_TILE_BYTES,
  COMMITTED_TILE_BYTES,
  MATERIAL_RESOLUTION,
  MaterialFieldCache,
  PencilDabIndex,
  PencilMaterialAccumulator,
  PencilMaterialRuntime,
  TILE_CELLS,
  TILE_CELL_COUNT,
  collectDabTiles,
  createPencilMaterialProgram,
  materialTileKey,
  placePencilDabs,
  reconstructMaterial,
  reconstructMaterialTile,
  resolveMaterialResource,
  type CommittedMaterialTile,
  type MaterialTileKey,
} from "../internal/pencil-material";
import type { StrokePoint } from "../types";
import { buildMaterial, pencilBrush, samplePoint, straight } from "./pencil-material-fixture";

/**
 * The cache contract, which is the whole reason the material is tiled.
 *
 * Every claim here reduces to one: **material is a consequence of the artwork,
 * not part of it.** A tile can be rebuilt alone, exactly, in any order, after
 * any amount of the cache has been destroyed, and what comes back is what was
 * there. Once that holds, a runtime is free to evict whatever it likes -- which
 * is what E4.2B goes on to do.
 */

function scribble(count: number, pressure = 0.55): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    points.push(
      samplePoint(90 + Math.sin(t * 19) * 60 + t * 140, 130 + Math.cos(t * 13) * 48, pressure),
    );
  }
  return points;
}

function fieldsFor(brush = pencilBrush()): MaterialFieldCache {
  const program = createPencilMaterialProgram(brush);
  return new MaterialFieldCache(resolveMaterialResource(program.paperResourceId));
}

function expectSameMaterial(
  actual: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>,
  expected: ReadonlyMap<MaterialTileKey, CommittedMaterialTile>,
): void {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  expect(expected.size).toBeGreaterThan(0);
  for (const [key, tile] of expected) {
    expect([...(actual.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
  }
}

/** Drives one stroke through the accumulator the way a live frame would. */
function accumulate(
  points: readonly StrokePoint[],
  brush = pencilBrush(),
  batch = 7,
): PencilMaterialAccumulator {
  const accumulator = new PencilMaterialAccumulator(brush, fieldsFor(brush));
  const seen: StrokePoint[] = [];
  for (let index = 0; index < points.length; index += batch) {
    for (let offset = index; offset < Math.min(index + batch, points.length); offset += 1) {
      const point = points[offset];
      if (point !== undefined) seen.push(point);
    }
    accumulator.append(seen, false);
  }
  accumulator.append(seen, true);
  return accumulator;
}

describe("Pencil material tiles and index", () => {
  it("assigns a dab to exactly the tiles its support reaches", () => {
    const dab = { x: 63, y: 63, radius: 4, coverage: 0.5, arc: 0 };
    // Centred one page unit inside the corner of tile 0,0 with a 4-unit radius,
    // so its support crosses into all four neighbours.
    expect(collectDabTiles(dab, [])).toEqual([0, 0, 1, 0, 0, 1, 1, 1]);
    const inside = { x: 20, y: 20, radius: 4, coverage: 0.5, arc: 0 };
    expect(collectDabTiles(inside, [])).toEqual([0, 0]);
  });

  it("builds the same packed index from the same samples every time", () => {
    const points = scribble(220);
    const brush = pencilBrush();
    const first = PencilDabIndex.build(points, brush);
    const second = PencilDabIndex.build(points, brush);
    expect(second.dabCount).toBe(first.dabCount);
    expect(second.tileCount).toBe(first.tileCount);
    expect(second.referenceCount).toBe(first.referenceCount);
    expect([...second.tileKeys()].sort()).toEqual([...first.tileKeys()].sort());
    for (const key of first.tileKeys()) {
      expect([...(second.membership(key)?.ids ?? [])]).toEqual([
        ...(first.membership(key)?.ids ?? []),
      ]);
    }
  });

  it("indexes the same dabs the placement produced, in order", () => {
    const points = scribble(160);
    const brush = pencilBrush();
    const index = PencilDabIndex.build(points, brush);
    const dabs = placePencilDabs(points, brush);
    expect(index.dabCount).toBe(dabs.length);
    const read = { x: 0, y: 0, radius: 0, coverage: 0, arc: 0 };
    for (let id = 0; id < dabs.length; id += 1) {
      index.readDab(id, read);
      const dab = dabs[id];
      expect([read.x, read.y, read.radius, read.coverage, read.arc]).toEqual([
        dab?.x,
        dab?.y,
        dab?.radius,
        dab?.coverage,
        dab?.arc,
      ]);
    }
  });

  it("gives one tile a strict subset of the stroke, in ascending order", () => {
    // The point of the index: redrawing one visible tile of a long mark must
    // not mean walking every dab the stroke ever placed.
    const points = scribble(600);
    const index = PencilDabIndex.build(points, pencilBrush());
    expect(index.tileCount).toBeGreaterThan(2);
    let largest = 0;
    for (const key of index.tileKeys()) {
      const ids = index.membership(key)?.ids ?? new Uint32Array();
      expect(ids.length).toBeGreaterThan(0);
      largest = Math.max(largest, ids.length);
      for (let position = 1; position < ids.length; position += 1) {
        expect(ids[position]).toBeGreaterThan(ids[position - 1] ?? 0);
      }
      const membership = index.membership(key);
      expect(membership).not.toBeNull();
      const tx = membership?.tx;
      const ty = membership?.ty;
      const read = { x: 0, y: 0, radius: 0, coverage: 0, arc: 0 };
      for (const id of ids) {
        index.readDab(id, read);
        const tiles = collectDabTiles(read, []);
        let found = false;
        for (let pair = 0; pair < tiles.length; pair += 2) {
          if (tiles[pair] === tx && tiles[pair + 1] === ty) found = true;
        }
        expect(found).toBe(true);
      }
    }
    expect(largest).toBeLessThan(index.dabCount);
  });

  it("holds no pixels and stays far smaller than the material it addresses", () => {
    const points = scribble(600);
    const index = PencilDabIndex.build(points, pencilBrush());
    const material = buildMaterial(points, pencilBrush());
    expect(index.retainedBytes).toBeLessThan(material.size * COMMITTED_TILE_BYTES);
  });

  it("rebuilds one tile exactly as a full build would", () => {
    const points = scribble(400);
    const brush = pencilBrush();
    const program = createPencilMaterialProgram(brush);
    const index = PencilDabIndex.build(points, brush);
    const full = reconstructMaterial(index, program, fieldsFor(brush));
    for (const key of index.tileKeys()) {
      // A separate field cache per tile, so nothing carried over from the full
      // build can be what makes the single rebuild agree.
      const alone = reconstructMaterialTile(key, index, program, fieldsFor(brush));
      expect([...(alone?.alpha ?? [])]).toEqual([...(full.get(key)?.alpha ?? [])]);
    }
  });

  it("does not depend on the order tiles are rebuilt in", () => {
    const points = scribble(300);
    const brush = pencilBrush();
    const program = createPencilMaterialProgram(brush);
    const index = PencilDabIndex.build(points, brush);
    const forward = reconstructMaterial(index, program, fieldsFor(brush));
    const fields = fieldsFor(brush);
    const reversed = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const key of [...index.tileKeys()].reverse()) {
      const tile = reconstructMaterialTile(key, index, program, fields);
      if (tile !== null) reversed.set(key, tile);
    }
    expectSameMaterial(reversed, forward);
  });

  it("returns nothing for a tile the stroke never reached", () => {
    const points = straight(0.6);
    const brush = pencilBrush();
    const index = PencilDabIndex.build(points, brush);
    const program = createPencilMaterialProgram(brush);
    expect(reconstructMaterialTile(materialTileKey(40, 40), index, program, fieldsFor(brush))).toBe(
      null,
    );
  });
});

describe("active and committed Pencil material", () => {
  const shapes: Array<[string, StrokePoint[]]> = [
    ["straight", straight(0.6)],
    ["curve", scribble(120, 0.7)],
    ["scribble", scribble(500)],
    ["tap", [samplePoint(150, 150, 0.6)]],
    [
      "self-crossing",
      Array.from({ length: 200 }, (_, index) => {
        const t = (index / 199) * Math.PI * 4;
        return samplePoint(150 + Math.sin(t) * 55, 150 + Math.sin(t * 2) * 40, 0.6);
      }),
    ],
  ];

  it.each(shapes)("live accumulation equals cold reconstruction: %s", (_name, points) => {
    // One algorithm, two schedules. If these ever diverged, a stroke would
    // change under the artist the first time its cache was dropped.
    const brush = pencilBrush();
    const committed = accumulate(points, brush).commit();
    const cold = reconstructMaterial(committed.index, committed.program, fieldsFor(brush));
    expectSameMaterial(cold, committed.tiles);
  });

  it("equals cold reconstruction for a broad Pencil too", () => {
    const brush = pencilBrush({ size: 26, smoothing: 0 });
    const committed = accumulate(scribble(260, 0.8), brush).commit();
    expectSameMaterial(
      reconstructMaterial(committed.index, committed.program, fieldsFor(brush)),
      committed.tiles,
    );
  });

  it("reaches the same material whatever the samples arrived in", () => {
    // A live stroke is fed a growing array in whatever batches the device
    // produced; the settled prefix must not depend on where those batches fell.
    const points = scribble(180);
    const brush = pencilBrush();
    const byOne = accumulate(points, brush, 1).commit();
    const byThirty = accumulate(points, brush, 30).commit();
    expectSameMaterial(byThirty.tiles, byOne.tiles);
    expect(byThirty.index.dabCount).toBe(byOne.index.dabCount);
  });

  it("keeps only the material once a stroke is committed", () => {
    // `base`, `peak` and `last` answer questions about a stroke in progress.
    // A finished stroke has no next dab to ask them on behalf of.
    const accumulator = accumulate(scribble(200));
    const tiles = accumulator.tileKeys();
    expect(tiles.length).toBeGreaterThan(0);
    const committed = accumulator.commit();
    expect(accumulator.residentTileCount).toBe(0);
    for (const tile of committed.tiles.values()) {
      expect(Object.keys(tile).sort()).toEqual(["alpha", "tx", "ty"]);
      expect(tile.alpha.byteLength).toBe(COMMITTED_TILE_BYTES);
    }
    const committedBytes = committed.tiles.size * COMMITTED_TILE_BYTES;
    const activeBytes = tiles.length * ACTIVE_TILE_BYTES;
    expect(committedBytes * 5).toBeLessThanOrEqual(activeBytes);
    expect(COMMITTED_TILE_BYTES).toBe(TILE_CELL_COUNT);
    expect(ACTIVE_TILE_BYTES).toBe(TILE_CELL_COUNT * 7);
  });

  it("refuses to commit material that is still being deposited", () => {
    const accumulator = new PencilMaterialAccumulator(pencilBrush(), fieldsFor());
    accumulator.append(straight(0.6).slice(0, 20), false);
    expect(() => accumulator.commit()).toThrow(/finalized/);
  });

  it("reports the tiles a frame changed, and no others", () => {
    const brush = pencilBrush({ smoothing: 0 });
    const accumulator = new PencilMaterialAccumulator(brush, fieldsFor(brush));
    const points = straight(0.6, 400, 100);
    const seen: StrokePoint[] = [];
    let everyDirty = new Set<MaterialTileKey>();
    for (let index = 0; index < points.length; index += 6) {
      for (let offset = index; offset < Math.min(index + 6, points.length); offset += 1) {
        const point = points[offset];
        if (point !== undefined) seen.push(point);
      }
      const dirty = accumulator.append(seen, false);
      everyDirty = new Set([...everyDirty, ...dirty]);
      // A frame touches the tiles near the tip, never the whole mark.
      expect(dirty.size).toBeLessThanOrEqual(2);
    }
    const dirty = accumulator.append(seen, true);
    everyDirty = new Set([...everyDirty, ...dirty]);
    expect(new Set(accumulator.tileKeys())).toEqual(everyDirty);
    expect(everyDirty.size).toBeGreaterThan(2);
  });
});

describe("Pencil material runtime ownership", () => {
  it("rebuilds identical material after the whole cache is destroyed", () => {
    // The invariant the boundary exists for: clearing the runtime costs time
    // and nothing else.
    const points = scribble(300);
    const brush = pencilBrush();
    const runtime = new PencilMaterialRuntime();
    const index = runtime.index("stroke-a", points, brush);
    const before = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const key of index.tileKeys()) {
      const tile = runtime.tile("stroke-a", key, points, brush);
      if (tile !== null) before.set(key, tile);
    }
    expect(runtime.stats().residentTiles).toBe(before.size);

    runtime.clear();
    expect(runtime.stats()).toMatchObject({ strokes: 0, residentTiles: 0, fieldTiles: 0 });

    const after = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const key of runtime.index("stroke-a", points, brush).tileKeys()) {
      const tile = runtime.tile("stroke-a", key, points, brush);
      if (tile !== null) after.set(key, tile);
    }
    expectSameMaterial(after, before);
  });

  it("leaves the artwork untouched when its material is released", () => {
    const brush = pencilBrush();
    const builder = new StrokeBuilder({
      id: "stroke-artwork",
      timestamp: 0,
      brush,
      smoother: new StrokeSmoother({ mode: "none" }),
    });
    for (const point of straight(0.6)) {
      builder.addPoint({
        x: point.x,
        y: point.y,
        timestamp: point.timestamp,
        pressure: point.pressure,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        pointerType: "pen",
        button: 0,
        buttons: 1,
      });
    }
    const stroke = builder.finalize();
    const before = stroke.points.map((point) => [point.x, point.y, point.pressure]);

    const runtime = new PencilMaterialRuntime();
    const material = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const key of runtime.index(stroke.id, stroke.points, stroke.brush).tileKeys()) {
      const tile = runtime.tile(stroke.id, key, stroke.points, stroke.brush);
      if (tile !== null) material.set(key, tile);
    }
    expect(material.size).toBeGreaterThan(0);

    runtime.releaseStroke(stroke.id);
    expect(runtime.stats().strokes).toBe(0);
    expect(stroke.points.map((point) => [point.x, point.y, point.pressure])).toEqual(before);
    expect(stroke.brush.renderer).toEqual({ version: 1, kind: "pencil" });

    const rebuilt = new Map<MaterialTileKey, CommittedMaterialTile>();
    for (const key of runtime.index(stroke.id, stroke.points, stroke.brush).tileKeys()) {
      const tile = runtime.tile(stroke.id, key, stroke.points, stroke.brush);
      if (tile !== null) rebuilt.set(key, tile);
    }
    expectSameMaterial(rebuilt, material);
  });

  it("adopts the material a live stroke just finished rather than rebuilding it", () => {
    const points = scribble(200);
    const brush = pencilBrush();
    const committed = accumulate(points, brush).commit();
    const runtime = new PencilMaterialRuntime();
    runtime.adopt("stroke-live", committed);
    expect(runtime.stats().reconstructedTiles).toBe(0);
    for (const [key, tile] of committed.tiles) {
      expect([...(runtime.tile("stroke-live", key, points, brush)?.alpha ?? [])]).toEqual([
        ...tile.alpha,
      ]);
    }
    expect(runtime.stats().reconstructedTiles).toBe(0);
  });

  it("holds one sheet between every stroke rather than one each", () => {
    const runtime = new PencilMaterialRuntime();
    const brush = pencilBrush();
    for (let index = 0; index < 40; index += 1) {
      const points = straight(0.6, 60, 100 + index * 3);
      for (const key of runtime.index(`stroke-${String(index)}`, points, brush).tileKeys()) {
        runtime.tile(`stroke-${String(index)}`, key, points, brush);
      }
    }
    const stats = runtime.stats();
    expect(stats.strokes).toBe(40);
    // Forty strokes over one region share a handful of field tiles; a per-stroke
    // field cache would hold forty copies of the same patch of paper.
    expect(stats.fieldTiles).toBeLessThan(10);
    expect(stats.residentTiles).toBeGreaterThan(stats.fieldTiles);
  });

  it("accounts material and index as the two budgets they will become", () => {
    const points = scribble(500);
    const brush = pencilBrush();
    const runtime = new PencilMaterialRuntime();
    for (const key of runtime.index("stroke-a", points, brush).tileKeys()) {
      runtime.tile("stroke-a", key, points, brush);
    }
    const stats = runtime.stats();
    expect(stats.residentMaterialBytes).toBe(stats.residentTiles * COMMITTED_TILE_BYTES);
    // Orders of magnitude apart, which is why E4.2B budgets them separately.
    expect(stats.residentIndexBytes * 4).toBeLessThan(stats.residentMaterialBytes);
  });

  it("puts nothing runtime into the material model", () => {
    // Backend-neutral by construction: no Canvas, no ImageData, no bitmap and
    // no context may reach a tile, an index or a resource.
    const points = straight(0.6);
    const brush = pencilBrush();
    const committed = accumulate(points, brush).commit();
    for (const tile of committed.tiles.values()) {
      expect(Object.keys(tile).sort()).toEqual(["alpha", "tx", "ty"]);
      expect(JSON.stringify(Object.keys(tile))).not.toMatch(/canvas|context|bitmap|image/i);
    }
    const program = committed.program;
    expect(Object.keys(program).sort()).toEqual(["deposition", "fieldCellSize", "paperResourceId"]);
    expect(Object.keys(program.deposition).sort()).toEqual([
      "fineBoost",
      "nib",
      "opacity",
      "spacing",
    ]);
  });

  it("covers one page unit with exactly the resolution the tiles claim", () => {
    expect(TILE_CELLS / MATERIAL_RESOLUTION).toBe(64);
    expect(TILE_CELL_COUNT).toBe(TILE_CELLS * TILE_CELLS);
  });
});
