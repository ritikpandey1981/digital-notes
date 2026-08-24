import { cn } from "@folio/ui";
import {
  Eraser,
  Highlighter,
  MousePointer2,
  Paintbrush,
  Pencil,
  PenLine,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import type { EditorTool } from "./editor-types";
import { ToolTooltip } from "./ToolTooltip";

interface ToolDockProps {
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
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

export function ToolDock({ activeTool, onSelectTool }: ToolDockProps) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const renderCountRef = useRef(0);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (dockRef.current !== null) {
      dockRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });
  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2">
      <div
        ref={dockRef}
        className="folio-floating-surface pointer-events-auto flex w-12 flex-col items-center p-1"
        role="toolbar"
        aria-label="Notebook tool dock"
        aria-orientation="vertical"
        data-tool-dock-layout="content-vertical"
        data-elevation="permanent"
        data-floating-surface="folio"
      >
        <ToolGroup tools={selectionTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <ToolGroup tools={drawingTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <ToolGroup tools={objectTools} activeTool={activeTool} onSelectTool={onSelectTool} />
      </div>
    </div>
  );
}

function ToolGroup({
  tools,
  activeTool,
  onSelectTool,
}: {
  readonly tools: readonly ToolDefinition[];
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {tools.map((tool) => (
        <ToolButton
          key={tool.label}
          tool={tool}
          active={activeTool === tool.label}
          onSelect={onSelectTool}
        />
      ))}
    </div>
  );
}

function ToolButton({
  tool,
  active,
  onSelect,
}: {
  readonly tool: ToolDefinition;
  readonly active: boolean;
  readonly onSelect: (tool: EditorTool) => void;
}) {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      className={cn(
        dockButtonClassName,
        active && "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft",
      )}
      aria-label={tool.label}
      aria-pressed={active}
      data-tool-active={active}
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
  );
}

function DockSeparator() {
  return <span className="my-1 h-px w-7 shrink-0 bg-folio-border" aria-hidden="true" />;
}
