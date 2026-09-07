import { useEffect, useRef, useState } from "react";
import { useReducedMotionPreference } from "./floating-surface-motion";

/**
 * One transient surface's presentation lifecycle.
 *
 * `opening` and `closing` are real states rather than implementation detail: a
 * surface that is still arriving must not take a press meant for the workspace
 * underneath it, and the phase is what lets a component say so.
 */
export type TransientPresentationPhase = "closed" | "opening" | "open" | "closing";

export interface TransientPresentation {
  readonly phase: TransientPresentationPhase;
  /** Linear position of the transition, 0 fully closed to 1 fully open. */
  readonly progress: number;
}

export interface TransientPresentationTiming {
  readonly openMilliseconds: number;
  readonly closeMilliseconds: number;
}

/**
 * Drives one linear progress value between closed and open.
 *
 * Deliberately linear: easing belongs at render time, where a surface can shape
 * its own arrival -- per ring for the Radial Brush Library, per sheet for the
 * Layers stack. Reversing a half-finished gesture then simply changes the
 * direction of travel from wherever it had got to, which is what makes a rapid
 * toggle continuous: there is no second clock to restart and no eased value to
 * invert. The frame loop exists only while the value is actually travelling.
 *
 * Reduced motion gets the instrument, not the performance: the surface arrives
 * and leaves at its final geometry with no transition at all.
 */
export function useTransientPresentation(
  requested: boolean,
  timing: TransientPresentationTiming,
): TransientPresentation {
  const reducedMotion = useReducedMotionPreference();
  const [state, setState] = useState<TransientPresentation>(() => ({
    phase: requested ? "open" : "closed",
    progress: requested ? 1 : 0,
  }));
  const frameRef = useRef<number | null>(null);
  const progressRef = useRef(state.progress);
  const openMilliseconds = timing.openMilliseconds;
  const closeMilliseconds = timing.closeMilliseconds;

  useEffect(() => {
    const cancel = (): void => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    cancel();
    if (reducedMotion) {
      progressRef.current = requested ? 1 : 0;
      setState({ phase: requested ? "open" : "closed", progress: progressRef.current });
      return cancel;
    }
    const settled = requested ? 1 : 0;
    if (progressRef.current === settled) {
      setState({ phase: requested ? "open" : "closed", progress: settled });
      return cancel;
    }
    const durationMs = requested ? openMilliseconds : closeMilliseconds;
    setState({ phase: requested ? "opening" : "closing", progress: progressRef.current });
    let lastFrameMs = performance.now();
    const step = (frameMs: number): void => {
      const elapsedMs = Math.max(0, frameMs - lastFrameMs);
      lastFrameMs = frameMs;
      const travel = durationMs > 0 ? elapsedMs / durationMs : 1;
      const next = requested
        ? Math.min(1, progressRef.current + travel)
        : Math.max(0, progressRef.current - travel);
      progressRef.current = next;
      if (next === settled) {
        frameRef.current = null;
        setState({ phase: requested ? "open" : "closed", progress: settled });
        return;
      }
      setState({ phase: requested ? "opening" : "closing", progress: next });
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return cancel;
  }, [closeMilliseconds, openMilliseconds, reducedMotion, requested]);

  return state;
}
