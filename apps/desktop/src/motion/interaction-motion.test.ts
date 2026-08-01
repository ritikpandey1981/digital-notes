import { describe, expect, it } from "vitest";
import { INTERACTION_MOTION, motionSeconds, PROFESSIONAL_EASE } from "./interaction-motion";

describe("desktop interaction motion policy", () => {
  it("keeps professional interaction timings within the approved ranges", () => {
    expect(INTERACTION_MOTION.hoverMilliseconds).toBeGreaterThanOrEqual(80);
    expect(INTERACTION_MOTION.hoverMilliseconds).toBeLessThanOrEqual(120);
    expect(INTERACTION_MOTION.pressMilliseconds).toBeGreaterThanOrEqual(60);
    expect(INTERACTION_MOTION.pressMilliseconds).toBeLessThanOrEqual(90);
    expect(INTERACTION_MOTION.selectionMilliseconds).toBeGreaterThanOrEqual(120);
    expect(INTERACTION_MOTION.selectionMilliseconds).toBeLessThanOrEqual(150);
    expect(INTERACTION_MOTION.floatingMilliseconds).toBeGreaterThanOrEqual(120);
    expect(INTERACTION_MOTION.floatingMilliseconds).toBeLessThanOrEqual(150);
    expect(INTERACTION_MOTION.tooltipMilliseconds).toBe(120);
    expect(INTERACTION_MOTION.paletteOpenMilliseconds).toBeGreaterThanOrEqual(180);
    expect(INTERACTION_MOTION.paletteOpenMilliseconds).toBeLessThanOrEqual(200);
    expect(INTERACTION_MOTION.paletteCloseMilliseconds).toBeGreaterThanOrEqual(140);
    expect(INTERACTION_MOTION.paletteCloseMilliseconds).toBeLessThanOrEqual(180);
    expect(INTERACTION_MOTION.contentMilliseconds).toBe(150);
  });

  it("uses one restrained easing curve and collapses durations for reduced motion", () => {
    expect(PROFESSIONAL_EASE).toEqual([0.22, 1, 0.36, 1]);
    expect(motionSeconds(190, false)).toBe(0.19);
    expect(motionSeconds(190, true)).toBe(0.01);
    expect(Object.isFrozen(INTERACTION_MOTION)).toBe(true);
  });
});
