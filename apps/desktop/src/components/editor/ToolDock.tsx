import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@folio/ui";
import {
  CopyPlus,
  Eraser,
  Highlighter,
  Image,
  MoreHorizontal,
  MousePointer2,
  PenLine,
  Shapes,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { EditorTool } from "./editor-types";
import { ToolTooltip } from "./ToolTooltip";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface ToolDockProps {
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
  readonly onDeleteSelection: () => void;
  readonly onDuplicateSelection: () => void;
  readonly moreToolsOpen: boolean;
  readonly onMoreToolsOpenChange: (open: boolean) => void;
}

interface ToolDefinition {
  readonly label: EditorTool;
  readonly icon: LucideIcon;
  readonly opticalOffset?: string;
}

const drawingTools = [
  { label: "Select", icon: MousePointer2, opticalOffset: "translate-x-px translate-y-px" },
  { label: "Pen", icon: PenLine },
  { label: "Highlighter", icon: Highlighter },
  { label: "Eraser", icon: Eraser },
] satisfies readonly ToolDefinition[];

const objectTools = [{ label: "Shapes", icon: Shapes }] satisfies readonly ToolDefinition[];

const futureActions = [
  { label: "Text", icon: TextCursorInput },
  { label: "Image", icon: Image },
  { label: "Table", icon: Table2 },
  { label: "Sticky Note", icon: StickyNote },
] satisfies readonly ToolDefinition[];

const dockButtonClassName =
  "group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-[var(--folio-icon-neutral)] transition-[background-color,color,box-shadow] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent disabled:pointer-events-none disabled:opacity-40";

export function ToolDock({
  activeTool,
  onSelectTool,
  onDeleteSelection,
  onDuplicateSelection,
  moreToolsOpen,
  onMoreToolsOpenChange,
}: ToolDockProps) {
  return (
    <div className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2">
      <div
        className="folio-floating-surface pointer-events-auto flex w-12 flex-col items-center p-1.5"
        role="toolbar"
        aria-label="Notebook tool dock"
        aria-orientation="vertical"
        data-tool-dock-layout="content-vertical"
        data-elevation="permanent"
        data-floating-surface="folio"
      >
        <ToolGroup tools={drawingTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <ToolGroup tools={objectTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={dockButtonClassName}
            aria-label="Duplicate selected object"
            onClick={onDuplicateSelection}
          >
            <CopyPlus
              className="size-[17px] -translate-x-px -translate-y-px"
              aria-hidden="true"
              data-optical-alignment="up-left-1px"
            />
            <ToolTooltip label="Duplicate selected object" />
          </button>
          <button
            type="button"
            className={cn(dockButtonClassName, "hover:text-red-600 dark:hover:text-red-400")}
            aria-label="Delete selected object"
            onClick={onDeleteSelection}
          >
            <Trash2 className="size-[17px]" aria-hidden="true" data-optical-alignment="centered" />
            <ToolTooltip label="Delete selected object" />
          </button>
          <FutureActionsMenu
            activeTool={activeTool}
            onSelectTool={onSelectTool}
            open={moreToolsOpen}
            onOpenChange={onMoreToolsOpenChange}
          />
        </div>
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
        active && "text-white hover:bg-transparent hover:text-white",
      )}
      aria-label={tool.label}
      aria-pressed={active}
      data-tool-active={active}
      data-interaction-motion="selection-140ms"
      onClick={() => onSelect(tool.label)}
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl bg-folio-accent opacity-0 shadow-sm transition-[opacity,box-shadow] duration-[140ms] ease-out",
          active && "opacity-100",
        )}
        aria-hidden="true"
      />
      <Icon
        className={cn("relative z-[1] size-[17px]", tool.opticalOffset)}
        aria-hidden="true"
        data-optical-alignment={tool.opticalOffset === undefined ? "centered" : "down-right-1px"}
      />
      <ToolTooltip label={tool.label} />
    </button>
  );
}

function FutureActionsMenu({
  activeTool,
  onSelectTool,
  open,
  onOpenChange,
}: {
  readonly activeTool: EditorTool;
  readonly onSelectTool: (tool: EditorTool) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const menuRef = useFloatingWidgetDismissal<HTMLDivElement>(open, () => onOpenChange(false));
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            dockButtonClassName,
            "data-[state=open]:bg-folio-hover data-[state=open]:text-folio-ink",
          )}
          aria-label="More tools"
        >
          <MoreHorizontal
            className="size-[18px]"
            aria-hidden="true"
            data-optical-alignment="centered"
          />
          <ToolTooltip label="More tools" hidden={open} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={menuRef}
        className="folio-floating-surface"
        style={{
          borderRadius: "var(--folio-floating-radius)",
          boxShadow: "var(--shadow-xl)",
        }}
        side="right"
        align="end"
        sideOffset={10}
        data-floating-surface="folio"
      >
        <DropdownMenuLabel>Future tools</DropdownMenuLabel>
        {futureActions.map(({ label, icon: Icon }) => (
          <DropdownMenuItem
            key={label}
            className={cn(activeTool === label && "bg-folio-hover text-folio-accent")}
            onSelect={() => onSelectTool(label)}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DockSeparator() {
  return <span className="my-1 h-px w-7 shrink-0 bg-folio-border" aria-hidden="true" />;
}
