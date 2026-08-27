import { cn } from "@folio/ui";
import {
  ChevronRight,
  Eraser,
  Highlighter,
  MousePointer2,
  Paintbrush,
  Pencil,
  PenLine,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { EditorTool } from "./editor-types";
import { ToolTooltip } from "./ToolTooltip";

interface ToolDockProps {
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
  /** True when the active tool owns a settings or chooser widget. */
  readonly activeToolHasOptions: boolean;
  readonly toolOptionsOpen: boolean;
  readonly onToggleToolOptions: () => void;
}

interface ToolDefinition {
  readonly label: EditorTool;
  readonly icon: LucideIcon;
  readonly opticalOffset?: string;
}

const selectionTools = [
  { label: "Select", icon: MousePointer2, opticalOffset: "translate-x-px translate-y-px" },
] satisfies readonly ToolDefinition[];

const drawingTools = [
  { label: "Pencil", icon: Pencil },
  { label: "Pen", icon: PenLine },
  { label: "Marker", icon: Paintbrush },
  { label: "Highlighter", icon: Highlighter },
  { label: "Eraser", icon: Eraser },
] satisfies readonly ToolDefinition[];

const objectTools = [{ label: "Shapes", icon: Shapes }] satisfies readonly ToolDefinition[];

const dockButtonClassName =
  "group relative flex size-9 shrink-0 items-center justify-center rounded-[9px] text-[var(--folio-icon-neutral)] transition-[background-color,color,box-shadow] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-40";

const ORDERED_TOOLS: readonly EditorTool[] = Object.freeze([
  ...selectionTools.map(({ label }) => label),
  ...drawingTools.map(({ label }) => label),
  ...objectTools.map(({ label }) => label),
]);

export function ToolDock({
  activeTool,
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

  /**
   * Roving-tabindex toolbar navigation, matching the Quick Color Rail.
   *
   * The dock is one tab stop; arrows move between tools and activate them, so
   * keyboard and pointer users reach the same state.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = ORDERED_TOOLS.indexOf(activeTool);
    if (index < 0) return;
    const last = ORDERED_TOOLS.length - 1;
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tool = ORDERED_TOOLS[next];
    if (tool === undefined || tool === activeTool) return;
    onSelectTool(tool);
    dockRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-tool-name="${tool}"]`)
      ?.focus({ preventScroll: true });
  };

  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2">
      <div
        ref={dockRef}
        className="folio-floating-surface pointer-events-auto flex w-12 flex-col items-center p-1"
        role="toolbar"
        aria-label="Notebook tool dock"
        aria-orientation="vertical"
        data-tool-dock-layout="content-vertical"
        data-tool-dock-keyboard="roving-tabindex"
        data-elevation="permanent"
        data-floating-surface="folio"
        onKeyDown={handleKeyDown}
      >
        <ToolGroup
          tools={selectionTools}
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          activeToolHasOptions={activeToolHasOptions}
          toolOptionsOpen={toolOptionsOpen}
          onToggleToolOptions={onToggleToolOptions}
        />
        <DockSeparator />
        <ToolGroup
          tools={drawingTools}
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          activeToolHasOptions={activeToolHasOptions}
          toolOptionsOpen={toolOptionsOpen}
          onToggleToolOptions={onToggleToolOptions}
        />
        <DockSeparator />
        <ToolGroup
          tools={objectTools}
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          activeToolHasOptions={activeToolHasOptions}
          toolOptionsOpen={toolOptionsOpen}
          onToggleToolOptions={onToggleToolOptions}
        />
      </div>
    </div>
  );
}

function ToolGroup({
  tools,
  activeTool,
  onSelectTool,
  activeToolHasOptions,
  toolOptionsOpen,
  onToggleToolOptions,
}: {
  readonly tools: readonly ToolDefinition[];
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
  readonly activeToolHasOptions: boolean;
  readonly toolOptionsOpen: boolean;
  readonly onToggleToolOptions: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {tools.map((tool) => {
        const active = activeTool === tool.label;
        return (
          <ToolButton
            key={tool.label}
            tool={tool}
            active={active}
            showOptionsAffordance={active && activeToolHasOptions}
            optionsOpen={active && toolOptionsOpen}
            onSelect={onSelectTool}
            onToggleOptions={onToggleToolOptions}
          />
        );
      })}
    </div>
  );
}

function ToolButton({
  tool,
  active,
  showOptionsAffordance,
  optionsOpen,
  onSelect,
  onToggleOptions,
}: {
  readonly tool: ToolDefinition;
  readonly active: boolean;
  readonly showOptionsAffordance: boolean;
  readonly optionsOpen: boolean;
  readonly onSelect: (tool: EditorTool) => void;
  readonly onToggleOptions: () => void;
}) {
  const Icon = tool.icon;
  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          dockButtonClassName,
          active && "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft",
        )}
        aria-label={tool.label}
        aria-pressed={active}
        tabIndex={active ? 0 : -1}
        data-tool-active={active}
        data-tool-name={tool.label}
        data-interaction-motion="selection-140ms"
        onClick={() => onSelect(tool.label)}
      >
        <Icon
          className={cn("size-[17px]", tool.opticalOffset)}
          aria-hidden="true"
          data-optical-alignment={tool.opticalOffset === undefined ? "centered" : "down-right-1px"}
        />
        <ToolTooltip label={tool.label} />
      </button>
      {showOptionsAffordance ? (
        // The one discoverable entry point into the active tool's settings.
        <button
          type="button"
          className="absolute -right-0.5 bottom-0 grid size-3.5 place-items-center rounded-[4px] text-folio-accent transition-transform duration-100 hover:bg-folio-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label={`${tool.label} options`}
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

function DockSeparator() {
  return <span className="my-1 h-px w-7 shrink-0 bg-folio-border" aria-hidden="true" />;
}
