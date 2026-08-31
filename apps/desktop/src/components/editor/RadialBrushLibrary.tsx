import { Paintbrush, Pencil, PenTool, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useReducedMotionPreference } from "../../motion/floating-surface-motion";
import type { BrushFixtureFamily } from "./brush-library-fixtures";
import {
  RADIAL_ROTATION_DRAG_THRESHOLD,
  RADIAL_VISIBILITY_EPSILON,
  computeCellVisibility,
  annularSectorPath,
  buildRadialLibraryLayout,
  decayAngularVelocity,
  hasSettled,
  integrateAngularMotion,
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

interface RadialBrushLibraryProps {
  readonly open: boolean;
  /** Dock slot the library radiates from, e.g. "pencil". */
  readonly anchorSlotId: string | null;
}

/**
 * One semantic glyph per library family.
 *
 * Deliberately coarse: every pencil fixture shares the pencil glyph, every pen
 * the nib, every colour brush the brush. This phase is judging geometry, and a
 * per-brush specimen both implied engine behaviour that does not exist and made
 * the wheel read as noise. Names stay available through `aria-label` and the
 * native SVG tooltip.
 */
const FAMILY_ICONS: Readonly<Record<BrushFixtureFamily, LucideIcon>> = Object.freeze({
  pencil: Pencil,
  pen: PenTool,
  "color-brush": Paintbrush,
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
export function RadialBrushLibrary({ open, anchorSlotId }: RadialBrushLibraryProps) {
  // The surface mounts only while the library is open, so its measured centre
  // resets by unmounting rather than by an effect.
  if (!open || anchorSlotId === null) return null;
  return <RadialLibrarySurface anchorSlotId={anchorSlotId} />;
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
}

/** The single coast in flight, if any. */
interface InertiaState {
  frameHandle: number | null;
  velocityDegreesPerSecond: number;
  lastFrameMs: number;
}

function RadialLibrarySurface({ anchorSlotId }: { readonly anchorSlotId: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [center, setCenter] = useState<RadialCenter | null>(null);
  // One shared offset for the entire instrument. Transient UI state: it lives
  // and dies with this component, so closing the library discards it.
  const [rotationOffsetDegrees, setRotationOffsetDegrees] = useState(0);
  const dragRef = useRef<RotationDrag | null>(null);
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
  const stopInertia = useCallback((): void => {
    const inertia = inertiaRef.current;
    if (inertia.frameHandle !== null) {
      cancelAnimationFrame(inertia.frameHandle);
      inertia.frameHandle = null;
    }
    inertia.velocityDegreesPerSecond = 0;
    setCoasting(false);
  }, []);

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
  useEffect(() => stopInertia, [stopInertia]);

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
    };
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A press that never became a drag is a click, not a tiny fling. It stays
    // available for the later brush selection and starts nothing here.
    if (!drag.rotating || event.type === "pointercancel") {
      setReleaseVelocity(0);
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

  const layout =
    center === null
      ? null
      : buildRadialLibraryLayout(center, undefined, undefined, rotationOffsetDegrees);
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
      data-library-coasting={coasting ? "true" : "false"}
      data-library-release-velocity={releaseVelocity.toFixed(1)}
      data-library-motion-preset={reducedMotion ? "reduced" : "standard"}
    >
      {layout === null ? null : (
        <svg
          className="size-full overflow-visible"
          role="group"
          aria-label="Brush library layout preview"
          focusable="false"
        >
          {/*
            One rotating group for the whole instrument. Pointer events bubble
            here from the cells themselves, so the wheel is grabbed by its
            brushes: no invisible rectangle is laid over the canvas, and nothing
            outside the library intercepts input.
          */}
          <g
            data-testid="radial-brush-library-rotator"
            style={{ touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {layout.tracks.map((track) => (
              <g
                key={track.index}
                data-library-track={track.index}
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
                    key={cell.fixture.id}
                    center={{ x: layout.centerX, y: layout.centerY }}
                    cell={cell}
                    tone={TRACK_TONES[track.index % TRACK_TONES.length] ?? TRACK_TONES[0]!}
                  />
                ))}
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}

function BrushCell({
  center,
  cell,
  tone,
}: {
  readonly center: RadialCenter;
  readonly cell: RadialCell;
  readonly tone: string;
}) {
  const iconMid = polarPoint(center, cell.midRadius, cell.midAngleDegrees);
  const Icon = FAMILY_ICONS[cell.fixture.family];
  // Opacity on the group, so surface, seam, icon and hover tint all fade as one
  // object rather than the glyph floating at full strength over a ghost cell.
  const visibility = computeCellVisibility(cell);
  // A cell hidden behind the dock must not quietly collect presses.
  const hidden = visibility <= RADIAL_VISIBILITY_EPSILON;
  return (
    <g
      // Spatial opacity, recomputed from the cell's current angle on every
      // render. Deliberately no CSS transition: the fade has to stay locked to
      // the pointer rather than trailing it, and the smoothstep band already
      // supplies the softness.
      opacity={visibility}
      // grab/grabbing communicates the affordance on fine pointers; touch and
      // stylus rely on the physical radial form instead. A cell hidden behind
      // the dock stops taking input rather than collecting presses invisibly.
      className={
        hidden
          ? "pointer-events-none"
          : "pointer-events-auto cursor-grab focus:outline-none active:cursor-grabbing"
      }
      data-brush-visibility={visibility.toFixed(3)}
      data-brush-item={cell.fixture.id}
      data-brush-family={cell.fixture.family}
      data-brush-track={cell.trackIndex}
      data-brush-index={cell.catalogueIndex}
      data-brush-arc-length={cell.arcLength.toFixed(2)}
      data-brush-inner-radius={cell.innerRadius}
      data-brush-outer-radius={cell.outerRadius}
      data-brush-cell-angle={cell.cellAngleDegrees.toFixed(3)}
      data-brush-start-angle={normalizeDegrees(cell.startAngleDegrees).toFixed(3)}
      data-brush-end-angle={cell.endAngleDegrees.toFixed(3)}
      aria-label={cell.fixture.name}
    >
      <title>{cell.fixture.name}</title>
      <path
        d={annularSectorPath(center, cell)}
        data-brush-cell={cell.fixture.id}
        fill={tone}
        // A hairline seam rather than a grid line: the instruments should read
        // before the lattice does. Hover is the only state this phase carries.
        className="stroke-[var(--folio-border)] stroke-[0.6] transition-[fill] duration-100 hover:fill-[var(--folio-accent-soft)]"
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
          strokeWidth={1.6}
          className="text-[var(--folio-icon-neutral)]"
          aria-hidden="true"
        />
      </g>
    </g>
  );
}
