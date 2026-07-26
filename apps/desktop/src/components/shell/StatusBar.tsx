import { CheckCircle2, MousePointer2 } from "lucide-react";
import type { EditorTool } from "../editor/editor-types";

interface StatusBarProps {
  activeTool: EditorTool;
}

export function StatusBar({ activeTool }: StatusBarProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center border-t border-folio-border bg-folio-status px-3 text-[11px] text-folio-muted">
      <div className="flex items-center gap-1.5">
        <CheckCircle2
          className="size-3.5 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <span>Saved</span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <span className="hidden items-center gap-1.5 sm:flex">
          <MousePointer2 className="size-3" aria-hidden="true" /> {activeTool}
        </span>
        <span>Page 1 of 12</span>
        <span className="rounded-md bg-folio-hover px-1.5 py-0.5 font-medium text-folio-ink">
          100%
        </span>
      </div>
    </footer>
  );
}
