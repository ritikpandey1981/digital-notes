import { cn } from "@folio/ui";
import {
  Eraser,
  Highlighter,
  MousePointer2,
  Paintbrush,
  Pencil,
  PenTool,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import type { DrawingToolKind } from "@folio/editor";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { useTheme } from "../theme/ThemeProvider";
import type { EditorTool } from "./editor-types";
import {
  DRAWING_SLOTS,
  UTILITY_SLOTS,
  dockSlotTools,
  resolveActiveDockSlotId,
  resolveDockKeyboardTarget,
  resolveTabbableDockSlotId,
  type DockSlotDefinition,
  type DrawingSlotDefinition,
} from "./tool-dock-model";
import { ToolTooltip } from "./ToolTooltip";
import { resolveToolDockGlyphContrast, type ToolDockAppearance } from "./tool-dock-color-contrast";

interface ToolDockProps {
  readonly activeTool: EditorTool;
  readonly activeDrawingSlotId: string | null;
  /**
   * The family each drawing slot currently holds, keyed by slot id.
   *
   * A slot is a position, not a tool: its icon and the tool it activates follow
   * whatever brush has been assigned to it. Omitted, the seeded families apply.
   */
  readonly slotFamilies?: Readonly<Record<string, DrawingToolKind>>;
  /**
   * The name of the brush each drawing slot currently holds, keyed by slot id.
   *
   * A slot is a position; what it holds is a brush. Naming it after the family
   * it was seeded with would keep announcing "Pen" long after the artist put a
   * pencil in it. Omitted, the seeded labels apply.
   */
  readonly slotBrushNames?: Readonly<Record<string, string>>;
  /** The library identity id each drawing slot holds, or "" for none. */
  readonly slotBrushIds?: Readonly<Record<string, string>>;
  /** Canonical current colour of each independently resolved drawing slot. */
  readonly slotDrawingColors: Readonly<Record<string, string>>;
  /**
   * Activates one drawing slot.
   *
   * The dock reports the press; what it means — take this tool, or choose a
   * brush for the tool already in hand — is decided by the workspace from
   * which slot is currently active.
   */
  readonly onSelectDrawingSlot: (slot: DrawingSlotDefinition) => void;
  readonly onSelectTool: (tool: EditorTool) => void;
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
  select: MousePointer2,
  eraser: Eraser,
  shapes: Shapes,
});

/**
 * A drawing slot's glyph follows the family it currently holds.
 *
 * A slot given a pencil must stop reading as a pen; the dock would otherwise
 * be labelling the slot with a tool it no longer activates. The glyphs are the
 * existing Folio vocabulary, unchanged.
 */
const FAMILY_ICONS: Readonly<Record<DrawingToolKind, LucideIcon>> = Object.freeze({
  pencil: Pencil,
  pen: PenTool,
  marker: Paintbrush,
  highlighter: Highlighter,
});

/** Optical nudges for glyphs whose ink sits off-centre in their box. */
const SLOT_OPTICAL_OFFSETS: Readonly<Record<string, string>> = Object.freeze({
  select: "translate-x-px translate-y-px",
});

const dockButtonClassName =
  "group relative flex size-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--folio-icon-neutral)] transition-[background-color,color,box-shadow] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-40";

const dockCapsuleClassName =
  "folio-floating-surface pointer-events-auto flex w-12 flex-col items-center gap-1 p-1";

/**
 * A soft theme-opposite neutral taken entirely from the active Folio surface
 * tokens. At 2.75px only 0.375px can show on either side of the exact 2px
 * artwork stroke, so it reads as silhouette separation rather than a halo.
 */
const DRAWING_GLYPH_KEYLINE_COLOR =
  "color-mix(in srgb, var(--folio-ink) 68%, var(--folio-surface))";

export function ToolDock({
  activeTool,
  activeDrawingSlotId,
  slotFamilies,
  slotBrushNames,
  slotBrushIds,
  slotDrawingColors,
  onSelectDrawingSlot,
  onSelectTool,
}: ToolDockProps) {
  const { theme } = useTheme();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const renderCountRef = useRef(0);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (dockRef.current !== null) {
      dockRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });

  const families = slotFamilies ?? {};
  const brushNames = slotBrushNames ?? {};
  const brushIds = slotBrushIds ?? {};
  const activeSlotId = resolveActiveDockSlotId(activeTool, activeDrawingSlotId, families);
  const slotTools = dockSlotTools(families);
  const tabbableSlotId = resolveTabbableDockSlotId(activeSlotId);

  const activateSlotId = (slotId: string): void => {
    const drawingSlot = DRAWING_SLOTS.find((slot) => slot.id === slotId);
    if (drawingSlot !== undefined) {
      onSelectDrawingSlot(drawingSlot);
      return;
    }
    void slotTools;
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
            family={families[slot.id] ?? slot.family}
            position={DRAWING_SLOTS.indexOf(slot) + 1}
            brushName={brushNames[slot.id]}
            brushId={brushIds[slot.id] ?? ""}
            active={activeSlotId === slot.id}
            tabbable={tabbableSlotId === slot.id}
            drawingColor={slotDrawingColors[slot.id] ?? null}
            appearance={theme}
            onActivate={activateSlotId}
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
            onActivate={activateSlotId}
          />
        ))}
      </div>
    </div>
  );
}

function DockButton({
  slot,
  family,
  position,
  brushName,
  brushId,
  active,
  tabbable,
  drawingColor,
  appearance,
  onActivate,
}: {
  readonly slot: DockSlotDefinition;
  /** Present for drawing slots: the family currently assigned to this slot. */
  readonly family?: DrawingToolKind | undefined;
  /** 1-based position of a drawing slot, which never changes. */
  readonly position?: number | undefined;
  /** The brush this drawing slot currently holds. */
  readonly brushName?: string | undefined;
  /** Its library identity id, or "" where the slot holds no catalogue brush. */
  readonly brushId?: string | undefined;
  readonly active: boolean;
  readonly tabbable: boolean;
  readonly drawingColor?: string | null | undefined;
  readonly appearance?: ToolDockAppearance | undefined;
  readonly onActivate: (slotId: string) => void;
}) {
  const Icon =
    family === undefined ? (SLOT_ICONS[slot.id] ?? Pencil) : (FAMILY_ICONS[family] ?? Pencil);
  // Position and contents together: the number is the stable physical slot the
  // artist reaches for, the brush name is what is currently in it. A utility is
  // a fixed category and keeps its own name.
  const accessibleName =
    position === undefined || brushName === undefined
      ? slot.label
      : `Brush slot ${position}, ${brushName}`;
  const tooltipLabel = brushName ?? slot.label;
  const opticalOffset = SLOT_OPTICAL_OFFSETS[slot.id];
  const drawingContrast =
    family !== undefined && drawingColor != null && appearance !== undefined
      ? resolveToolDockGlyphContrast(drawingColor, appearance, active)
      : null;
  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          dockButtonClassName,
          active &&
            (family === undefined
              ? "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft"
              : "rounded-[6px] bg-transparent text-[var(--folio-icon-neutral)] hover:bg-transparent"),
        )}
        aria-label={accessibleName}
        aria-pressed={active}
        tabIndex={tabbable ? 0 : -1}
        data-tool-active={active}
        // The brush this slot currently holds, not the family it was seeded
        // with. A generic slot that has been given a pencil must stop
        // reporting "Pen"; `data-dock-slot` is the stable physical identity.
        data-tool-name={tooltipLabel}
        data-dock-slot={slot.id}
        data-slot-family={family ?? ""}
        data-slot-brush={brushId ?? ""}
        data-drawing-slot-selection={
          family === undefined ? undefined : active ? "flat" : "inactive"
        }
        data-interaction-motion="selection-140ms"
        // One press, whatever modifiers are held. What it means is decided by
        // the workspace from which slot is already active.
        onClick={() => onActivate(slot.id)}
      >
        {active && family !== undefined ? (
          <span
            className="pointer-events-none absolute inset-y-0 -inset-x-1 rounded-[6px] bg-folio-surface-muted"
            aria-hidden="true"
            data-testid="drawing-slot-selected-surface"
          >
            <span className="absolute right-0 top-2 bottom-2 w-px rounded-full bg-folio-accent opacity-60" />
          </span>
        ) : null}
        {family === undefined ? (
          <Icon
            className={cn("size-[17px]", opticalOffset)}
            aria-hidden="true"
            data-optical-alignment={opticalOffset === undefined ? "centered" : "down-right-1px"}
          />
        ) : (
          <span
            className="pointer-events-none relative grid size-[21px] place-items-center"
            aria-hidden="true"
            data-drawing-slot-glyph-frame={slot.id}
          >
            {drawingContrast?.needsKeyline === true ? (
              <Icon
                className="pointer-events-none absolute size-[17px]"
                style={{ color: DRAWING_GLYPH_KEYLINE_COLOR }}
                strokeWidth={2.75}
                aria-hidden="true"
                data-testid="drawing-slot-contrast-keyline"
                data-drawing-slot-glyph-keyline={slot.id}
              />
            ) : null}
            <Icon
              className="relative z-[1] size-[17px]"
              // Every drawing glyph reads its own slot's canonical resolved
              // colour. Contrast is supplied around it, never by changing its
              // stroke, scale, geometry or exact artwork colour.
              style={drawingColor != null ? { color: drawingColor } : undefined}
              strokeWidth={2}
              data-drawing-slot-glyph={slot.id}
              data-drawing-slot-glyph-active={active}
              data-drawing-slot-glyph-color={drawingColor ?? ""}
              data-drawing-slot-glyph-contrast={
                drawingContrast?.needsKeyline === true ? "keylined" : "direct"
              }
              data-drawing-slot-glyph-contrast-ratio={
                drawingContrast?.contrastRatio.toFixed(2) ?? ""
              }
              data-optical-alignment="centered"
            />
          </span>
        )}
        <ToolTooltip label={tooltipLabel} />
      </button>
    </div>
  );
}
