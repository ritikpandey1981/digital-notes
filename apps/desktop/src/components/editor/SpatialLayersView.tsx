import {
  renderPageLayerPreview,
  renderPagePaperPreview,
  type LayerActions,
  type LayersSnapshot,
  type Page,
} from "@folio/editor";
import { cn } from "@folio/ui";
import {
  Eye,
  EyeOff,
  GripVertical,
  Layers3,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Rows3,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReducedMotionPreference } from "../../motion/floating-surface-motion";
import { useSettlingValue } from "../../motion/settling-value";
import { useTransientPresentation } from "../../motion/transient-presentation";
import { ContinuousSlider } from "./ContinuousSlider";
import { pushDismissal } from "./floating-dismissal-stack";
import {
  describeDeletedLayer,
  LAYER_DRAG_THRESHOLD,
  moveTargetIndex,
  normalizeLayerName,
  resolveLayerDragMove,
} from "./layers-panel-model";
import {
  canReorderLayers,
  clampReorderExposure,
  REORDER_EDGE,
  REORDER_LIFT_DEPTH,
  reorderExposureExhausted,
  resolveReorderEdgeZone,
  resolveReorderSlots,
  resolveSpatialDropIndex,
  type ReorderEdge,
} from "./spatial-layer-reorder-model";
import {
  controlsInteractive,
  resolveDisclosureShift,
  resolveDisclosureSide,
  resolveSpatialControls,
  sheetShowsControls,
  SPATIAL_CONTROL_METRICS,
  SPATIAL_CONTROL_ROW_WIDTH,
  type SpatialControlState,
} from "./spatial-layer-controls-model";
import { ToolTooltip } from "./ToolTooltip";
import {
  accumulateWheelNavigation,
  computeFocusedStackOffset,
  computeSpatialLayerStackFrame,
  computeSheetEmphasis,
  computeSpatialLayerStackLayout,
  EMPTY_WHEEL_NAVIGATION,
  projectSheetCorner,
  SPATIAL_STACK_MOTION,
  SPATIAL_STACK_NAVIGATION,
  type SpatialStackLayout,
  type SpatialStackPlane,
} from "./spatial-layer-stack-model";

interface SpatialLayersViewProps {
  readonly open: boolean;
  /** The live active page. Planes read straight from it; nothing is copied. */
  readonly page: Page | null;
  readonly snapshot: LayersSnapshot;
  /** Bumped by the workspace on every committed document change. */
  readonly revision: number;
  /**
   * The one Layer mutation surface, shared with the list presentation.
   *
   * The stack is a second presentation of the same model: it owns no layer
   * commands of its own, no opacity transaction of its own, and no copy of any
   * layer field. Everything it can do, the list can already do.
   */
  readonly actions: LayerActions | null;
  readonly onActivateLayer: (layerId: string) => void;
  readonly onShowList: () => void;
  readonly onDismiss: () => void;
  readonly onNotify: (message: string) => void;
}

/** One in-flight reorder gesture, in display order. Never document state. */
interface SpatialReorderDrag {
  readonly layerId: string;
  readonly fromDisplayIndex: number;
  /** Candidate gap: 0 is above the top sheet, `layerCount` is below the last. */
  readonly insertDisplayIndex: number;
  /** How far the held sheet has travelled from its resting position. */
  readonly pointerDeltaY: number;
  /**
   * Layers of arrangement slid under the held sheet by edge dwell.
   *
   * Presentation only, and transient: it exposes a different neighbourhood of
   * the same canonical order so destinations the window cannot show become
   * reachable. It is not a second focus authority -- the active layer is still
   * the one being held -- and it disappears with the gesture.
   */
  readonly exposure: number;
}

/** Chrome the stack must stay clear of: dock plus property rail, and the utility rail. */
const WORKSPACE_INSET = Object.freeze({ left: 128, right: 96, top: 24, bottom: 24 });

/**
 * Width reserved beside the sheets for their upright labels.
 *
 * Labels hang off the right edge of a plane, so the plane has to be sized
 * against the space that is left after them -- otherwise a wider stack pushes
 * its own labels under the utility rail.
 */
const LABEL_COLUMN = 132;

/** Clear air between a sheet's projected edge and its label. */
const LABEL_GAP = 12;

/** Preview backing store is capped: a plane is never shown at document resolution. */
const MAXIMUM_PREVIEW_PIXEL_RATIO = 2;

/**
 * The exploded Layers stack.
 *
 * Every plane is a real canvas painted by the production preview renderers, so
 * what the artist sees here is the same artwork the canvas draws. Layer planes
 * are transparent; the page's paper is its own base sheet underneath, because
 * paper is Page state and never a Layer.
 *
 * The spatial arrangement is presentation only. Nothing in this component
 * mutates a PageObject, a Layer, the ObjectCollection, page geometry or the
 * viewport. The single document-adjacent thing it can do is select the active
 * Layer, which is editor session state and creates no History.
 *
 * 3D is deliberately *not* a shared scene. Each plane carries its own
 * `perspective()` and is ordered by an explicit `z-index` from the layout
 * model, so paint order is decided by Folio rather than by the browser's
 * `preserve-3d` sorting.
 */
export function SpatialLayersView({
  open,
  page,
  snapshot,
  revision,
  actions,
  onActivateLayer,
  onShowList,
  onDismiss,
  onNotify,
}: SpatialLayersViewProps) {
  const boundsRef = useRef<HTMLDivElement | null>(null);
  const paperCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerCanvases = useRef(new Map<string, HTMLCanvasElement>());
  /**
   * Ephemeral disclosure state, keyed by layer exactly as the list keeps it.
   *
   * Neither holds document truth -- no name, no opacity value -- so there is
   * nothing here that can disagree with the snapshot. Storing the layer id
   * rather than a boolean is what makes navigating away close them: the derived
   * flags below simply stop matching, with no effect to run and no moment where
   * the previous sheet's disclosure is still showing on the new one.
   */
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [opacityLayerId, setOpacityLayerId] = useState<string | null>(null);
  /**
   * One reorder gesture in flight. Presentation only until it is dropped.
   *
   * Holding a candidate index rather than mutating as the pointer crosses each
   * sheet is what keeps a drag past five layers to one command: the document is
   * untouched until the drop resolves.
   */
  const [drag, setDrag] = useState<SpatialReorderDrag | null>(null);
  /** The single resolution path, so Escape and teardown end the same gesture. */
  const cancelDragRef = useRef<(() => void) | null>(null);
  /**
   * The live arrangement, for the window-level drag listeners.
   *
   * They outlive the render that installed them, and a stale layout would judge
   * the pointer against sheets that have since moved. Written on every render
   * below, read only inside the gesture.
   */
  const layoutRef = useRef<{
    layout: SpatialStackLayout;
    planes: readonly SpatialStackPlane[];
    tiltDegrees: number;
    offset: number;
  } | null>(null);
  // Only ever open on the sheet that is actually focused.
  const renaming = renamingLayerId !== null && renamingLayerId === snapshot.activeLayerId;
  const opacityOpen = opacityLayerId !== null && opacityLayerId === snapshot.activeLayerId;
  const [bounds, setBounds] = useState<Readonly<{ width: number; height: number }>>({
    width: 0,
    height: 0,
  });
  const wheelRef = useRef(EMPTY_WHEEL_NAVIGATION);

  // One authoritative transition state for the whole stack, shared with the
  // Radial Brush Library. Every sheet reads its position from this single
  // value, so a reversal changes one direction of travel rather than unwinding
  // a set of per-sheet timers.
  const presentation = useTransientPresentation(open, SPATIAL_STACK_MOTION);
  // Edge-dwell reorder is functional, not decoration: reduced motion drops the
  // neighbour transition but must never remove access to a destination.
  const reducedMotion = useReducedMotionPreference();
  // Presentation mount, not logical open: the sheets have to outlive the
  // request long enough to come back together.
  const mounted = presentation.phase !== "closed";

  const layers = snapshot.layers;
  const layerCount = layers.length;
  // Display order is top-first; canonical storage runs bottom to top.
  const displayLayers = useMemo(() => [...layers].reverse(), [layers]);

  const layout = useMemo(
    () =>
      computeSpatialLayerStackLayout({
        pageWidth: page?.geometry.width ?? 1,
        pageHeight: page?.geometry.height ?? 1,
        workspaceWidth: Math.max(0, bounds.width - LABEL_COLUMN),
        workspaceHeight: bounds.height,
        layerCount: Math.max(1, layerCount),
      }),
    [bounds.height, bounds.width, layerCount, page?.geometry.height, page?.geometry.width],
  );

  useLayoutEffect(() => {
    const element = boundsRef.current;
    if (!mounted || element === null) return;
    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      setBounds((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);

  /**
   * Escape unwinds the innermost thing first, then closes the stack.
   *
   * One registration on the editor's existing LIFO stack, not a second global
   * key listener: the opacity disclosure is transient state owned by this
   * surface, so this surface resolves it before giving the key up. Rename
   * resolves nearer still -- its input cancels the key itself, which the shared
   * handler already respects -- so it never reaches here.
   */
  const handleEscape = useCallback((): void => {
    // A live drag is the innermost transient state, so it unwinds first and
    // leaves the order exactly as it was -- the same precedence the list uses.
    if (cancelDragRef.current !== null) {
      cancelDragRef.current();
      return;
    }
    if (renaming) {
      setRenamingLayerId(null);
      return;
    }
    if (opacityOpen) {
      actions?.cancelLayerOpacityEdit();
      setOpacityLayerId(null);
      return;
    }
    onDismiss();
  }, [actions, onDismiss, opacityOpen, renaming]);

  useEffect(() => {
    if (!open) return;
    return pushDismissal("spatial-layers-stack", handleEscape);
  }, [handleEscape, open]);

  /**
   * An open opacity disclosure always owns a live transaction boundary.
   *
   * The cleanup is the single place every ending resolves through: closing the
   * disclosure, navigating to another sheet, deleting the layer being adjusted,
   * closing the stack, or unmounting the view. Committing rather than
   * cancelling matches the list, where putting the disclosure away keeps the
   * value the artist dialled in, and `commit` is idempotent -- it returns null
   * when no edit is live, so an ending that carries no transaction costs
   * nothing. Without this, a stack closed mid-adjustment would leave a preview
   * document installed with no owner left to resolve it.
   */
  useEffect(() => {
    if (opacityLayerId === null) return;
    return () => {
      actions?.commitLayerOpacityEdit();
    };
  }, [actions, opacityLayerId]);

  /**
   * Transient control state is discarded the moment it stops being current.
   *
   * Two endings, one adjustment, made during render rather than in an effect --
   * the same shape the list panel uses. Clearing the id is what runs the
   * cleanup above, so this is also how the opacity transaction resolves.
   *
   * The second condition matters as much as the first: hiding the disclosure
   * because the derived flag stopped matching would leave the id still pointing
   * at the previous sheet, and an interrupted transaction would then sit
   * unresolved until something happened to reopen it.
   */
  const staleControlState =
    renamingLayerId !== snapshot.activeLayerId || opacityLayerId !== snapshot.activeLayerId;
  if ((!open || staleControlState) && (renamingLayerId !== null || opacityLayerId !== null)) {
    if (renamingLayerId !== null && (!open || renamingLayerId !== snapshot.activeLayerId)) {
      setRenamingLayerId(null);
    }
    if (opacityLayerId !== null && (!open || opacityLayerId !== snapshot.activeLayerId)) {
      setOpacityLayerId(null);
    }
  }

  // Focus returns to the Layers trigger, matching the Radial Library.
  useEffect(() => {
    if (!open) return;
    return () => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="layers-toggle"]')
          ?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  /**
   * The focused Layer is the active Layer. There is no second selection.
   *
   * Two pieces of state here would be two things that can disagree, and the
   * disagreement is exactly the confusing case: one sheet sitting in the focus
   * position while a different one wears the accent. Deriving focus from the
   * session's active Layer makes that state unrepresentable, and it means an
   * activation from anywhere -- a press, a key, the wheel, or something outside
   * this view entirely -- moves the stack through the same path.
   *
   * Derived rather than corrected in an effect, so deleting the focused Layer
   * cannot leave the roving tab stop pointing past the end for a render.
   */
  const focusedIndex = Math.max(
    0,
    displayLayers.findIndex((layer) => layer.id === snapshot.activeLayerId),
  );

  /**
   * How far the arrangement is offset to hold the focused sheet in place.
   *
   * The stack navigates rather than scrolls: this offset is computed from the
   * focused Layer, not read back from a scroll container, so there is one
   * authority for where the arrangement sits and no arbitrary in-between
   * positions to settle out of.
   */
  const targetOffset = computeFocusedStackOffset({
    layout,
    focusedVisualIndex: focusedIndex,
    viewportHeight: bounds.height,
  });
  const offset = useSettlingValue(targetOffset, SPATIAL_STACK_NAVIGATION.settleTimeConstantMs);

  const paintPlane = useCallback(
    (
      canvas: HTMLCanvasElement | null,
      paint: (context: CanvasRenderingContext2D) => void,
    ): void => {
      if (canvas === null || layout.planeWidth <= 0 || layout.planeHeight <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, MAXIMUM_PREVIEW_PIXEL_RATIO);
      const width = Math.max(1, Math.round(layout.planeWidth * ratio));
      const height = Math.max(1, Math.round(layout.planeHeight * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(context);
    },
    [layout.planeHeight, layout.planeWidth],
  );

  // Every plane repaints from current state whenever the document, the page or
  // the geometry changes. No snapshot is cached, so Undo and Redo stay truthful.
  useLayoutEffect(() => {
    if (!mounted || page === null) return;
    const size = { width: layout.planeWidth, height: layout.planeHeight };
    const theme = {
      pageLineColor:
        getComputedStyle(document.documentElement).getPropertyValue("--folio-border").trim() ||
        "#d8d5cf",
    };
    paintPlane(paperCanvasRef.current, (context) =>
      renderPagePaperPreview(context, page, size, theme),
    );
    for (const layer of layers) {
      paintPlane(layerCanvases.current.get(layer.id) ?? null, (context) =>
        renderPageLayerPreview(context, page, layer.id, size),
      );
    }
  }, [layers, layout.planeHeight, layout.planeWidth, mounted, page, paintPlane, revision]);

  /**
   * The one way a Layer is brought into focus.
   *
   * The wheel, a press, the keyboard and anything that changes the active Layer
   * from outside all come through here, so there is a single description of
   * what focusing means: the Layer becomes active, the arrangement moves it
   * into the focus zone, and keyboard focus follows it. Session state only --
   * activation creates no History and nothing here touches the document, the
   * page, or the canvas viewport.
   */
  const focusLayer = useCallback(
    (visualIndex: number): void => {
      const target = displayLayers[Math.min(Math.max(visualIndex, 0), displayLayers.length - 1)];
      if (target === undefined) return;
      // The offset follows the active Layer, so activation is the whole move.
      // Re-activating the focused Layer would be a no-op the stack should not
      // re-animate through.
      if (target.id !== snapshot.activeLayerId) onActivateLayer(target.id);
      boundsRef.current
        ?.querySelector<HTMLButtonElement>(`[data-layer-plane="${target.id}"]`)
        ?.focus({ preventScroll: true });
    },
    [displayLayers, onActivateLayer, snapshot.activeLayerId],
  );

  /**
   * One reorder gesture, owned from the threshold until it is resolved.
   *
   * Pointer capture goes to the grip, not to a sheet: the artwork is not a drag
   * handle, so activation, the contextual controls and wheel navigation each
   * keep their own press. Window listeners rather than React handlers because
   * the pointer routinely leaves the small grip it started on.
   *
   * `finish` is the single exit. It removes the listeners, releases the
   * capture, clears the transient arrangement, and only then decides whether
   * anything happened -- so Escape, a lost capture, a blur, a closing stack and
   * an unmount all resolve through the same path exactly once.
   */
  const beginReorder = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, fromDisplayIndex: number, layerId: string) => {
      if (event.button !== 0 || !canReorderLayers(displayLayers.length)) return;
      event.preventDefault();
      // The grip sits inside the control cluster; a press on it is never also a
      // press on the sheet behind it or the buttons beside it.
      event.stopPropagation();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const originY = event.clientY;
      let started = false;
      let insertDisplayIndex = fromDisplayIndex;
      let resolved = false;
      // Transient exposure: how many layers of arrangement have been slid under
      // the held sheet. Presentation only; the document never sees it.
      let exposure = 0;
      let pointerY = originY;
      let edge: ReorderEdge = null;
      let edgeTimer: number | null = null;

      /** One owner for every edge timer, so no dwell can outlive the gesture. */
      const stopEdgeTimer = (): void => {
        if (edgeTimer !== null) {
          window.clearTimeout(edgeTimer);
          edgeTimer = null;
        }
      };

      const publish = (): void => {
        setDrag({
          layerId,
          fromDisplayIndex,
          insertDisplayIndex,
          pointerDeltaY: pointerY - originY,
          exposure,
        });
      };

      /**
       * Re-resolves the candidate against the arrangement as it stands now.
       *
       * The same insertion algorithm as an ordinary move -- exposure changes
       * which neighbourhood the pointer is measured against, never how the
       * measurement is made.
       */
      const resolveCandidate = (): void => {
        const bounds = boundsRef.current?.getBoundingClientRect();
        const live = layoutRef.current;
        if (bounds === undefined || live === null) return;
        insertDisplayIndex = resolveSpatialDropIndex(
          pointerY - bounds.top,
          live.layout,
          live.planes,
          live.tiltDegrees,
          live.offset + exposure * live.layout.gap,
        );
      };

      /**
       * One layer of arrangement slides under the held sheet.
       *
       * The sheet itself does not move: its position is compensated by the same
       * exposure, so what travels is the stack. Holding at the end of the stack
       * stops the timer rather than churning against a clamp.
       */
      const stepEdge = (direction: Exclude<ReorderEdge, null>): void => {
        const count = displayLayers.length;
        if (reorderExposureExhausted(exposure, direction, fromDisplayIndex, count)) {
          stopEdgeTimer();
          return;
        }
        exposure = clampReorderExposure(
          exposure + (direction === "down" ? 1 : -1),
          fromDisplayIndex,
          count,
        );
        resolveCandidate();
        publish();
        edgeTimer = window.setTimeout(() => stepEdge(direction), REORDER_EDGE.repeatMs);
      };

      /**
       * Starts, keeps or cancels the dwell as the pointer enters and leaves.
       *
       * A direction change is a new decision, not a continuation: banked dwell
       * time is dropped, mirroring the reversal rule wheel navigation already
       * follows. Leaving for the middle stops the traversal but keeps whatever
       * neighbourhood it exposed, so the artist can auto-navigate and then aim.
       */
      const updateEdge = (): void => {
        const bounds = boundsRef.current?.getBoundingClientRect();
        const next =
          bounds === undefined ? null : resolveReorderEdgeZone(pointerY, bounds.top, bounds.bottom);
        if (next === edge) return;
        edge = next;
        stopEdgeTimer();
        if (next === null) return;
        edgeTimer = window.setTimeout(() => stepEdge(next), REORDER_EDGE.firstDwellMs);
      };

      const finish = (commit: boolean): void => {
        if (resolved) return;
        resolved = true;
        stopEdgeTimer();
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        window.removeEventListener("blur", handleBlur);
        cancelDragRef.current = null;
        setDrag(null);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          // The browser may already have released it.
        }
        if (!commit || !started) return;
        const move = resolveLayerDragMove(
          fromDisplayIndex,
          insertDisplayIndex,
          displayLayers.length,
        );
        // A drop back where it started stops here rather than relying on the
        // command layer to notice nothing changed: no command, no History.
        if (move.changed) actions?.moveLayer(layerId, move.targetStorageIndex);
      };

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return;
        pointerY = moveEvent.clientY;
        if (!started) {
          // The same travel the list requires, so a steady hand pressing the
          // grip never reorders by accident. No edge timer may run before this:
          // a press that never became a drag must not move the arrangement.
          if (Math.abs(pointerY - originY) < LAYER_DRAG_THRESHOLD) return;
          started = true;
        }
        resolveCandidate();
        updateEdge();
        publish();
      };
      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return;
        finish(true);
      };
      const handleCancel = (cancelEvent: PointerEvent): void => {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(false);
      };
      // A window that loses focus mid-gesture never receives the pointerup, so
      // the drag would otherwise be stranded holding a sheet.
      const handleBlur = (): void => finish(false);

      handle.setPointerCapture(pointerId);
      cancelDragRef.current = () => finish(false);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      window.addEventListener("blur", handleBlur);
    },
    [actions, displayLayers.length],
  );

  // Closing the stack, switching to the list, changing page and unmounting all
  // arrive here as the surface going away. The gesture is cancelled, never
  // committed: a drop is something the artist does, not something a teardown
  // decides on their behalf.
  useEffect(() => {
    if (open) return;
    cancelDragRef.current?.();
  }, [open]);
  useEffect(() => () => cancelDragRef.current?.(), []);

  /**
   * Keyboard reorder, using the list's own modifier and its own move resolver.
   *
   * Alt with the arrows moves the layer; the bare arrows keep navigating focus.
   * Inventing a second shortcut for the same action in a second view is how two
   * presentations of one model start to feel like two products.
   */
  const reorderFocusedLayer = useCallback(
    (direction: "up" | "down"): void => {
      const layer = displayLayers[focusedIndex];
      if (layer === undefined || !canReorderLayers(displayLayers.length)) return;
      // Display runs top-first and storage runs bottom-to-top, so "up the
      // arrangement" is a higher storage index -- mirrored once, by the list's
      // resolver rather than by hand.
      const storageIndex = displayLayers.length - 1 - focusedIndex;
      const target = moveTargetIndex({ storageIndex }, direction, displayLayers.length);
      if (target === null) return;
      actions?.moveLayer(layer.id, target);
    },
    [actions, displayLayers, focusedIndex],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const last = displayLayers.length - 1;
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        reorderFocusedLayer(event.key === "ArrowUp" ? "up" : "down");
        return;
      }
      const next =
        event.key === "ArrowUp"
          ? focusedIndex - 1
          : event.key === "ArrowDown"
            ? focusedIndex + 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : null;
      if (next === null) return;
      event.preventDefault();
      focusLayer(next);
    },
    [displayLayers.length, focusLayer, focusedIndex, reorderFocusedLayer],
  );

  /**
   * Wheel and trackpad navigate between sheets rather than scrolling.
   *
   * The accumulator lives in the model, so what a gesture is worth is decided
   * in one tested place rather than by whatever deltas this particular device
   * happens to emit.
   */
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>): void => {
      if (presentation.phase !== "open" || displayLayers.length < 2) return;
      // A reorder owns the pointer outright. Letting the wheel move the focus
      // underneath it would change which sheet is active mid-gesture, and the
      // arrangement the drag is being judged against would move with it.
      if (cancelDragRef.current !== null) return;
      const result = accumulateWheelNavigation(
        wheelRef.current,
        event.deltaY,
        event.timeStamp || performance.now(),
      );
      wheelRef.current = result.state;
      if (result.step !== 0) focusLayer(focusedIndex + result.step);
    },
    [displayLayers.length, focusLayer, focusedIndex, presentation.phase],
  );

  // A gesture never carries over between two openings of the stack.
  useEffect(() => {
    if (!open) wheelRef.current = EMPTY_WHEEL_NAVIGATION;
  }, [open]);

  /**
   * Keeps the drag listeners' view of the arrangement current.
   *
   * Synced after commit rather than written during render. A reorder can only
   * begin once the stack is settled open, and at that point the interpolated
   * frame *is* the layout -- the choreography returns the approved planes by
   * identity at the end of its travel -- so the settled layout and the live
   * focus offset are exactly what the gesture must measure against.
   */
  useEffect(() => {
    layoutRef.current = {
      layout,
      planes: layout.layers,
      tiltDegrees: layout.tiltDegrees,
      offset,
    };
  }, [layout, offset]);

  if (!mounted || page === null) return null;

  // One moment of the separation. At progress 1 this is exactly the approved
  // open geometry, so the settled arrangement is decided in the model and the
  // choreography only ever travels toward it.
  const frame = computeSpatialLayerStackFrame(layout, presentation.progress);
  // Sheets take presses only once they have stopped moving. A plane that is
  // still arriving must not catch a click aimed at where it is going, and the
  // root keeps blocking the canvas throughout.
  const interactive = controlsInteractive(presentation.phase);

  /**
   * The focused sheet and what its controls may currently do.
   *
   * Read straight from the live snapshot every render, so an icon can never
   * show a state the document does not have. Nothing is cached and nothing is
   * copied -- the cluster is a projection of the same rows the list renders.
   */
  const candidate = displayLayers[focusedIndex];
  // Controls appear for the genuinely active Layer only. `focusedIndex` falls
  // back to the top sheet when the active id is momentarily absent, which is
  // right for the arrangement but must not put a control cluster on a sheet
  // that is not wearing the accent.
  const focused =
    candidate !== undefined && sheetShowsControls(candidate.id, snapshot.activeLayerId)
      ? candidate
      : null;
  const focusedPlane = frame.layers[focusedIndex];
  const controls = resolveSpatialControls({
    name: focused?.name ?? "",
    visible: focused?.visible ?? true,
    locked: focused?.locked ?? false,
    opacity: focused?.opacity ?? 1,
    layerCount,
    opacityOpen,
  });

  const groupHeight = layout.planeHeight + layout.paper.translateY;

  /**
   * Where each sheet sits while a reorder is in flight.
   *
   * The neighbours close up behind the held sheet and open ahead of it, which
   * is what reads as one sheet being lifted out of a stack rather than a list
   * re-sorting. Presentation only: canonical order is untouched until the drop.
   */
  const reorderSlots =
    drag === null
      ? null
      : resolveReorderSlots(displayLayers.length, drag.fromDisplayIndex, drag.insertDisplayIndex);
  const dragging = (layerId: string): boolean => drag?.layerId === layerId;
  /**
   * Where the arrangement actually sits, edge-dwell exposure included.
   *
   * Exposure is added to the focus offset rather than to the focus itself: the
   * held sheet stays the active layer, and what moves is which neighbourhood of
   * the same canonical order is under it.
   */
  const exposurePixels = (drag?.exposure ?? 0) * layout.gap;
  const arrangementOffset = offset + exposurePixels;

  /**
   * How much of the composition a sheet is part of, from its live position.
   *
   * The settled view is three sheets: the one being worked on and its two
   * neighbours. The rest stay mounted, navigable and in the accessibility tree,
   * but they step out of the picture rather than piling up behind it.
   */
  const emphasisOf = (plane: SpatialStackPlane): number =>
    computeSheetEmphasis(layout, plane, arrangementOffset, bounds.height);
  /**
   * A sheet's resting Y, or the slot the reorder has opened for it.
   *
   * The held sheet keeps its own resting position and adds the pointer's travel
   * on top, so it follows the hand rather than snapping between slots while the
   * others move around it.
   */
  const planeTop = (plane: SpatialStackPlane, displayIndex: number): number => {
    // Paper is Page state, not a Layer. It is passed a negative index because it
    // has no place in display order, and it never takes part in a reorder.
    if (drag === null || reorderSlots === null || displayIndex < 0) return plane.translateY;
    if (displayIndex !== drag.fromDisplayIndex) {
      return (reorderSlots[displayIndex] ?? displayIndex) * layout.gap;
    }
    // The held sheet follows the hand, but only within the arrangement it
    // belongs to. Reaching the next position costs a whole gap of pointer
    // travel, and unclamped that throws the sheet clean off the top of the
    // workspace -- the artwork being moved becomes the one thing not visible.
    // Clamping to the first and last slot also *is* the top and bottom
    // boundary: a sheet cannot be carried past Paper or out of the stack.
    //
    // Exposure is added back here so the sheet stays under the pointer while
    // the stack slides beneath it. Without it, auto-navigating would drag the
    // held sheet along with the arrangement and it would appear to teleport.
    const lowest = Math.max(0, displayLayers.length - 1) * layout.gap;
    return Math.min(lowest, Math.max(0, plane.translateY + drag.pointerDeltaY + exposurePixels));
  };
  const planeStyle = (plane: SpatialStackPlane, displayIndex = -1): React.CSSProperties => ({
    top: displayIndex < 0 ? plane.translateY : planeTop(plane, displayIndex),
    width: layout.planeWidth,
    height: layout.planeHeight,
    zIndex: plane.zIndex,
  });
  /**
   * Depth grows with the plane, so the sheets recede rather than merely
   * sliding down. Every plane shares one page scale -- only position differs.
   *
   * The transform is written per frame rather than handed to a CSS transition,
   * because the separation is one interpolated arrangement and not a set of
   * independent property animations that could arrive out of step.
   */
  const surfaceStyle = (plane: SpatialStackPlane, held = false): React.CSSProperties => ({
    // A held sheet comes a little toward the viewer. Depth is the stack's own
    // language for "nearer", so lifting it says the sheet has been picked up
    // without adding a shadow or a card the rest of the view does not use.
    transform: `perspective(${layout.perspective}px) translateZ(${plane.translateZ + (held ? REORDER_LIFT_DEPTH : 0)}px) rotateX(${frame.tiltDegrees}deg)`,
  });
  /**
   * Where a sheet's lower-right corner lands, so a label can hang off it.
   *
   * Shared with the focus shelf, which places a sheet by the same projected
   * edge -- one definition of where a transformed sheet actually is. Passing
   * the frame's tilt keeps a label tracking its sheet while the stack is still
   * tipping open, rather than waiting at the angle it is heading for.
   */
  const cornerOf = (plane: SpatialStackPlane): { readonly x: number; readonly y: number } =>
    projectSheetCorner(layout, plane, frame.tiltDegrees);

  /**
   * Keeps the opacity disclosure inside the workspace at a small window.
   *
   * Measured against the same projected corner the cluster hangs from, in the
   * bounds' own coordinates: the sheet group is centred in the space left after
   * the label column, so the cluster's distance from the right edge depends on
   * the page shape and the sheet's depth. The disclosure slides along its
   * anchor; the arrangement never moves to make room for it.
   */
  const disclosureAnchorBottom =
    focusedPlane === undefined
      ? 0
      : focusedPlane.translateY + layout.planeHeight / 2 + cornerOf(focusedPlane).y - offset;
  const disclosureSide = resolveDisclosureSide(disclosureAnchorBottom, bounds.height);
  const disclosureShift =
    focusedPlane === undefined
      ? 0
      : resolveDisclosureShift(
          (bounds.width - LABEL_COLUMN - layout.planeWidth) / 2 +
            layout.planeWidth / 2 +
            cornerOf(focusedPlane).x +
            LABEL_GAP,
          bounds.width,
        );

  return (
    // Owns the workspace while open: pointer events stop here rather than
    // reaching the canvas, so drawing, selection and manipulation are inert.
    //
    // A stack that is on its way out lets go immediately, even though it is
    // still visibly collapsing. Motion must never delay interaction: while it
    // held its grip through the collapse, the first stroke after switching to
    // the list view was swallowed by a surface the artist had already
    // dismissed. Same rule the floating surfaces follow on exit.
    <div
      className={cn(
        "absolute inset-0 z-[15] cursor-default",
        presentation.phase === "closing" && "pointer-events-none",
      )}
      role="presentation"
      data-testid="spatial-layers-view"
      data-layer-count={layerCount}
      data-stack-phase={presentation.phase}
      // Exposed so the separation can be verified rather than described: a
      // test can assert what the geometry is at a given point of the travel.
      data-stack-progress={frame.progress.toFixed(2)}
      // The settled separation, so a gesture test can drag in real sheet-gaps
      // rather than hard-coding a pixel distance that only holds at one size.
      data-stack-gap={Math.round(layout.gap)}
      data-stack-reordering={drag === null ? "false" : "true"}
      // The candidate gap the drop would land in, so a gesture can be driven to
      // a destination and verified rather than timed.
      data-stack-drop-index={drag?.insertDisplayIndex ?? -1}
      // Layers of arrangement slid under the held sheet, so a test can wait for
      // real navigation progress rather than sleeping through a dwell.
      data-stack-exposure={drag?.exposure ?? 0}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/*
        The live page recedes while the stack is the subject. Without this the
        real canvas stays visible behind the sheets and the workspace reads as
        two competing pages rather than one structural view.

        It reaches full opacity before any sheet starts to separate, so the
        canvas is never visible through a transparent Layer -- while the
        backdrop is still arriving the sheets are all still lying on the opaque
        paper. Closing runs the same ramp backwards.
      */}
      <div
        className="absolute inset-0 bg-folio-workspace"
        style={{ opacity: frame.backdropOpacity }}
        aria-hidden="true"
        data-testid="spatial-layers-backdrop"
      />
      {/*
        The view switch lives inside the Layers experience, not in the
        workspace rails: there is one Layers entry point, and this only chooses
        how it is presented. Session state, zero History.

        It hangs one surface gap below the workspace's permanent top chrome,
        on the same right edge: the row above is what the workspace can always
        do, and this row is what is only true while Layers is open. Purely
        screen-space chrome -- the sheets, the shelf and the projection are
        laid out from WORKSPACE_INSET and are untouched by it.
      */}
      <div
        className="folio-floating-surface pointer-events-auto absolute right-4 top-16 flex gap-0.5 p-1"
        role="group"
        aria-label="Layers view"
        data-testid="layers-view-switch"
        data-floating-surface="folio"
      >
        <button
          type="button"
          className="group relative grid size-7 place-items-center rounded-[7px] bg-folio-accent-soft text-folio-accent"
          aria-label="Stack view"
          aria-pressed={true}
          data-testid="layers-view-stack"
        >
          <Layers3 className="size-4" aria-hidden="true" />
          <ToolTooltip label="Stack view" side="bottom" />
        </button>
        <button
          type="button"
          className="group relative grid size-7 place-items-center rounded-[7px] text-[var(--folio-icon-neutral)] transition-colors hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label="List view"
          aria-pressed={false}
          data-testid="layers-view-list"
          onClick={onShowList}
        >
          <Rows3 className="size-4" aria-hidden="true" />
          <ToolTooltip label="List view" side="bottom" />
        </button>
        {/*
          Add belongs to the experience, not to one sheet.

          The list keeps it in its header for exactly the same reason, and this
          is the same action reached from the other view -- same wording, same
          command, same result. The test id is view-specific because both
          presentations are briefly mounted together while one is closing, and
          an ambiguous locator there is a flake waiting to happen.

          The new layer becomes active, and the derived focus carries the
          arrangement to it. Nothing here touches the offset.
        */}
        <span className="mx-0.5 my-1 w-px self-stretch bg-folio-border" aria-hidden="true" />
        <button
          type="button"
          className="group relative grid size-7 place-items-center rounded-[7px] text-[var(--folio-icon-neutral)] transition-colors hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label="Add layer"
          data-testid="spatial-layers-add"
          onClick={() => actions?.addLayer()}
        >
          <Plus className="size-4" aria-hidden="true" />
          <ToolTooltip label="Add layer" side="bottom" />
        </button>
      </div>
      <div
        ref={boundsRef}
        className="absolute"
        style={{
          left: WORKSPACE_INSET.left,
          right: WORKSPACE_INSET.right,
          top: WORKSPACE_INSET.top,
          bottom: WORKSPACE_INSET.bottom,
        }}
        data-testid="spatial-layers-bounds"
      >
        {/*
          The stack keeps its plane size and is navigated rather than scrolled.

          No scroll container: the arrangement is positioned by one offset
          computed from the focused Layer, which is why there is no scrollbar
          and no reserved gutter to hide. A browser scrollbar here would also be
          a lie about the interaction -- this moves between sheets, not to
          arbitrary positions. Session-only: the document viewport is untouched,
          and nothing here pans or zooms the real canvas.
        */}
        <div
          className="size-full overflow-hidden"
          data-testid="spatial-layers-scroller"
          data-stack-scrolls={layout.scrolls ? "true" : "false"}
          data-stack-offset={Math.round(arrangementOffset)}
          onWheel={handleWheel}
          // The offset is the only authority on where the arrangement sits.
          // `overflow-hidden` still leaves a box the browser may scroll on its
          // own -- focusing a sheet that is currently out of view is the usual
          // way -- and a stray `scrollTop` would silently desync the view from
          // the model. Every focus call here passes `preventScroll`; this is the
          // guard for the ones that do not come from here.
          onScroll={(event) => {
            event.currentTarget.scrollTop = 0;
          }}
        >
          {/* The sheets centre in the space left after the label column. */}
          <div className="flex justify-center" style={{ paddingRight: LABEL_COLUMN }}>
            <div
              className="relative"
              style={{
                width: layout.planeWidth,
                height: groupHeight,
                transform: `translateY(${-arrangementOffset}px)`,
              }}
            >
              {/* The page's own sheet. Structural only: never a Layer, never selectable. */}
              {/*
            Structural only. It sits nearest the viewer and therefore highest in
            paint order, so it must not take pointer events -- otherwise the page
            base would swallow presses aimed at the Layer above it.
          */}
              <div
                className="pointer-events-none absolute"
                style={planeStyle(frame.paper)}
                data-testid="spatial-paper-plane"
              >
                {/*
                  The one opaque sheet, so it alone earns a page edge and a base
                  shadow. Giving every transparent Layer a shadow would make
                  five sheets all claim to be the physical page; this difference
                  is what says which one actually is.
                */}
                <div
                  className="size-full overflow-hidden border border-folio-muted/40 shadow-[0_16px_34px_-22px_rgba(0,0,0,0.6)]"
                  style={surfaceStyle(frame.paper)}
                >
                  <canvas ref={paperCanvasRef} className="size-full" aria-hidden="true" />
                </div>
              </div>

              <div role="list" aria-label="Layer stack" onKeyDown={handleKeyDown}>
                {displayLayers.map((layer, displayIndex) => {
                  const plane = frame.layers[displayIndex];
                  if (plane === undefined) return null;
                  const active = layer.id === snapshot.activeLayerId;
                  const held = dragging(layer.id);
                  // A held sheet stays a full participant wherever the hand has
                  // taken it. Fading it out because it left the shelf would hide
                  // the very thing being moved.
                  const emphasis = held ? 1 : emphasisOf(plane);
                  return (
                    <div
                      key={layer.id}
                      role="listitem"
                      className={cn(
                        "absolute",
                        // Slots settle; the held sheet tracks the pointer and
                        // must not lag a frame behind it.
                        drag !== null &&
                          !held &&
                          !reducedMotion &&
                          "transition-[top] duration-150 ease-out",
                      )}
                      style={{
                        ...planeStyle(plane, displayIndex),
                        opacity: emphasis,
                        // Held sheets paint above the ones making room.
                        ...(held ? { zIndex: layout.layers.length + 2 } : {}),
                      }}
                      data-testid={`spatial-layer-plane-${layer.id}`}
                      data-layer-active={active}
                      data-layer-visible={layer.visible}
                      data-layer-locked={layer.locked}
                      data-layer-display-index={displayIndex}
                      data-layer-emphasis={emphasis.toFixed(2)}
                      data-layer-dragging={held}
                    >
                      <button
                        type="button"
                        // Sheets, not cards: an edge and no fill, so the paper
                        // below shows through and the transparency reads.
                        //
                        // Every sheet always has a boundary, including an empty,
                        // hidden or very lightly drawn one -- the outline is what
                        // says a Layer is there at all. It is drawn from the
                        // muted token rather than the border token, which is an
                        // 11%-alpha hairline meant for panel chrome and simply
                        // disappears at this size against the workspace.
                        className={cn(
                          "size-full overflow-hidden border transition-[border-color] duration-100 focus-visible:outline-none",
                          active
                            ? "border-folio-accent"
                            : "border-folio-muted/30 hover:border-folio-muted/55 focus-visible:border-folio-muted/55",
                          interactive ? "" : "pointer-events-none",
                        )}
                        style={surfaceStyle(plane, held)}
                        aria-label={accessibleLayerName(layer, active)}
                        {...(active ? { "aria-current": true as const } : {})}
                        tabIndex={interactive && displayIndex === focusedIndex ? 0 : -1}
                        data-layer-plane={layer.id}
                        // Pressing a sheet is the same navigation the wheel and
                        // the arrow keys perform: it becomes active and comes
                        // into the focus zone.
                        onClick={() => focusLayer(displayIndex)}
                      >
                        <canvas
                          ref={(canvas) => {
                            if (canvas === null) layerCanvases.current.delete(layer.id);
                            else layerCanvases.current.set(layer.id, canvas);
                          }}
                          className="size-full"
                          aria-hidden="true"
                          data-layer-canvas={layer.id}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/*
                Labels live above every plane in one overlay, not inside their
                sheet. A plane sets its own z-index, which makes it a stacking
                context, so a label placed inside one is buried by the nearer
                sheet below it. Upright and untransformed: perspective text is
                unreadable.
              */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ zIndex: layout.layers[0]!.zIndex + 1 }}
                aria-hidden="true"
              >
                {[
                  ...displayLayers
                    // The focused sheet's name lives in the interactive cluster
                    // below, so it is not drawn twice. Everything else keeps the
                    // approved quiet label exactly as it was.
                    .filter((layer) => !sheetShowsControls(layer.id, snapshot.activeLayerId))
                    .map((layer) => ({
                      key: layer.id,
                      plane: frame.layers[displayLayers.indexOf(layer)],
                      // A label belongs to its sheet, including while another
                      // sheet is being reordered around it. Without this the
                      // neighbours slide into their new slots and leave their
                      // names behind at the old ones.
                      displayIndex: displayLayers.indexOf(layer),
                      name: layer.name,
                      active: false,
                      hidden: !layer.visible,
                      locked: layer.locked,
                      testId: `spatial-layer-label-${layer.id}`,
                    })),
                  {
                    key: "__paper",
                    // Paper never takes part in a reorder, so it never moves.
                    displayIndex: -1,
                    plane: frame.paper,
                    name: "Paper",
                    active: false,
                    hidden: false,
                    locked: false,
                    testId: "spatial-paper-label",
                  },
                ].map((entry) =>
                  entry.plane === undefined ? null : (
                    <span
                      key={entry.key}
                      className="absolute flex items-center gap-1.5 whitespace-nowrap"
                      style={{
                        left: layout.planeWidth / 2 + cornerOf(entry.plane).x + LABEL_GAP,
                        top:
                          planeTop(entry.plane, entry.displayIndex) +
                          layout.planeHeight / 2 +
                          cornerOf(entry.plane).y,
                        transform: "translateY(-100%)",
                        // A label belongs to its sheet, so it leaves the
                        // composition with it. The paper keeps its own approved
                        // presentation and is not part of this falloff.
                        opacity: entry.key === "__paper" ? 1 : emphasisOf(entry.plane),
                      }}
                    >
                      <span
                        className={cn(
                          "text-[11px]",
                          entry.active
                            ? "font-semibold text-folio-ink"
                            : "font-medium text-folio-muted",
                        )}
                        data-testid={entry.testId}
                      >
                        {entry.name}
                      </span>
                      {entry.hidden ? (
                        <EyeOff
                          className="size-3 text-folio-muted"
                          data-testid={`spatial-layer-hidden-${entry.key}`}
                        />
                      ) : null}
                      {entry.locked ? (
                        <Lock
                          className="size-3 text-folio-muted"
                          data-testid={`spatial-layer-locked-${entry.key}`}
                        />
                      ) : null}
                    </span>
                  ),
                )}
              </div>

              {/*
                The focused sheet's own label, and only its controls.

                A separate overlay from the quiet labels above because this one
                is interactive and must reach the accessibility tree, while
                those stay aria-hidden behind the sheets' own names. It hangs
                off the same projected corner, so the cluster sits beside the
                artwork rather than over it, and it is upright: perspective
                buttons would be both unreadable and untouchable.
              */}
              {focusedPlane === undefined || focused === null ? null : (
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: layout.planeWidth / 2 + cornerOf(focusedPlane).x + LABEL_GAP,
                    // Travels with its sheet while it is held, so the label and
                    // the grip stay attached to the thing being moved.
                    top:
                      planeTop(focusedPlane, focusedIndex) +
                      layout.planeHeight / 2 +
                      cornerOf(focusedPlane).y,
                    transform: "translateY(-100%)",
                    zIndex: layout.layers[0]!.zIndex + 2,
                    // Tracks its sheet through the choreography like any other
                    // label, so the cluster never floats free of the plane it
                    // belongs to. A held sheet stays a full participant wherever
                    // the hand has taken it: emphasis is measured from a sheet's
                    // resting position, and edge dwell deliberately moves the
                    // arrangement out from under that -- fading the cluster then
                    // would hide the label and controls of the very sheet being
                    // moved, exactly when they say what is being moved.
                    opacity: dragging(focused.id) ? 1 : emphasisOf(focusedPlane),
                  }}
                  data-testid="spatial-layer-controls"
                  data-layer-controls-for={focused.id}
                  data-layer-controls-interactive={interactive}
                >
                  {/*
                    The label and the control row are the cluster's whole
                    height. Opening the disclosure must not push them upward off
                    their own sheet corner, so the disclosure hangs below from
                    outside the flow -- activation feedback never moves layout.
                  */}
                  <div className="relative flex flex-col items-start gap-1">
                    {renaming ? (
                      <SpatialRenameInput
                        name={focused.name}
                        onCommit={(draft) => {
                          const name = normalizeLayerName(draft, focused.name);
                          // An unchanged or empty draft is discarded by the
                          // shared rule, so a rename that changes nothing
                          // creates no History entry.
                          if (name !== null) actions?.renameLayer(focused.id, name);
                          setRenamingLayerId(null);
                        }}
                        onCancel={() => setRenamingLayerId(null)}
                      />
                    ) : (
                      <span
                        className="pointer-events-none whitespace-nowrap text-[11px] font-semibold text-folio-ink"
                        data-testid={`spatial-layer-label-${focused.id}`}
                      >
                        {focused.name}
                      </span>
                    )}
                    <div
                      className={cn(
                        "folio-floating-surface flex items-center gap-0 p-0.5",
                        interactive ? "pointer-events-auto" : "pointer-events-none",
                      )}
                      role="group"
                      aria-label={`${focused.name} layer controls`}
                      data-testid="spatial-layer-control-row"
                      // The cluster is a sibling of the sheet list, so keys
                      // pressed here would otherwise never reach the stack's
                      // own navigation. Buttons consume neither the arrows nor
                      // Alt, and the rename field and the opacity disclosure
                      // are outside this row and keep their own keys.
                      onKeyDown={handleKeyDown}
                      style={{ minWidth: SPATIAL_CONTROL_ROW_WIDTH }}
                    >
                      {/*
                        The reorder handle, and the only one.

                        Deliberately not the artwork: making every pixel of a
                        sheet a drag handle would collide with activation, with
                        the controls beside it and with wheel navigation, and
                        would leave no way to press a sheet without risking a
                        move. A grip on the focused cluster says exactly what it
                        does and belongs to exactly one sheet.
                      */}
                      <button
                        type="button"
                        className={cn(
                          "grid shrink-0 cursor-grab touch-none place-items-center rounded-[6px] text-[var(--folio-icon-neutral)] transition-colors duration-100 hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35",
                          drag !== null && "cursor-grabbing text-folio-ink",
                        )}
                        style={{
                          width: SPATIAL_CONTROL_METRICS.buttonSize,
                          height: SPATIAL_CONTROL_METRICS.buttonSize,
                        }}
                        aria-label={`Reorder ${focused.name}. Hold Alt with the arrow keys to move it`}
                        data-testid={`spatial-layer-reorder-${focused.id}`}
                        disabled={!canReorderLayers(layerCount)}
                        onPointerDown={(event) => beginReorder(event, focusedIndex, focused.id)}
                        // The press is the gesture. A click that never crossed
                        // the threshold must not also read as an activation.
                        onClick={(event) => event.stopPropagation()}
                      >
                        <GripVertical className="size-3.5" aria-hidden="true" />
                      </button>
                      <ControlButton
                        state={controls.visibility}
                        testId={`spatial-layer-visibility-${focused.id}`}
                        onPress={() => actions?.setLayerVisible(focused.id, !focused.visible)}
                      >
                        {focused.visible ? (
                          <Eye className="size-3.5" aria-hidden="true" />
                        ) : (
                          <EyeOff className="size-3.5" aria-hidden="true" />
                        )}
                      </ControlButton>
                      <ControlButton
                        state={controls.lock}
                        testId={`spatial-layer-lock-${focused.id}`}
                        onPress={() => actions?.setLayerLocked(focused.id, !focused.locked)}
                      >
                        {focused.locked ? (
                          <Lock className="size-3.5" aria-hidden="true" />
                        ) : (
                          <LockOpen className="size-3.5" aria-hidden="true" />
                        )}
                      </ControlButton>
                      <ControlButton
                        state={controls.opacity}
                        testId={`spatial-layer-opacity-${focused.id}`}
                        onPress={() => {
                          // Closing commits, exactly as the list disclosure
                          // does. Commit is a no-op when no drag ever began.
                          if (opacityOpen) {
                            setOpacityLayerId(null);
                            return;
                          }
                          setOpacityLayerId(focused.id);
                        }}
                      >
                        <OpacityGlyph />
                      </ControlButton>
                      <ControlButton
                        state={controls.rename}
                        testId={`spatial-layer-rename-${focused.id}`}
                        onPress={() => setRenamingLayerId(focused.id)}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </ControlButton>
                      <ControlButton
                        state={controls.delete}
                        testId={`spatial-layer-delete-${focused.id}`}
                        danger
                        onPress={() => {
                          // A layer that is going away cannot be committed to,
                          // so an open adjustment is abandoned rather than
                          // patched onto a row that will not exist. This is
                          // cancel's exact meaning: the target is genuinely
                          // gone.
                          if (opacityOpen) actions?.cancelLayerOpacityEdit();
                          const removed = actions?.deleteLayer(focused.id);
                          if (removed !== null && removed !== undefined) {
                            onNotify(describeDeletedLayer(focused.name, removed));
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </ControlButton>
                      {/*
                        Only a changed value earns space in the row, matching
                        the list. The percentage is always announced through the
                        opacity control's own name.
                      */}
                      {focused.opacity < 1 ? (
                        <span
                          className="px-1 text-[10px] tabular-nums text-folio-muted"
                          data-testid={`spatial-layer-opacity-value-${focused.id}`}
                        >
                          {Math.round(focused.opacity * 100)}%
                        </span>
                      ) : null}
                    </div>
                    {opacityOpen ? (
                      <div
                        className={cn(
                          "folio-floating-surface p-1",
                          interactive ? "pointer-events-auto" : "pointer-events-none",
                        )}
                        style={{
                          position: "absolute",
                          left: disclosureShift,
                          width: SPATIAL_CONTROL_METRICS.disclosureWidth,
                          ...(disclosureSide === "above"
                            ? {
                                bottom: "100%",
                                marginBottom: SPATIAL_CONTROL_METRICS.disclosureGap,
                              }
                            : { top: "100%", marginTop: SPATIAL_CONTROL_METRICS.disclosureGap }),
                        }}
                        data-testid={`spatial-layer-opacity-panel-${focused.id}`}
                        data-disclosure-shift={Math.round(disclosureShift)}
                        data-disclosure-side={disclosureSide}
                        // The stack navigates on wheel. Ownership genuinely
                        // transfers here, so this one surface keeps its wheel
                        // instead of scrolling the arrangement out from under
                        // the control being adjusted.
                        onWheel={(event) => event.stopPropagation()}
                      >
                        <ContinuousSlider
                          descriptor={{
                            key: `spatial-layer-opacity-${focused.id}`,
                            type: "number",
                            displayName: "Opacity",
                            value: focused.opacity,
                            defaultValue: 1,
                            unit: "%",
                            constraints: { minimum: 0, maximum: 1, step: 0.01 },
                            displayScale: 100,
                            precision: 0,
                            validate: (value) =>
                              typeof value === "number" && value >= 0 && value <= 1,
                          }}
                          onChange={(value) => actions?.previewLayerOpacity(value)}
                          onInteractionStart={() => actions?.beginLayerOpacityEdit(focused.id)}
                          onInteractionCommit={() => actions?.commitLayerOpacityEdit()}
                          onInteractionCancel={() => actions?.cancelLayerOpacityEdit()}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Folio's opacity glyph: a disc filled to exactly half.
 *
 * The same mark the Drawing Property Rail uses, so one property reads the same
 * wherever it appears -- this is layer opacity rather than stroke opacity, but
 * it is still opacity. Fixed at half on purpose: it names the property, it does
 * not report the value, which the adjacent percentage and the control's own
 * accessible name already do.
 *
 * Redrawn here rather than imported because the rail is a frozen surface this
 * phase must not edit. If a third surface ever needs it, that is the moment to
 * lift all three into one shared icon.
 */
function OpacityGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" focusable="false">
      <path d="M8 1.75 A6.25 6.25 0 0 0 8 14.25 Z" fill="currentColor" />
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * One contextual control on the focused sheet.
 *
 * Deliberately the compact dock-button language rather than a new one: quiet by
 * default, state carried by colour, and no surface of its own. Delete earns its
 * destructive treatment only on hover and focus, which is the same restraint
 * the list row uses -- it must not read as loudly as visibility or lock.
 */
function ControlButton({
  state,
  testId,
  danger,
  onPress,
  children,
}: {
  readonly state: SpatialControlState;
  readonly testId: string;
  readonly danger?: boolean;
  readonly onPress: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid shrink-0 place-items-center rounded-[6px] text-[var(--folio-icon-neutral)] transition-colors duration-100 hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35",
        state.pressed === true && "text-folio-ink",
        danger === true && "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400",
      )}
      style={{
        width: SPATIAL_CONTROL_METRICS.buttonSize,
        height: SPATIAL_CONTROL_METRICS.buttonSize,
      }}
      aria-label={state.label}
      {...(state.pressed === undefined ? {} : { "aria-pressed": state.pressed })}
      disabled={state.disabled}
      data-testid={testId}
      // The cluster is a sibling overlay above the sheets, so a press here never
      // reaches a plane and nothing has to be stopped to protect focus. Only the
      // canvas underneath is blocked, and the root already does that.
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/**
 * Owns one rename draft, mounted on demand so the draft resets naturally.
 *
 * Same lifecycle as the list: Enter commits, Escape cancels and restores, blur
 * commits. Escape cancels the key event itself, which is what keeps it from
 * reaching the shared dismissal stack and closing the whole arrangement while
 * the artist is only abandoning a name. Arrow keys, Home, End and Space are the
 * field's own -- the stack's navigation listener is on an ancestor, so stopping
 * propagation here is what makes typing a space type a space.
 */
function SpatialRenameInput({
  name,
  onCommit,
  onCancel,
}: {
  readonly name: string;
  readonly onCommit: (draft: string) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      className="pointer-events-auto w-[168px] rounded-[6px] border border-folio-border bg-folio-surface px-1.5 py-0.5 text-[11px] text-folio-ink outline-none focus:ring-2 focus:ring-folio-accent"
      aria-label={`Rename ${name}`}
      data-testid="spatial-layer-rename-input"
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => onCommit(draft)}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        // Every other key belongs to the text field, including the ones the
        // stack navigates with.
        event.stopPropagation();
      }}
    />
  );
}

/** The pixels are never the accessibility interface; this sentence is. */
function accessibleLayerName(layer: LayersSnapshot["layers"][number], active: boolean): string {
  const states = [
    layer.visible ? null : "hidden",
    layer.locked ? "locked" : null,
    active ? "active layer" : null,
  ].filter((state): state is string => state !== null);
  const objects = `${layer.objectCount} object${layer.objectCount === 1 ? "" : "s"}`;
  return [`${layer.name}, ${objects}`, ...states].join(", ");
}
