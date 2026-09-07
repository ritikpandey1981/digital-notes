import {
  renderPageLayerPreview,
  renderPagePaperPreview,
  type LayerActions,
  type LayersSnapshot,
  type Page,
} from "@folio/editor";
import { cn } from "@folio/ui";
import { Eye, EyeOff, Layers3, Lock, LockOpen, Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSettlingValue } from "../../motion/settling-value";
import { useTransientPresentation } from "../../motion/transient-presentation";
import { ContinuousSlider } from "./ContinuousSlider";
import { pushDismissal } from "./floating-dismissal-stack";
import { describeDeletedLayer, normalizeLayerName } from "./layers-panel-model";
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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const last = displayLayers.length - 1;
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
    [displayLayers.length, focusLayer, focusedIndex],
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
   * How much of the composition a sheet is part of, from its live position.
   *
   * The settled view is three sheets: the one being worked on and its two
   * neighbours. The rest stay mounted, navigable and in the accessibility tree,
   * but they step out of the picture rather than piling up behind it.
   */
  const emphasisOf = (plane: SpatialStackPlane): number =>
    computeSheetEmphasis(layout, plane, offset, bounds.height);
  const planeStyle = (plane: SpatialStackPlane): React.CSSProperties => ({
    top: plane.translateY,
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
  const surfaceStyle = (plane: SpatialStackPlane): React.CSSProperties => ({
    transform: `perspective(${layout.perspective}px) translateZ(${plane.translateZ}px) rotateX(${frame.tiltDegrees}deg)`,
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
      */}
      <div
        className="folio-floating-surface pointer-events-auto absolute right-4 top-4 flex gap-0.5 p-1"
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
          data-stack-offset={Math.round(offset)}
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
                transform: `translateY(${-offset}px)`,
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
                  const emphasis = emphasisOf(plane);
                  return (
                    <div
                      key={layer.id}
                      role="listitem"
                      className="absolute"
                      style={{ ...planeStyle(plane), opacity: emphasis }}
                      data-testid={`spatial-layer-plane-${layer.id}`}
                      data-layer-active={active}
                      data-layer-visible={layer.visible}
                      data-layer-locked={layer.locked}
                      data-layer-display-index={displayIndex}
                      data-layer-emphasis={emphasis.toFixed(2)}
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
                        style={surfaceStyle(plane)}
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
                      name: layer.name,
                      active: false,
                      hidden: !layer.visible,
                      locked: layer.locked,
                      testId: `spatial-layer-label-${layer.id}`,
                    })),
                  {
                    key: "__paper",
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
                          entry.plane.translateY + layout.planeHeight / 2 + cornerOf(entry.plane).y,
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
                    top:
                      focusedPlane.translateY + layout.planeHeight / 2 + cornerOf(focusedPlane).y,
                    transform: "translateY(-100%)",
                    zIndex: layout.layers[0]!.zIndex + 2,
                    // Tracks its sheet through the choreography like any other
                    // label, so the cluster never floats free of the plane it
                    // belongs to.
                    opacity: emphasisOf(focusedPlane),
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
                      style={{ minWidth: SPATIAL_CONTROL_ROW_WIDTH }}
                    >
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
