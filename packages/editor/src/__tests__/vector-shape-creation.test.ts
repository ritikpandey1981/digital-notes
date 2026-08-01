import { describe, expect, it } from "vitest";
import type { PagePoint } from "@folio/selection";
import { createVectorShapeDraft } from "../VectorShapeCreation";

function point(x: number, y: number): PagePoint {
  return Object.freeze({ x, y, coordinateSpace: "page" });
}

const style = Object.freeze({ strokeColor: "#111111", strokeWidth: 2 });

describe("vector shape creation drafts", () => {
  it("creates exact rectangle and ellipse geometry without producing PageObjects", () => {
    const rectangle = createVectorShapeDraft(
      "rectangle",
      point(20, 30),
      point(140, 110),
      false,
      style,
    );
    const ellipse = createVectorShapeDraft("ellipse", point(20, 30), point(140, 110), false, style);

    expect(rectangle.geometry).toEqual({ x: 20, y: 30, width: 120, height: 80 });
    expect(rectangle.measurement).toBe("Width: 120 px \u00b7 Height: 80 px");
    expect(ellipse.measurement).toBe("Width: 120 px \u00b7 Height: 80 px");
    expect(ellipse.geometry).toEqual({
      center: { x: 80, y: 70 },
      radiusX: 60,
      radiusY: 40,
    });
    expect("id" in rectangle).toBe(false);
    expect(Object.isFrozen(rectangle)).toBe(true);
  });

  it("constrains lines to 45-degree increments while preserving drag length", () => {
    const draft = createVectorShapeDraft("line", point(0, 0), point(90, 70), true, style);
    const geometry = draft.geometry as {
      readonly start: { readonly x: number; readonly y: number };
      readonly end: { readonly x: number; readonly y: number };
    };
    const angle = Math.atan2(geometry.end.y, geometry.end.x);

    expect(angle).toBeCloseTo(Math.PI / 4);
    expect(Math.hypot(geometry.end.x, geometry.end.y)).toBeCloseTo(Math.hypot(90, 70));
    expect(draft.measurement).toContain("Angle: 315\u00b0");
  });

  it("constrains rectangles to squares and ellipses to circles in every drag direction", () => {
    const square = createVectorShapeDraft(
      "rectangle",
      point(100, 100),
      point(40, 130),
      true,
      style,
    );
    const circle = createVectorShapeDraft("ellipse", point(100, 100), point(40, 130), true, style);

    expect(square.geometry).toEqual({ x: 40, y: 100, width: 60, height: 60 });
    expect(circle.measurement).toBe("Radius: 30 px \u00b7 Diameter: 60 px");
  });

  it("reports positive counter-clockwise line angles", () => {
    const upward = createVectorShapeDraft("line", point(0, 100), point(100, 0), false, style);
    const downward = createVectorShapeDraft("line", point(0, 0), point(100, 100), false, style);

    expect(upward.measurement).toContain("45\u00b0");
    expect(downward.measurement).toContain("315\u00b0");
  });

  it("marks sub-pixel clicks invalid so cancellation and no-op drags cannot reach History", () => {
    expect(createVectorShapeDraft("line", point(10, 10), point(10, 10), false, style).valid).toBe(
      false,
    );
    expect(
      createVectorShapeDraft("rectangle", point(10, 10), point(10.5, 20), false, style).valid,
    ).toBe(false);
  });
});
