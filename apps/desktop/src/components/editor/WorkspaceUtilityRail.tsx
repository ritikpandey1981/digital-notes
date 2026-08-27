import { cn } from "@folio/ui";
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { ToolTooltip } from "./ToolTooltip";

interface WorkspaceUtilityRailProps {
  readonly layersPanelOpen: boolean;
  readonly onToggleLayersPanel: () => void;
  readonly children?: ReactNode;
}

/**
 * The right-hand artwork utility cluster.
 *
 * Folio's spatial language puts creation tools on the left, artwork utilities on
 * the right, and document controls along the top. Layers is an artwork utility,
 * so it lives here directly above the colour rail rather than in the top bar.
 */
export function WorkspaceUtilityRail({
  layersPanelOpen,
  onToggleLayersPanel,
  children,
}: WorkspaceUtilityRailProps) {
  return (
    <div
      className="pointer-events-none absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-end gap-2"
      data-testid="workspace-utility-rail"
      data-utility-rail-side="right"
    >
      <div
        className="folio-floating-surface pointer-events-auto flex w-12 flex-col items-center p-1"
        role="toolbar"
        aria-label="Artwork utilities"
        aria-orientation="vertical"
        data-testid="utility-rail-actions"
        data-floating-surface="folio"
      >
        <button
          type="button"
          className={cn(
            "group relative grid size-9 shrink-0 place-items-center rounded-[9px] text-[var(--folio-icon-neutral)] transition-[background-color,color] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
            layersPanelOpen && "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft",
          )}
          aria-label="Layers"
          aria-pressed={layersPanelOpen}
          data-testid="layers-toggle"
          onClick={onToggleLayersPanel}
        >
          <Layers className="size-[17px]" aria-hidden="true" />
          <ToolTooltip label="Layers" side="left" />
        </button>
      </div>
      {children}
    </div>
  );
}
