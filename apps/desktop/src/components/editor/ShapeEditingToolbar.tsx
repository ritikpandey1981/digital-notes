import type { ShapeEditingSnapshot, ShapeStylePatch } from "@folio/editor";
import { CopyPlus, MoreHorizontal, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ContinuousSlider } from "./ContinuousSlider";
import { ExpandableToolbarSection } from "./ExpandableToolbarSection";
import { ToolTooltip } from "./ToolTooltip";
import {
  resolveShapeEditingToolbarPlacement,
  type ShapeEditingToolbarSize,
} from "./shape-editing-toolbar-position";
import type { ToolOptionPropertyDescriptor } from "./tool-options-registry";

interface ShapeEditingToolbarProps {
  readonly snapshot: ShapeEditingSnapshot | null;
  readonly onUpdateStyle: (patch: ShapeStylePatch) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}

const TOOLBAR_MARGIN = 12;

export function ShapeEditingToolbar({
  snapshot,
  onUpdateStyle,
  onDuplicate,
  onDelete,
}: ShapeEditingToolbarProps) {
  const toolbarRef = useRef<HTMLElement | null>(null);
  const [toolbarSize, setToolbarSize] = useState<ShapeEditingToolbarSize>({
    width: 0,
    height: 0,
  });
  const [expandedSection, setExpandedSection] = useState<ExpandedSection | null>(null);
  const visible = snapshot !== null;
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
  const placement =
    snapshot === null ? null : resolveShapeEditingToolbarPlacement(snapshot, toolbarSize);
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
    if (activeExpandedSection === null) return;
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target) === true)
        return;
      setExpandedSection(null);
    };
    const dismissWithEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpandedSection(null);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    window.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      window.removeEventListener("keydown", dismissWithEscape);
    };
  }, [activeExpandedSection]);

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
      data-toolbar-expanded-section={activeExpandedSection ?? ""}
      data-selected-shape-type={snapshot?.objectType ?? ""}
      data-floating-surface="folio"
    >
      <label className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-folio-hover focus-within:ring-2 focus-within:ring-folio-accent">
        <span className="sr-only">Shape stroke color</span>
        <span
          className="pointer-events-none size-5 rounded-full border border-black/15 shadow-sm"
          style={{ backgroundColor: snapshot?.strokeColor ?? "#111111" }}
          aria-hidden="true"
        />
        <input
          className="absolute size-px opacity-0"
          type="color"
          aria-label="Shape stroke color"
          value={snapshot?.strokeColor ?? "#111111"}
          tabIndex={visible ? 0 : -1}
          disabled={!visible}
          onChange={(event) => onUpdateStyle({ strokeColor: event.currentTarget.value })}
        />
      </label>
      <span className="h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
      <ExpandableToolbarSection
        id="strokeWidth"
        label="Width"
        ariaLabel="Shape stroke width"
        summary={`${formatWidth(snapshot?.strokeWidth ?? 2)} px`}
        open={visible && activeExpandedSection === "strokeWidth"}
        disabled={!visible}
        onOpenChange={(open) =>
          setExpandedSection(
            open && snapshot !== null ? { id: "strokeWidth", objectId: snapshot.objectId } : null,
          )
        }
      >
        <ContinuousSlider
          descriptor={widthDescriptor}
          onChange={(strokeWidth) => onUpdateStyle({ strokeWidth })}
        />
      </ExpandableToolbarSection>
      <ExpandableToolbarSection
        id="opacity"
        label="Opacity"
        ariaLabel="Shape stroke opacity"
        summary={`${Math.round((snapshot?.opacity ?? 1) * 100)} %`}
        open={visible && activeExpandedSection === "opacity"}
        disabled={!visible}
        onOpenChange={(open) =>
          setExpandedSection(
            open && snapshot !== null ? { id: "opacity", objectId: snapshot.objectId } : null,
          )
        }
      >
        <ContinuousSlider
          descriptor={opacityDescriptor}
          onChange={(opacity) => onUpdateStyle({ opacity })}
        />
      </ExpandableToolbarSection>
      <span className="h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
      <ToolbarButton
        label="Duplicate shape"
        disabled={!visible}
        onClick={onDuplicate}
        icon={<CopyPlus className="size-4" aria-hidden="true" />}
      />
      <ToolbarButton
        label="Delete shape"
        disabled={!visible}
        onClick={onDelete}
        danger
        icon={<Trash2 className="size-4" aria-hidden="true" />}
      />
      <ToolbarButton
        label="More shape options"
        disabled
        icon={<MoreHorizontal className="size-[17px]" aria-hidden="true" />}
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
