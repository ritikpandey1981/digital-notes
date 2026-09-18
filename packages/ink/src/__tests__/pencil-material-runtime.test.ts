import { describe, expect, it } from "vitest";
import type { ResolvedBrushSnapshot } from "../brush-model";
import {
  COMMITTED_TILE_BYTES,
  DEFAULT_INDEX_BUDGET_BYTES,
  DEFAULT_MATERIAL_BUDGET_BYTES,
  MAXIMUM_CONCURRENT_JOBS,
  MaterialPriority,
  PencilDabIndex,
  PencilMaterialRuntime,
  PencilReconstructionScheduler,
  SLICE_BUDGET_MS,
  type CommittedMaterialTile,
  type MaterialSchedulerHost,
  type MaterialTileKey,
} from "../internal/pencil-material";
import type { StrokePoint } from "../types";
import { buildMaterial, pencilBrush, samplePoint } from "./pencil-material-fixture";

/**
 * The runtime that owns material: what it may spend, what it finishes first,
 * and what happens to work whose answer nobody is waiting for any more.
 *
 * Every rule here changes *when* a tile appears and never *what is in it* --
 * which is exactly why the scheduler is allowed to be as aggressive as it is.
 * The bytes are settled by the material suites; this settles the policy.
 */

/**
 * A scheduler whose clock and yield the test owns.
 *
 * Injecting both is what makes "a slice is four milliseconds" testable without
 * depending on how fast the machine happens to be.
 */
function controllable(host: MaterialSchedulerHost): PencilReconstructionScheduler {
  let now = 0;
  return new PencilReconstructionScheduler(
    host,
    (run) => {
      run();
    },
    () => {
      now += 0.05;
      return now;
    },
  );
}

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

function line(count: number, offsetY: number): StrokePoint[] {
  return Array.from({ length: count }, (_, index) =>
    samplePoint(60 + (index / Math.max(1, count - 1)) * 400, offsetY, 0.6),
  );
}

/** Drains a runtime's scheduler by running its real slices to completion. */
function drain(runtime: PencilMaterialRuntime, limit = 4000): void {
  runtime.scheduler.flush(limit);
}

/** Which tiles a stroke reaches, without depositing a single dab to find out. */
function tileKeysOf(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
): MaterialTileKey[] {
  return [...PencilDabIndex.build(points, brush).tileKeys()];
}

describe("Pencil material budgets", () => {
  it("defaults to the measured desktop budgets, accounted separately", () => {
    expect(DEFAULT_MATERIAL_BUDGET_BYTES).toBe(64 * 1024 * 1024);
    expect(DEFAULT_INDEX_BUDGET_BYTES).toBe(16 * 1024 * 1024);
    const runtime = new PencilMaterialRuntime();
    const stats = runtime.stats();
    expect(stats.materialBudgetBytes).toBe(DEFAULT_MATERIAL_BUDGET_BYTES);
    expect(stats.indexBudgetBytes).toBe(DEFAULT_INDEX_BUDGET_BYTES);
    runtime.destroy();
  });

  it("holds a hard material cap rather than quietly exceeding it", () => {
    // A cache that overran its budget would not be a budget. Nothing evicted is
    // lost, which is what lets eviction be this blunt.
    const brush = pencilBrush({ size: 12 });
    const runtime = new PencilMaterialRuntime({ materialBudgetBytes: COMMITTED_TILE_BYTES * 6 });
    for (let stroke = 0; stroke < 12; stroke += 1) {
      const points = line(80, 100 + stroke * 90);
      for (const key of tileKeysOf(points, brush)) {
        runtime.tileNow(`stroke-${String(stroke)}`, key, points, brush);
        expect(runtime.stats().residentMaterialBytes).toBeLessThanOrEqual(COMMITTED_TILE_BYTES * 6);
      }
    }
    const stats = runtime.stats();
    expect(stats.materialEvictions).toBeGreaterThan(0);
    expect(stats.residentTiles).toBeLessThanOrEqual(6);
    runtime.destroy();
  });

  it("evicts offscreen material before material that is on screen", () => {
    const brush = pencilBrush({ size: 12 });
    const runtime = new PencilMaterialRuntime({ materialBudgetBytes: COMMITTED_TILE_BYTES * 4 });
    const visiblePoints = line(60, 120);
    const visibleKeys = tileKeysOf(visiblePoints, brush).slice(0, 2);
    for (const key of visibleKeys) runtime.tileNow("visible", key, visiblePoints, brush);
    runtime.markVisible(visibleKeys.map((key) => ({ strokeId: "visible", key })));

    for (let stroke = 0; stroke < 6; stroke += 1) {
      const points = line(60, 400 + stroke * 80);
      for (const key of tileKeysOf(points, brush)) {
        runtime.tileNow(`offscreen-${String(stroke)}`, key, points, brush);
      }
    }
    for (const key of visibleKeys) expect(runtime.tile("visible", key)).not.toBeNull();
    expect(runtime.stats().materialEvictions).toBeGreaterThan(0);
    runtime.destroy();
  });

  it("budgets indexes separately from material", () => {
    const brush = pencilBrush({ size: 12 });
    const runtime = new PencilMaterialRuntime({ indexBudgetBytes: 4096 });
    for (let stroke = 0; stroke < 8; stroke += 1) {
      runtime.index(`stroke-${String(stroke)}`, scribble(400, 0.6, stroke * 40), brush);
    }
    const stats = runtime.stats();
    expect(stats.indexEvictions).toBeGreaterThan(0);
    expect(stats.residentIndexBytes).toBeGreaterThan(0);
    // Material was never charged for any of it.
    expect(stats.residentMaterialBytes).toBe(0);
    runtime.destroy();
  });

  it("rebuilds an evicted index from the samples alone", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(300);
    const runtime = new PencilMaterialRuntime({ indexBudgetBytes: 4096 });
    const first = runtime.index("stroke-a", points, brush);
    const digest = [...(first.membership(first.tileKeys()[0] ?? "")?.ids ?? [])];
    for (let other = 0; other < 8; other += 1) {
      runtime.index(`filler-${String(other)}`, scribble(400, 0.6, other * 40), brush);
    }
    const rebuilt = runtime.index("stroke-a", points, brush);
    expect([...(rebuilt.membership(rebuilt.tileKeys()[0] ?? "")?.ids ?? [])]).toEqual(digest);
    runtime.destroy();
  });
});

describe("Pencil reconstruction scheduling", () => {
  it("bypasses the scheduler entirely for material it already holds", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(200);
    const runtime = new PencilMaterialRuntime();
    const keys = tileKeysOf(points, brush);
    for (const key of keys) runtime.tileNow("hot", key, points, brush);
    const before = runtime.stats();

    runtime.requestVisible([runtime.createRequest("hot", points, brush, keys)]);
    const after = runtime.stats();
    // Nothing queued, nothing reconstructed, no index rebuilt, no task hop.
    expect(after.scheduler.queuedJobs).toBe(0);
    expect(after.reconstructedTiles).toBe(before.reconstructedTiles);
    for (const key of keys) expect(runtime.tile("hot", key)).not.toBeNull();
    runtime.destroy();
  });

  it("rebuilds only the visible tiles it was asked for, not the whole stroke", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(700);
    const runtime = new PencilMaterialRuntime();
    const keys = tileKeysOf(points, brush);
    expect(keys.length).toBeGreaterThan(3);
    // Warm: the index is resident, the material is not.
    runtime.index("warm", points, brush);
    const wanted = keys.slice(0, 2);
    runtime.requestVisible([runtime.createRequest("warm", points, brush, wanted)]);
    drain(runtime);
    for (const key of wanted) expect(runtime.tile("warm", key)).not.toBeNull();
    for (const key of keys.slice(2)) expect(runtime.tile("warm", key)).toBeNull();
    runtime.destroy();
  });

  it("builds the index and then the tiles when both are cold", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(600);
    const runtime = new PencilMaterialRuntime();
    expect(runtime.hasIndex("cold")).toBe(false);
    const wanted = tileKeysOf(points, brush).slice(0, 3);
    runtime.requestVisible([runtime.createRequest("cold", points, brush, wanted)]);
    drain(runtime);
    expect(runtime.hasIndex("cold")).toBe(true);
    for (const key of wanted) expect(runtime.tile("cold", key)).not.toBeNull();
    runtime.destroy();
  });

  it("chunks a large index build and does it inline for an ordinary stroke", () => {
    const brush = pencilBrush({ size: 8 });
    const small = new PencilMaterialRuntime();
    const smallPoints = scribble(400);
    small.requestVisible([
      small.createRequest("small", smallPoints, brush, tileKeysOf(smallPoints, brush).slice(0, 1)),
    ]);
    drain(small);
    expect(small.stats().scheduler.chunkedIndexBuilds).toBe(0);
    expect(small.stats().scheduler.indexBuilds).toBe(1);
    small.destroy();

    const large = new PencilMaterialRuntime();
    const largePoints = scribble(4000);
    large.requestVisible([
      large.createRequest("large", largePoints, brush, tileKeysOf(largePoints, brush).slice(0, 1)),
    ]);
    drain(large);
    expect(large.stats().scheduler.chunkedIndexBuilds).toBe(1);
    large.destroy();
  });

  it("produces the same bytes whether a tile is built in one slice or many", () => {
    // Intra-tile resume: a tile paused halfway and continued next slice must be
    // the tile a synchronous build would have produced, to the byte.
    const brush = pencilBrush({ size: 26 });
    const points = scribble(900, 0.85);
    const reference = buildMaterial(points, brush);
    const runtime = new PencilMaterialRuntime();
    runtime.requestVisible([runtime.createRequest("sliced", points, brush, [...reference.keys()])]);
    drain(runtime);
    for (const [key, tile] of reference) {
      expect([...(runtime.tile("sliced", key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
    expect(runtime.stats().scheduler.slices).toBeGreaterThan(1);
    runtime.destroy();
  });

  it("never publishes a tile it has not finished", () => {
    const brush = pencilBrush({ size: 26 });
    const points = scribble(800, 0.85);
    const reference = buildMaterial(points, brush);
    const published: CommittedMaterialTile[] = [];
    const runtime = new PencilMaterialRuntime({
      onMaterialPublished: (strokeId, keys) => {
        for (const key of keys) {
          const tile = runtime.tile(strokeId, key);
          if (tile !== null) published.push(tile);
        }
      },
    });
    runtime.requestVisible([runtime.createRequest("whole", points, brush, [...reference.keys()])]);
    drain(runtime);
    expect(published.length).toBeGreaterThan(0);
    for (const tile of published) {
      const key = `${String(tile.tx)},${String(tile.ty)}`;
      // Every published tile is complete, not a snapshot of scratch.
      expect([...tile.alpha]).toEqual([...(reference.get(key)?.alpha ?? [])]);
    }
    runtime.destroy();
  });

  it("finishes visible-centre material before visible-peripheral material", () => {
    const brush = pencilBrush({ size: 12 });
    const centre = scribble(400, 0.6, 0);
    const edge = scribble(400, 0.6, 600);
    const order: string[] = [];
    const runtime = new PencilMaterialRuntime({
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
    drain(runtime);
    expect(order.length).toBeGreaterThan(1);
    expect(order[0]).toBe("centre");
    expect(order.lastIndexOf("centre")).toBeLessThan(order.indexOf("edge"));
    runtime.destroy();
  });

  it("rotates between strokes of one priority instead of finishing them in turn", () => {
    // One heavy mark must not starve the twenty around it: a viewport where one
    // stroke finishes and the rest are blank reads as broken in a way that a
    // viewport filling in evenly does not.
    const brush = pencilBrush({ size: 16 });
    const order: string[] = [];
    const runtime = new PencilMaterialRuntime({
      onMaterialPublished: (strokeId) => order.push(strokeId),
    });
    const requests = [0, 1, 2, 3].map((index) => {
      const points = scribble(500, 0.7, index * 30);
      // Indexes resident, so the rotation is over tile work rather than builds.
      runtime.index(`stroke-${String(index)}`, points, brush);
      return runtime.createRequest(
        `stroke-${String(index)}`,
        points,
        brush,
        tileKeysOf(points, brush),
      );
    });
    runtime.requestVisible(requests);
    drain(runtime);
    const firstFour = new Set(order.slice(0, 6));
    expect(firstFour.size).toBeGreaterThan(1);
    expect(new Set(order).size).toBe(4);
    runtime.destroy();
  });

  it("holds scratch for a bounded number of jobs at once", () => {
    const brush = pencilBrush({ size: 16 });
    const runtime = new PencilMaterialRuntime();
    const requests = Array.from({ length: MAXIMUM_CONCURRENT_JOBS * 2 }, (_, index) => {
      const points = scribble(300, 0.7, index * 24);
      return runtime.createRequest(
        `stroke-${String(index)}`,
        points,
        brush,
        tileKeysOf(points, brush),
      );
    });
    runtime.requestVisible(requests);
    runtime.scheduler.flush(1);
    expect(runtime.stats().scheduler.startedJobs).toBeLessThanOrEqual(MAXIMUM_CONCURRENT_JOBS);
    runtime.destroy();
  });

  it("cancels obsolete work when the viewport moves on", () => {
    const brush = pencilBrush({ size: 16 });
    const runtime = new PencilMaterialRuntime();
    const first = [0, 1, 2].map((index) => {
      const points = scribble(600, 0.7, index * 30);
      return runtime.createRequest(
        `old-${String(index)}`,
        points,
        brush,
        tileKeysOf(points, brush),
      );
    });
    runtime.requestVisible(first);
    runtime.scheduler.flush(1);
    expect(runtime.stats().scheduler.queuedJobs).toBeGreaterThan(0);
    const settledBefore = runtime.stats().scheduler.tilesPublished;

    // A new authoritative request supersedes the last one entirely. Tiles the
    // old request had already finished are kept -- a cache may keep anything it
    // built -- but no further work is spent on them.
    const replacementPoints = scribble(200, 0.7, 900);
    runtime.requestVisible([
      runtime.createRequest("new", replacementPoints, brush, tileKeysOf(replacementPoints, brush)),
    ]);
    const stats = runtime.stats().scheduler;
    expect(stats.jobsCancelled).toBeGreaterThanOrEqual(3);
    drain(runtime);
    expect(runtime.stats().scheduler.queuedJobs).toBe(0);

    const replacementKeys = tileKeysOf(replacementPoints, brush);
    for (const key of replacementKeys) expect(runtime.tile("new", key)).not.toBeNull();
    // Everything finished after the supersede belongs to the new request.
    expect(runtime.stats().scheduler.tilesPublished - settledBefore).toBeLessThanOrEqual(
      replacementKeys.length,
    );
    let oldResident = 0;
    for (let index = 0; index < 3; index += 1) {
      const points = scribble(600, 0.7, index * 30);
      for (const key of tileKeysOf(points, brush)) {
        if (runtime.tile(`old-${String(index)}`, key) !== null) oldResident += 1;
      }
    }
    expect(oldResident).toBeLessThanOrEqual(settledBefore);
    runtime.destroy();
  });

  it("drops every job when a page is left", () => {
    const brush = pencilBrush({ size: 16 });
    const runtime = new PencilMaterialRuntime();
    const points = scribble(800, 0.8);
    runtime.requestVisible([
      runtime.createRequest("page-a", points, brush, tileKeysOf(points, brush)),
    ]);
    runtime.scheduler.flush(1);
    runtime.scheduler.cancelAll();
    expect(runtime.stats().scheduler.queuedJobs).toBe(0);
    drain(runtime);
    expect(runtime.stats().scheduler.tilesPublished).toBeLessThan(tileKeysOf(points, brush).length);
    runtime.destroy();
  });

  it("publishes nothing once its project runtime has been retired", () => {
    // The guard that makes runtime replacement safe: a slice that began
    // legitimately can still finish into a runtime that has moved on.
    let owned = true;
    const brush = pencilBrush({ size: 16 });
    const points = scribble(900, 0.8);
    const published: string[] = [];
    const runtime = new PencilMaterialRuntime({
      isActive: () => owned,
      onMaterialPublished: (_strokeId, keys) => published.push(...keys),
    });
    runtime.requestVisible([
      runtime.createRequest("retired", points, brush, tileKeysOf(points, brush)),
    ]);
    runtime.scheduler.flush(1);
    owned = false;
    drain(runtime);
    const after = published.length;
    drain(runtime);
    expect(published.length).toBe(after);
    expect(runtime.active).toBe(false);
    expect(runtime.stats().scheduler.queuedJobs).toBe(0);
    runtime.destroy();
  });

  it("stops scheduling once destroyed", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(300);
    const runtime = new PencilMaterialRuntime();
    runtime.destroy();
    runtime.requestVisible([
      runtime.createRequest("gone", points, brush, tileKeysOf(points, brush)),
    ]);
    expect(runtime.stats().scheduler.queuedJobs).toBe(0);
    expect(runtime.active).toBe(false);
  });

  it("uses a four millisecond slice budget", () => {
    expect(SLICE_BUDGET_MS).toBe(4);
    const brush = pencilBrush({ size: 12 });
    const points = scribble(600, 0.8);
    const runtime = new PencilMaterialRuntime();
    runtime.requestVisible([
      runtime.createRequest("sliced", points, brush, tileKeysOf(points, brush)),
    ]);
    drain(runtime);
    const stats = runtime.stats().scheduler;
    expect(stats.slices).toBeGreaterThan(0);
    // A quantum can overrun its budget by at most the work it was already in.
    expect(stats.longestSliceMilliseconds).toBeLessThan(SLICE_BUDGET_MS * 6);
    runtime.destroy();
  });

  it("keeps a controllable clock inside its slice budget", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(500, 0.7);
    const keys = tileKeysOf(points, brush);
    const runtime = new PencilMaterialRuntime({
      scheduler: (host) => controllable(host),
    });
    runtime.requestVisible([runtime.createRequest("clocked", points, brush, keys)]);
    runtime.scheduler.flush(2000);
    for (const key of keys) expect(runtime.tile("clocked", key)).not.toBeNull();
    runtime.destroy();
  });

  it("leaves the artwork authoritative when everything is thrown away", () => {
    const brush = pencilBrush({ size: 12 });
    const points = scribble(400);
    const reference = buildMaterial(points, brush);
    const runtime = new PencilMaterialRuntime();
    runtime.requestVisible([
      runtime.createRequest("durable", points, brush, [...reference.keys()]),
    ]);
    drain(runtime);
    runtime.clear();
    expect(runtime.stats().residentTiles).toBe(0);
    expect(runtime.stats().residentIndexes).toBe(0);

    runtime.requestVisible([
      runtime.createRequest("durable", points, brush, [...reference.keys()]),
    ]);
    drain(runtime);
    for (const [key, tile] of reference) {
      expect([...(runtime.tile("durable", key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
    runtime.destroy();
  });

  it("uses a packed index that never exceeds its own budget accounting", () => {
    const brush = pencilBrush({ size: 12 });
    const runtime = new PencilMaterialRuntime();
    const points = scribble(2000);
    const index = runtime.index("accounted", points, brush);
    expect(index).toBeInstanceOf(PencilDabIndex);
    expect(runtime.stats().residentIndexBytes).toBe(index.retainedBytes);
    runtime.destroy();
  });
});
