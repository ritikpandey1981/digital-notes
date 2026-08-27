import {
  EDITOR_VIEWPORT_ZOOM_PRESETS,
  formatEditorViewportZoom,
  type EditorViewportSnapshot,
} from "@folio/editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@folio/ui";
import { Check, Minus, Plus } from "lucide-react";

interface WorkspaceViewportControlProps {
  readonly viewport: EditorViewportSnapshot;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly onSetZoom: (zoom: number) => void;
  readonly onResetZoom: () => void;
  readonly onFitPage: () => void;
  readonly onFitWidth: () => void;
}

export function WorkspaceViewportControl({
  viewport,
  onZoomOut,
  onZoomIn,
  onSetZoom,
  onResetZoom,
  onFitPage,
  onFitWidth,
}: WorkspaceViewportControlProps) {
  const zoomLabel = formatEditorViewportZoom(viewport.zoom);
  const atMinimum = viewport.zoom <= viewport.minZoom + Number.EPSILON;
  const atMaximum = viewport.zoom >= viewport.maxZoom - Number.EPSILON;

  return (
    <div
      className="folio-compact-surface absolute bottom-4 right-4 z-20 flex shrink-0 items-center overflow-hidden text-[11px] text-folio-ink"
      role="group"
      aria-label="Viewport controls"
      data-testid="viewport-controls"
      data-viewport-mode={viewport.mode}
      data-viewport-zoom={viewport.zoom}
      data-workspace-corner="bottom-right"
      data-floating-surface="folio"
    >
      <button
        type="button"
        className="grid size-8 place-items-center transition-colors duration-100 hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-folio-accent disabled:opacity-35"
        aria-label="Zoom out"
        onClick={onZoomOut}
        disabled={atMinimum}
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-8 min-w-16 border-x border-folio-border px-2 font-medium tabular-nums transition-colors duration-100 hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-folio-accent"
            aria-label={`Zoom options, ${zoomLabel}`}
          >
            {zoomLabel}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={10} className="min-w-60">
          {EDITOR_VIEWPORT_ZOOM_PRESETS.filter((zoom) => zoom !== 1).map((zoom) => (
            <DropdownMenuItem key={zoom} onSelect={() => onSetZoom(zoom)}>
              <Check
                className={`size-3.5 ${
                  viewport.mode === "manual" && Math.abs(viewport.zoom - zoom) < 1e-9
                    ? "opacity-100"
                    : "opacity-0"
                }`}
                aria-hidden="true"
              />
              {formatEditorViewportZoom(zoom)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onResetZoom}>
            <Check
              className={`size-3.5 ${
                viewport.mode === "manual" && Math.abs(viewport.zoom - 1) < 1e-9
                  ? "opacity-100"
                  : "opacity-0"
              }`}
              aria-hidden="true"
            />
            100% (Actual Size)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFitPage}>
            <Check
              className={`size-3.5 ${viewport.mode === "fit-page" ? "opacity-100" : "opacity-0"}`}
              aria-hidden="true"
            />
            Fit Page
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFitWidth}>
            <Check
              className={`size-3.5 ${viewport.mode === "fit-width" ? "opacity-100" : "opacity-0"}`}
              aria-hidden="true"
            />
            Fit Width
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Navigation shortcuts</DropdownMenuLabel>
          <div
            className="grid gap-1 px-2.5 pb-1.5 text-xs"
            data-testid="viewport-navigation-shortcuts"
            aria-label="Navigation shortcuts"
          >
            {[
              ["Move canvas", "Space + Drag"],
              ["Zoom", "Ctrl + Wheel"],
              ["Scroll", "Wheel / Trackpad"],
            ].map(([action, shortcut]) => (
              <div key={action} className="flex items-center justify-between gap-6">
                <span className="text-folio-ink">{action}</span>
                <kbd className="font-sans text-[11px] text-folio-muted">{shortcut}</kbd>
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className="grid size-8 place-items-center transition-colors duration-100 hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-folio-accent disabled:opacity-35"
        aria-label="Zoom in"
        onClick={onZoomIn}
        disabled={atMaximum}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
