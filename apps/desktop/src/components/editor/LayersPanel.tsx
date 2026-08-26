import type { LayerActions, LayersSnapshot } from "@folio/editor";
import { cn } from "@folio/ui";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { ContinuousSlider } from "./ContinuousSlider";
import {
  canDeleteLayer,
  describeDeletedLayer,
  LAYER_PANEL_WIDTH,
  LAYER_ROW_HEIGHT,
  layerRows,
  moveTargetIndex,
  nextFocusIndex,
  normalizeLayerName,
  type LayerRow,
} from "./layers-panel-model";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface LayersPanelProps {
  readonly open: boolean;
  readonly snapshot: LayersSnapshot;
  readonly actions: LayerActions | null;
  readonly onDismiss: () => void;
  readonly onNotify: (message: string) => void;
}

export function LayersPanel({ open, snapshot, actions, onDismiss, onNotify }: LayersPanelProps) {
  const reducedMotion = useReducedMotion() === true;
  const boundaryRef = useRef<HTMLElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [opacityLayerId, setOpacityLayerId] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const floatingWidgetScope = useFloatingWidgetDismissal(open, onDismiss, boundaryRef, {
    outsidePointerDismissal: "ignore",
    onEscape: () => {
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
  const rows = layerRows(snapshot);
  // Closing the panel discards transient row state without an effect.
  if (!open && (renamingLayerId !== null || opacityLayerId !== null)) {
    setRenamingLayerId(null);
    setOpacityLayerId(null);
  }

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (renamingLayerId !== null) return;
    const row = rows[focusIndex];
    if (row === undefined) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const direction = event.key === "ArrowUp" ? "up" : "down";
      event.preventDefault();
      if (event.altKey) {
        const target = moveTargetIndex(row, direction, rows.length);
        if (target !== null && actions?.moveLayer(row.id, target) === true) {
          setFocusIndex(nextFocusIndex(focusIndex, direction, rows.length));
        }
        return;
      }
      const next = nextFocusIndex(focusIndex, direction, rows.length);
      setFocusIndex(next);
      rowRefs.current[next]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      actions?.setActiveLayer(row.id);
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
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              duration: motionSeconds(INTERACTION_MOTION.floatingMilliseconds, reducedMotion),
              ease: PROFESSIONAL_EASE,
            }}
          >
            <header className="flex shrink-0 items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold text-folio-ink">Layers</span>
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
            </header>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-1 pb-1"
              role="listbox"
              aria-label="Layer list"
              aria-orientation="vertical"
              data-testid="layers-list"
              onKeyDown={handleListKeyDown}
            >
              {rows.map((row, index) => (
                <LayerRowView
                  key={row.id}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  row={row}
                  tabIndex={index === focusIndex ? 0 : -1}
                  layerCount={rows.length}
                  renaming={renamingLayerId === row.id}
                  opacityOpen={opacityLayerId === row.id}
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
                  onMove={(direction) => {
                    const target = moveTargetIndex(row, direction, rows.length);
                    if (target !== null) actions?.moveLayer(row.id, target);
                  }}
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

interface LayerRowViewProps {
  readonly row: LayerRow;
  readonly tabIndex: number;
  readonly layerCount: number;
  readonly renaming: boolean;
  readonly opacityOpen: boolean;
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
  readonly onOpacityCommit: () => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onDelete: () => void;
}

function LayerRowView({
  ref,
  row,
  tabIndex,
  layerCount,
  renaming,
  opacityOpen,
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
  onMove,
  onDelete,
}: LayerRowViewProps & { readonly ref?: (element: HTMLDivElement | null) => void }) {
  return (
    <div data-testid={`layer-row-${row.id}`} data-layer-active={row.active}>
      <div
        ref={ref}
        role="option"
        data-testid={`layer-row-button-${row.id}`}
        tabIndex={tabIndex}
        aria-selected={row.active}
        aria-label={`${row.name}, ${row.objectCount} object${row.objectCount === 1 ? "" : "s"}`}
        className={cn(
          "group flex items-center gap-1 rounded-lg px-1 outline-none transition-colors",
          row.active ? "bg-folio-accent-soft" : "hover:bg-folio-hover",
          "focus-visible:ring-2 focus-visible:ring-folio-accent",
        )}
        style={{ height: LAYER_ROW_HEIGHT }}
        onFocus={onFocusRow}
        onClick={onActivate}
        onDoubleClick={onStartRename}
      >
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
          <span
            className="min-w-0 flex-1 truncate text-[11px] text-folio-ink"
            data-testid={`layer-name-${row.id}`}
          >
            {row.name}
          </span>
        )}
        <span
          className="w-8 shrink-0 text-right text-[10px] tabular-nums text-folio-muted"
          data-testid={`layer-opacity-value-${row.id}`}
        >
          {Math.round(row.opacity * 100)}%
        </span>
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
            <RowButton
              label={`Delete ${row.name}`}
              testId={`layer-delete-${row.id}`}
              disabled={!canDeleteLayer(layerCount)}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </RowButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RowButton({
  label,
  testId,
  pressed,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly testId: string;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35",
        pressed === true && "text-folio-ink",
      )}
      aria-label={label}
      data-testid={testId}
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
