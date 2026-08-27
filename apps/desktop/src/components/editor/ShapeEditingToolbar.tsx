import type { ShapeEditingSnapshot, ShapeStylePatch } from "@folio/editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@folio/ui";
import { CopyPlus, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { pushDismissal } from "./floating-dismissal-stack";
import { ContinuousSlider } from "./ContinuousSlider";
import { ExpandableToolbarSection } from "./ExpandableToolbarSection";
import { ToolTooltip } from "./ToolTooltip";
import { collectEditorOccupiedZones, measureSurfaceRect } from "./editor-workspace-zones";
import {
  resolveShapeEditingToolbarPlacement,
  toolbarZonesFromOccupied,
  type ShapeEditingToolbarSize,
} from "./shape-editing-toolbar-position";
import type { ToolOptionPropertyDescriptor } from "./tool-options-registry";

interface ShapeEditingToolbarProps {
  readonly snapshot: ShapeEditingSnapshot | null;
  readonly onBeginStyleEdit: () => void;
  readonly onPreviewStyle: (patch: ShapeStylePatch) => void;
  readonly onCommitStyleEdit: () => void;
  readonly onCancelStyleEdit: () => void;
  readonly onOpenColorPicker: (anchor: HTMLElement) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly layers: readonly Readonly<{ id: string; name: string }>[];
  readonly onMoveToLayer: (layerId: string) => void;
}

const TOOLBAR_MARGIN = 12;

export function ShapeEditingToolbar({
  snapshot,
  onBeginStyleEdit,
  onPreviewStyle,
  onCommitStyleEdit,
  onCancelStyleEdit,
  onOpenColorPicker,
  onDuplicate,
  onDelete,
  layers,
  onMoveToLayer,
}: ShapeEditingToolbarProps) {
  const toolbarRef = useRef<HTMLElement | null>(null);
  const expandedSectionScope = useId();
  const selectedObjectIdRef = useRef<string | null>(null);
  const [toolbarSize, setToolbarSize] = useState<ShapeEditingToolbarSize>({
    width: 0,
    height: 0,
  });
  const [expandedSection, setExpandedSection] = useState<ExpandedSection | null>(null);
  const visible = snapshot !== null;
  // A read-only selection stays visible and selectable, but every mutation
  // control is disabled rather than silently doing nothing.
  const readOnly = snapshot?.readOnly === true;
  const interactive = visible && !readOnly;
  const activeExpandedSection =
    expandedSection !== null && snapshot?.objectId === expandedSection.objectId
      ? expandedSection.id
      : null;
  const widthDescriptor = useMemo(
    () => shapeWidthDescriptor(snapshot?.strokeWidth ?? 2),
    [snapshot?.strokeWidth],
  );
  const opacityDescriptor = useMemo(
    () => shapeOpacityDescriptor(snapshot?.opacity ?? 1),
    [snapshot?.opacity],
  );
  // The toolbar reads the same measured chrome as every other floating
  // surface, minus itself, so a Layers panel or open Page Settings pushes it
  // aside exactly like the right rail always did.
  const workspaceOrigin = measureSurfaceRect(
    document.querySelector('[data-testid="editor-workspace"]'),
  );
  const occupiedZones =
    snapshot === null || workspaceOrigin === undefined
      ? []
      : toolbarZonesFromOccupied(
          collectEditorOccupiedZones({ exclude: ["selection-toolbar"] }),
          workspaceOrigin,
        );
  const placement =
    snapshot === null
      ? null
      : resolveShapeEditingToolbarPlacement(snapshot, toolbarSize, occupiedZones);
  const maximumToolbarWidth =
    snapshot === null
      ? `calc(100% - ${TOOLBAR_MARGIN * 2}px)`
      : snapshot.viewportSize.width - TOOLBAR_MARGIN * 2;
  const position: CSSProperties =
    placement === null
      ? {
          left: TOOLBAR_MARGIN,
          top: TOOLBAR_MARGIN,
          opacity: 0,
          visibility: "hidden",
          transform: "translateY(4px)",
          maxWidth: maximumToolbarWidth,
        }
      : {
          left: placement.left,
          top: placement.top,
          opacity: 1,
          visibility: "visible",
          transform: "translateY(0)",
          maxWidth: maximumToolbarWidth,
        };

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (toolbar === null) return;
    // Deliberately the bar alone. An expanded Width or Opacity section hangs
    // below it, and folding that into the toolbar's own size would make the bar
    // jump the moment a section opens. Other surfaces still see the expansion:
    // the shared zone collector unions it into this toolbar's occupied rect.
    const measure = (): void => {
      const bounds = toolbar.getBoundingClientRect();
      setToolbarSize((previous) =>
        previous.width === bounds.width && previous.height === bounds.height
          ? previous
          : { width: bounds.width, height: bounds.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const objectId = snapshot?.objectId ?? null;
    if (selectedObjectIdRef.current !== objectId) onCancelStyleEdit();
    selectedObjectIdRef.current = objectId;
  }, [onCancelStyleEdit, snapshot?.objectId]);

  useEffect(() => {
    if (activeExpandedSection === null) return;
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target) === true)
        return;
      onCancelStyleEdit();
      setExpandedSection(null);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    // The expanded section joins the shared dismissal stack so one Escape
    // closes it alone and never also clears the canvas selection beneath it.
    const releaseDismissal = pushDismissal(expandedSectionScope, () => {
      onCancelStyleEdit();
      setExpandedSection(null);
    });
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      releaseDismissal();
    };
  }, [activeExpandedSection, expandedSectionScope, onCancelStyleEdit]);

  return (
    <section
      ref={toolbarRef}
      className="folio-floating-surface pointer-events-auto absolute z-20 flex h-12 w-max items-center gap-1 px-2 transition-[opacity,transform,visibility] duration-150 ease-out"
      style={position}
      role="toolbar"
      aria-label="Shape editing toolbar"
      aria-hidden={!visible}
      data-testid="shape-editing-toolbar"
      data-toolbar-mounted="true"
      data-toolbar-state={visible ? "visible" : "hidden"}
      data-toolbar-sizing="content"
      data-toolbar-placement={placement?.side ?? "hidden"}
      data-toolbar-collision-policy="selection-controls"
      data-toolbar-occupied-zones={occupiedZones.length}
      data-toolbar-expanded-section={activeExpandedSection ?? ""}
      data-selection-read-only={readOnly}
      data-selected-shape-type={snapshot?.objectType ?? ""}
      data-floating-surface="folio"
    >
      <button
        type="button"
        className="group relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-folio-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35"
        aria-label="Stroke color"
        data-testid="selected-vector-color-trigger"
        tabIndex={interactive ? 0 : -1}
        disabled={!interactive}
        onClick={(event) => onOpenColorPicker(event.currentTarget)}
      >
        <span
          className="size-5 rounded-full border border-black/15 shadow-sm"
          style={{ backgroundColor: snapshot?.strokeColor ?? "#111111" }}
          aria-hidden="true"
        />
        <ToolTooltip label="Stroke color" side="bottom" />
      </button>
      {readOnly ? (
        <span
          className="flex shrink-0 items-center gap-1 rounded-md bg-folio-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-folio-muted"
          data-testid="selection-read-only-badge"
        >
          <Lock className="size-3" aria-hidden="true" />
          Locked
        </span>
      ) : null}
      <span className="h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
      <ExpandableToolbarSection
        id="strokeWidth"
        label="Width"
        ariaLabel="Stroke width"
        summary={`${formatWidth(snapshot?.strokeWidth ?? 2)} px`}
        open={interactive && activeExpandedSection === "strokeWidth"}
        disabled={!interactive}
        onOpenChange={(open) => {
          if (!open) onCancelStyleEdit();
          setExpandedSection(
            open && snapshot !== null ? { id: "strokeWidth", objectId: snapshot.objectId } : null,
          );
        }}
      >
        <ContinuousSlider
          descriptor={widthDescriptor}
          onChange={(strokeWidth) => onPreviewStyle({ strokeWidth })}
          onInteractionStart={onBeginStyleEdit}
          onInteractionCommit={onCommitStyleEdit}
          onInteractionCancel={onCancelStyleEdit}
        />
      </ExpandableToolbarSection>
      <ExpandableToolbarSection
        id="opacity"
        label="Opacity"
        ariaLabel="Stroke opacity"
        summary={`${Math.round((snapshot?.opacity ?? 1) * 100)} %`}
        open={interactive && activeExpandedSection === "opacity"}
        disabled={!interactive}
        onOpenChange={(open) => {
          if (!open) onCancelStyleEdit();
          setExpandedSection(
            open && snapshot !== null ? { id: "opacity", objectId: snapshot.objectId } : null,
          );
        }}
      >
        <ContinuousSlider
          descriptor={opacityDescriptor}
          onChange={(opacity) => onPreviewStyle({ opacity })}
          onInteractionStart={onBeginStyleEdit}
          onInteractionCommit={onCommitStyleEdit}
          onInteractionCancel={onCancelStyleEdit}
        />
      </ExpandableToolbarSection>
      <span className="h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
      <ToolbarButton
        label="Duplicate"
        disabled={!interactive}
        onClick={onDuplicate}
        icon={<CopyPlus className="size-4" aria-hidden="true" />}
      />
      <ToolbarButton
        label="Delete"
        disabled={!interactive}
        onClick={onDelete}
        danger
        icon={<Trash2 className="size-4" aria-hidden="true" />}
      />
      <MoveToLayerMenu
        visible={interactive}
        layers={layers}
        currentLayerId={snapshot?.layerId ?? null}
        onMoveToLayer={onMoveToLayer}
      />
    </section>
  );
}

interface ExpandedSection {
  readonly id: string;
  readonly objectId: string;
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
  danger = false,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`group relative flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--folio-icon-neutral)] transition-[background-color,color] duration-100 hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35 ${danger ? "hover:text-red-600 dark:hover:text-red-400" : ""}`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <ToolTooltip label={label} side="bottom" />
    </button>
  );
}

function shapeWidthDescriptor(value: number): ToolOptionPropertyDescriptor {
  return Object.freeze({
    key: "strokeWidth",
    control: "continuous-number",
    type: "number",
    displayName: "Width",
    value,
    defaultValue: 2,
    constraints: Object.freeze({ minimum: 0.5, maximum: 30, step: 0.1 }),
    largeStep: 1,
    precision: 1,
    unit: "px",
    validate: (candidate: unknown): boolean =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0.5 &&
      candidate <= 30,
  });
}

function shapeOpacityDescriptor(value: number): ToolOptionPropertyDescriptor {
  return Object.freeze({
    key: "opacity",
    control: "continuous-number",
    type: "number",
    displayName: "Opacity",
    value,
    defaultValue: 1,
    constraints: Object.freeze({ minimum: 0.1, maximum: 1, step: 0.01 }),
    largeStep: 0.05,
    displayScale: 100,
    precision: 0,
    unit: "%",
    validate: (candidate: unknown): boolean =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0.1 &&
      candidate <= 1,
  });
}

function formatWidth(value: number): string {
  return value.toFixed(1).replace(/\.0$/u, "");
}

/** Compact Layer destination menu for the current selection. */
function MoveToLayerMenu({
  visible,
  layers,
  currentLayerId,
  onMoveToLayer,
}: {
  readonly visible: boolean;
  readonly layers: readonly Readonly<{ id: string; name: string }>[];
  readonly currentLayerId: string | null;
  readonly onMoveToLayer: (layerId: string) => void;
}) {
  const destinations = layers.filter((layer) => layer.id !== currentLayerId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group relative flex size-8 shrink-0 items-center justify-center rounded-lg text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-35"
          aria-label="More selection options"
          data-testid="selection-more-options"
          tabIndex={visible ? 0 : -1}
          disabled={!visible}
          data-selection-read-only={!visible}
        >
          <MoreHorizontal className="size-[17px]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-floating-widget-owned-portal="true"
        data-testid="selection-more-menu"
      >
        <DropdownMenuLabel>Move to layer</DropdownMenuLabel>
        {destinations.length === 0 ? (
          <DropdownMenuItem disabled data-testid="move-to-layer-empty">
            No other layers
          </DropdownMenuItem>
        ) : (
          destinations.map((layer) => (
            <DropdownMenuItem
              key={layer.id}
              data-testid={`move-to-layer-${layer.id}`}
              onSelect={() => onMoveToLayer(layer.id)}
            >
              {layer.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
