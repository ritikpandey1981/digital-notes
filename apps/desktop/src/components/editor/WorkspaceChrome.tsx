import { Sparkles } from "lucide-react";

interface WorkspaceChromeProps {
  workspaceName: string;
  locationLabel: string;
}

export function WorkspaceChrome({ workspaceName, locationLabel }: WorkspaceChromeProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute left-5 top-5 flex items-center gap-2 text-xs text-folio-muted">
        <span className="font-medium text-folio-ink">{workspaceName}</span>
        <span aria-hidden="true">/</span>
        <span>{locationLabel}</span>
      </div>

      <div className="absolute right-5 top-5 hidden items-center gap-2 rounded-full border border-folio-border bg-folio-surface px-3 py-1.5 text-[11px] text-folio-muted lg:flex">
        <Sparkles className="size-3 text-folio-accent" aria-hidden="true" />
        Calm workspace
      </div>
    </div>
  );
}
