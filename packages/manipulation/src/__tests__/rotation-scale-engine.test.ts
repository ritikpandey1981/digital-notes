import { describe, expect, it } from "vitest";
import { createRotationEngine, createScaleEngine } from "../index";
import { pagePoint } from "./fixtures";

describe("RotationEngine", () => {
  it("calculates deterministic center-pivot radians without retaining input", () => {
    const engine = createRotationEngine();
    const result = engine.calculate(pagePoint(10, 10), pagePoint(20, 10), pagePoint(10, 20));
    expect(result.deltaRadians).toBeCloseTo(Math.PI / 2);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes crossing the negative angle boundary", () => {
    const engine = createRotationEngine();
    const center = pagePoint(0, 0);
    const origin = pagePoint(-10, 0.1);
    const current = pagePoint(-10, -0.1);
    expect(Math.abs(engine.calculate(center, origin, current).deltaRadians)).toBeLessThan(0.1);
  });
});

describe("ScaleEngine", () => {
  it("calculates an origin-relative radial factor", () => {
    const result = createScaleEngine().calculate(
      pagePoint(10, 10),
      pagePoint(20, 10),
      pagePoint(35, 10),
    );
    expect(result).toEqual({ factor: 2.5 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects an origin at the object center", () => {
    expect(() =>
      createScaleEngine().calculate(pagePoint(10, 10), pagePoint(10, 10), pagePoint(20, 10)),
    ).toThrow(RangeError);
  });
});
