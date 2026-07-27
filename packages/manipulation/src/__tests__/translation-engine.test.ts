import { describe, expect, it } from "vitest";
import { createTranslationEngine } from "../index";
import { pagePoint } from "./fixtures";

describe("TranslationEngine", () => {
  it("calculates immutable absolute origin-relative translation", () => {
    const result = createTranslationEngine().calculate(pagePoint(10, 20), pagePoint(40, -20));
    expect(result).toEqual({
      translationX: 30,
      translationY: -40,
      totalDistance: 50,
      movementVector: { x: 30, y: -40 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.movementVector)).toBe(true);
  });

  it("produces identical final results regardless of intermediate event frequency", () => {
    const engine = createTranslationEngine();
    const origin = pagePoint(0, 0);
    const direct = engine.calculate(origin, pagePoint(100, 75));
    for (let value = 1; value < 100; value += 1) {
      engine.calculate(origin, pagePoint(value, value * 0.75));
    }
    expect(engine.calculate(origin, pagePoint(100, 75))).toEqual(direct);
  });
});
