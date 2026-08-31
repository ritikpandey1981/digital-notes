import { describe, expect, it } from "vitest";
import { BRUSH_LIBRARY_FIXTURES } from "./brush-library-fixtures";
import {
  RADIAL_APERTURE,
  RADIAL_LIBRARY_CONFIGURATION,
  RADIAL_VISIBILITY_EPSILON,
  buildRadialLibraryLayout,
  computeAngularVisibility,
  computeCellVisibility,
  hiddenDirectionDegrees,
  normalizeDegrees,
  type RadialCenter,
} from "./radial-brush-library-model";

const CENTER: RadialCenter = Object.freeze({ x: 200, y: 300 });
const HIDDEN = hiddenDirectionDegrees(RADIAL_APERTURE.dockSide);
const CORE = RADIAL_APERTURE.hiddenCoreDegrees;
const EDGE = CORE + RADIAL_APERTURE.transitionDegrees;

function rotated(offsetDegrees: number) {
  return buildRadialLibraryLayout(
    CENTER,
    RADIAL_LIBRARY_CONFIGURATION,
    BRUSH_LIBRARY_FIXTURES,
    offsetDegrees,
  );
}

describe("dock-side aperture", () => {
  it("hides straight back through a left-hand dock", () => {
    expect(HIDDEN).toBe(180);
    expect(RADIAL_APERTURE.dockSide).toBe("left");
  });

  it("mirrors for a right-hand dock without touching the fade maths", () => {
    expect(hiddenDirectionDegrees("right")).toBe(0);
    const mirrored = { ...RADIAL_APERTURE, dockSide: "right" as const };
    expect(computeAngularVisibility(0, mirrored)).toBe(0);
    expect(computeAngularVisibility(180, mirrored)).toBe(1);
  });
});

describe("angular visibility", () => {
  it("is fully hidden inside the core", () => {
    for (const offset of [0, 5, -5, CORE, -CORE]) {
      expect(computeAngularVisibility(HIDDEN + offset), `offset ${offset}`).toBe(0);
    }
  });

  it("is fully visible beyond the transition band", () => {
    for (const offset of [EDGE, EDGE + 20, 90, 180]) {
      expect(computeAngularVisibility(HIDDEN + offset), `offset ${offset}`).toBe(1);
      expect(computeAngularVisibility(HIDDEN - offset), `offset -${offset}`).toBe(1);
    }
  });

  it("is strictly between 0 and 1 inside the transition band", () => {
    for (let offset = CORE + 1; offset < EDGE; offset += 2) {
      const value = computeAngularVisibility(HIDDEN + offset);
      expect(value, `offset ${offset}`).toBeGreaterThan(0);
      expect(value, `offset ${offset}`).toBeLessThan(1);
    }
  });

  it("rises monotonically away from the hidden direction", () => {
    let previous = -1;
    for (let offset = 0; offset <= 90; offset += 1) {
      const value = computeAngularVisibility(HIDDEN + offset);
      expect(value, `offset ${offset}`).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("is symmetric either side of the aperture", () => {
    for (let offset = 0; offset <= 90; offset += 3) {
      expect(computeAngularVisibility(HIDDEN + offset)).toBeCloseTo(
        computeAngularVisibility(HIDDEN - offset),
        12,
      );
    }
  });

  it("meets its boundaries continuously", () => {
    const inside = computeAngularVisibility(HIDDEN + CORE - 1e-6);
    const atCore = computeAngularVisibility(HIDDEN + CORE + 1e-6);
    expect(Math.abs(atCore - inside)).toBeLessThan(1e-3);
    const nearEdge = computeAngularVisibility(HIDDEN + EDGE - 1e-6);
    expect(Math.abs(1 - nearEdge)).toBeLessThan(1e-3);
  });

  it("stays within range and finite for any angle", () => {
    for (let angle = -900; angle <= 900; angle += 7) {
      const value = computeAngularVisibility(angle);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("treats angles a whole turn apart identically", () => {
    for (let angle = -170; angle <= 170; angle += 13) {
      const base = computeAngularVisibility(angle);
      for (const turns of [360, 720, -360, -720]) {
        expect(computeAngularVisibility(angle + turns), `${angle} + ${turns}`).toBeCloseTo(
          base,
          12,
        );
      }
    }
  });
});

describe("cell visibility", () => {
  it("samples across the arc rather than trusting the centre alone", () => {
    // An inner cell is wider than the hidden core, so a centre-only rule would
    // blink it out while part of it was still clear of the aperture.
    const wide = { startAngleDegrees: HIDDEN - 17, endAngleDegrees: HIDDEN + 17 };
    expect(RADIAL_LIBRARY_CONFIGURATION.targetCellWidth).toBe(72);
    expect(computeAngularVisibility(HIDDEN)).toBe(0);
    expect(computeCellVisibility(wide)).toBeGreaterThan(0);
  });

  it("is fully hidden only when the whole cell is inside the core", () => {
    expect(
      computeCellVisibility({ startAngleDegrees: HIDDEN - 5, endAngleDegrees: HIDDEN + 5 }),
    ).toBe(0);
  });

  it("is fully visible only when the whole cell clears the band", () => {
    expect(
      computeCellVisibility({
        startAngleDegrees: HIDDEN + EDGE + 5,
        endAngleDegrees: HIDDEN + EDGE + 25,
      }),
    ).toBe(1);
  });

  it("stays in range for every cell at any rotation", () => {
    for (const offset of [0, 37, 180, 400, -725]) {
      for (const cell of rotated(offset).cells) {
        const value = computeCellVisibility(cell);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("visibility as the wheel turns", () => {
  /** Follows one catalogue entry's opacity across a full turn. */
  function track(catalogueIndex: number, offsets: readonly number[]): number[] {
    return offsets.map((offset) => computeCellVisibility(rotated(offset).cells[catalogueIndex]!));
  }

  it("takes a cell from visible, through the band, to hidden", () => {
    const start = rotated(0).cells[0]!;
    // Rotate the cell's centre onto the hidden direction.
    const toHidden = shortestPath(start.midAngleDegrees, HIDDEN);
    const samples = track(0, [0, toHidden * 0.5, toHidden * 0.85, toHidden]);
    expect(samples[0], "starts visible").toBeGreaterThan(0.9);
    expect(samples[samples.length - 1]!, "ends hidden").toBeLessThan(0.2);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!, `step ${index} keeps receding`).toBeLessThanOrEqual(
        samples[index - 1]! + 1e-9,
      );
    }
  });

  it("brings the same cell back out symmetrically", () => {
    const start = rotated(0).cells[0]!;
    const toHidden = shortestPath(start.midAngleDegrees, HIDDEN);
    const emerging = track(0, [toHidden, toHidden * 1.3, toHidden * 1.7, toHidden * 2.2]);
    expect(emerging[0]!, "starts hidden").toBeLessThan(0.2);
    expect(emerging[emerging.length - 1]!, "comes back").toBeGreaterThan(0.9);
  });

  it("keeps working past several turns", () => {
    const base = rotated(0).cells[5]!;
    for (const turns of [360, 720, -360, -720]) {
      expect(computeCellVisibility(rotated(turns).cells[5]!)).toBeCloseTo(
        computeCellVisibility(base),
        10,
      );
    }
  });

  it("gives every ring the same visibility along one angular ray", () => {
    // Cells centred on the same bearing must agree, whatever their radius.
    for (const bearing of [0, 60, 150, 200, 300]) {
      const values = [10, 30, 60].map((half) =>
        computeCellVisibility({
          startAngleDegrees: bearing - half / 2,
          endAngleDegrees: bearing + half / 2,
        }),
      );
      // Wider cells straddle more of the band, so they may differ near the
      // aperture, but far from it every ring must agree exactly.
      if (Math.abs(shortestPath(bearing, HIDDEN)) > 90) {
        expect(new Set(values.map((value) => value.toFixed(6))).size, `bearing ${bearing}`).toBe(1);
      }
    }
  });
});

describe("fade changes nothing structural", () => {
  it("leaves geometry, sizes and catalogue untouched", () => {
    const base = rotated(0);
    for (const cell of base.cells) {
      // Reading visibility must not mutate anything.
      computeCellVisibility(cell);
    }
    const again = rotated(0);
    expect(again.cells.map((cell) => cell.fixture.id)).toEqual(
      base.cells.map((cell) => cell.fixture.id),
    );
    for (const [index, cell] of base.cells.entries()) {
      expect(again.cells[index]!.startAngleDegrees).toBe(cell.startAngleDegrees);
      expect(again.cells[index]!.arcLength).toBeCloseTo(cell.arcLength, 12);
      expect(again.cells[index]!.outerRadius - again.cells[index]!.innerRadius).toBe(64);
    }
  });

  it("leaves the propagated channels as real gaps, never faded placeholders", () => {
    const layout = rotated(0);
    expect(layout.tracks.map((track) => track.blockedIntervals.length)).toEqual([1, 2, 3, 3]);
    // Nothing is drawn in a gap, so there is no cell there to fade.
    for (const track of layout.tracks) {
      for (const blocked of track.blockedIntervals) {
        const inside = track.cells.filter((cell) => {
          const offset = normalizeDegrees(cell.midAngleDegrees - blocked.startDegrees);
          return offset < blocked.widthDegrees;
        });
        expect(inside, `ring ${track.index} keeps its channel empty`).toHaveLength(0);
      }
    }
  });

  it("marks only effectively invisible cells as non-interactive", () => {
    expect(RADIAL_VISIBILITY_EPSILON).toBeGreaterThan(0);
    expect(
      computeCellVisibility({ startAngleDegrees: HIDDEN - 4, endAngleDegrees: HIDDEN + 4 }),
    ).toBeLessThanOrEqual(RADIAL_VISIBILITY_EPSILON);
    expect(computeCellVisibility({ startAngleDegrees: 0, endAngleDegrees: 20 })).toBeGreaterThan(
      RADIAL_VISIBILITY_EPSILON,
    );
  });
});

/** Shortest signed way from one bearing to another, in (-180, 180]. */
function shortestPath(from: number, to: number): number {
  return normalizeDegrees(to - from + 180) - 180;
}
