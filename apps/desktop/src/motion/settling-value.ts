import { useEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "./floating-surface-motion";

/** Close enough to be the target: sub-pixel travel is not worth another frame. */
const SETTLED_PIXELS = 0.5;

/**
 * Follows a moving target, settling into it.
 *
 * The transient presentation clock next door answers "how far open is this",
 * which travels between two fixed ends. This answers a different question --
 * "where is this heading now" -- where the destination itself changes while the
 * value is in flight. Keeping them apart is deliberate: folding a moving target
 * into a 0..1 progress machine leaves no correct answer for "retarget halfway
 * through".
 *
 * Exponential rather than duration-based, because retargeting is then simply a
 * new destination: there is no elapsed fraction to reinterpret, no queue of
 * pending moves, and no snap back to a start position. Rapid input just changes
 * where the value is going, from wherever it currently is.
 *
 * Reduced motion takes the target immediately, with no travel at all.
 */
export function useSettlingValue(target: number, timeConstantMs: number): number {
  const reducedMotion = useReducedMotionPreference();
  const destination = Number.isFinite(target) ? target : 0;
  const immediate = reducedMotion || timeConstantMs <= 0;
  const [travelling, setTravelling] = useState(destination);
  const valueRef = useRef(destination);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const cancel = (): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    cancel();
    // Nothing to travel: either the preference says so, or the value is already
    // where it is going. The rendered value comes straight from the target.
    if (immediate || valueRef.current === destination) {
      valueRef.current = destination;
      return cancel;
    }
    let lastFrameMs = performance.now();
    const step = (frameMs: number): void => {
      const elapsedMs = Math.max(0, frameMs - lastFrameMs);
      lastFrameMs = frameMs;
      // Frame-rate independent: the same proportion of the remaining distance is
      // covered per millisecond however often frames actually arrive.
      const remaining = destination - valueRef.current;
      const next = valueRef.current + remaining * (1 - Math.exp(-elapsedMs / timeConstantMs));
      if (Math.abs(destination - next) < SETTLED_PIXELS) {
        valueRef.current = destination;
        frameRef.current = null;
        setTravelling(destination);
        return;
      }
      valueRef.current = next;
      setTravelling(next);
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return cancel;
  }, [destination, immediate, timeConstantMs]);

  return immediate ? destination : travelling;
}
