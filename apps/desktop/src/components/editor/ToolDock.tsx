import { cn } from "@folio/ui";
import {
  ChevronRight,
  Eraser,
  Highlighter,
  MousePointer2,
  Paintbrush,
  Pencil,
  PenLine,
  PenTool,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { EditorTool } from "./editor-types";
import {
  DRAWING_SLOTS,
  UTILITY_SLOTS,
  resolveActiveDockSlotId,
  resolveDockKeyboardTarget,
  resolveTabbableDockSlotId,
  type DockSlotDefinition,
  type DrawingSlotDefinition,
} from "./tool-dock-model";
import { ToolTooltip } from "./ToolTooltip";

interface ToolDockProps {
  readonly activeTool: EditorTool;
  readonly activeDrawingSlotId: string | null;
  readonly onSelectDrawingSlot: (slot: DrawingSlotDefinition) => void;
  readonly onSelectTool: (tool: EditorTool) => void;
  /** True when the active tool owns a settings or chooser widget. */
  readonly activeToolHasOptions: boolean;
  readonly toolOptionsOpen: boolean;
  readonly onToggleToolOptions: () => void;
}

/**
 * Per-slot iconography.
 *
 * Utilities are semantic icons because they are stable categories. Drawing
 * slots use the closest honest tool glyph as a deliberately temporary stand-in:
 * `docs/design/drawing-tool-system.md` §5 makes a representative stroke the
 * slot's real identity, and that preview is its own piece of work. A
 * hand-drawn approximation here would imply brush behaviour the engine does not
 * have yet.
 */
const SLOT_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  pencil: Pencil,
  pen: PenLine,
  "brush-pen": PenTool,
  marker: Paintbrush,
  highlighter: Highlighter,
  select: MousePointer2,
  eraser: Eraser,
  shapes: Shapes,
});

/** Optical nudges for glyphs whose ink sits off-centre in their box. */
const SLOT_OPTICAL_OFFSETS: Readonly<Record<string, string>> = Object.freeze({
  select: "translate-x-px translate-y-px",
});

const dockButtonClassName =
  "group relative flex size-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--folio-icon-neutral)] transition-[background-color,color,box-shadow] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-40";

const dockCapsuleClassName =
  "folio-floating-surface pointer-events-auto flex w-12 flex-col items-center gap-1 p-1";

export function ToolDock({
  activeTool,
  activeDrawingSlotId,
  onSelectDrawingSlot,
  onSelectTool,
  activeToolHasOptions,
  toolOptionsOpen,
  onToggleToolOptions,
}: ToolDockProps) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const renderCountRef = useRef(0);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (dockRef.current !== null) {
      dockRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });

  const activeSlotId = resolveActiveDockSlotId(activeTool, activeDrawingSlotId);
  const tabbableSlotId = resolveTabbableDockSlotId(activeSlotId);

  const activateSlotId = (slotId: string): void => {
    const drawingSlot = DRAWING_SLOTS.find((slot) => slot.id === slotId);
    if (drawingSlot !== undefined) {
      onSelectDrawingSlot(drawingSlot);
      return;
    }
    const utilitySlot = UTILITY_SLOTS.find((slot) => slot.id === slotId);
    if (utilitySlot !== undefined) onSelectTool(utilitySlot.tool);
  };

  /**
   * Roving-tabindex navigation across BOTH capsules.
   *
   * The two surfaces are one logical toolbar and one tab stop; arrows move
   * between all eight slots and activate them, so keyboard and pointer users
   * reach the same state. The visual gap is grouping, not a boundary.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = resolveDockKeyboardTarget(activeSlotId, event.key);
    if (target === null) return;
    event.preventDefault();
    activateSlotId(target);
    dockRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-dock-slot="${target}"]`)
      ?.focus({ preventScroll: true });
  };

  return (
    // One logical dock: `data-tool-dock-layout` stays on the element that spans
    // both capsules, so occupied-zone measurement, picker placement and
    // dismissal all keep treating the dock as a single region.
    <div
      ref={dockRef}
      className="pointer-events-none absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-3"
      role="toolbar"
      aria-label="Notebook tool dock"
      aria-orientation="vertical"
      data-tool-dock-layout="content-vertical"
      data-tool-dock-keyboard="roving-tabindex"
      data-tool-dock-groups="drawing-utility"
      data-elevation="permanent"
      onKeyDown={handleKeyDown}
    >
      <div
        className={dockCapsuleClassName}
        data-tool-dock-group="drawing"
        data-floating-surface="folio"
      >
        {DRAWING_SLOTS.map((slot) => (
          <DockButton
            key={slot.id}
            slot={slot}
            active={activeSlotId === slot.id}
            tabbable={tabbableSlotId === slot.id}
            showOptionsAffordance={activeSlotId === slot.id && activeToolHasOptions}
            optionsOpen={activeSlotId === slot.id && toolOptionsOpen}
            onActivate={activateSlotId}
            onToggleOptions={onToggleToolOptions}
          />
        ))}
      </div>
      <div
        className={dockCapsuleClassName}
        data-tool-dock-group="utility"
        data-floating-surface="folio"
      >
        {UTILITY_SLOTS.map((slot) => (
          <DockButton
            key={slot.id}
            slot={slot}
            active={activeSlotId === slot.id}
            tabbable={tabbableSlotId === slot.id}
            showOptionsAffordance={activeSlotId === slot.id && activeToolHasOptions}
            optionsOpen={activeSlotId === slot.id && toolOptionsOpen}
            onActivate={activateSlotId}
            onToggleOptions={onToggleToolOptions}
          />
        ))}
      </div>
    </div>
  );
}

function DockButton({
  slot,
  active,
  tabbable,
  showOptionsAffordance,
  optionsOpen,
  onActivate,
  onToggleOptions,
}: {
  readonly slot: DockSlotDefinition;
  readonly active: boolean;
  readonly tabbable: boolean;
  readonly showOptionsAffordance: boolean;
  readonly optionsOpen: boolean;
  readonly onActivate: (slotId: string) => void;
  readonly onToggleOptions: () => void;
}) {
  const Icon = SLOT_ICONS[slot.id] ?? Pencil;
  const opticalOffset = SLOT_OPTICAL_OFFSETS[slot.id];
  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          dockButtonClassName,
          active && "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft",
        )}
        aria-label={slot.label}
        aria-pressed={active}
        tabIndex={tabbable ? 0 : -1}
        data-tool-active={active}
        data-tool-name={slot.label}
        data-dock-slot={slot.id}
        data-interaction-motion="selection-140ms"
        onClick={() => onActivate(slot.id)}
      >
        <Icon
          className={cn("size-[17px]", opticalOffset)}
          aria-hidden="true"
          data-optical-alignment={opticalOffset === undefined ? "centered" : "down-right-1px"}
        />
        <ToolTooltip label={slot.label} />
      </button>
      {showOptionsAffordance ? (
        // The one discoverable entry point into the active tool's settings.
        <button
          type="button"
          className="absolute -right-0.5 bottom-0 grid size-3.5 place-items-center rounded-[4px] text-folio-accent transition-transform duration-100 hover:bg-folio-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label={`${slot.label} options`}
          aria-expanded={optionsOpen}
          tabIndex={-1}
          data-testid="tool-options-affordance"
          data-tool-options-open={optionsOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleOptions();
          }}
        >
          <ChevronRight
            className={cn("size-3 transition-transform duration-100", optionsOpen && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </div>
  );
}
