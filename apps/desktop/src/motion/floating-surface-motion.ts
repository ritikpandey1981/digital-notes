import { useSyncExternalStore } from "react";
import type { TargetAndTransition, Transition } from "framer-motion";
import { PROFESSIONAL_EASE } from "./interaction-motion";

/**
 * One restrained motion treatment for every floating editor surface.
 *
 * Tool Options, Layers, Page Settings, Pages, the color picker and the compact
 * popovers each used to carry their own hand-tuned distance and direction, so
 * opening two of them in a row looked like two different applications. They now
 * share these numbers, and differ only in which edge they arrive from.
 *
 * Two rules are load-bearing rather than cosmetic:
 *
 *  - An exiting surface drops `pointer-events` immediately. Motion must never
 *    delay interaction: a closing panel that still intercepts presses swallows
 *    the first stroke drawn after it.
 *  - Reduced motion means opacity only. No spatial travel at all, rather than
 *    a shorter version of it.
 */
export const FLOATING_SURFACE_MOTION = Object.freeze({
  openMilliseconds: 160,
  closeMilliseconds: 120,
  /** Small enough to read as settling rather than sliding. */
  travelPixels: 5,
});

const FLOATING_EASE: [number, number, number, number] = [
  PROFESSIONAL_EASE[0],
  PROFESSIONAL_EASE[1],
  PROFESSIONAL_EASE[2],
  PROFESSIONAL_EASE[3],
];

/** Which edge a surface arrives from, so it settles toward its anchor. */
export type FloatingSurfaceOrigin = "top" | "bottom" | "left" | "right";

export interface FloatingSurfaceMotionResolution {
  readonly travelPixels: number;
  readonly openSeconds: number;
  readonly closeSeconds: number;
  readonly reducedMotion: boolean;
}

/** Resolves the treatment for one accessibility preference. */
export function resolveFloatingSurfaceMotion(
  reducedMotion: boolean,
): FloatingSurfaceMotionResolution {
  return Object.freeze({
    travelPixels: reducedMotion ? 0 : FLOATING_SURFACE_MOTION.travelPixels,
    openSeconds: reducedMotion ? 0.01 : FLOATING_SURFACE_MOTION.openMilliseconds / 1_000,
    closeSeconds: reducedMotion ? 0.01 : FLOATING_SURFACE_MOTION.closeMilliseconds / 1_000,
    reducedMotion,
  });
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reads the viewer's motion preference and resolves the shared treatment.
 *
 * This subscribes to `matchMedia` directly rather than going through Framer's
 * hook, which resolves the preference once per module load: a preference that
 * changes while the app is running — including under test emulation — then
 * never reaches the surfaces.
 */
export function useFloatingSurfaceMotion(): FloatingSurfaceMotionResolution {
  return resolveFloatingSurfaceMotion(useReducedMotionPreference());
}

/**
 * The live `prefers-reduced-motion` preference.
 *
 * Shared by surfaces that are not Framer-animated — the radial library's
 * inertia among them — so there is one subscription mechanism rather than a
 * second motion store with its own drift.
 */
export function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface FloatingSurfaceMotionProps {
  readonly initial: TargetAndTransition;
  readonly animate: TargetAndTransition;
  readonly exit: TargetAndTransition;
  readonly transition: Transition;
  readonly "data-motion-preset": string;
}

/** Spreads the shared open/close treatment onto one `motion` element. */
export function floatingSurfaceMotion(
  resolution: FloatingSurfaceMotionResolution,
  origin: FloatingSurfaceOrigin = "top",
): FloatingSurfaceMotionProps {
  const { axis, sign } = ORIGIN_TRAVEL[origin];
  // `|| 0` keeps reduced motion at a plain zero rather than -0.
  const offset = resolution.travelPixels * sign || 0;
  const travel = axis === "x" ? { x: offset } : { y: offset };
  const settled = axis === "x" ? { x: 0 } : { y: 0 };
  return Object.freeze({
    initial: { opacity: 0, ...travel },
    animate: { opacity: 1, ...settled },
    exit: {
      opacity: 0,
      ...travel,
      // Applied on the first exit frame, so the surface stops taking presses
      // the moment it starts leaving rather than when it finishes.
      pointerEvents: "none",
      transition: { duration: resolution.closeSeconds, ease: FLOATING_EASE },
    },
    transition: { duration: resolution.openSeconds, ease: FLOATING_EASE },
    "data-motion-preset": resolution.reducedMotion ? "reduced" : "standard",
  });
}

const ORIGIN_TRAVEL: Readonly<
  Record<FloatingSurfaceOrigin, Readonly<{ axis: "x" | "y"; sign: number }>>
> = Object.freeze({
  top: Object.freeze({ axis: "y", sign: -1 }),
  bottom: Object.freeze({ axis: "y", sign: 1 }),
  left: Object.freeze({ axis: "x", sign: -1 }),
  right: Object.freeze({ axis: "x", sign: 1 }),
});
