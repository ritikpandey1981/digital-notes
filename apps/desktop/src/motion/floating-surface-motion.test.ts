import { describe, expect, it } from "vitest";
import {
  FLOATING_SURFACE_MOTION,
  floatingSurfaceMotion,
  resolveFloatingSurfaceMotion,
} from "./floating-surface-motion";

describe("shared floating surface motion", () => {
  it("keeps open and close inside the approved ranges", () => {
    expect(FLOATING_SURFACE_MOTION.openMilliseconds).toBeGreaterThanOrEqual(140);
    expect(FLOATING_SURFACE_MOTION.openMilliseconds).toBeLessThanOrEqual(180);
    expect(FLOATING_SURFACE_MOTION.closeMilliseconds).toBeGreaterThanOrEqual(100);
    expect(FLOATING_SURFACE_MOTION.closeMilliseconds).toBeLessThanOrEqual(150);
    // Closing is quicker than opening: a surface should get out of the way.
    expect(FLOATING_SURFACE_MOTION.closeMilliseconds).toBeLessThan(
      FLOATING_SURFACE_MOTION.openMilliseconds,
    );
    expect(FLOATING_SURFACE_MOTION.travelPixels).toBeGreaterThanOrEqual(3);
    expect(FLOATING_SURFACE_MOTION.travelPixels).toBeLessThanOrEqual(6);
  });

  it("resolves the standard preset with travel", () => {
    const standard = resolveFloatingSurfaceMotion(false);

    expect(standard).toEqual({
      travelPixels: FLOATING_SURFACE_MOTION.travelPixels,
      openSeconds: 0.16,
      closeSeconds: 0.12,
      reducedMotion: false,
    });
  });

  it("collapses to opacity only for reduced motion", () => {
    const reduced = resolveFloatingSurfaceMotion(true);

    expect(reduced.travelPixels).toBe(0);
    expect(reduced.openSeconds).toBe(0.01);
    expect(reduced.closeSeconds).toBe(0.01);

    const props = floatingSurfaceMotion(reduced, "left");
    expect(props.initial).toMatchObject({ opacity: 0, x: 0 });
    expect(props.animate).toMatchObject({ opacity: 1, x: 0 });
    expect(props["data-motion-preset"]).toBe("reduced");
  });

  it.each([
    ["top", "y", -1],
    ["bottom", "y", 1],
    ["left", "x", -1],
    ["right", "x", 1],
  ] as const)("travels from the %s edge", (origin, axis, sign) => {
    const props = floatingSurfaceMotion(resolveFloatingSurfaceMotion(false), origin);
    const expected = FLOATING_SURFACE_MOTION.travelPixels * sign;

    expect(props.initial).toMatchObject({ opacity: 0, [axis]: expected });
    expect(props.animate).toMatchObject({ opacity: 1, [axis]: 0 });
    expect(props.exit).toMatchObject({ opacity: 0, [axis]: expected });
    // No other axis is touched, and nothing scales: opacity plus one small
    // translate, never both translate and scale together.
    expect(Object.keys(props.initial).sort()).toEqual(["opacity", axis].sort());
    expect(props.initial).not.toHaveProperty("scale");
  });

  it("drops pointer events on the first exit frame", () => {
    // A closing panel that still intercepts presses swallows the first stroke
    // drawn after it, which is the regression this guards.
    const props = floatingSurfaceMotion(resolveFloatingSurfaceMotion(false));

    expect(props.exit).toMatchObject({ pointerEvents: "none" });
    expect(props.initial).not.toHaveProperty("pointerEvents");
    expect(props.animate).not.toHaveProperty("pointerEvents");
  });

  it("uses one easing curve and never a spring", () => {
    const props = floatingSurfaceMotion(resolveFloatingSurfaceMotion(false));
    const exitTransition = (props.exit as { transition: { duration: number; ease: unknown } })
      .transition;

    expect(props.transition).toMatchObject({ duration: 0.16 });
    expect(exitTransition.duration).toBe(0.12);
    expect(exitTransition.ease).toEqual([0.22, 1, 0.36, 1]);
    expect(props.transition).not.toHaveProperty("type");
    expect(props.transition).not.toHaveProperty("bounce");
  });
});
