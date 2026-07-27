import { describe, expect, it, vi } from "vitest";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";

const points: StrokePointInput[] = [0, 10, 20].map((x, index) => ({
  x,
  y: index * 3,
  timestamp: index,
  pressure: 0.5,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  pointerType: "pen",
  button: 0,
  buttons: 1,
}));

describe("StrokeSmoother", () => {
  it("supports no smoothing", () => {
    const smoother = new StrokeSmoother({ mode: "none" });
    expect(smoother.smoothNext(points)).toEqual({ x: 20, y: 6 });
  });

  it("supports configurable lightweight moving-average smoothing", () => {
    const smoother = new StrokeSmoother({ mode: "average", windowSize: 3, strength: 1 });
    expect(smoother.smoothNext(points)).toEqual({ x: 10, y: 3 });
    expect(Object.isFrozen(smoother.smoothNext(points))).toBe(true);
  });

  it.each(["catmull-rom", "bezier"] as const)(
    "supports a replaceable %s interpolation hook",
    (mode) => {
      const smooth = vi.fn(() => ({ x: 9, y: 7 }));
      const hook = { name: mode, smooth };
      const smoother = new StrokeSmoother({
        mode,
        ...(mode === "catmull-rom" ? { catmullRomHook: hook } : { bezierHook: hook }),
      });
      expect(smoother.smoothNext(points)).toEqual({ x: 9, y: 7 });
      expect(smooth).toHaveBeenCalledWith(points, 2);
    },
  );

  it("rejects invalid configuration and hook output", () => {
    expect(() => new StrokeSmoother({ mode: "average", windowSize: 0 })).toThrowError(
      expect.objectContaining({ code: "INVALID_STROKE" }),
    );
    expect(() => new StrokeSmoother({ mode: "catmull-rom" })).toThrowError(
      expect.objectContaining({ code: "INVALID_STROKE" }),
    );
    const smoother = new StrokeSmoother({
      mode: "bezier",
      bezierHook: { name: "broken", smooth: () => ({ x: Number.NaN, y: 0 }) },
    });
    expect(() => smoother.smoothNext(points)).toThrowError(
      expect.objectContaining({ code: "INVALID_POINTER_DATA" }),
    );
  });

  it("rejects empty point collections", () => {
    expect(() => new StrokeSmoother().smoothNext([])).toThrowError(
      expect.objectContaining({ code: "INVALID_STROKE" }),
    );
  });
});
