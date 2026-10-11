import { describe, expect, it } from "vitest";
import { resolveBrushForPointerType } from "../brush-model";
import { MATERIAL_RESOLUTION, placePencilDabs, TILE_CELLS } from "../internal/pencil-material";
import type { StrokePoint } from "../types";
import {
  alphaAt,
  buildMaterial,
  pencilBrush,
  samplePoint,
  straight,
  totalAlpha,
} from "./pencil-material-fixture";

/**
 * What the material looks like, stated as things that can fail.
 *
 * The visual gate is not implied by the correctness gates -- E4.1 settled that
 * the hard way -- so these are the properties of the approved appearance that a
 * later change could break without breaking determinism: a tap is a textured
 * tip, a terminal is a full tip, pressure only ever reveals more of the same
 * sheet, a retrace darkens, and the colour the artist picked is nowhere in it.
 */

/** Out and back along exactly the same line. */
function retrace(pressure: number): StrokePoint[] {
  const points: StrokePoint[] = [];
  for (let index = 0; index < 120; index += 1) {
    const t = index / 119;
    const along = t <= 0.5 ? t * 2 : 2 - t * 2;
    points.push(samplePoint(60 + along * 90, 100, pressure));
  }
  return points;
}

describe("hybrid Pencil material", () => {
  it("deposits deterministically from the same samples and snapshot", () => {
    const points = straight(0.6);
    const brush = pencilBrush();
    const first = buildMaterial(points, brush);
    const second = buildMaterial(points, brush);
    expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
    for (const [key, tile] of first) {
      expect([...(second.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
  });

  // The superset property -- a firmer pass adds grains and never moves them --
  // is asserted in `pencil-visual-freeze.test.ts`, which owns it and states it
  // twice: once on the preset as shipped, and once with the size response held
  // off so a displacement of a single cell breaks the chain. The copy that used
  // to live here was the first form on a straight run, and measurably weaker:
  // with a pressure-dependent shift of a whole cell injected into placement, it
  // passed while the freeze suite's sharp form failed. Two subtly different
  // definitions of one durable property is worse than one, so this defers to
  // the authority rather than restating it.

  it("deposits monotonically more material as pressure rises", () => {
    const brush = pencilBrush();
    const totals = [0.15, 0.35, 0.55, 0.75, 0.95].map((pressure) =>
      totalAlpha(buildMaterial(straight(pressure), brush)),
    );
    for (let index = 1; index < totals.length; index += 1) {
      expect(totals[index]).toBeGreaterThan(totals[index - 1] ?? 0);
    }
  });

  it("leaves a textured circular impression for a tap, not a solid disc", () => {
    const brush = pencilBrush({ size: 26 });
    const material = buildMaterial([samplePoint(140, 140, 0.55)], brush);
    const dabs = placePencilDabs([samplePoint(140, 140, 0.55)], brush);
    expect(dabs).toHaveLength(1);
    const radius = dabs[0]?.radius ?? 0;

    // Radially bounded: no graphite outside the tip that made it.
    for (const tile of material.values()) {
      for (let index = 0; index < tile.alpha.length; index += 1) {
        if ((tile.alpha[index] ?? 0) === 0) continue;
        const x = (tile.tx * TILE_CELLS + (index % TILE_CELLS)) / MATERIAL_RESOLUTION;
        const y = (tile.ty * TILE_CELLS + Math.floor(index / TILE_CELLS)) / MATERIAL_RESOLUTION;
        expect(Math.hypot(x - 140, y - 140) - radius).toBeLessThan(1);
      }
    }

    // Round rather than square: the four corners of the bounding box are bare.
    for (const [x, y] of [
      [140 - radius * 0.8, 140 - radius * 0.8],
      [140 + radius * 0.8, 140 - radius * 0.8],
      [140 - radius * 0.8, 140 + radius * 0.8],
      [140 + radius * 0.8, 140 + radius * 0.8],
    ] as const) {
      expect(alphaAt(material, x, y)).toBe(0);
    }

    // Textured rather than solid: the core has both graphite and bare paper in
    // it, and the graphite it has is not all one value.
    const core: number[] = [];
    for (let offset = -4; offset <= 4; offset += 1) {
      for (let across = -4; across <= 4; across += 1) {
        core.push(alphaAt(material, 140 + offset * 0.5, 140 + across * 0.5));
      }
    }
    expect(core.some((value) => value > 0)).toBe(true);
    expect(new Set(core.filter((value) => value > 0)).size).toBeGreaterThan(3);
  });

  it("ends a stroke on a full tip rather than on a point", () => {
    // A terminal deposits through the same envelope as its neighbours, so the
    // mark runs out across the tip instead of tapering to a filament.
    const brush = pencilBrush({ size: 16, smoothing: 0 });
    const points = straight(0.8, 90, 150);
    const material = buildMaterial(points, brush);
    const dabs = placePencilDabs(points, brush);
    const last = dabs[dabs.length - 1];
    const middle = dabs[Math.floor(dabs.length / 2)];
    expect(last).toBeDefined();
    expect(middle).toBeDefined();

    const widthAt = (x: number): number => {
      let extent = 0;
      for (let offset = -12; offset <= 12; offset += 0.5) {
        if (alphaAt(material, x, 150 + offset) > 0) extent = Math.max(extent, Math.abs(offset));
      }
      return extent;
    };
    // Measured just inside the terminal, where the final tip is fully on paper.
    const terminalWidth = widthAt((last?.x ?? 0) - 0.5);
    expect(terminalWidth).toBeGreaterThan(widthAt(middle?.x ?? 0) * 0.7);
  });

  it("darkens where a stroke retraces its own mark", () => {
    const brush = pencilBrush({ smoothing: 0 });
    const single = totalAlpha(buildMaterial(straight(0.6), brush));
    const doubled = totalAlpha(buildMaterial(retrace(0.6), brush));
    expect(doubled).toBeGreaterThan(single * 1.2);
  });

  it("does not darken with the sampling rate within one passage", () => {
    // Consecutive dabs of one pass overlap by construction; if each overlap
    // compounded, a fast hand and a slow one would draw different tones.
    const brush = pencilBrush({ smoothing: 0 });
    const sparse: StrokePoint[] = [];
    const dense: StrokePoint[] = [];
    for (let index = 0; index < 9; index += 1) sparse.push(samplePoint(60 + index * 10, 100, 0.6));
    for (let index = 0; index < 401; index += 1) {
      dense.push(samplePoint(60 + index * 0.2, 100, 0.6));
    }
    const a = buildMaterial(sparse, brush);
    const b = buildMaterial(dense, brush);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [key, tile] of a) {
      expect([...(b.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
  });

  it("gives two separate strokes over one patch of page the same sheet", () => {
    // Independent strokes, independent caches, one sheet: the tooth a mark
    // finds is a property of the page, so a second pass lands in the same
    // gullies the first one did.
    const brush = pencilBrush({ smoothing: 0 });
    const first = buildMaterial(straight(0.6), brush);
    const second = buildMaterial(straight(0.6), brush);
    for (const [key, tile] of first) {
      expect([...(second.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
    // And a stroke somewhere else finds different paper.
    const elsewhere = buildMaterial(straight(0.6, 90, 340), brush);
    expect([...elsewhere.keys()].sort()).not.toEqual([...first.keys()].sort());
  });

  it("deposits the same material whatever colour the artist picked", () => {
    // Colour is applied when material is painted, never when it is deposited,
    // so one cached tile serves every colour and no pigment is baked in.
    const points = straight(0.6);
    const graphite = buildMaterial(points, pencilBrush({ color: "#1a1a1a" }));
    const magenta = buildMaterial(points, pencilBrush({ color: "#cc3377" }));
    const teal = buildMaterial(points, pencilBrush({ color: "#0099bb" }));
    for (const [key, tile] of graphite) {
      expect([...(magenta.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
      expect([...(teal.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
  });

  it("applies base opacity exactly once", () => {
    // A tap is a single contact, so its material is the deposit scaled by
    // opacity and nothing else. Applying opacity twice would square it.
    const tap = [samplePoint(140, 140, 0.7)];
    const opaque = buildMaterial(tap, pencilBrush({ size: 20, opacity: 1 }));
    const half = buildMaterial(tap, pencilBrush({ size: 20, opacity: 0.5 }));
    let compared = 0;
    for (const [key, tile] of opaque) {
      const scaled = half.get(key);
      expect(scaled).toBeDefined();
      for (let index = 0; index < tile.alpha.length; index += 1) {
        const full = tile.alpha[index] ?? 0;
        if (full === 0) continue;
        // One rounding at each opacity, so at most one unit apart.
        expect(Math.abs((scaled?.alpha[index] ?? 0) - full * 0.5)).toBeLessThanOrEqual(1);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(200);
    let peak = 0;
    for (const tile of half.values()) for (const value of tile.alpha) peak = Math.max(peak, value);
    expect(peak).toBeLessThanOrEqual(Math.round(255 * 0.5));
  });

  it("gives a mouse the brush as configured, still on pencil@1", () => {
    // A mouse reports a synthetic 0.5, so its pressure must not drive
    // expression. The strategy identity does not change: a mouse-drawn Pencil
    // is the same Pencil, drawn at its configured width and coverage.
    const configured = pencilBrush({ smoothing: 0 });
    const mouse = resolveBrushForPointerType(configured, "mouse");
    expect(mouse.renderer).toEqual({ version: 1, kind: "pencil" });
    expect(mouse.dynamics.pressureSize.enabled).toBe(false);
    expect(mouse.dynamics.pressureOpacity.enabled).toBe(false);

    const light = placePencilDabs(straight(0.1), mouse);
    const firm = placePencilDabs(straight(0.9), mouse);
    expect(light[0]?.radius).toBe(configured.size / 2);
    expect(light[0]?.radius).toBe(firm[0]?.radius);
    expect(light[0]?.coverage).toBe(firm[0]?.coverage);
    // And the material it deposits is genuinely pressure-independent.
    const a = buildMaterial(straight(0.1), mouse);
    const b = buildMaterial(straight(0.9), mouse);
    for (const [key, tile] of a) {
      expect([...(b.get(key)?.alpha ?? [])]).toEqual([...tile.alpha]);
    }
  });

  it("keeps a narrow pencil continuous instead of dashed", () => {
    // Two page units is only a few field cells across; without the narrow-tip
    // core floor a tooth that declines breaks the whole line.
    const brush = pencilBrush({ size: 2, smoothing: 0 });
    const material = buildMaterial(straight(0.55), brush);
    let gaps = 0;
    for (let x = 62; x < 148; x += 0.5) {
      let column = 0;
      for (let offset = -3; offset <= 3; offset += 0.5) {
        column += alphaAt(material, x, 100 + offset);
      }
      if (column === 0) gaps += 1;
    }
    expect(gaps).toBe(0);
  });
});
