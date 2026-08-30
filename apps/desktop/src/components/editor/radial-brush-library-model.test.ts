import { describe, expect, it } from "vitest";
import { BRUSH_LIBRARY_FIXTURES } from "./brush-library-fixtures";
import {
  RADIAL_LIBRARY_CONFIGURATION,
  annularSectorPath,
  buildRadialLibraryLayout,
  degreesToRadians,
  normalizeDegrees,
  polarPoint,
  radiansToDegrees,
  type RadialCenter,
} from "./radial-brush-library-model";

const CENTER: RadialCenter = Object.freeze({ x: 40, y: 470 });

function layout(center: RadialCenter = CENTER) {
  return buildRadialLibraryLayout(center);
}

/** Which allowed arc wholly contains this cell, or -1. */
function hostArcIndex(
  track: { readonly allowedArcs: readonly { startDegrees: number; widthDegrees: number }[] },
  cell: { readonly startAngleDegrees: number; readonly cellAngleDegrees: number },
): number {
  return track.allowedArcs.findIndex((arc) => {
    const offset = normalizeDegrees(normalizeDegrees(cell.startAngleDegrees) - arc.startDegrees);
    return offset + cell.cellAngleDegrees <= arc.widthDegrees + 1e-6;
  });
}

/** True when two clockwise arcs share more than a touching boundary. */
function intervalsOverlap(
  firstStart: number,
  firstWidth: number,
  secondStart: number,
  secondWidth: number,
): boolean {
  const offset = normalizeDegrees(secondStart - firstStart);
  return (
    offset + 1e-6 < firstWidth && normalizeDegrees(firstStart - secondStart) + 1e-6 < secondWidth
  );
}

describe("radial library configuration", () => {
  it("configures a direct gap for each of the three inner rings", () => {
    expect(RADIAL_LIBRARY_CONFIGURATION.directGaps).toHaveLength(3);
  });

  it("keeps the taller three-ring geometry in one tunable place", () => {
    expect(RADIAL_LIBRARY_CONFIGURATION.hubRadius).toBe(90);
    expect(RADIAL_LIBRARY_CONFIGURATION.trackThickness).toBe(64);
    expect(RADIAL_LIBRARY_CONFIGURATION.targetCellWidth).toBe(72);
    expect(
      RADIAL_LIBRARY_CONFIGURATION.directGaps.map((gap) => [
        Number((gap.startDegrees + gap.widthDegrees / 2).toFixed(2)),
        Number(gap.widthDegrees.toFixed(2)),
      ]),
    ).toEqual([
      [210, 21.86],
      [55, 27.31],
      [305, 29.98],
    ]);
  });

  it("adds a fourth ring only because three cannot hold the catalogue", () => {
    const tracks = layout().tracks;
    const threeRingCapacity = tracks
      .slice(0, 3)
      .reduce((total, track) => total + track.capacity, 0);
    expect(threeRingCapacity).toBe(38);
    expect(threeRingCapacity).toBeLessThan(BRUSH_LIBRARY_FIXTURES.length);
    expect(tracks).toHaveLength(4);
    // The fourth ring carries only the overflow, well under its own capacity.
    expect(tracks[3]?.cells).toHaveLength(7);
    expect(tracks[3]?.capacity).toBe(20);
    expect(tracks[3]?.innerRadius).toBe(282);
    expect(tracks[3]?.outerRadius).toBe(346);
    expect(layout().outerRadius).toBe(346);
  });

  it("stops creating rings as soon as the catalogue is exhausted", () => {
    expect(layout().tracks.length).toBeLessThan(RADIAL_LIBRARY_CONFIGURATION.maximumTracks);
  });
});

describe("radial library origin", () => {
  it("uses the supplied slot centre as the geometric origin", () => {
    const result = layout({ x: 123, y: 456 });
    expect(result.centerX).toBe(123);
    expect(result.centerY).toBe(456);
  });

  it("moves every cell when the anchor slot moves, without changing shape", () => {
    const first = layout({ x: 40, y: 300 });
    const second = layout({ x: 40, y: 500 });
    expect(first.cells).toHaveLength(second.cells.length);
    for (const [index, cell] of first.cells.entries()) {
      const other = second.cells[index];
      expect(other?.innerRadius).toBe(cell.innerRadius);
      expect(other?.startAngleDegrees).toBe(cell.startAngleDegrees);
    }
    expect(annularSectorPath({ x: 40, y: 300 }, first.cells[0]!)).not.toBe(
      annularSectorPath({ x: 40, y: 500 }, second.cells[0]!),
    );
  });
});

describe("radial track radii", () => {
  it("runs 90-154, 154-218, 218-282, 282-346 with no radial gap", () => {
    const tracks = layout().tracks;
    expect(tracks.map((track) => track.innerRadius)).toEqual([90, 154, 218, 282]);
    expect(tracks.map((track) => track.outerRadius)).toEqual([154, 218, 282, 346]);
    for (let index = 1; index < tracks.length; index += 1) {
      expect(tracks[index]?.innerRadius).toBe(tracks[index - 1]?.outerRadius);
    }
  });

  it("gives every cell the same 64px radial height", () => {
    const heights = new Set(layout().cells.map((cell) => cell.outerRadius - cell.innerRadius));
    expect([...heights]).toEqual([64]);
  });

  it("places the mid-radii at 122, 186, 250 and 314", () => {
    expect(layout().tracks.map((track) => track.midRadius)).toEqual([122, 186, 250, 314]);
  });
});

describe("equal physical cell width", () => {
  it("derives each track's angular span from its own mid-radius", () => {
    for (const track of layout().tracks) {
      expect(track.cellAngleDegrees).toBeCloseTo(
        radiansToDegrees(RADIAL_LIBRARY_CONFIGURATION.targetCellWidth / track.midRadius),
        10,
      );
    }
  });

  it("narrows the angular span on every step outward", () => {
    const angles = layout().tracks.map((track) => track.cellAngleDegrees);
    for (let index = 1; index < angles.length; index += 1) {
      expect(angles[index]).toBeLessThan(angles[index - 1]!);
    }
    expect(angles.map((angle) => Number(angle.toFixed(2)))).toEqual([33.81, 22.18, 16.5, 13.14]);
  });

  it("holds the physical arc length at the target on every cell", () => {
    for (const cell of layout().cells) {
      expect(cell.arcLength).toBeCloseTo(RADIAL_LIBRARY_CONFIGURATION.targetCellWidth, 6);
    }
  });
});

describe("gaps propagate outward", () => {
  const tracks = () => layout().tracks;

  it("gives the innermost ring only its own gap", () => {
    const first = tracks()[0]!;
    expect(first.inheritedGaps).toHaveLength(0);
    expect(first.directGap?.widthDegrees).toBeCloseTo(21.86, 6);
    expect(first.blockedIntervals).toHaveLength(1);
  });

  it("accumulates every inner gap on each ring outward", () => {
    const [one, two, three, four] = tracks();
    expect(one!.inheritedGaps).toHaveLength(0);
    expect(two!.inheritedGaps).toHaveLength(1);
    expect(three!.inheritedGaps).toHaveLength(2);
    // The fourth ring introduces nothing of its own but inherits all three.
    expect(four!.inheritedGaps).toHaveLength(3);
    expect(four!.directGap).toBeNull();
    expect(four!.blockedIntervals).toHaveLength(3);
  });

  it("keeps an inherited gap at exactly the same angles on every outer ring", () => {
    const [one, two, three, four] = tracks();
    const firstGap = one!.directGap!;
    for (const outer of [two, three, four]) {
      const carried = outer!.inheritedGaps.find(
        (gap) => Math.abs(gap.startDegrees - firstGap.startDegrees) < 1e-9,
      );
      expect(carried, `ring ${outer!.index} carries ring 1's gap`).toBeDefined();
      expect(carried?.widthDegrees).toBeCloseTo(firstGap.widthDegrees, 9);
    }
    const secondGap = two!.directGap!;
    for (const outer of [three, four]) {
      const carried = outer!.inheritedGaps.find(
        (gap) => Math.abs(gap.startDegrees - secondGap.startDegrees) < 1e-9,
      );
      expect(carried, `ring ${outer!.index} carries ring 2's gap`).toBeDefined();
      expect(carried?.widthDegrees).toBeCloseTo(secondGap.widthDegrees, 9);
    }
  });

  it("never lets a cell touch any blocked interval on its own ring", () => {
    for (const track of tracks()) {
      for (const cell of track.cells) {
        for (const blocked of track.blockedIntervals) {
          expect(
            intervalsOverlap(
              normalizeDegrees(cell.startAngleDegrees),
              cell.cellAngleDegrees,
              blocked.startDegrees,
              blocked.widthDegrees,
            ),
            `${cell.fixture.id} vs blocked ${blocked.startDegrees.toFixed(2)}`,
          ).toBe(false);
        }
      }
    }
  });

  it("never lets an outer cell cover an inner ring's gap", () => {
    const all = tracks();
    for (const track of all) {
      for (const inner of all.slice(0, track.index)) {
        if (inner.directGap === null) continue;
        for (const cell of track.cells) {
          expect(
            intervalsOverlap(
              normalizeDegrees(cell.startAngleDegrees),
              cell.cellAngleDegrees,
              inner.directGap.startDegrees,
              inner.directGap.widthDegrees,
            ),
            `ring ${track.index} cell over ring ${inner.index} gap`,
          ).toBe(false);
        }
      }
    }
  });

  it("resumes packing full cells after an inherited gap", () => {
    // More than one allowed arc means the ring is genuinely broken by gaps and
    // picks up again on the far side of each one.
    expect(tracks()[1]!.allowedArcs.length).toBe(2);
    expect(tracks()[2]!.allowedArcs.length).toBe(3);
    expect(tracks()[3]!.allowedArcs.length).toBe(3);
    for (const track of tracks()) {
      const arcsUsed = new Set(track.cells.map((cell) => hostArcIndex(track, cell)));
      expect(arcsUsed.has(-1), `ring ${track.index} has a homeless cell`).toBe(false);
      // A ring filled to capacity must have carried on past each gap. The
      // outermost ring holds only the overflow, so it stops in its first arc.
      if (track.cells.length === track.capacity && track.allowedArcs.length > 1) {
        expect(arcsUsed.size, `ring ${track.index} uses several arcs`).toBeGreaterThan(1);
      }
    }
    expect(tracks()[3]!.cells.length).toBeLessThan(tracks()[3]!.capacity);
  });

  it("never splits, shrinks or stretches a cell to fill an arc", () => {
    for (const track of tracks()) {
      for (const cell of track.cells) {
        expect(cell.endAngleDegrees - cell.startAngleDegrees).toBeCloseTo(
          track.cellAngleDegrees,
          10,
        );
        expect(cell.arcLength).toBeCloseTo(RADIAL_LIBRARY_CONFIGURATION.targetCellWidth, 6);
      }
    }
  });

  it("keeps every cell inside one allowed arc", () => {
    for (const track of tracks()) {
      for (const cell of track.cells) {
        expect(
          hostArcIndex(track, cell),
          `${cell.fixture.id} sits inside an allowed arc`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reports a capacity that matches what each arc can hold", () => {
    for (const track of tracks()) {
      const expected = track.allowedArcs.reduce(
        (total, arc) => total + Math.floor(arc.widthDegrees / track.cellAngleDegrees + 1e-9),
        0,
      );
      expect(track.capacity, `ring ${track.index}`).toBe(expected);
    }
    expect(tracks().map((track) => track.capacity)).toEqual([10, 13, 15, 20]);
  });

  it("keeps the three channels separate rather than merging into one wedge", () => {
    const outermost = tracks()[3]!;
    expect(outermost.blockedIntervals).toHaveLength(3);
    for (const blocked of outermost.blockedIntervals) {
      expect(blocked.widthDegrees).toBeLessThan(40);
    }
  });
});

describe("shared rotation readiness", () => {
  it("shifts every cell in every ring by one uniform offset", () => {
    const base = buildRadialLibraryLayout(CENTER);
    const turned = buildRadialLibraryLayout(
      CENTER,
      RADIAL_LIBRARY_CONFIGURATION,
      BRUSH_LIBRARY_FIXTURES,
      33,
    );
    expect(turned.cells).toHaveLength(base.cells.length);
    for (const [index, cell] of base.cells.entries()) {
      const moved = turned.cells[index];
      expect(moved?.startAngleDegrees).toBeCloseTo(cell.startAngleDegrees + 33, 10);
      expect(moved?.endAngleDegrees).toBeCloseTo(cell.endAngleDegrees + 33, 10);
      // A rigid turn: radii and sizes are untouched.
      expect(moved?.innerRadius).toBe(cell.innerRadius);
      expect(moved?.arcLength).toBeCloseTo(cell.arcLength, 10);
    }
  });

  it("carries the gaps round with the wheel, direct and inherited alike", () => {
    const base = buildRadialLibraryLayout(CENTER);
    const turned = buildRadialLibraryLayout(
      CENTER,
      RADIAL_LIBRARY_CONFIGURATION,
      BRUSH_LIBRARY_FIXTURES,
      33,
    );
    for (const [index, track] of base.tracks.entries()) {
      const moved = turned.tracks[index]!;
      if (track.directGap !== null) {
        expect(moved.directGap?.startDegrees).toBeCloseTo(
          normalizeDegrees(track.directGap.startDegrees + 33),
          6,
        );
        expect(moved.directGap?.widthDegrees).toBeCloseTo(track.directGap.widthDegrees, 9);
      }
      for (const [gapIndex, gap] of track.inheritedGaps.entries()) {
        expect(moved.inheritedGaps[gapIndex]?.startDegrees).toBeCloseTo(
          normalizeDegrees(gap.startDegrees + 33),
          6,
        );
      }
      // A rigid turn never changes how much fits.
      expect(moved.capacity).toBe(track.capacity);
    }
  });

  it("defaults to no rotation", () => {
    const first = buildRadialLibraryLayout(CENTER).tracks[0]!;
    expect(first.directGap?.startDegrees).toBeCloseTo(199.07, 2);
  });
});

describe("catalogue assignment", () => {
  it("assigns exactly forty-five fixtures, each exactly once", () => {
    expect(BRUSH_LIBRARY_FIXTURES).toHaveLength(45);
    expect(layout().cells).toHaveLength(45);
  });

  it("fills the rings sequentially as capacity allows", () => {
    const result = layout();
    expect(result.tracks.map((track) => track.cells.length)).toEqual([10, 13, 15, 7]);
    expect(result.cells.map((cell) => cell.catalogueIndex)).toEqual(
      BRUSH_LIBRARY_FIXTURES.map((_, index) => index),
    );
    expect(result.tracks[0]?.cells[0]?.catalogueIndex).toBe(0);
    expect(result.tracks[1]?.cells[0]?.catalogueIndex).toBe(10);
    expect(result.tracks[2]?.cells[0]?.catalogueIndex).toBe(23);
    expect(result.tracks[3]?.cells[0]?.catalogueIndex).toBe(38);
  });

  it("loses and repeats nothing", () => {
    const ids = layout().cells.map((cell) => cell.fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...BRUSH_LIBRARY_FIXTURES.map(({ id }) => id)].sort());
  });

  it("keeps the catalogue ordered pencils, pens, then colour brushes", () => {
    const order = ["pencil", "pen", "color-brush"];
    let seen = 0;
    for (const fixture of BRUSH_LIBRARY_FIXTURES) {
      const position = order.indexOf(fixture.family);
      expect(position).toBeGreaterThanOrEqual(seen);
      seen = position;
    }
  });

  it("lets families straddle ring boundaries instead of owning a ring", () => {
    const tracks = layout().tracks;
    expect(
      tracks.some((track) => new Set(track.cells.map((cell) => cell.fixture.family)).size > 1),
    ).toBe(true);
    // A family ring would be a ring that is one family AND all of it. Ring 1
    // holds every pencil but also two pens; ring 3 is one family but only part
    // of it. Neither is a ring dedicated to a family.
    for (const track of tracks) {
      const families = new Set(track.cells.map((cell) => cell.fixture.family));
      if (families.size > 1) continue;
      const [only] = [...families];
      const total = BRUSH_LIBRARY_FIXTURES.filter((f) => f.family === only).length;
      expect(track.cells.length, `track ${track.index} is not a whole family`).toBeLessThan(total);
    }
    // At least one ring boundary genuinely falls mid-family: ring 1 runs from
    // pencils into pens, so rings are not carved along the taxonomy.
    expect(new Set(tracks[0]!.cells.map((cell) => cell.fixture.family)).size).toBe(2);
  });
});

describe("annular sector paths", () => {
  it("is deterministic for one cell", () => {
    const cell = layout().cells[7]!;
    expect(annularSectorPath(CENTER, cell)).toBe(annularSectorPath(CENTER, cell));
  });

  it("draws two arcs and closes the shape", () => {
    const path = annularSectorPath(CENTER, layout().cells[0]!);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.match(/A /gu)).toHaveLength(2);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("produces only finite coordinates for every cell", () => {
    for (const cell of layout().cells) {
      const path = annularSectorPath(CENTER, cell);
      expect(path).not.toMatch(/NaN|Infinity/u);
      for (const value of path.match(/-?\d+(\.\d+)?/gu) ?? []) {
        expect(Number.isFinite(Number(value))).toBe(true);
      }
    }
  });

  it("carries no NaN through any derived geometry value", () => {
    for (const cell of layout().cells) {
      for (const value of [
        cell.innerRadius,
        cell.outerRadius,
        cell.midRadius,
        cell.startAngleDegrees,
        cell.endAngleDegrees,
        cell.midAngleDegrees,
        cell.arcLength,
        cell.cellAngleDegrees,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("places points on the requested circle", () => {
    const point = polarPoint(CENTER, 100, 0);
    expect(point.x).toBeCloseTo(CENTER.x + 100, 10);
    expect(point.y).toBeCloseTo(CENTER.y, 10);
    expect(polarPoint(CENTER, 100, -90).y).toBeCloseTo(CENTER.y - 100, 10);
  });

  it("converts and normalises angles consistently", () => {
    expect(radiansToDegrees(degreesToRadians(37.5))).toBeCloseTo(37.5, 10);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
  });
});
