import { describe, expect, it } from "vitest";
import { BRUSH_LIBRARY_CATALOGUE } from "./brush-library-catalogue";
import {
  RADIAL_LIBRARY_CONFIGURATION,
  RADIAL_ROTATION_DRAG_THRESHOLD,
  buildRadialLibraryLayout,
  normalizeDegrees,
  pointerAngleDegrees,
  shortestAngularDelta,
  type RadialCenter,
} from "./radial-brush-library-model";

const CENTER: RadialCenter = Object.freeze({ x: 200, y: 300 });

function rotated(offsetDegrees: number) {
  return buildRadialLibraryLayout(
    CENTER,
    RADIAL_LIBRARY_CONFIGURATION,
    BRUSH_LIBRARY_CATALOGUE,
    offsetDegrees,
  );
}

describe("pointer angle around the axle", () => {
  it("measures in the same screen space the geometry uses", () => {
    // 0 degrees points right; positive angles turn downward, matching polarPoint.
    expect(pointerAngleDegrees(CENTER, CENTER.x + 100, CENTER.y)).toBeCloseTo(0, 10);
    expect(pointerAngleDegrees(CENTER, CENTER.x, CENTER.y + 100)).toBeCloseTo(90, 10);
    expect(pointerAngleDegrees(CENTER, CENTER.x - 100, CENTER.y)).toBeCloseTo(180, 10);
    expect(pointerAngleDegrees(CENTER, CENTER.x, CENTER.y - 100)).toBeCloseTo(-90, 10);
  });

  it("ignores distance from the axle", () => {
    expect(pointerAngleDegrees(CENTER, CENTER.x + 10, CENTER.y + 10)).toBeCloseTo(
      pointerAngleDegrees(CENTER, CENTER.x + 400, CENTER.y + 400),
      10,
    );
  });

  it("stays finite for any pointer position, including the axle itself", () => {
    for (const [x, y] of [
      [CENTER.x, CENTER.y],
      [CENTER.x + 1e-9, CENTER.y],
      [CENTER.x - 5000, CENTER.y + 5000],
    ] as const) {
      expect(Number.isFinite(pointerAngleDegrees(CENTER, x, y))).toBe(true);
    }
  });
});

describe("shortest angular delta", () => {
  it("reports a clockwise drag as positive", () => {
    expect(shortestAngularDelta(10, 40)).toBeCloseTo(30, 10);
  });

  it("reports a counter-clockwise drag as negative", () => {
    expect(shortestAngularDelta(40, 10)).toBeCloseTo(-30, 10);
  });

  it("crosses +180 to -180 as a small forward step", () => {
    expect(shortestAngularDelta(179, -179)).toBeCloseTo(2, 10);
  });

  it("crosses -180 to +180 as a small backward step", () => {
    expect(shortestAngularDelta(-179, 179)).toBeCloseTo(-2, 10);
  });

  it("never returns a step longer than half a turn", () => {
    for (let from = -350; from <= 350; from += 7) {
      for (let to = -350; to <= 350; to += 11) {
        const delta = shortestAngularDelta(from, to);
        expect(Math.abs(delta)).toBeLessThanOrEqual(180 + 1e-9);
        // The step really does land on the destination angle.
        expect(normalizeDegrees(from + delta)).toBeCloseTo(normalizeDegrees(to), 8);
      }
    }
  });

  it("uses the editor's established movement threshold", () => {
    expect(RADIAL_ROTATION_DRAG_THRESHOLD).toBe(4);
  });
});

describe("rigid rotation of the whole instrument", () => {
  it("returns the original geometry at zero rotation", () => {
    const base = rotated(0);
    const untouched = buildRadialLibraryLayout(CENTER);
    for (const [index, cell] of base.cells.entries()) {
      expect(cell.startAngleDegrees).toBe(untouched.cells[index]?.startAngleDegrees);
    }
  });

  it("moves every cell on every ring by exactly the same offset", () => {
    const base = rotated(0);
    const turned = rotated(47.5);
    expect(turned.cells).toHaveLength(base.cells.length);
    const deltas = new Set(
      base.cells.map((cell, index) =>
        Number((turned.cells[index]!.startAngleDegrees - cell.startAngleDegrees).toFixed(9)),
      ),
    );
    expect([...deltas]).toEqual([47.5]);
    // Every ring, not just the aggregate.
    for (const track of turned.tracks) {
      for (const cell of track.cells) {
        const original = base.cells[cell.catalogueIndex]!;
        expect(cell.startAngleDegrees - original.startAngleDegrees).toBeCloseTo(47.5, 9);
      }
    }
  });

  it("moves direct gaps by the same offset", () => {
    const base = rotated(0);
    const turned = rotated(47.5);
    for (const [index, track] of base.tracks.entries()) {
      if (track.directGap === null) {
        expect(turned.tracks[index]?.directGap).toBeNull();
        continue;
      }
      expect(turned.tracks[index]!.directGap!.startDegrees).toBeCloseTo(
        normalizeDegrees(track.directGap.startDegrees + 47.5),
        9,
      );
      expect(turned.tracks[index]!.directGap!.widthDegrees).toBeCloseTo(
        track.directGap.widthDegrees,
        9,
      );
    }
  });

  it("moves inherited gaps by the same offset, keeping channels aligned", () => {
    const turned = rotated(47.5);
    const innermostGap = turned.tracks[0]!.directGap!;
    for (const outer of turned.tracks.slice(1)) {
      const carried = outer.inheritedGaps.find(
        (gap) => Math.abs(gap.startDegrees - innermostGap.startDegrees) < 1e-6,
      );
      expect(carried, `ring ${outer.index} keeps ring 1's channel`).toBeDefined();
      expect(carried?.widthDegrees).toBeCloseTo(innermostGap.widthDegrees, 9);
    }
  });

  it("keeps cells clear of the rotated channels", () => {
    const turned = rotated(123.4);
    for (const track of turned.tracks) {
      for (const cell of track.cells) {
        for (const blocked of track.blockedIntervals) {
          const offset = normalizeDegrees(blocked.startDegrees - cell.startAngleDegrees);
          const reverse = normalizeDegrees(cell.startAngleDegrees - blocked.startDegrees);
          const overlapping =
            offset + 1e-6 < cell.cellAngleDegrees && reverse + 1e-6 < blocked.widthDegrees;
          expect(overlapping, `${cell.brush.id} after rotation`).toBe(false);
        }
      }
    }
  });

  it("never changes a cell's physical size", () => {
    const base = rotated(0);
    const turned = rotated(-260);
    for (const [index, cell] of base.cells.entries()) {
      const moved = turned.cells[index]!;
      expect(moved.innerRadius).toBe(cell.innerRadius);
      expect(moved.outerRadius).toBe(cell.outerRadius);
      expect(moved.arcLength).toBeCloseTo(cell.arcLength, 10);
      expect(moved.cellAngleDegrees).toBeCloseTo(cell.cellAngleDegrees, 10);
    }
  });

  it("never changes catalogue assignment or ring capacity", () => {
    const base = rotated(0);
    const turned = rotated(1000);
    expect(turned.cells.map((cell) => cell.brush.id)).toEqual(
      base.cells.map((cell) => cell.brush.id),
    );
    expect(turned.tracks.map((track) => track.cells.length)).toEqual(
      base.tracks.map((track) => track.cells.length),
    );
    expect(turned.tracks.map((track) => track.capacity)).toEqual(
      base.tracks.map((track) => track.capacity),
    );
  });

  it("keeps accumulating past a full turn in either direction", () => {
    const base = rotated(0);
    for (const offset of [360, 720, -360, -725.5]) {
      const turned = rotated(offset);
      expect(turned.cells).toHaveLength(base.cells.length);
      for (const [index, cell] of base.cells.entries()) {
        expect(turned.cells[index]!.startAngleDegrees - cell.startAngleDegrees).toBeCloseTo(
          offset,
          9,
        );
      }
    }
  });

  it("lands a full turn back where it started, geometrically", () => {
    const base = rotated(0);
    const full = rotated(360);
    for (const [index, cell] of base.cells.entries()) {
      expect(normalizeDegrees(full.cells[index]!.startAngleDegrees)).toBeCloseTo(
        normalizeDegrees(cell.startAngleDegrees),
        8,
      );
    }
  });

  it("is deterministic and free of NaN at any offset", () => {
    for (const offset of [0, 12.5, -47.5, 360, -1000]) {
      const first = rotated(offset);
      const second = rotated(offset);
      for (const [index, cell] of first.cells.entries()) {
        expect(cell.startAngleDegrees).toBe(second.cells[index]?.startAngleDegrees);
        for (const value of [
          cell.startAngleDegrees,
          cell.endAngleDegrees,
          cell.midAngleDegrees,
          cell.arcLength,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });
});

describe("accumulating a drag", () => {
  /** Mirrors the component: accumulate shortest deltas between samples. */
  function accumulate(samples: readonly Readonly<{ x: number; y: number }>[]): number {
    let offset = 0;
    let previous = pointerAngleDegrees(CENTER, samples[0]!.x, samples[0]!.y);
    for (const sample of samples.slice(1)) {
      const angle = pointerAngleDegrees(CENTER, sample.x, sample.y);
      offset += shortestAngularDelta(previous, angle);
      previous = angle;
    }
    return offset;
  }

  function pointAt(degrees: number, radius = 200): Readonly<{ x: number; y: number }> {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: CENTER.x + radius * Math.cos(radians),
      y: CENTER.y + radius * Math.sin(radians),
    };
  }

  it("turns 30 degrees of pointer travel into 30 degrees of wheel, one to one", () => {
    const samples = [0, 10, 20, 30].map((degrees) => pointAt(degrees));
    expect(accumulate(samples)).toBeCloseTo(30, 8);
  });

  it("reverses cleanly for a counter-clockwise drag", () => {
    const samples = [0, -15, -30, -45].map((degrees) => pointAt(degrees));
    expect(accumulate(samples)).toBeCloseTo(-45, 8);
  });

  it("crosses the seam without a jump", () => {
    // 170 -> 190 passes straight through the +/-180 discontinuity.
    const samples = [170, 176, 182, 188].map((degrees) => pointAt(degrees));
    expect(accumulate(samples)).toBeCloseTo(18, 8);
  });

  it("accumulates several turns without corruption", () => {
    const samples: Readonly<{ x: number; y: number }>[] = [];
    for (let degrees = 0; degrees <= 800; degrees += 10) samples.push(pointAt(degrees));
    expect(accumulate(samples)).toBeCloseTo(800, 6);
  });
});
