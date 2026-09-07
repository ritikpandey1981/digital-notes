import { cn } from "@folio/ui";
import { Paintbrush, Pencil, PenTool, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useReducedMotionPreference } from "../../motion/floating-surface-motion";
import {
  useTransientPresentation,
  type TransientPresentation,
} from "../../motion/transient-presentation";
import type { BrushLibraryFamily } from "./brush-library-catalogue";
import {
  RADIAL_OPEN_MOTION,
  RADIAL_ROTATION_DRAG_THRESHOLD,
  RADIAL_VISIBILITY_EPSILON,
  cellCircumferentialReveal,
  combineRevealFactors,
  completeAnnulusPath,
  computeCellVisibility,
  annularSectorPath,
  buildRadialLibraryLayout,
  decayAngularVelocity,
  expandCell,
  hasSettled,
  integrateAngularMotion,
  revealFrontDegrees,
  ringAngularRevealProgress,
  ringLocalProgress,
  ringRadialExpansion,
  ringRevealOpacity,
  type RadialPresentationPhase,
  normalizeDegrees,
  pointerAngleDegrees,
  polarPoint,
  releaseVelocityDegreesPerSecond,
  shortestAngularDelta,
  shouldStartInertia,
  trimRotationSamples,
  type RadialCell,
  type RadialCenter,
  type RotationSample,
} from "./radial-brush-library-model";
import { pushDismissal } from "./floating-dismissal-stack";

interface RadialBrushLibraryProps {
  readonly open: boolean;
  /** Dock slot the library radiates from, e.g. "pencil". */
  readonly anchorSlotId: string | null;
  /**
   * The library identity the anchoring slot currently holds, or null when it
   * holds none. Null shows no selection rather than guessing at one.
   */
  readonly selectedBrushId: string | null;
  readonly onSelectBrush: (brushId: string) => void;
  readonly onDismiss: () => void;
}

/**
 * One semantic glyph per library family, matching the dock's own vocabulary.
 *
 * Deliberately coarse. Every pencil identity shares the pencil glyph and every
 * pen the nib, because a per-brush specimen would imply that forty-five
 * distinct brush behaviours exist. They do not yet: several identities share
 * one backing preset, and drawing a unique mark for each would be the wheel
 * making a promise the engine cannot keep. Names carry the distinction, through
 * the accessible name on every cell.
 */
const FAMILY_ICONS: Readonly<Record<BrushLibraryFamily, LucideIcon>> = Object.freeze({
  pencil: Pencil,
  pen: PenTool,
  marker: Paintbrush,
});

const ICON_SIZE = 22;

/**
 * One restrained neutral per ring, stepping gently outward.
 *
 * Three existing Folio surface tokens rather than new colour, forming a ladder
 * from the lightest surface to the workspace tone. Enough separation to read
 * the rings apart at a glance without drawing a grid. Family tinting is
 * deliberately not used: taxonomy does not own geometry here.
 */
const TRACK_TONES: readonly string[] = Object.freeze([
  "var(--folio-surface)",
  "var(--folio-surface-muted)",
  "var(--folio-workspace)",
]);

/**
 * Static radial Brush Library geometry.
 *
 * Layout evaluation only. The cells are dummy fixtures: nothing is selectable,
 * no brush is replaced, no preset store is touched, and no document state
 * exists here.
 *
 * The whole surface sits at z-[15]: above the canvas and the workspace chrome
 * at z-10, below the Tool Dock and Property Rail at z-20. That ordering is
 * load-bearing for the later fade phase, where cells dim as they pass behind
 * the dock — for now plain occlusion is enough, and cells passing behind the
 * dock is expected rather than a defect: the future rotation brings them round.
 */
export function RadialBrushLibrary({
  open,
  anchorSlotId,
  selectedBrushId,
  onSelectBrush,
  onDismiss,
}: RadialBrushLibraryProps) {
  const requested = open && anchorSlotId !== null;
  const presentation = useRadialPresentation(requested);
  // The axle is latched while the library is wanted, because a tool switch
  // moves the active slot in the same commit that closes the library: without
  // this the collapse would resolve into whichever slot just became active
  // rather than the one the instrument actually unfolded from.
  const [latchedSlotId, setLatchedSlotId] = useState<string | null>(null);
  if (requested && anchorSlotId !== null && anchorSlotId !== latchedSlotId) {
    setLatchedSlotId(anchorSlotId);
  }
  const slotId = requested ? anchorSlotId : latchedSlotId;
  // Presentation mount, not logical open: the surface has to outlive the
  // request long enough to collapse. It still unmounts the moment it is closed,
  // so nothing hidden is left mounted, and the rotation, velocity and measured
  // centre all reset by unmounting exactly as they did before.
  if (presentation.phase === "closed" || slotId === null) return null;
  return (
    <RadialLibrarySurface
      anchorSlotId={slotId}
      phase={presentation.phase}
      openProgress={presentation.progress}
      selectedBrushId={selectedBrushId}
      onSelectBrush={onSelectBrush}
      onDismiss={onDismiss}
    />
  );
}

/**
 * This instrument's own timing, driven by the shared presentation clock.
 *
 * The clock is deliberately not per-surface: two independent rAF loops for
 * "how far open is this" is exactly how two surfaces end up reversing
 * differently under a rapid toggle.
 */
function useRadialPresentation(requested: boolean): TransientPresentation {
  return useTransientPresentation(requested, RADIAL_OPEN_MOTION);
}

/** One in-flight rotation gesture. */
interface RotationDrag {
  readonly pointerId: number;
  /** Where the press landed, for the movement threshold. */
  readonly originX: number;
  readonly originY: number;
  /** Angle around the axle at the previous move, in the geometry's space. */
  previousAngleDegrees: number;
  /** False until the pointer has travelled far enough to mean rotation. */
  rotating: boolean;
  /** Unwrapped rotation reached so far, tracked for the release speed. */
  travelledDegrees: number;
  /** Recent movement, trimmed to the sample window on every move. */
  samples: readonly RotationSample[];
  /**
   * The identity the press landed on, and the candidate for selection.
   *
   * Cleared the moment the gesture becomes a rotation: one threshold decides
   * between turning the wheel and choosing a brush, and a drag can never also
   * be a click.
   */
  candidateBrushId: string | null;
}

/** The single coast in flight, if any. */
interface InertiaState {
  frameHandle: number | null;
  velocityDegreesPerSecond: number;
  lastFrameMs: number;
}

function RadialLibrarySurface({
  anchorSlotId,
  phase,
  openProgress,
  selectedBrushId,
  onSelectBrush,
  onDismiss,
}: {
  readonly anchorSlotId: string;
  readonly phase: RadialPresentationPhase;
  readonly openProgress: number;
  readonly selectedBrushId: string | null;
  readonly onSelectBrush: (brushId: string) => void;
  readonly onDismiss: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rotatorRef = useRef<SVGGElement | null>(null);
  const [center, setCenter] = useState<RadialCenter | null>(null);
  // One shared offset for the entire instrument. Transient UI state: it lives
  // and dies with this component, so closing the library discards it.
  const [rotationOffsetDegrees, setRotationOffsetDegrees] = useState(0);
  const dragRef = useRef<RotationDrag | null>(null);
  // Render-facing view of the mutable drag. The gesture itself remains in the
  // ref so pointer moves never wait for React; this exists only to expose the
  // lifecycle accurately to the real-window recovery tests.
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  // One velocity for one wheel. Rings never carry momentum of their own.
  const inertiaRef = useRef<InertiaState>({
    frameHandle: null,
    velocityDegreesPerSecond: 0,
    lastFrameMs: 0,
  });
  // Observable only so the coast can be asserted and reasoned about; the
  // rotation itself lives in the offset, exactly as it did before inertia.
  const [coasting, setCoasting] = useState(false);
  // The speed the last gesture released at. Reported so the physics can be
  // observed in the real window rather than inferred from where the wheel
  // happened to stop.
  const [releaseVelocity, setReleaseVelocity] = useState(0);
  const reducedMotion = useReducedMotionPreference();

  /**
   * Ends any coast immediately and discards its momentum.
   *
   * Called on release-into-a-new-drag, on unmount, and whenever the wheel has
   * slowed to a stop. There is never more than one frame handle to cancel
   * because nothing starts a second loop while this one is live.
   */
  /**
   * Drops the coast itself, touching no React state.
   *
   * Separated so effects can shut the frame loop down — which is exactly the
   * external system an effect exists to manage — without a synchronous state
   * update cascading another render on the way.
   */
  const cancelInertiaFrame = useCallback((): void => {
    const inertia = inertiaRef.current;
    if (inertia.frameHandle !== null) {
      cancelAnimationFrame(inertia.frameHandle);
      inertia.frameHandle = null;
    }
    inertia.velocityDegreesPerSecond = 0;
  }, []);

  const stopInertia = useCallback((): void => {
    cancelInertiaFrame();
    setCoasting(false);
  }, [cancelInertiaFrame]);

  /** Clears one in-flight grab without touching render-facing state. */
  const clearDragFrame = useCallback((releaseCapture: boolean): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    rootRef.current?.setAttribute("data-library-dragging", "false");
    rootRef.current?.setAttribute("data-library-pointer-id", "");
    if (!releaseCapture || drag === null) return;
    const rotator = rotatorRef.current;
    if (rotator?.hasPointerCapture(drag.pointerId) !== true) return;
    try {
      rotator.releasePointerCapture(drag.pointerId);
    } catch {
      // Ownership may have disappeared between the query and release. The
      // local drag is already clear, which is the recovery that matters.
    }
  }, []);

  /** Clears one in-flight grab without ever turning its press into a choice. */
  const cancelDrag = useCallback(
    (releaseCapture: boolean): void => {
      clearDragFrame(releaseCapture);
      setActivePointerId(null);
    },
    [clearDragFrame],
  );

  /** Drops all radial transient input state; it never selects or dismisses. */
  const cancelTransientInteraction = useCallback((): void => {
    cancelDrag(true);
    stopInertia();
    setReleaseVelocity(0);
  }, [cancelDrag, stopInertia]);

  /**
   * Coasts the wheel from a release speed until friction settles it.
   *
   * The loop exists only while the wheel is actually moving: it is started by a
   * release and cancels itself the moment the speed falls below the stop
   * threshold, so an open library at rest runs no animation at all.
   */
  const startInertia = useCallback((velocityDegreesPerSecond: number): void => {
    const inertia = inertiaRef.current;
    inertia.velocityDegreesPerSecond = velocityDegreesPerSecond;
    inertia.lastFrameMs = performance.now();
    setCoasting(true);
    const step = (frameMs: number): void => {
      const current = inertiaRef.current;
      const elapsedMs = Math.max(0, frameMs - current.lastFrameMs);
      current.lastFrameMs = frameMs;
      const advance = integrateAngularMotion(current.velocityDegreesPerSecond, elapsedMs);
      current.velocityDegreesPerSecond = decayAngularVelocity(
        current.velocityDegreesPerSecond,
        elapsedMs,
      );
      if (advance !== 0) {
        // The same shared offset the drag writes to, so the existing spatial
        // fade and every gap recompute from the coast with no special case.
        setRotationOffsetDegrees((offset) => offset + advance);
      }
      if (hasSettled(current.velocityDegreesPerSecond)) {
        current.frameHandle = null;
        current.velocityDegreesPerSecond = 0;
        setCoasting(false);
        return;
      }
      current.frameHandle = requestAnimationFrame(step);
    };
    inertia.frameHandle = requestAnimationFrame(step);
  }, []);

  // No orphan frame loops: closing the library, switching tool, or reanchoring
  // all unmount this surface, and each drops any coast still in flight.
  //
  // Momentum must not keep turning the wheel while it is collapsing either. The
  // rotation it had reached is kept rather than snapped back to zero, so the
  // instrument folds away from where the artist actually left it; a completed
  // close unmounts the surface, which is what resets rotation for next time.
  useEffect(() => {
    if (phase !== "open") {
      clearDragFrame(true);
      cancelInertiaFrame();
    }
    return () => {
      clearDragFrame(true);
      cancelInertiaFrame();
    };
  }, [cancelInertiaFrame, clearDragFrame, phase]);

  // Losing the application while a pointer is captured must not strand either
  // a drag or its RAF. This follows the canvas input system's robustness
  // principle while keeping radial state entirely local to this surface.
  useEffect(() => {
    window.addEventListener("blur", cancelTransientInteraction);
    return () => window.removeEventListener("blur", cancelTransientInteraction);
  }, [cancelTransientInteraction]);

  /**
   * The origin is measured from the selected slot itself, never assumed.
   *
   * Each of the five slots therefore produces a different vertical origin, and
   * the wheel keeps its anchor when the window resizes. The wheel is never
   * repositioned to fit the screen: the selected slot is the axle.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const workspace = root.closest<HTMLElement>('[data-testid="editor-workspace"]');
    if (workspace === null) return;
    const measure = (): void => {
      const slot = document.querySelector<HTMLElement>(`button[data-dock-slot="${anchorSlotId}"]`);
      if (slot === null) {
        setCenter(null);
        return;
      }
      const slotRect = slot.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      setCenter(
        Object.freeze({
          x: slotRect.left + slotRect.width / 2 - workspaceRect.left,
          y: slotRect.top + slotRect.height / 2 - workspaceRect.top,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [anchorSlotId]);

  /**
   * Pointer position in the same space the geometry uses.
   *
   * The root element covers the workspace exactly, so its own rect converts
   * client coordinates into the workspace coordinates the axle was measured in.
   */
  const workspacePoint = (event: ReactPointerEvent): Readonly<{ x: number; y: number }> | null => {
    const root = rootRef.current;
    if (root === null) return null;
    const rect = root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGGElement>): void => {
    if (center === null || dragRef.current !== null) return;
    const point = workspacePoint(event);
    if (point === null) return;
    // Which brush the press landed on, read from the cell the event came from.
    // Only a wheel that has finished unfolding offers a selection.
    const pressed = brushCellAt(event.target);
    // The pointer always wins. Grabbing a coasting wheel stops it dead on this
    // frame, so there is never a tug-of-war between momentum and the hand.
    stopInertia();
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      previousAngleDegrees: pointerAngleDegrees(center, point.x, point.y),
      rotating: false,
      travelledDegrees: 0,
      samples: [],
      candidateBrushId: phase === "open" ? pressed : null,
    };
    rootRef.current?.setAttribute("data-library-dragging", "true");
    rootRef.current?.setAttribute("data-library-pointer-id", String(event.pointerId));
    setActivePointerId(event.pointerId);
    // Capture on the rotating group, so the drag survives leaving the cell it
    // started on and continues over the dock, the rail, or empty workspace.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || center === null) return;
    const point = workspacePoint(event);
    if (point === null) return;
    const angle = pointerAngleDegrees(center, point.x, point.y);
    if (!drag.rotating) {
      const travelled = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
      if (travelled < RADIAL_ROTATION_DRAG_THRESHOLD) {
        // Still a possible press. Keep tracking the angle so the first rotation
        // step measures from here rather than from the original touchdown.
        drag.previousAngleDegrees = angle;
        return;
      }
      drag.rotating = true;
      // Past the threshold this is a rotation, so it is no longer a click. The
      // same 4px that starts the turn is what cancels the selection.
      drag.candidateBrushId = null;
      // The gesture only starts being measured once it is a rotation, so the
      // still moments before the threshold cannot dilute the release speed.
      drag.samples = [{ timeMs: event.timeStamp, rotationDegrees: drag.travelledDegrees }];
    }
    // Shortest signed step, so crossing the +/-180 seam never lurches a turn.
    // The same unwrapped delta feeds the velocity samples, which is what keeps
    // a flick through +179 -> -179 reading as a small step rather than a turn.
    const delta = shortestAngularDelta(drag.previousAngleDegrees, angle);
    drag.previousAngleDegrees = angle;
    drag.travelledDegrees += delta;
    drag.samples = trimRotationSamples(
      [...drag.samples, { timeMs: event.timeStamp, rotationDegrees: drag.travelledDegrees }],
      event.timeStamp,
    );
    // Accumulated without clamping: the wheel may be turned past a full turn in
    // either direction and keeps going. Direct manipulation stays exactly 1:1 —
    // nothing here smooths, lags, or scales the pointer's own movement.
    setRotationOffsetDegrees((current) => current + delta);
  };

  const endDrag = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    rootRef.current?.setAttribute("data-library-dragging", "false");
    rootRef.current?.setAttribute("data-library-pointer-id", "");
    setActivePointerId(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A press that never became a drag is a click, not a tiny fling: it selects
    // the brush it landed on and starts no momentum.
    if (!drag.rotating || event.type === "pointercancel") {
      setReleaseVelocity(0);
      if (event.type !== "pointercancel" && drag.candidateBrushId !== null) {
        onSelectBrush(drag.candidateBrushId);
      }
      return;
    }
    // Reduced motion keeps the wheel fully usable and simply stops it on
    // release, matching how the floating surfaces drop their travel.
    if (reducedMotion) {
      setReleaseVelocity(0);
      return;
    }
    const velocity = releaseVelocityDegreesPerSecond(
      trimRotationSamples(drag.samples, event.timeStamp),
    );
    setReleaseVelocity(velocity);
    if (!shouldStartInertia(velocity)) return;
    startInertia(velocity);
  };

  const handleLostPointerCapture = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    // A lost capture is cancellation, never a release: no selection and no
    // release velocity may be synthesized from an incomplete gesture.
    cancelDrag(false);
    stopInertia();
    setReleaseVelocity(0);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<SVGGElement>): void => {
    if (phase !== "open") return;
    // Enter and Space are the standard activation keys for a radio, and both
    // are handled here. Only Enter can actually arrive today: the editor binds
    // Space globally to transient viewport panning and consumes it with
    // stopImmediatePropagation, so no keydown for it reaches this surface.
    // That is the frozen viewport authority's gesture, not something to take
    // from it here; if it ever exempts these cells, this already works.
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    const brushId = brushCellAt(event.target);
    if (brushId === null) return;
    // Space would otherwise scroll the workspace out from under the wheel.
    event.preventDefault();
    onSelectBrush(brushId);
  };

  const layout =
    center === null
      ? null
      : buildRadialLibraryLayout(center, undefined, undefined, rotationOffsetDegrees);
  const interactionInnerRadius = layout?.configuration.hubRadius ?? null;
  const interactionOuterRadius = layout?.outerRadius ?? null;

  // Escape participates in the editor's existing LIFO transient-surface stack.
  // Only Escape is registered here; pointer dismissal below intentionally stays
  // non-blocking so the canvas can own the same pointerdown.
  useEffect(() => {
    if (phase !== "open") return;
    return pushDismissal(`radial-brush-library:${anchorSlotId}`, () => {
      cancelTransientInteraction();
      onDismiss();
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(`button[data-dock-slot="${anchorSlotId}"]`)
          ?.focus({ preventScroll: true });
      });
    });
  }, [anchorSlotId, cancelTransientInteraction, onDismiss, phase]);

  // Observe only true workspace presses outside the physical instrument. No
  // default prevention, propagation stop, or backdrop is involved: event
  // targeting has already chosen the canvas, and that same pointer continues
  // through its normal drawing/selection/pan path while the wheel closes.
  useEffect(() => {
    if (
      phase !== "open" ||
      center === null ||
      interactionInnerRadius === null ||
      interactionOuterRadius === null
    ) {
      return;
    }
    const observeOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-floating-surface="folio"],[data-tool-dock-layout]') !== null
      ) {
        // Foreground chrome owns its own action and closing semantics, but a
        // new physical press still takes momentum away from the wheel now.
        stopInertia();
        return;
      }
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const distance = Math.hypot(
        event.clientX - rect.left - center.x,
        event.clientY - rect.top - center.y,
      );
      const insideTracks = distance >= interactionInnerRadius && distance <= interactionOuterRadius;
      if (insideTracks) return;
      cancelTransientInteraction();
      onDismiss();
    };
    window.addEventListener("pointerdown", observeOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", observeOutsidePointer, true);
  }, [
    cancelTransientInteraction,
    center,
    interactionInnerRadius,
    interactionOuterRadius,
    onDismiss,
    phase,
    stopInertia,
  ]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-[15]"
      data-testid="radial-brush-library"
      data-library-anchor-slot={anchorSlotId}
      data-library-track-count={layout?.tracks.length ?? 0}
      data-library-center-x={layout === null ? "" : String(Math.round(layout.centerX))}
      data-library-center-y={layout === null ? "" : String(Math.round(layout.centerY))}
      data-library-rotation={rotationOffsetDegrees.toFixed(3)}
      // A wheel that is still unfolding, or already folding away, is not
      // coasting: inertia can only ever be started by releasing a drag on an
      // open instrument, and the collapse drops it on its first frame.
      data-library-coasting={phase === "open" && coasting ? "true" : "false"}
      data-library-release-velocity={releaseVelocity.toFixed(1)}
      data-library-motion-preset={reducedMotion ? "reduced" : "standard"}
      data-library-phase={phase}
      data-library-open-progress={openProgress.toFixed(3)}
      data-library-dragging={phase === "open" && activePointerId !== null ? "true" : "false"}
      data-library-pointer-id={phase === "open" ? (activePointerId ?? "") : ""}
    >
      {layout === null ? null : (
        <svg
          className="size-full overflow-visible"
          role="radiogroup"
          aria-label="Brush library"
          focusable="false"
        >
          {/*
            One rotating group for the whole instrument. Cells paint above one
            complete transparent annulus per ring, so visible gaps are physical
            wheel material without creating a rectangular canvas blocker.
          */}
          <g
            ref={rotatorRef}
            data-testid="radial-brush-library-rotator"
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={handleLostPointerCapture}
            onKeyDown={handleKeyDown}
          >
            {layout.tracks.map((track) => (
              <path
                key={`interaction-${track.index}`}
                d={completeAnnulusPath(
                  { x: layout.centerX, y: layout.centerY },
                  track.innerRadius,
                  track.outerRadius,
                )}
                fill="transparent"
                fillRule="evenodd"
                stroke="none"
                pointerEvents={phase === "open" ? "all" : "none"}
                className={phase === "open" ? "cursor-grab active:cursor-grabbing" : undefined}
                data-testid="radial-ring-interaction"
                data-ring-interaction={track.index}
                data-ring-inner-radius={track.innerRadius}
                data-ring-outer-radius={track.outerRadius}
                aria-hidden="true"
              />
            ))}
            {layout.tracks.map((track) => {
              // Two presentation dimensions per ring, both from the one shared
              // progress: how far out the ring has grown, and how far a front
              // has swept round uncovering its cells. Staging is per ring, so
              // the eye reads four rings propagating outward rather than
              // forty-five brushes being dealt.
              const local = ringLocalProgress(openProgress, track.index, layout.tracks.length);
              const expansion = ringRadialExpansion(local);
              const reveal = ringRevealOpacity(expansion);
              const angularProgress = ringAngularRevealProgress(local);
              return (
                <g
                  key={track.index}
                  data-library-track={track.index}
                  data-track-expansion={expansion.toFixed(3)}
                  data-track-reveal={reveal.toFixed(3)}
                  data-track-angular={angularProgress.toFixed(3)}
                  data-track-front={revealFrontDegrees(angularProgress).toFixed(2)}
                  data-track-cell-angle={track.cellAngleDegrees.toFixed(3)}
                  data-track-capacity={track.capacity}
                  data-track-direct-gap={
                    track.directGap === null
                      ? ""
                      : `${track.directGap.startDegrees.toFixed(2)}:${track.directGap.widthDegrees.toFixed(2)}`
                  }
                  data-track-blocked={track.blockedIntervals
                    .map((gap) => `${gap.startDegrees.toFixed(2)}:${gap.widthDegrees.toFixed(2)}`)
                    .join(" ")}
                  data-track-allowed={track.allowedArcs
                    .map((arc) => `${arc.startDegrees.toFixed(2)}:${arc.widthDegrees.toFixed(2)}`)
                    .join(" ")}
                >
                  {track.cells.map((cell) => (
                    <BrushCell
                      key={cell.brush.id}
                      center={{ x: layout.centerX, y: layout.centerY }}
                      cell={cell}
                      expansion={expansion}
                      reveal={reveal}
                      angularProgress={angularProgress}
                      interactive={phase === "open"}
                      selected={cell.brush.id === selectedBrushId}
                      tone={TRACK_TONES[track.index % TRACK_TONES.length] ?? TRACK_TONES[0]!}
                    />
                  ))}
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * The brush under an event target.
 *
 * Every catalogue entry fits every slot: a drawing slot is a stable position
 * that owns preferences, and family is a property of the brush it happens to
 * hold, so there is nothing here to refuse.
 */
function brushCellAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest("[data-brush-item]")?.getAttribute("data-brush-item") ?? null;
}

function BrushCell({
  center,
  cell,
  expansion,
  reveal,
  angularProgress,
  interactive,
  selected,
  tone,
}: {
  readonly center: RadialCenter;
  readonly cell: RadialCell;
  /** How far this cell's ring has unfolded, 0 at the hub to 1 in place. */
  readonly expansion: number;
  /** Secondary reveal opacity supporting the ring's arrival. */
  readonly reveal: number;
  /** How far the ring's reveal front has swept, 0 to 1. */
  readonly angularProgress: number;
  readonly interactive: boolean;
  /** True when the anchoring slot currently holds this identity. */
  readonly selected: boolean;
  readonly tone: string;
}) {
  // One animated geometry drives the surface, the seam and the glyph together,
  // so nothing detaches from its cell while the ring travels.
  const drawn = expandCell(cell, expansion);
  const iconMid = polarPoint(center, drawn.midRadius, drawn.midAngleDegrees);
  const Icon = FAMILY_ICONS[cell.brush.family];
  // Opacity on the group, so surface, seam, icon and hover tint all fade as one
  // object rather than the glyph floating at full strength over a ghost cell.
  //
  // Three independent ideas, multiplied rather than merged: where the cell is
  // relative to the dock aperture, how established its ring currently is, and
  // how far the sweep has uncovered this particular cell. The spatial term
  // knows nothing about time, the ring term nothing about angle, and the
  // circumferential term nothing about radius.
  const visibility = computeCellVisibility(cell);
  const circumferential = cellCircumferentialReveal(cell.midAngleDegrees, angularProgress);
  const opacity = combineRevealFactors(visibility, reveal, circumferential);
  // A cell hidden behind the dock must not quietly collect presses, and a wheel
  // still unfolding is not yet an instrument to grab.
  // Every visible cell on a settled wheel both turns the instrument and offers
  // itself for selection. Only visibility and the presentation phase gate that.
  const hidden = visibility <= RADIAL_VISIBILITY_EPSILON || !interactive;
  return (
    <g
      // Spatial opacity, recomputed from the cell's current angle on every
      // render. Deliberately no CSS transition: the fade has to stay locked to
      // the pointer rather than trailing it, and the smoothstep band already
      // supplies the softness.
      opacity={opacity}
      // grab/grabbing communicates the affordance on fine pointers; touch and
      // stylus rely on the physical radial form instead. A cell hidden behind
      // the dock stops taking input rather than collecting presses invisibly.
      // `outline-none` unconditionally, on the hidden branch too. Chromium's
      // default focus ring here is a 4.8px orange rectangle drawn around the
      // element's bounding box, which is doubly wrong for an annular cell: the
      // wrong shape, and a colour from outside Folio's palette. Leaving the
      // suppression on the visible branch alone would let it reappear the
      // moment rotation carried a focused cell behind the dock — a rectangle
      // floating over empty workspace. The Folio treatment is drawn on the
      // cell's own path instead, so it follows the real geometry.
      className={
        hidden
          ? "group pointer-events-none outline-none"
          : "group pointer-events-auto cursor-grab outline-none active:cursor-grabbing"
      }
      role="radio"
      aria-checked={selected}
      // Focusable only while the wheel is a usable instrument, so a collapsed,
      // unfolding or hidden cell never becomes a tab stop.
      tabIndex={hidden ? -1 : 0}
      data-brush-visibility={visibility.toFixed(3)}
      data-brush-circumferential={circumferential.toFixed(3)}
      data-brush-opacity={opacity.toFixed(3)}
      data-brush-selected={selected ? "true" : "false"}
      data-brush-item={cell.brush.id}
      data-brush-family={cell.brush.family}
      // The real preset backing this identity today. Reported so the
      // provisional mapping is observable rather than an unverifiable claim.
      data-brush-fallback-preset={cell.brush.fallbackPresetId}
      data-brush-track={cell.trackIndex}
      data-brush-index={cell.catalogueIndex}
      data-brush-arc-length={cell.arcLength.toFixed(2)}
      data-brush-inner-radius={drawn.innerRadius.toFixed(2)}
      data-brush-outer-radius={drawn.outerRadius.toFixed(2)}
      data-brush-cell-angle={cell.cellAngleDegrees.toFixed(3)}
      data-brush-start-angle={normalizeDegrees(cell.startAngleDegrees).toFixed(3)}
      data-brush-end-angle={cell.endAngleDegrees.toFixed(3)}
      aria-label={cell.brush.name}
    >
      {/*
        No <title>: the browser's own SVG tooltip is unpositionable, and on the
        dock side of the wheel it surfaced over the Property Rail and blocked
        it. The name is carried by `aria-label`, which screen readers announce
        and which the tooltip was only ever duplicating.
      */}
      <path
        d={annularSectorPath(center, drawn)}
        data-brush-cell={cell.brush.id}
        fill={selected ? "var(--folio-accent-soft)" : tone}
        // A hairline seam rather than a grid line: the instruments should read
        // before the lattice does. The selected cell is stated by a slightly
        // firmer accent seam over a faint accent surface — enough to find at a
        // glance, restrained enough that the wheel stays calm. It inherits the
        // group's opacity like everything else, so a selected cell behind the
        // dock fades away exactly as its neighbours do.
        // Keyboard focus is drawn on this same arc rather than as a box, so the
        // indicator keeps the curved physical geometry of the control. It is a
        // firmer accent seam than selection uses, and it lives inside the cell
        // group, so it fades with the cell rather than hanging in empty space
        // once rotation carries that cell behind the dock.
        //
        // Driven by the browser's own `:focus-visible` on the focusable group,
        // not by a React flag: the modality decision is the browser's, and
        // reading it inside `onFocus` races the decision itself. A pointer
        // press therefore focuses the cell without raising this indicator.
        className={cn(
          "transition-[fill] duration-100",
          selected
            ? "stroke-[var(--folio-accent)] stroke-[1.2]"
            : "stroke-[var(--folio-border)] stroke-[0.6] hover:fill-[var(--folio-accent-soft)]",
          "group-focus-visible:stroke-[var(--folio-accent)] group-focus-visible:stroke-[2.2]",
        )}
      />
      {/*
        Positioned, never rotated. A glyph carried around the circle would sit
        upside-down through the lower half; the cell follows the arc, the
        instrument stays legible.
      */}
      <g
        transform={`translate(${iconMid.x - ICON_SIZE / 2} ${iconMid.y - ICON_SIZE / 2})`}
        className="pointer-events-none"
      >
        <Icon
          width={ICON_SIZE}
          height={ICON_SIZE}
          strokeWidth={selected ? 1.9 : 1.6}
          className={selected ? "text-[var(--folio-accent)]" : "text-[var(--folio-icon-neutral)]"}
          aria-hidden="true"
        />
      </g>
    </g>
  );
}
