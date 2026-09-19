import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResolvedBrushSnapshot } from "../brush-model";
import {
  COMMITTED_TILE_BYTES,
  MaterialFieldCache,
  MaterialPriority,
  PencilDabIndex,
  PencilMaterialAccumulator,
  TILE_CELLS,
  createPencilMaterialProgram,
  materialAppearanceKey,
  resolveMaterialResource,
  type MaterialTileKey,
} from "../internal/pencil-material";
import {
  PencilMaterialEvaluator,
  createPencilMaterialGeometry,
  createPencilMaterialRuntime,
  drawPencilMaterial,
  pencilMaterialCacheId,
  releaseTileScratch,
} from "../internal/pencil-material-strategy";
import type { StrokePoint } from "../types";
import { buildMaterial, pencilBrush, samplePoint } from "./pencil-material-fixture";
import { installCanvasStub, recordingContext, type CanvasStub } from "./canvas-stub";

/**
 * Turning finished material into something drawable.
 *
 * A presentation is a tile's alpha tinted with the stroke's colour, and it is
 * the last derived thing between the artwork and the screen. It is cheap --
 * about a fifth of a millisecond a tile -- and that is exactly why it needed
 * scheduling rather than a rewrite: a cold viewport of a large project wants
 * hundreds at once, and hundreds of a fifth of a millisecond is a frame gone.
 *
 * Everything here is about *when* a tile becomes drawable and what it costs to
 * hold. What is in it is settled by the material suites, and this checks that
 * scheduling did not disturb them.
 */

const PRESENTATION_BYTES = TILE_CELLS * TILE_CELLS * 4;

function scribble(count: number, pressure = 0.55, offsetY = 0): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / Math.max(1, count - 1);
    points.push(
      samplePoint(
        90 + Math.sin(t * 19) * 60 + t * 220,
        130 + offsetY + Math.cos(t * 13) * 48,
        pressure,
      ),
    );
  }
  return points;
}

function tileKeysOf(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
): MaterialTileKey[] {
  return [...PencilDabIndex.build(points, brush).tileKeys()];
}

let canvas: CanvasStub;

beforeEach(() => {
  canvas = installCanvasStub();
});

afterEach(() => {
  releaseTileScratch();
  canvas.restore();
});

describe("Pencil presentation tiles", () => {
  it("leaves the deposited material exactly as it was", () => {
    // Scheduling changes when a tile is drawable and nothing about what it
    // holds. The bytes a presenting runtime keeps are the bytes a plain
    // reconstruction produces.
    const brush = pencilBrush({ size: 16 });
    const points = scribble(400);
    const reference = buildMaterial(points, brush);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, [...reference.keys()])]);
    runtime.scheduler.flush();
    for (const [key, tile] of reference) {
      expect([...(runtime.tile("a", key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
    runtime.destroy();
  });

  it("builds a presentation from the committed alpha, in the stroke's colour", () => {
    const brush = pencilBrush({ size: 16, color: "#0099bb" });
    const points = scribble(200);
    const keys = tileKeysOf(points, brush);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    runtime.scheduler.flush();
    const display = runtime.display("a", keys[0] ?? "");
    expect(display).not.toBeNull();
    expect(display?.color).toBe("#0099bb");
    expect(canvas.fills).toContain("#0099bb");
    runtime.destroy();
  });

  it("does not apply base opacity a second time when it tints", () => {
    // Opacity is already inside the alpha bytes. The tint is a `source-in`
    // fill, which replaces colour and keeps alpha; a painter that also reached
    // for globalAlpha would darken the mark on every rebuild.
    const brush = pencilBrush({ size: 16, opacity: 0.4 });
    const points = scribble(150);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, tileKeysOf(points, brush))]);
    runtime.scheduler.flush();
    expect(canvas.fillAlphas.length).toBeGreaterThan(0);
    for (const alpha of canvas.fillAlphas) expect(alpha).toBe(1);
    runtime.destroy();
  });

  it("keys material on the appearance, not on identity alone", () => {
    // A restyled stroke keeps its id and changes its width, so a cache keyed by
    // identity would serve the graphite of a mark that no longer exists.
    const thin = pencilBrush({ size: 6 });
    const thick = pencilBrush({ size: 20 });
    expect(pencilMaterialCacheId("s", thin)).not.toBe(pencilMaterialCacheId("s", thick));
    expect(pencilMaterialCacheId("s", thin)).toBe(
      pencilMaterialCacheId("s", pencilBrush({ size: 6 })),
    );
    // Colour is deliberately not in it: recolouring must not throw away
    // graphite, only the tint built from it.
    expect(materialAppearanceKey(pencilBrush({ size: 6, color: "#ff0000" }))).toBe(
      materialAppearanceKey(thin),
    );
    for (const changed of [
      pencilBrush({ size: 6, opacity: 0.2 }),
      pencilBrush({ size: 6, smoothing: 0 }),
    ]) {
      expect(materialAppearanceKey(changed)).not.toBe(materialAppearanceKey(thin));
    }
  });

  it("rebuilds only the tint when the colour changes", () => {
    const points = scribble(150);
    const graphite = pencilBrush({ size: 16, color: "#343434" });
    const teal = pencilBrush({ size: 16, color: "#0099bb" });
    const keys = tileKeysOf(points, graphite);
    const runtime = createPencilMaterialRuntime();
    const id = pencilMaterialCacheId("s", graphite);
    expect(id).toBe(pencilMaterialCacheId("s", teal));

    runtime.requestVisible([runtime.createRequest(id, points, graphite, keys)]);
    runtime.scheduler.flush();
    const rebuilt = runtime.stats().reconstructedTiles;
    const alpha = [...(runtime.tile(id, keys[0] ?? "")?.alpha ?? [])];
    expect(runtime.ready(id, keys[0] ?? "", "#343434")).toBe(true);
    expect(runtime.ready(id, keys[0] ?? "", "#0099bb")).toBe(false);

    runtime.requestVisible([runtime.createRequest(id, points, teal, keys)]);
    runtime.scheduler.flush();
    expect(runtime.display(id, keys[0] ?? "")?.color).toBe("#0099bb");
    // The graphite underneath was not touched.
    expect([...(runtime.tile(id, keys[0] ?? "")?.alpha ?? [])]).toEqual(alpha);
    expect(runtime.stats().reconstructedTiles).toBe(rebuilt);
    runtime.destroy();
  });

  it("bypasses the scheduler for a tile that is already drawable", () => {
    const brush = pencilBrush({ size: 16 });
    const points = scribble(200);
    const keys = tileKeysOf(points, brush);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    runtime.scheduler.flush();
    const settled = runtime.stats().scheduler;

    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    const after = runtime.stats().scheduler;
    expect(after.queuedJobs).toBe(0);
    expect(after.slices).toBe(settled.slices);
    runtime.destroy();
  });

  it("presents a tile whose material was adopted rather than rebuilt", () => {
    // Commit hands over finished material, so the only thing missing is the
    // drawable form -- and it must still be scheduled rather than made in a
    // frame, because a broad mark hands over dozens of tiles at once.
    const brush = pencilBrush({ size: 16 });
    const points = scribble(300);
    const accumulator = new PencilMaterialAccumulator(
      brush,
      new MaterialFieldCache(
        resolveMaterialResource(createPencilMaterialProgram(brush).paperResourceId),
      ),
    );
    accumulator.append(points, true);
    const committed = accumulator.commit();
    expect(committed.tiles.size).toBeGreaterThan(1);

    const runtime = createPencilMaterialRuntime();
    runtime.adopt("a", committed);
    const keys = [...committed.tiles.keys()];
    // Deposited, not yet drawable.
    for (const key of keys) {
      expect(runtime.tile("a", key)).not.toBeNull();
      expect(runtime.ready("a", key, brush.color)).toBe(false);
    }
    const reconstructed = runtime.stats().reconstructedTiles;

    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    runtime.scheduler.flush();
    for (const key of keys) expect(runtime.ready("a", key, brush.color)).toBe(true);
    // Nothing was deposited a second time to get there.
    expect(runtime.stats().reconstructedTiles).toBe(reconstructed);
    expect(runtime.stats().presentationsBuilt).toBe(keys.length);
    runtime.destroy();
  });

  it("spends a quantum on a presentation, never a whole burst", () => {
    const brush = pencilBrush({ size: 20 });
    const points = scribble(900, 0.8);
    const keys = tileKeysOf(points, brush);
    expect(keys.length).toBeGreaterThan(4);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    runtime.scheduler.flush(1);
    const afterOne = runtime.stats();
    // One slice cannot have presented every tile of a broad mark.
    expect(afterOne.presentationsBuilt).toBeLessThan(keys.length);
    runtime.scheduler.flush();
    const done = runtime.stats();
    expect(done.presentationsBuilt).toBeGreaterThan(0);
    for (const key of keys) {
      if (runtime.tile("a", key) !== null) {
        expect(runtime.ready("a", key, brush.color)).toBe(true);
      }
    }
    runtime.destroy();
  });

  it("finishes central material before peripheral material", () => {
    const brush = pencilBrush({ size: 12 });
    const centre = scribble(300, 0.6, 0);
    const edge = scribble(300, 0.6, 600);
    const order: string[] = [];
    const runtime = createPencilMaterialRuntime({
      onMaterialPublished: (strokeId) => order.push(strokeId),
    });
    runtime.requestVisible([
      runtime.createRequest(
        "edge",
        edge,
        brush,
        tileKeysOf(edge, brush),
        MaterialPriority.VisiblePeripheral,
      ),
      runtime.createRequest(
        "centre",
        centre,
        brush,
        tileKeysOf(centre, brush),
        MaterialPriority.VisibleCenter,
      ),
    ]);
    runtime.scheduler.flush();
    expect(order[0]).toBe("centre");
    runtime.destroy();
  });

  it("publishes nothing once its runtime has been retired", () => {
    let owned = true;
    const brush = pencilBrush({ size: 20 });
    const points = scribble(800, 0.8);
    const runtime = createPencilMaterialRuntime({ isActive: () => owned });
    runtime.requestVisible([runtime.createRequest("a", points, brush, tileKeysOf(points, brush))]);
    runtime.scheduler.flush(1);
    const presented = runtime.stats().presentationsBuilt;
    owned = false;
    runtime.scheduler.flush();
    expect(runtime.stats().presentationsBuilt).toBe(presented);
    expect(runtime.active).toBe(false);
    runtime.destroy();
  });

  it("drops presentation work with the page it belonged to", () => {
    const brush = pencilBrush({ size: 20 });
    const points = scribble(800, 0.8);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, tileKeysOf(points, brush))]);
    runtime.scheduler.flush(1);
    runtime.scheduler.cancelAll();
    const presented = runtime.stats().presentationsBuilt;
    runtime.scheduler.flush();
    expect(runtime.stats().presentationsBuilt).toBe(presented);
    expect(runtime.stats().scheduler.queuedJobs).toBe(0);
    runtime.destroy();
  });

  it("charges presentation backing to the material budget", () => {
    // Sixteen kilobytes of alpha becomes eighty once it can be drawn. A budget
    // that counted only the alpha would be wrong by a factor of five.
    const brush = pencilBrush({ size: 12 });
    const points = scribble(120);
    const keys = tileKeysOf(points, brush).slice(0, 1);
    const runtime = createPencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("a", points, brush, keys)]);
    runtime.scheduler.flush();
    const stats = runtime.stats();
    expect(stats.residentTiles).toBe(1);
    expect(stats.residentMaterialBytes).toBe(COMMITTED_TILE_BYTES + PRESENTATION_BYTES);
    runtime.destroy();
  });

  it("keeps the hard cap with presentation backing counted in", () => {
    const brush = pencilBrush({ size: 12 });
    const budget = (COMMITTED_TILE_BYTES + PRESENTATION_BYTES) * 3;
    const runtime = createPencilMaterialRuntime({ materialBudgetBytes: budget });
    for (let stroke = 0; stroke < 8; stroke += 1) {
      const points = scribble(120, 0.6, stroke * 80);
      runtime.requestVisible([
        runtime.createRequest(`s-${String(stroke)}`, points, brush, tileKeysOf(points, brush)),
      ]);
      runtime.scheduler.flush();
      expect(runtime.stats().residentMaterialBytes).toBeLessThanOrEqual(budget);
    }
    expect(runtime.stats().materialEvictions).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("shares one scratch canvas for live tiles rather than making one each time", () => {
    // The largest allocator in the live path was a fresh ImageData per dirty
    // tile per frame: 64 KiB at a hundred and twenty frames a second, which
    // shows up not as a slow function but as an occasional long pause.
    const brush = pencilBrush({ size: 12 });
    const points = scribble(200);
    const evaluator = new PencilMaterialEvaluator(brush);
    evaluator.append(points, true);
    const geometry = evaluator.geometry();
    expect(geometry.tileKeys.length).toBeGreaterThan(1);

    releaseTileScratch();
    const before = canvas.created;
    const { context } = recordingContext();
    for (let frame = 0; frame < 20; frame += 1) {
      drawPencilMaterial(context, geometry, brush, null);
    }
    // One canvas for the whole run, however many tiles and frames it painted.
    expect(canvas.created - before).toBe(1);
    evaluator.dispose();
  });
});

describe("the handover from live to cached", () => {
  /**
   * The frame that first paints a mark the artist has just finished.
   *
   * A stroke leaves the live layer the instant it is finalized and arrives on
   * the compositor that keeps it. Between those two things the mark must never
   * be missing, and it must never arrive in pieces -- both of which a person
   * sees as a flicker at the moment they lift the pencil.
   *
   * Measured at pointer-up before this rule existed: one frame on neither
   * surface, then a frame carrying 46% of the mark, then the rest about 20 ms
   * later. The 46% is the ordinary inline limit doing exactly what it is for,
   * in the one case where it is wrong.
   */
  function committedMaterial(brush: ResolvedBrushSnapshot, points: readonly StrokePoint[]) {
    const accumulator = new PencilMaterialAccumulator(
      brush,
      new MaterialFieldCache(
        resolveMaterialResource(createPencilMaterialProgram(brush).paperResourceId),
      ),
    );
    accumulator.append(points, true);
    return accumulator.commit();
  }

  it("paints every tile of a just-deposited mark in one frame", () => {
    const brush = pencilBrush({ size: 22 });
    const points = scribble(700, 0.8);
    const committed = committedMaterial(brush, points);
    // More tiles than the ordinary inline limit of eight, which is the whole
    // point: rationing them is what tore the mark.
    expect(committed.tiles.size).toBeGreaterThan(8);

    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("handover", brush);
    runtime.adopt(cacheId, committed);
    expect(runtime.isHandingOver(cacheId)).toBe(true);

    const geometry = createPencilMaterialGeometry(points, brush, "handover");
    const { context } = recordingContext();
    const result = drawPencilMaterial(context, geometry, brush, runtime);
    expect(result.missing).toEqual([]);
    expect(result.painted).toBe(geometry.tileKeys.length);
    // Having been painted whole, it is an ordinary cached mark from here on.
    expect(runtime.isHandingOver(cacheId)).toBe(false);
    runtime.destroy();
  });

  it("still rations an ordinary mark that is merely being looked at", () => {
    // The limit exists for a cold viewport of a large project, and nothing
    // here weakens it: a mark that was not just drawn gets the ordinary eight.
    const brush = pencilBrush({ size: 22 });
    const points = scribble(700, 0.8);
    const committed = committedMaterial(brush, points);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("ordinary", brush);
    runtime.adopt(cacheId, committed);
    runtime.endHandover(cacheId);
    expect(runtime.isHandingOver(cacheId)).toBe(false);

    const geometry = createPencilMaterialGeometry(points, brush, "ordinary");
    const { context } = recordingContext();
    const result = drawPencilMaterial(context, geometry, brush, runtime);
    expect(result.painted).toBe(8);
    expect(result.missing.length).toBe(geometry.tileKeys.length - 8);
    runtime.destroy();
  });

  it("does not end a handover on a repaint of part of the mark", () => {
    // A local repaint of two tiles says nothing about the other twenty, and
    // must not retire the handover on their behalf.
    const brush = pencilBrush({ size: 22 });
    const points = scribble(700, 0.8);
    const committed = committedMaterial(brush, points);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("partial", brush);
    runtime.adopt(cacheId, committed);

    const geometry = createPencilMaterialGeometry(points, brush, "partial");
    const { context } = recordingContext();
    const first = geometry.tileKeys[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    drawPencilMaterial(context, geometry, brush, runtime, new Set([first]));
    expect(runtime.isHandingOver(cacheId)).toBe(true);
    runtime.destroy();
  });

  it("forgets a handover with the stroke it belonged to", () => {
    const brush = pencilBrush({ size: 16 });
    const points = scribble(200);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("released", brush);
    runtime.adopt(cacheId, committedMaterial(brush, points));
    expect(runtime.isHandingOver(cacheId)).toBe(true);
    runtime.releaseStroke(cacheId);
    expect(runtime.isHandingOver(cacheId)).toBe(false);

    runtime.adopt(cacheId, committedMaterial(brush, points));
    expect(runtime.isHandingOver(cacheId)).toBe(true);
    runtime.clear();
    expect(runtime.isHandingOver(cacheId)).toBe(false);
    runtime.destroy();
  });

  it("hands over the same bytes the artist watched being deposited", () => {
    // The handover changes when tiles become drawable and nothing about what
    // is in them: the adopted material is the material a cold rebuild makes.
    const brush = pencilBrush({ size: 18 });
    const points = scribble(400, 0.7);
    const committed = committedMaterial(brush, points);
    const rebuilt = buildMaterial(points, brush);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("equal", brush);
    runtime.adopt(cacheId, committed);
    for (const [key, tile] of committed.tiles) {
      const cached = runtime.tile(cacheId, key);
      expect(cached).not.toBeNull();
      expect(cached?.alpha).toEqual(tile.alpha);
      const cold = rebuilt.get(key);
      if (cold !== undefined) expect(tile.alpha).toEqual(cold.alpha);
    }
    runtime.destroy();
  });
});
