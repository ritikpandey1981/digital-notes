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
import { Check, CheckCircle2, Minus, MousePointer2, Plus } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { EditorTool, ShapeToolKind } from "../editor/editor-types";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useContextHint } from "./context-hint-context";

interface StatusBarProps {
  activeTool: EditorTool;
  activeShape: ShapeToolKind;
  viewport: EditorViewportSnapshot;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onSetZoom: (zoom: number) => void;
  onResetZoom: () => void;
  onFitPage: () => void;
  onFitWidth: () => void;
  navigationTeachingAvailable: boolean;
}

export function StatusBar({
  activeTool,
  activeShape,
  viewport,
  onZoomOut,
  onZoomIn,
  onSetZoom,
  onResetZoom,
  onFitPage,
  onFitWidth,
  navigationTeachingAvailable,
}: StatusBarProps) {
  const hint = useContextHint({
    tool: activeTool,
    shapeKind: activeShape,
    navigationTeachingAvailable,
  });
  const reducedMotion = useReducedMotion() === true;
  const zoomLabel = formatEditorViewportZoom(viewport.zoom);
  const atMinimum = viewport.zoom <= viewport.minZoom + Number.EPSILON;
  const atMaximum = viewport.zoom >= viewport.maxZoom - Number.EPSILON;
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
        <span
          className="hidden h-4 w-[220px] shrink-0 items-center overflow-hidden md:flex"
          data-testid="context-hint"
          data-context-hint-tool={hint?.tool ?? ""}
          data-context-hint-shape={hint?.shapeKind ?? ""}
          data-context-hint-motion="fade-150ms"
          aria-live="polite"
        >
          <AnimatePresence initial={false} mode="wait">
            {hint === null ? null : (
              <motion.span
                key={hint.id}
                className="block truncate"
                initial={{ opacity: 0, x: 3 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -3 }}
                transition={{
                  duration: motionSeconds(INTERACTION_MOTION.contentMilliseconds, reducedMotion),
                  ease: PROFESSIONAL_EASE,
                }}
                data-context-hint={hint.id}
              >
                {hint.text}
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="shrink-0">Page 1 of 12</span>
        <div
          className="flex shrink-0 items-center overflow-hidden rounded-md border border-folio-border bg-folio-hover text-folio-ink"
          role="group"
          aria-label="Viewport controls"
          data-testid="viewport-controls"
          data-viewport-mode={viewport.mode}
          data-viewport-zoom={viewport.zoom}
        >
          <button
            type="button"
            className="grid size-6 place-items-center transition-colors hover:bg-folio-surface disabled:opacity-35"
            aria-label="Zoom out"
            onClick={onZoomOut}
            disabled={atMinimum}
          >
            <Minus className="size-3" aria-hidden="true" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-6 min-w-14 border-x border-folio-border px-1.5 font-medium tabular-nums transition-colors hover:bg-folio-surface"
                aria-label={`Zoom options, ${zoomLabel}`}
              >
                {zoomLabel}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-60">
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
                  ["Pan", "Middle Drag"],
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
            className="grid size-6 place-items-center transition-colors hover:bg-folio-surface disabled:opacity-35"
            aria-label="Zoom in"
            onClick={onZoomIn}
            disabled={atMaximum}
          >
            <Plus className="size-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}
