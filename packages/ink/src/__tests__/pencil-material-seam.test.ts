import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TILE_CELLS, TILE_PAGE_UNITS, type MaterialTileKey } from "../internal/pencil-material";
import {
  createPencilMaterialRuntime,
  drawMaterialTileGrid,
  drawPencilMaterial,
  materialTileDeviceRect,
  materialTileGrid,
  pencilMaterialCacheId,
  releaseTileScratch,
} from "../internal/pencil-material-strategy";
import { createPencilMaterialGeometry } from "../internal/pencil-material-strategy";
import type { StrokePoint } from "../types";
import { buildMaterial, pencilBrush, samplePoint } from "./pencil-material-fixture";
import {
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
