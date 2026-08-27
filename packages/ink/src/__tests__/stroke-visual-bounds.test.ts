import { describe, expect, it } from "vitest";
import {
  getStrokeLocalRenderBounds,
  getStrokeTransformPivot,
  getStrokeVisualLocalBounds,
  StrokeBuilder,
  type Stroke,
} from "../index";

/**
 * M-012: the frame around selected Ink used to inherit the render bounds,
 * which carry a repaint safety margin and are squared around the transform
 * pivot. These assertions pin the visual bounds as the tighter of the two for
 * every stroke shape a user can actually draw.
 */
describe("stroke visual bounds", () => {
  it.each([
    ["a tiny dot", [[100, 100] as const, [100.2, 100.1] as const], 4],
    [
      "a horizontal stroke",
      [[50, 100] as const, [100, 100] as const, [150, 100] as const, [200, 100] as const],
      4,
    ],
    [
      "a vertical stroke",
      [[100, 50] as const, [100, 100] as const, [100, 150] as const, [100, 200] as const],
      4,
    ],
    [
      "a diagonal stroke",
      [[50, 50] as const, [100, 100] as const, [150, 150] as const, [200, 200] as const],
      4,
    ],
    ["a thick stroke", [[50, 50] as const, [110, 90] as const, [170, 150] as const], 24],
    ["a thin stroke", [[50, 50] as const, [110, 90] as const, [170, 150] as const], 1],
    [
      "a large curve",
      [
        [50, 100] as const,
        [80, 40] as const,
        [140, 40] as const,
        [180, 120] as const,
        [220, 60] as const,
      ],
      6,
    ],
  ])("describes %s more tightly than its render bounds", (_label, points, width) => {
    const stroke = buildStroke(points, width);
    const visual = getStrokeVisualLocalBounds(stroke);
    const render = getStrokeLocalRenderBounds(stroke);

    expect(visual.width).toBeLessThanOrEqual(render.width);
    expect(visual.height).toBeLessThanOrEqual(render.height);
    expect(visual.x).toBeGreaterThanOrEqual(render.x);
    expect(visual.y).toBeGreaterThanOrEqual(render.y);
    expect(visual.x + visual.width).toBeLessThanOrEqual(render.x + render.width);
    expect(visual.y + visual.height).toBeLessThanOrEqual(render.y + render.height);
    // The frame still contains the ink: the drawn width is real coverage.
    expect(visual.width).toBeGreaterThanOrEqual(stroke.bounds.width);
    expect(visual.height).toBeGreaterThanOrEqual(stroke.bounds.height);
  });

  it("drops the repaint margin a thin stroke used to inherit", () => {
    const stroke = buildStroke(
      [
        [50, 100],
        [100, 100],
        [150, 100],
        [200, 100],
      ],
      4,
    );
    const visual = getStrokeVisualLocalBounds(stroke);
    const render = getStrokeLocalRenderBounds(stroke);

    // Two pixels of repaint padding on each axis, on both sides.
    expect(render.height - visual.height).toBeCloseTo(4, 5);
    expect(visual.height).toBeCloseTo(4, 5);
  });

  it("reports the pivot the transform actually rotates about", () => {
    const stroke = buildStroke(
      [
        [50, 50],
        [150, 90],
        [250, 130],
      ],
      6,
    );

    expect(getStrokeTransformPivot(stroke)).toEqual(stroke.bounds.center);
  });

  it("scales the visual bounds with the rendered scale", () => {
    const stroke = buildStroke(
      [
        [50, 50],
        [150, 90],
        [250, 130],
      ],
      6,
    );

    expect(getStrokeVisualLocalBounds(stroke, 2).width).toBeGreaterThan(0);
    expect(getStrokeVisualLocalBounds(stroke, 2)).not.toEqual(
      getStrokeVisualLocalBounds(stroke, 1),
    );
  });
});

function buildStroke(points: readonly (readonly [number, number])[], width: number): Stroke {
  const builder = new StrokeBuilder({ id: "visual-bounds", timestamp: 0, style: { width } });
  points.forEach(([x, y], index) => {
    builder.addPoint({
      x,
      y,
      pressure: 0.5,
      timestamp: index * 8,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  });
  return builder.finalize();
}
