import {
  CopyPlus,
  Eraser,
  Highlighter,
  Image,
  Move,
  MousePointer2,
  PenLine,
  RotateCw,
  Scaling,
  Shapes,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import { cn } from "@folio/ui";
import type { EditorTool } from "./editor-types";

interface FloatingToolbarProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
}

const tools = [
  { label: "Select", icon: MousePointer2 },
  { label: "Move", icon: Move },
  { label: "Rotate", icon: RotateCw },
  { label: "Scale", icon: Scaling },
  { label: "Pen", icon: PenLine },
  { label: "Highlighter", icon: Highlighter },
  { label: "Eraser", icon: Eraser },
  { label: "Text", icon: TextCursorInput },
  { label: "Image", icon: Image },
  { label: "Shape", icon: Shapes },
  { label: "Table", icon: Table2 },
  { label: "Sticky Note", icon: StickyNote },
] satisfies ReadonlyArray<{ label: EditorTool; icon: typeof MousePointer2 }>;

export function FloatingToolbar({
  activeTool,
  onSelectTool,
  onDeleteSelection,
  onDuplicateSelection,
}: FloatingToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-[18px] border border-folio-border bg-folio-glass p-1.5 shadow-lg backdrop-blur-xl"
        role="toolbar"
        aria-label="Notebook tools"
      >
        {tools.map(({ label, icon: Icon }, index) => (
          <div key={label} className="contents">
            {index === 4 ? (
              <>
                <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" />
                <button
                  type="button"
                  className="group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                  aria-label="Duplicate selected object"
                  title="Duplicate selected object"
                  onClick={onDuplicateSelection}
                >
                  <CopyPlus className="size-[17px]" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent dark:hover:text-red-400"
                  aria-label="Delete selected object"
                  title="Delete selected object"
                  onClick={onDeleteSelection}
                >
                  <Trash2 className="size-[17px]" aria-hidden="true" />
                </button>
                <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" />
              </>
            ) : index === 7 ? (
              <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" />
            ) : null}
            <button
              type="button"
              className={cn(
                "group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                activeTool === label &&
                  "bg-folio-accent text-white shadow-sm hover:bg-folio-accent hover:text-white",
              )}
              aria-label={label}
              aria-pressed={activeTool === label}
              title={label}
              onClick={() => onSelectTool(label)}
            >
              <Icon className="size-[17px]" aria-hidden="true" />
            </button>
          </div>
        ))}
        <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
        <button
          type="button"
          className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-semibold text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label="Zoom placeholder at 100 percent"
          title="Zoom controls are placeholders"
        >
          100%
        </button>
      </div>
    </div>
  );
}
