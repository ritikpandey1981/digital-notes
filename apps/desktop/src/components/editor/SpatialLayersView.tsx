import {
  renderPageLayerPreview,
  renderPagePaperPreview,
  type LayersSnapshot,
  type Page,
} from "@folio/editor";
import { cn } from "@folio/ui";
import { EyeOff, Layers3, Lock, Rows3 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSettlingValue } from "../../motion/settling-value";
import { useTransientPresentation } from "../../motion/transient-presentation";
import { pushDismissal } from "./floating-dismissal-stack";
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
  readonly onActivateLayer: (layerId: string) => void;
  readonly onShowList: () => void;
  readonly onDismiss: () => void;
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
  onActivateLayer,
  onShowList,
  onDismiss,
}: SpatialLayersViewProps) {
  const boundsRef = useRef<HTMLDivElement | null>(null);
  const paperCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerCanvases = useRef(new Map<string, HTMLCanvasElement>());
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

  // Escape joins the editor's existing LIFO transient-surface stack rather than
  // installing a competing global key listener.
  useEffect(() => {
    if (!open) return;
    return pushDismissal("spatial-layers-stack", onDismiss);
  }, [onDismiss, open]);

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
  const interactive = presentation.phase === "open";

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
                  ...displayLayers.map((layer, displayIndex) => ({
                    key: layer.id,
                    plane: frame.layers[displayIndex],
                    name: layer.name,
                    active: layer.id === snapshot.activeLayerId,
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
            </div>
          </div>
        </div>
      </div>
    </div>
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
