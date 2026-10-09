import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TILE_CELLS, TILE_PAGE_UNITS, type MaterialTileKey } from "../internal/pencil-material";
import {
  PencilMaterialEvaluator,
  assemblePresentationAlpha,
  createPencilMaterialRuntime,
  drawMaterialTileGrid,
  drawPencilMaterial,
  materialTileDeviceRect,
  materialTileGrid,
  pencilMaterialCacheId,
  previewMaterialRuntime,
  releasePreviewMaterialRuntime,
  releaseTileScratch,
} from "../internal/pencil-material-strategy";
import { createPencilMaterialGeometry } from "../internal/pencil-material-strategy";
import type { StrokePoint } from "../types";
import { buildMaterial, pencilBrush, samplePoint, straight } from "./pencil-material-fixture";
import {
  IDENTITY_TRANSFORM,
  installCanvasStub,
  recordingContext,
  type CanvasStub,
  type StubTransform,
} from "./canvas-stub";

/**
 * Where a tile is put, as opposed to what is in it.
 *
 * Two neighbouring tiles abut exactly in page space and that is not enough.
 * Each `drawImage` is rasterized on its own, so a shared boundary that falls
 * between two device pixels leaves that pixel covered partly by one tile and
 * partly by the other -- and two partial coverages composited with
 * `source-over` do not add up to one. The pixel comes out lighter, and a person
 * sees a pale grid through broad Pencil.
 *
 * Measured with uniform tiles, so that nothing but the compositor could vary:
 * body tone 80, seam tone 86-118, at exactly `floor(n x pitch)`, at every zoom
 * whose pitch is fractional and at *any* zoom once the camera sits on a
 * fractional offset. In the editor, folding the tone across sixteen offsets
 * inside a tile, the boundary was the lightest of the sixteen in eleven of
 * twelve conditions before and is an unremarkable one of them after.
 *
 * The material itself was never involved: its alpha runs continuously across
 * the boundary, which is checked here first so that the rest of this file is
 * known to be about compositing.
 */

function horizontalRun(): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push(samplePoint(20 + index * 0.6, 100, 0.85));
  }
  return points;
}

function transform(a: number, d: number, e: number, f: number): StubTransform {
  return { a, b: 0, c: 0, d, e, f };
}

let canvas: CanvasStub;

beforeEach(() => {
  canvas = installCanvasStub();
});

afterEach(() => {
  releaseTileScratch();
  canvas.restore();
});

describe("material across a tile boundary", () => {
  it("deposits continuous alpha on both sides of the seam", () => {
    const brush = pencilBrush({ size: 26, opacity: 0.9 });
    const material = buildMaterial(horizontalRun(), brush);
    const left = material.get("0,1");
    const right = material.get("1,1");
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;

    // The rows the stroke actually passes through, compared across the join.
    let inkedRows = 0;
    let bothSides = 0;
    for (let row = 0; row < TILE_CELLS; row += 1) {
      const a = left.alpha[row * TILE_CELLS + (TILE_CELLS - 1)] ?? 0;
      const b = right.alpha[row * TILE_CELLS] ?? 0;
      if (a === 0 && b === 0) continue;
      inkedRows += 1;
      if (a > 0 && b > 0) bothSides += 1;
    }
    expect(inkedRows).toBeGreaterThan(30);
    // A seam in the *material* would be a column of zeroes against a column of
    // graphite. Nearly every inked row carries material on both sides.
    expect(bothSides).toBeGreaterThan(inkedRows * 0.9);
  });

  it("keeps the outermost cells of a tile, with no truncation at the edge", () => {
    const brush = pencilBrush({ size: 26, opacity: 0.9 });
    const material = buildMaterial(horizontalRun(), brush);
    const tile = material.get("1,1");
    expect(tile).toBeDefined();
    if (tile === undefined) return;
    let firstColumn = 0;
    let secondColumn = 0;
    for (let row = 0; row < TILE_CELLS; row += 1) {
      firstColumn += tile.alpha[row * TILE_CELLS] ?? 0;
      secondColumn += tile.alpha[row * TILE_CELLS + 1] ?? 0;
    }
    expect(firstColumn).toBeGreaterThan(0);
    // The edge column carries a comparable load to the one beside it. A tint
    // or upload that lost a cell would show here as a fraction of it.
    expect(firstColumn).toBeGreaterThan(secondColumn * 0.5);
  });
});

describe("tile placement", () => {
  const cases: readonly (readonly [string, StubTransform])[] = [
    ["identity", transform(1, 1, 0, 0)],
    ["100% on a fractional pan", transform(1, 1, 154.75, 53.25)],
    ["150%", transform(1.5, 1.5, -131.625, -145.5)],
    ["193%, the reported case", transform(1.93, 1.93, 17.31, -42.87)],
    ["200% on a half pixel", transform(2, 2, 0.5, 0.5)],
    ["80%, a fractional pitch", transform(0.8, 0.8, 3.3, 9.1)],
    ["a mirrored transform", transform(-1.7, 1.7, 640.25, -11.5)],
  ];

  it.each(cases)("puts every edge on a whole device pixel at %s", (_name, matrix) => {
    const { context } = recordingContext(matrix);
    const grid = materialTileGrid(context);
    expect(grid).not.toBeNull();
    if (grid === null) return;
    for (let tx = -2; tx <= 4; tx += 1) {
      for (let ty = -2; ty <= 4; ty += 1) {
        const rect = materialTileDeviceRect(grid, `${String(tx)},${String(ty)}`);
        expect(Number.isInteger(rect.x)).toBe(true);
        expect(Number.isInteger(rect.y)).toBe(true);
        expect(Number.isInteger(rect.width)).toBe(true);
        expect(Number.isInteger(rect.height)).toBe(true);
        expect(rect.width).toBeGreaterThan(0);
        expect(rect.height).toBeGreaterThan(0);
      }
    }
  });

  it.each(cases)("leaves no gap and no overlap between neighbours at %s", (_name, matrix) => {
    const { context } = recordingContext(matrix);
    const grid = materialTileGrid(context);
    expect(grid).not.toBeNull();
    if (grid === null) return;
    for (let tx = -2; tx <= 4; tx += 1) {
      for (let ty = -2; ty <= 4; ty += 1) {
        const here = materialTileDeviceRect(grid, `${String(tx)},${String(ty)}`);
        const right = materialTileDeviceRect(grid, `${String(tx + 1)},${String(ty)}`);
        const below = materialTileDeviceRect(grid, `${String(tx)},${String(ty + 1)}`);
        // Exactly equal, not merely close: both edges are the same rounding of
        // the same page coordinate, so agreement is by construction. A
        // tolerance here would be hiding the property rather than asserting it.
        if (matrix.a > 0) expect(here.x + here.width).toBe(right.x);
        else expect(right.x + right.width).toBe(here.x);
        expect(here.y + here.height).toBe(below.y);
      }
    }
  });

  it("covers a span of tiles with no pixel drawn twice and none left bare", () => {
    const { context } = recordingContext(transform(1.93, 1.93, 17.31, 0));
    const grid = materialTileGrid(context);
    if (grid === null) throw new Error("expected a grid");
    const covered = new Map<number, number>();
    for (let tx = 0; tx < 12; tx += 1) {
      const rect = materialTileDeviceRect(grid, `${String(tx)},0`);
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        covered.set(x, (covered.get(x) ?? 0) + 1);
      }
    }
    const first = materialTileDeviceRect(grid, "0,0");
    const last = materialTileDeviceRect(grid, "11,0");
    for (let x = first.x; x < last.x + last.width; x += 1) {
      expect(covered.get(x)).toBe(1);
    }
  });

  it("draws exactly, without snapping, under a rotated transform", () => {
    // There is no device axis to snap to, and the seam is not an axis-aligned
    // line anyway, so a rotated object keeps the exact rectangle.
    const { context } = recordingContext({ a: 0.87, b: 0.5, c: -0.5, d: 0.87, e: 12, f: 8 });
    expect(materialTileGrid(context)).toBeNull();
  });

  it("keeps the gutter when it cannot snap", () => {
    // Rotation gives up device alignment; it does not give up continuity. A
    // rotated object is resampled too, so it needs its neighbours just as much.
    const { context, draws } = recordingContext({
      a: 0.87,
      b: 0.5,
      c: -0.5,
      d: 0.87,
      e: 12,
      f: 8,
    });
    const brush = pencilBrush({ size: 14 });
    const points = horizontalRun().slice(0, 80);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("rotated", brush);
    const geometry = createPencilMaterialGeometry(points, brush, "rotated");
    for (const key of geometry.tileKeys) runtime.tileNow(cacheId, key, points, brush);
    drawPencilMaterial(context, geometry, brush, runtime);
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) {
      expect(draw.source?.x).toBe(1);
      expect(draw.source?.width).toBe(TILE_CELLS);
      expect(draw.width).toBe(TILE_PAGE_UNITS);
    }
    runtime.destroy();
  });

  it("falls back to the exact rectangle on a canvas that cannot report a transform", () => {
    const { context, draws } = recordingContext();
    delete (context as unknown as Record<string, unknown>).getTransform;
    const brush = pencilBrush({ size: 14 });
    const points = horizontalRun().slice(0, 60);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("fallback", brush);
    const geometry = createPencilMaterialGeometry(points, brush, "fallback");
    for (const key of geometry.tileKeys) runtime.tileNow(cacheId, key, points, brush);
    drawPencilMaterial(context, geometry, brush, runtime);
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) {
      expect(draw.width).toBe(TILE_PAGE_UNITS);
      expect(draw.height).toBe(TILE_PAGE_UNITS);
    }
    runtime.destroy();
  });
});

describe("the tile grid diagnostic", () => {
  it("outlines exactly the rectangles the painter draws into", () => {
    const matrix = transform(1.93, 1.93, 17.31, -42.87);
    const { context } = recordingContext(matrix);
    const grid = materialTileGrid(context);
    if (grid === null) throw new Error("expected a grid");
    const keys: MaterialTileKey[] = ["0,0", "1,0", "0,1"];
    const outlined: { x: number; y: number; width: number; height: number }[] = [];
    const stroked = context as unknown as {
      strokeRect: (x: number, y: number, w: number, h: number) => void;
    };
    stroked.strokeRect = (x, y, width, height) => outlined.push({ x, y, width, height });
    drawMaterialTileGrid(context, keys);
    expect(outlined).toHaveLength(3);
    keys.forEach((key, index) => {
      const rect = materialTileDeviceRect(grid, key);
      const drawn = outlined[index];
      expect(drawn).toBeDefined();
      // Inset by half a pixel so a one pixel outline sits inside the tile it
      // marks rather than straddling the boundary it is there to show.
      expect(drawn?.x).toBe(rect.x + 0.5);
      expect(drawn?.y).toBe(rect.y + 0.5);
      expect(drawn?.width).toBe(rect.width - 1);
      expect(drawn?.height).toBe(rect.height - 1);
    });
  });

  it("is not something a paint turns on by itself", () => {
    // It is an instrument, not a feature: an ordinary paint never outlines a
    // tile, and nothing in the painter calls the diagnostic.
    const { context } = recordingContext(transform(1, 1, 0, 0));
    let outlines = 0;
    (context as unknown as { strokeRect: () => void }).strokeRect = () => {
      outlines += 1;
    };
    const brush = pencilBrush({ size: 14 });
    const points = horizontalRun().slice(0, 60);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("plain", brush);
    const geometry = createPencilMaterialGeometry(points, brush, "plain");
    for (const key of geometry.tileKeys) runtime.tileNow(cacheId, key, points, brush);
    drawPencilMaterial(context, geometry, brush, runtime);
    expect(outlines).toBe(0);
    runtime.destroy();
  });
});

describe("the presentation border", () => {
  /**
   * What a tile carries beyond its own cells, and why.
   *
   * Placing tiles on whole device pixels made them abut; it did not make them
   * continuous. A magnified tile is resampled, and a bilinear filter asked for
   * a pixel at the tile's own edge needs a sample from beyond it. With nothing
   * there the filter clamps and repeats the edge cell, so the texture stops
   * dead along the boundary -- measured in the running editor as a step
   * eighteen times sharper than ordinary graphite at 664%, which is a drawn
   * line. Average tone is preserved, which is why the brightness statistic that
   * passed E4.2D never saw it.
   */
  function fieldStroke(): StrokePoint[] {
    const points: StrokePoint[] = [];
    for (let index = 0; index <= 420; index += 1) {
      points.push(samplePoint(20 + index * 0.62, 96 + Math.sin(index / 23) * 30, 0.85));
    }
    return points;
  }

  it("fills the gutter with the neighbours' own cells, not a repeat of its own", () => {
    const brush = pencilBrush({ size: 26, opacity: 0.9 });
    const material = buildMaterial(fieldStroke(), brush);
    const own = material.get("1,1");
    const left = material.get("0,1");
    const right = material.get("2,1");
    const above = material.get("1,0");
    const below = material.get("1,2");
    expect(own).toBeDefined();
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (own === undefined || left === undefined || right === undefined) return;

    const cells = assemblePresentationAlpha(own.alpha, (dx, dy) => {
      const found = material.get(`${String(1 + dx)},${String(1 + dy)}`);
      return found?.alpha ?? null;
    });
    const size = TILE_CELLS + 2;
    const last = TILE_CELLS - 1;
    expect(cells.length).toBe(size * size);

    // The middle is the tile itself, cell for cell.
    for (let row = 0; row < TILE_CELLS; row += 1) {
      for (let column = 0; column < TILE_CELLS; column += 1) {
        expect(cells[(row + 1) * size + column + 1]).toBe(own.alpha[row * TILE_CELLS + column]);
      }
    }
    // The ring is the neighbour's adjoining cells, which is the whole point:
    // a repeat of the tile's own edge would be the clamp this replaces.
    let differsFromOwnEdge = 0;
    for (let row = 0; row < TILE_CELLS; row += 1) {
      expect(cells[(row + 1) * size]).toBe(left.alpha[row * TILE_CELLS + last]);
      expect(cells[(row + 1) * size + size - 1]).toBe(right.alpha[row * TILE_CELLS]);
      if (cells[(row + 1) * size] !== own.alpha[row * TILE_CELLS]) differsFromOwnEdge += 1;
    }
    expect(differsFromOwnEdge).toBeGreaterThan(TILE_CELLS / 4);
    if (above !== undefined) {
      for (let column = 0; column < TILE_CELLS; column += 1) {
        expect(cells[column + 1]).toBe(above.alpha[last * TILE_CELLS + column]);
      }
    }
    if (below !== undefined) {
      for (let column = 0; column < TILE_CELLS; column += 1) {
        expect(cells[(size - 1) * size + column + 1]).toBe(below.alpha[column]);
      }
    }
  });

  it("carries the four corners, where a diagonal sample reads all of them", () => {
    const brush = pencilBrush({ size: 26, opacity: 0.9 });
    const material = buildMaterial(fieldStroke(), brush);
    const own = material.get("1,1");
    expect(own).toBeDefined();
    if (own === undefined) return;
    const at = (tx: number, ty: number) =>
      material.get(`${String(tx)},${String(ty)}`)?.alpha ?? null;
    const cells = assemblePresentationAlpha(own.alpha, (dx, dy) => at(1 + dx, 1 + dy));
    const size = TILE_CELLS + 2;
    const last = TILE_CELLS - 1;
    const corners: readonly (readonly [number, number, number, number])[] = [
      [-1, -1, 0, TILE_CELLS * TILE_CELLS - 1],
      [1, -1, size - 1, last * TILE_CELLS],
      [-1, 1, (size - 1) * size, last],
      [1, 1, (size - 1) * size + size - 1, 0],
    ];
    for (const [dx, dy, here, there] of corners) {
      const neighbour = at(1 + dx, 1 + dy);
      expect(cells[here]).toBe(neighbour === null ? 0 : (neighbour[there] ?? 0));
    }
  });

  it("leaves the gutter empty where the stroke never reached", () => {
    // Not a fallback. A tile the stroke never touched holds no graphite, so
    // interpolating towards nothing is exactly what a contiguous raster does.
    const brush = pencilBrush({ size: 14 });
    const material = buildMaterial(straight(0.6), brush);
    const key = [...material.keys()][0];
    expect(key).toBeDefined();
    if (key === undefined) return;
    const own = material.get(key);
    if (own === undefined) return;
    const cells = assemblePresentationAlpha(own.alpha, () => null);
    const size = TILE_CELLS + 2;
    for (let column = 0; column < size; column += 1) {
      expect(cells[column]).toBe(0);
      expect(cells[(size - 1) * size + column]).toBe(0);
    }
    for (let row = 0; row < size; row += 1) {
      expect(cells[row * size]).toBe(0);
      expect(cells[row * size + size - 1]).toBe(0);
    }
  });

  it("gives a preview every tile a complete gutter, not just the last one", () => {
    /**
     * A thumbnail, a page preview or an export has no project runtime and
     * rebuilds what it needs as it paints. Doing that a tile at a time would
     * present each one before its neighbours existed, so every leading edge
     * would go without a gutter -- the seam, in exactly the place nobody looks
     * for it. Deposit first, present after.
     *
     * Observable as: once the paint is over, every tile still has the
     * presentation it was drawn with. If any had been built short, arriving
     * material would have dropped it.
     */
    releasePreviewMaterialRuntime();
    const brush = pencilBrush({ size: 22 });
    const points = horizontalRun();
    const geometry = createPencilMaterialGeometry(points, brush, "preview");
    expect(geometry.tileKeys.length).toBeGreaterThan(2);
    const { context, draws } = recordingContext(IDENTITY_TRANSFORM);
    const result = drawPencilMaterial(context, geometry, brush, null);
    expect(result.missing).toEqual([]);
    expect(draws.length).toBe(geometry.tileKeys.length);

    const cache = previewMaterialRuntime();
    const cacheId = pencilMaterialCacheId("preview", brush);
    for (const key of geometry.tileKeys) {
      expect(cache.display(cacheId, key), `${key} lost its presentation`).not.toBeNull();
    }
    releasePreviewMaterialRuntime();
  });

  it("blits the tile out of the middle of its presentation", () => {
    // The gutter is drawn *through*, never drawn: the painter asks for the
    // inner square and lets the filter reach into the ring. Expanding the
    // destination instead would overlap neighbours and composite
    // semi-transparent graphite twice, trading a pale grid for a dark one.
    const brush = pencilBrush({ size: 16 });
    const points = fieldStroke().slice(0, 120);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("blit", brush);
    const geometry = createPencilMaterialGeometry(points, brush, "blit");
    for (const key of geometry.tileKeys) runtime.tileNow(cacheId, key, points, brush);
    const { context, draws } = recordingContext(IDENTITY_TRANSFORM);
    drawPencilMaterial(context, geometry, brush, runtime);
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) {
      expect(draw.source).not.toBeNull();
      expect(draw.source?.x).toBe(1);
      expect(draw.source?.y).toBe(1);
      expect(draw.source?.width).toBe(TILE_CELLS);
      expect(draw.source?.height).toBe(TILE_CELLS);
    }
    runtime.destroy();
  });

  it("uploads a presentation one cell larger than the tile on every side", () => {
    const brush = pencilBrush({ size: 16 });
    const points = fieldStroke().slice(0, 120);
    const runtime = createPencilMaterialRuntime();
    const cacheId = pencilMaterialCacheId("upload", brush);
    const geometry = createPencilMaterialGeometry(points, brush, "upload");
    for (const key of geometry.tileKeys) runtime.tileNow(cacheId, key, points, brush);
    const { context } = recordingContext(IDENTITY_TRANSFORM);
    drawPencilMaterial(context, geometry, brush, runtime);
    expect(canvas.uploads.length).toBeGreaterThan(0);
    for (const upload of canvas.uploads) {
      expect(upload.width).toBe(TILE_CELLS + 2);
      expect(upload.height).toBe(TILE_CELLS + 2);
    }
    runtime.destroy();
  });

  it("redraws a tile whenever a neighbour's edge cells move under its gutter", () => {
    /**
     * The live path has no invalidation, and does not need one.
     *
     * A tile's gutter reads one cell of each neighbour, so a frame that changes
     * a neighbour's edge cells makes this tile's edge wrong. The accumulator
     * already covers that: a dab close enough to reach a neighbour's adjoining
     * column is within its own radius of this tile too, so the frame that
     * dirties one dirties both. That is an assumption the border rule rests on,
     * so it is checked rather than asserted in a comment.
     */
    const brush = pencilBrush({ size: 24, opacity: 0.85 });
    const evaluator = new PencilMaterialEvaluator(brush);
    const points: StrokePoint[] = [];
    // A run straight across a tile boundary, fed a few samples at a time the
    // way a live stroke arrives.
    for (let index = 0; index <= 220; index += 1) {
      points.push(samplePoint(40 + index * 0.9, 90 + Math.sin(index / 17) * 26, 0.8));
    }

    const edgesOf = (alpha: Uint8Array): string => {
      const last = TILE_CELLS - 1;
      const parts: number[] = [];
      for (let row = 0; row < TILE_CELLS; row += 1) {
        parts.push(alpha[row * TILE_CELLS] ?? 0, alpha[row * TILE_CELLS + last] ?? 0);
      }
      for (let column = 0; column < TILE_CELLS; column += 1) {
        parts.push(alpha[column] ?? 0, alpha[last * TILE_CELLS + column] ?? 0);
      }
      return parts.join(",");
    };

    let previous = new Map<string, string>();
    let checkedFrames = 0;
    for (let end = 8; end <= points.length; end += 8) {
      evaluator.append(points.slice(0, end), false);
      const dirty = new Set(evaluator.dirtyTiles);
      const geometry = evaluator.geometry();
      const supply = geometry.supply;
      if (supply.kind !== "live") continue;
      const current = new Map<string, string>();
      for (const [key, alpha] of supply.tiles) current.set(key, edgesOf(alpha));

      for (const [key, edges] of current) {
        if (previous.get(key) === edges) continue;
        // This tile's edge cells moved, so every neighbour that reads them has
        // to have been repainted in the same frame.
        const comma = key.indexOf(",");
        const tx = Number(key.slice(0, comma));
        const ty = Number(key.slice(comma + 1));
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const neighbour = `${String(tx + dx)},${String(ty + dy)}`;
            if (!current.has(neighbour)) continue;
            expect(
              dirty.has(neighbour),
              `${neighbour} reads ${key}'s edge but was not repainted with it`,
            ).toBe(true);
            checkedFrames += 1;
          }
        }
      }
      previous = current;
    }
    expect(checkedFrames).toBeGreaterThan(0);
    evaluator.dispose();
  });

  it("gives the live path the same border as the cached one", () => {
    // Active and committed must agree about their edges, or lifting the pencil
    // changes how the mark's boundaries look. Both assemble the same way from
    // the same neighbours; the only difference is where the neighbours come
    // from, which is ownership rather than appearance.
    const brush = pencilBrush({ size: 22 });
    const points = fieldStroke().slice(0, 260);
    const evaluator = new PencilMaterialEvaluator(brush);
    evaluator.append(points, true);
    const live = evaluator.geometry();
    const supply = live.supply;
    expect(supply.kind).toBe("live");
    if (supply.kind !== "live") return;

    const committed = evaluator.commit();
    for (const [key, tile] of committed.tiles) {
      const liveAlpha = supply.tiles.get(key);
      expect(liveAlpha).toBeDefined();
      if (liveAlpha === undefined) continue;
      const comma = key.indexOf(",");
      const tx = Number(key.slice(0, comma));
      const ty = Number(key.slice(comma + 1));
      const fromLive = assemblePresentationAlpha(liveAlpha, (dx, dy) => {
        return supply.tiles.get(`${String(tx + dx)},${String(ty + dy)}`) ?? null;
      });
      const fromCommitted = assemblePresentationAlpha(tile.alpha, (dx, dy) => {
        return committed.tiles.get(`${String(tx + dx)},${String(ty + dy)}`)?.alpha ?? null;
      });
      expect(fromLive).toEqual(fromCommitted);
    }
    evaluator.dispose();
  });
});
