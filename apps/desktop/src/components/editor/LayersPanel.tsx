import type { LayerActions, LayersSnapshot } from "@folio/editor";
import { cn } from "@folio/ui";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers3,
  GripVertical,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";
import { ContinuousSlider } from "./ContinuousSlider";
import {
  canDeleteLayer,
  describeDeletedLayer,
  LAYER_DRAG_THRESHOLD,
  LAYER_PANEL_WIDTH,
  LAYER_ROW_HEIGHT,
  layerRows,
  moveTargetIndex,
  nextFocusIndex,
  normalizeLayerName,
  resolveLayerAutoScroll,
  resolveLayerDragMove,
  resolveLayerDropIndex,
  type LayerRow,
} from "./layers-panel-model";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface LayersPanelProps {
  readonly open: boolean;
  readonly snapshot: LayersSnapshot;
  readonly actions: LayerActions | null;
  readonly onShowStack?: () => void;
  readonly onDismiss: () => void;
  readonly onNotify: (message: string) => void;
}

/** Live state of one reorder gesture. Presentation only until it commits. */
interface LayerDragState {
  readonly layerId: string;
  readonly fromIndex: number;
  readonly insertIndex: number;
}

export function LayersPanel({
  open,
  snapshot,
  actions,
  onShowStack,
  onDismiss,
  onNotify,
}: LayersPanelProps) {
  const motionPreset = useFloatingSurfaceMotion();
  const boundaryRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [opacityLayerId, setOpacityLayerId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [drag, setDrag] = useState<LayerDragState | null>(null);
  const cancelDragRef = useRef<(() => void) | null>(null);
  const rows = layerRows(snapshot);
  const floatingWidgetScope = useFloatingWidgetDismissal(open, onDismiss, boundaryRef, {
    outsidePointerDismissal: "canvas",
    onEscape: () => {
      // A live drag is the innermost transient state, so it unwinds first and
      // leaves the order exactly as it was.
      if (cancelDragRef.current !== null) {
        cancelDragRef.current();
        return;
      }
      if (renamingLayerId !== null) {
        setRenamingLayerId(null);
        return;
      }
      if (opacityLayerId !== null) {
        actions?.cancelLayerOpacityEdit();
        setOpacityLayerId(null);
        return;
      }
      onDismiss();
    },
  });
  // Closing the panel discards transient row state without an effect.
  if (!open && (renamingLayerId !== null || opacityLayerId !== null)) {
    setRenamingLayerId(null);
    setOpacityLayerId(null);
  }

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, fromIndex: number, layerId: string): void => {
      if (event.button !== 0 || rows.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const originY = event.clientY;
      let pointerY = originY;
      let started = false;
      let insertIndex = fromIndex;
      let autoScrollFrame: number | null = null;

      const rowMetrics = (): readonly Readonly<{ top: number; height: number }>[] =>
        rowRefs.current.slice(0, rows.length).map((element) => {
          const bounds = element?.getBoundingClientRect();
          return { top: bounds?.top ?? 0, height: bounds?.height ?? LAYER_ROW_HEIGHT };
        });

      const updateInsertion = (): void => {
        const next = resolveLayerDropIndex(pointerY, rowMetrics());
        if (next === insertIndex) return;
        insertIndex = next;
        setDrag({ layerId, fromIndex, insertIndex });
      };

      const stepAutoScroll = (): void => {
        autoScrollFrame = null;
        const list = listRef.current;
        if (list === null || !started) return;
        const bounds = list.getBoundingClientRect();
        const delta = resolveLayerAutoScroll(pointerY, {
          top: bounds.top,
          height: bounds.height,
        });
        if (delta !== 0) {
          list.scrollTop += delta;
          updateInsertion();
          autoScrollFrame = requestAnimationFrame(stepAutoScroll);
        }
      };

      const finish = (commit: boolean): void => {
        if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
        autoScrollFrame = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        cancelDragRef.current = null;
        setDrag(null);
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          // The browser may already have released it.
        }
        if (!commit || !started) return;
        const move = resolveLayerDragMove(fromIndex, insertIndex, rows.length);
        // A no-op drag must not reach History at all, so it stops here rather
        // than relying on the command layer to notice nothing changed.
        if (move.changed) actions?.moveLayer(layerId, move.targetStorageIndex);
      };

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return;
        pointerY = moveEvent.clientY;
        if (!started) {
          if (Math.abs(pointerY - originY) < LAYER_DRAG_THRESHOLD) return;
          started = true;
          setDrag({ layerId, fromIndex, insertIndex });
        }
        updateInsertion();
        if (autoScrollFrame === null) autoScrollFrame = requestAnimationFrame(stepAutoScroll);
      };
      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return;
        finish(true);
      };
      const handleCancel = (cancelEvent: PointerEvent): void => {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(false);
      };

      handle.setPointerCapture(pointerId);
      cancelDragRef.current = () => finish(false);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    },
    [actions, rows.length],
  );

  useEffect(() => () => cancelDragRef.current?.(), []);

  const moveRow = useCallback(
    (row: LayerRow, direction: "up" | "down", index: number): void => {
      const target = moveTargetIndex(row, direction, rows.length);
      if (target === null || actions?.moveLayer(row.id, target) !== true) return;
      const next = nextFocusIndex(index, direction, rows.length);
      setFocusIndex(next);
      // Focus follows the row so a run of keyboard moves keeps working.
      queueMicrotask(() => handleRefs.current[next]?.focus());
    },
    [actions, rows.length],
  );

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (renamingLayerId !== null) return;
    const index = rowIndexFromEvent(event.target, rows.length) ?? focusIndex;
    const row = rows[index];
    if (row === undefined) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const direction = event.key === "ArrowUp" ? "up" : "down";
      event.preventDefault();
      if (event.altKey) {
        moveRow(row, direction, index);
        return;
      }
      const next = nextFocusIndex(index, direction, rows.length);
      setFocusIndex(next);
      handleRefs.current[next]?.focus();
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      setRenamingLayerId(row.id);
    }
  };

  return (
    <div className="pointer-events-none absolute right-[76px] top-2 z-30">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={boundaryRef}
            data-floating-widget-scope={floatingWidgetScope}
            className="folio-floating-surface pointer-events-auto flex flex-col overflow-hidden"
            style={{ width: LAYER_PANEL_WIDTH, maxHeight: "min(520px, calc(100vh - 140px))" }}
            aria-label="Layers"
            data-testid="layers-panel"
            data-elevation="temporary"
            data-floating-surface="folio"
            data-layer-count={rows.length}
            data-layer-drag-state={drag === null ? "idle" : "dragging"}
            {...floatingSurfaceMotion(motionPreset)}
          >
            <header className="flex shrink-0 items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold text-folio-ink">Layers</span>
              <div className="flex items-center gap-0.5">
                {/* The way back to the spatial stack. Presentation only. */}
                {onShowStack === undefined ? null : (
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-lg text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                    aria-label="Stack view"
                    aria-pressed={false}
                    data-testid="layers-view-stack"
                    onClick={onShowStack}
                  >
                    <Layers3 className="size-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-lg text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                  aria-label="Add layer"
                  data-testid="layers-add"
                  onClick={() => {
                    const layerId = actions?.addLayer();
                    if (layerId !== null && layerId !== undefined) setFocusIndex(0);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            </header>
            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
              role="list"
              aria-label="Layer list"
              data-testid="layers-list"
              onKeyDown={handleListKeyDown}
            >
              {rows.map((row, index) => (
                <LayerRowView
                  key={row.id}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  handleRef={(element) => {
                    handleRefs.current[index] = element;
                  }}
                  row={row}
                  index={index}
                  handleTabIndex={index === focusIndex ? 0 : -1}
                  layerCount={rows.length}
                  dragging={drag?.layerId === row.id}
                  dropBefore={drag !== null && drag.insertIndex === index}
                  dropAfter={
                    drag !== null && drag.insertIndex === rows.length && index === rows.length - 1
                  }
                  renaming={renamingLayerId === row.id}
                  opacityOpen={opacityLayerId === row.id}
                  onDragHandlePointerDown={(event) => beginDrag(event, index, row.id)}
                  onFocusRow={() => setFocusIndex(index)}
                  onActivate={() => actions?.setActiveLayer(row.id)}
                  onToggleVisible={() => actions?.setLayerVisible(row.id, !row.visible)}
                  onToggleLocked={() => actions?.setLayerLocked(row.id, !row.locked)}
                  onStartRename={() => setRenamingLayerId(row.id)}
                  onCommitRename={(draft) => {
                    const name = normalizeLayerName(draft, row.name);
                    if (name !== null) actions?.renameLayer(row.id, name);
                    setRenamingLayerId(null);
                  }}
                  onCancelRename={() => setRenamingLayerId(null)}
                  onToggleOpacity={() => {
                    if (opacityLayerId === row.id) {
                      actions?.commitLayerOpacityEdit();
                      setOpacityLayerId(null);
                      return;
                    }
                    setOpacityLayerId(row.id);
                  }}
                  onOpacityStart={() => actions?.beginLayerOpacityEdit(row.id)}
                  onOpacityChange={(value) => actions?.previewLayerOpacity(value)}
                  onOpacityCommit={() => actions?.commitLayerOpacityEdit()}
                  onOpacityCancel={() => actions?.cancelLayerOpacityEdit()}
                  onMove={(direction) => moveRow(row, direction, index)}
                  onDelete={() => {
                    const removed = actions?.deleteLayer(row.id);
                    if (removed !== null && removed !== undefined) {
                      onNotify(describeDeletedLayer(row.name, removed));
                    }
                  }}
                />
              ))}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Resolves the row a keyboard event came from, whichever control has focus. */
function rowIndexFromEvent(target: EventTarget | null, rowCount: number): number | null {
  if (!(target instanceof Element)) return null;
  const raw = target.closest("[data-layer-row-index]")?.getAttribute("data-layer-row-index");
  if (raw === null || raw === undefined) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < rowCount ? index : null;
}

interface LayerRowViewProps {
  readonly row: LayerRow;
  readonly index: number;
  readonly handleTabIndex: number;
  readonly layerCount: number;
  readonly dragging: boolean;
  readonly dropBefore: boolean;
  readonly dropAfter: boolean;
  readonly renaming: boolean;
  readonly opacityOpen: boolean;
  readonly handleRef: (element: HTMLButtonElement | null) => void;
  readonly onDragHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onFocusRow: () => void;
  readonly onActivate: () => void;
  readonly onToggleVisible: () => void;
  readonly onToggleLocked: () => void;
  readonly onStartRename: () => void;
  readonly onCommitRename: (draft: string) => void;
  readonly onCancelRename: () => void;
  readonly onToggleOpacity: () => void;
  readonly onOpacityStart: () => void;
  readonly onOpacityChange: (value: number) => void;
  readonly onOpacityCancel: () => void;
  readonly onOpacityCommit: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onDelete: () => void;
}

/**
 * One layer row.
 *
 * The list is a plain list of list items rather than a listbox of options: the
 * rows hold their own buttons, and a listbox option that contains interactive
 * controls is not a pattern assistive technology can navigate. Active state is
 * carried by `aria-current` on the row's own name control.
 */
function LayerRowView({
  ref,
  handleRef,
  row,
  index,
  handleTabIndex,
  layerCount,
  dragging,
  dropBefore,
  dropAfter,
  renaming,
  opacityOpen,
  onDragHandlePointerDown,
  onFocusRow,
  onActivate,
  onToggleVisible,
  onToggleLocked,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onToggleOpacity,
  onOpacityStart,
  onOpacityChange,
  onOpacityCommit,
  onOpacityCancel,
  onMove,
  onDelete,
}: LayerRowViewProps & { readonly ref?: (element: HTMLDivElement | null) => void }) {
  const optionsRef = useRef<HTMLDivElement | null>(null);
  // Expanding the last visible row used to leave its controls clipped below the
  // panel edge; the panel now scrolls the expansion into view instead.
  useEffect(() => {
    if (!opacityOpen) return;
    optionsRef.current?.scrollIntoView({ block: "nearest" });
  }, [opacityOpen]);
  return (
    <div
      ref={ref}
      role="listitem"
      data-testid={`layer-row-${row.id}`}
      data-layer-row-index={index}
      data-layer-active={row.active}
      data-layer-dragging={dragging}
      className="relative"
    >
      {dropBefore ? <DropIndicator position="before" /> : null}
      {dropAfter ? <DropIndicator position="after" /> : null}
      <div
        data-testid={`layer-row-button-${row.id}`}
        className={cn(
          "group flex items-center gap-1 rounded-lg px-1 outline-none transition-colors",
          row.active ? "bg-folio-accent-soft" : "hover:bg-folio-hover",
          dragging && "opacity-60 shadow-sm ring-1 ring-folio-accent",
        )}
        style={{ height: LAYER_ROW_HEIGHT }}
        onFocus={onFocusRow}
        onClick={onActivate}
        onDoubleClick={onStartRename}
      >
        <button
          ref={handleRef}
          type="button"
          className={cn(
            "flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-folio-muted opacity-0 transition-[color,opacity] hover:text-folio-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent group-focus-within:opacity-100 group-hover:opacity-100",
            dragging && "cursor-grabbing opacity-100 text-folio-ink",
            layerCount < 2 && "pointer-events-none opacity-0",
          )}
          aria-label={`Reorder ${row.name}. Hold Alt with the arrow keys to move it`}
          data-testid={`layer-drag-handle-${row.id}`}
          tabIndex={handleTabIndex}
          disabled={layerCount < 2}
          onPointerDown={onDragHandlePointerDown}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="size-3.5" aria-hidden="true" />
        </button>
        <RowButton
          label={row.visible ? `Hide ${row.name}` : `Show ${row.name}`}
          testId={`layer-visibility-${row.id}`}
          pressed={row.visible}
          onClick={onToggleVisible}
        >
          {row.visible ? (
            <Eye className="size-3.5" aria-hidden="true" />
          ) : (
            <EyeOff className="size-3.5" aria-hidden="true" />
          )}
        </RowButton>
        <RowButton
          label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
          testId={`layer-lock-${row.id}`}
          pressed={row.locked}
          onClick={onToggleLocked}
        >
          {row.locked ? (
            <Lock className="size-3.5" aria-hidden="true" />
          ) : (
            <LockOpen className="size-3.5" aria-hidden="true" />
          )}
        </RowButton>
        {renaming ? (
          <RenameInput
            layerId={row.id}
            name={row.name}
            onCommit={onCommitRename}
            onCancel={onCancelRename}
          />
        ) : (
          // Names read and behave like editable text: a hover affordance, a
          // pencil on the active row, plus double-click and F2. The same
          // control carries the active-layer state.
          <button
            type="button"
            className="group/name flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-folio-ink transition-colors hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
            aria-label={`${row.name}, ${row.objectCount} object${row.objectCount === 1 ? "" : "s"}${row.active ? ", active layer" : ""}. Activate, or press F2 to rename`}
            {...(row.active ? { "aria-current": true as const } : {})}
            data-testid={`layer-name-${row.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onActivate();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onStartRename();
            }}
          >
            <span className="min-w-0 truncate">{row.name}</span>
            <Pencil
              className="size-2.5 shrink-0 text-folio-muted opacity-0 transition-opacity group-hover/name:opacity-100"
              aria-hidden="true"
            />
          </button>
        )}
        {/* Repeating "100%" on every row is noise; only a changed value earns space. */}
        {row.opacity < 1 ? (
          <span
            className="w-8 shrink-0 text-right text-[10px] tabular-nums text-folio-muted"
            data-testid={`layer-opacity-value-${row.id}`}
          >
            {Math.round(row.opacity * 100)}%
          </span>
        ) : (
          <span className="sr-only" data-testid={`layer-opacity-value-${row.id}`}>
            {Math.round(row.opacity * 100)}%
          </span>
        )}
        {/* Delete belongs on the row, not two clicks deep under opacity. */}
        <RowButton
          label={`Delete ${row.name}`}
          testId={`layer-delete-${row.id}`}
          disabled={!canDeleteLayer(layerCount)}
          className="opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[always-visible=true]:opacity-100"
          alwaysVisible={row.active}
          danger
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </RowButton>
        <RowButton
          label={`Layer options for ${row.name}`}
          testId={`layer-options-${row.id}`}
          pressed={opacityOpen}
          onClick={onToggleOpacity}
        >
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </RowButton>
      </div>
      {opacityOpen ? (
        <div
          ref={optionsRef}
          className="mb-1 rounded-lg bg-folio-surface-muted p-1"
          data-testid={`layer-options-panel-${row.id}`}
        >
          <ContinuousSlider
            descriptor={{
              key: `layer-opacity-${row.id}`,
              type: "number",
              displayName: "Opacity",
              value: row.opacity,
              defaultValue: 1,
              unit: "%",
              constraints: { minimum: 0, maximum: 1, step: 0.01 },
              displayScale: 100,
              precision: 0,
              validate: (value) => typeof value === "number" && value >= 0 && value <= 1,
            }}
            onChange={onOpacityChange}
            onInteractionStart={onOpacityStart}
            onInteractionCommit={onOpacityCommit}
            // Without this the slider has nothing to call when it unmounts
            // mid-interaction, and the layer-opacity transaction is left open
            // with a preview installed. The stack has always passed it; this is
            // the same edit boundary reached from the other presentation.
            onInteractionCancel={onOpacityCancel}
          />
          <div className="flex items-center gap-1 px-1 pb-0.5">
            <RowButton
              label={`Move ${row.name} up`}
              testId={`layer-move-up-${row.id}`}
              disabled={!row.canMoveUp}
              onClick={() => onMove("up")}
            >
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </RowButton>
            <RowButton
              label={`Move ${row.name} down`}
              testId={`layer-move-down-${row.id}`}
              disabled={!row.canMoveDown}
              onClick={() => onMove("down")}
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </RowButton>
            <span className="flex-1" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The line the dragged row will land on. */
function DropIndicator({ position }: { readonly position: "before" | "after" }) {
  return (
    <span
      className="pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-folio-accent"
      style={position === "before" ? { top: -1 } : { bottom: -1 }}
      data-testid={`layer-drop-indicator-${position}`}
      aria-hidden="true"
    />
  );
}

function RowButton({
  label,
  testId,
  pressed,
  disabled,
  className,
  alwaysVisible,
  danger,
  onClick,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly alwaysVisible?: boolean;
  readonly danger?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35",
        pressed === true && "text-folio-ink",
        danger === true && "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400",
        className,
      )}
      aria-label={label}
      data-testid={testId}
      {...(alwaysVisible === undefined ? {} : { "data-always-visible": alwaysVisible })}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      disabled={disabled === true}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Owns one rename draft. Mounting on demand makes the draft reset naturally. */
function RenameInput({
  layerId,
  name,
  onCommit,
  onCancel,
}: {
  readonly layerId: string;
  readonly name: string;
  readonly onCommit: (draft: string) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      className="min-w-0 flex-1 rounded border border-folio-border bg-folio-surface px-1 text-[11px] text-folio-ink outline-none focus:ring-2 focus:ring-folio-accent"
      aria-label={`Rename ${name}`}
      data-testid={`layer-rename-${layerId}`}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(draft);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
