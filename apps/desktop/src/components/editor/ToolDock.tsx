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
}

const drawingTools = [
  { label: "Select", icon: MousePointer2 },
  { label: "Pen", icon: PenLine },
  { label: "Highlighter", icon: Highlighter },
  { label: "Eraser", icon: Eraser },
] satisfies readonly ToolDefinition[];

const futureObjectTools = [
  { label: "Shape", icon: Shapes },
  { label: "Text", icon: TextCursorInput },
  { label: "Image", icon: Image },
] satisfies readonly ToolDefinition[];

const futureActions = [
  { label: "Table", icon: Table2 },
  { label: "Sticky Note", icon: StickyNote },
] satisfies readonly ToolDefinition[];

const dockButtonClassName =
  "group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-[background-color,color,transform,box-shadow] duration-150 hover:scale-[1.04] hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95";

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
        className="pointer-events-auto flex h-[420px] w-12 flex-col items-center rounded-[20px] border border-folio-border bg-folio-glass p-1.5 shadow-lg backdrop-blur-xl"
        role="toolbar"
        aria-label="Notebook tool dock"
        aria-orientation="vertical"
        data-tool-dock-layout="fixed-vertical"
      >
        <ToolGroup tools={drawingTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <ToolGroup tools={futureObjectTools} activeTool={activeTool} onSelectTool={onSelectTool} />
        <DockSeparator />
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className={dockButtonClassName}
            aria-label="Duplicate selected object"
            title="Duplicate selected object"
            onClick={onDuplicateSelection}
          >
            <CopyPlus className="size-[17px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn(dockButtonClassName, "hover:text-red-600 dark:hover:text-red-400")}
            aria-label="Delete selected object"
            title="Delete selected object"
            onClick={onDeleteSelection}
          >
            <Trash2 className="size-[17px]" aria-hidden="true" />
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
        active && "bg-folio-accent text-white shadow-sm hover:bg-folio-accent hover:text-white",
      )}
      aria-label={tool.label}
      aria-pressed={active}
      title={tool.label}
      onClick={() => onSelect(tool.label)}
    >
      <Icon className="size-[17px]" aria-hidden="true" />
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
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={dockButtonClassName}
          aria-label="More tools"
          title="More tools"
        >
          <MoreHorizontal className="size-[18px]" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={10}>
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
