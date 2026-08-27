import { renderPageThumbnail, type PageActions, type PagesSnapshot } from "@folio/editor";
import type { Page } from "@folio/editor";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@folio/ui";
import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal, Plus, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";
import {
  canDeletePage,
  describeDeletedPage,
  nextPageFocusIndex,
  PAGE_NAVIGATOR_MAX_WIDTH,
  PAGE_NAVIGATOR_SIDE_RESERVE,
  pageMoveTarget,
  pageRows,
  pageThumbnailSize,
  type PageRow,
} from "./page-navigator-model";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface PageNavigatorProps {
  readonly open: boolean;
  readonly snapshot: PagesSnapshot;
  readonly actions: PageActions | null;
  readonly getPage: ((pageId: string) => Page | null) | null;
  readonly thumbnailRevision: number;
  readonly onDismiss: () => void;
  readonly onOpenPageSettings: () => void;
  readonly onNotify: (message: string) => void;
}

export function PageNavigator({
  open,
  snapshot,
  actions,
  getPage,
  thumbnailRevision,
  onDismiss,
  onOpenPageSettings,
  onNotify,
}: PageNavigatorProps) {
  const motionPreset = useFloatingSurfaceMotion();
  const boundaryRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const rows = pageRows(snapshot);
  const floatingWidgetScope = useFloatingWidgetDismissal(open, onDismiss, boundaryRef, {
    outsidePointerDismissal: "canvas",
  });

  const activeIndex = rows.findIndex((row) => row.active);
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, activeIndex, snapshot.activePageId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const row = rows[focusIndex];
    if (row === undefined) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowLeft" ? "previous" : "next";
    event.preventDefault();
    if (event.altKey) {
      const target = pageMoveTarget(row, direction, rows.length);
      if (target !== null && actions?.movePage(row.id, target) === true) {
        setFocusIndex(nextPageFocusIndex(focusIndex, direction, rows.length));
      }
      return;
    }
    const next = nextPageFocusIndex(focusIndex, direction, rows.length);
    setFocusIndex(next);
    rowRefs.current[next]?.focus();
  };

  return (
    // Anchored to the Pages control in the document toolbar rather than parked
    // over the drawing. Pages are a document operation, so the navigator lives
    // with the other document controls and leaves the canvas alone.
    <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={boundaryRef}
            data-floating-widget-scope={floatingWidgetScope}
            className="folio-floating-surface pointer-events-auto flex items-stretch gap-1 p-1.5"
            // Stay clear of the Layers/Page Settings slot on the right and the
            // tool dock on the left at every supported window width.
            style={{
              maxWidth: `min(${PAGE_NAVIGATOR_MAX_WIDTH}px, calc(100vw - ${PAGE_NAVIGATOR_SIDE_RESERVE * 2}px))`,
            }}
            aria-label="Pages"
            data-testid="page-navigator"
            data-elevation="temporary"
            data-navigator-anchor="document-controls"
            data-floating-surface="folio"
            data-page-count={rows.length}
            {...floatingSurfaceMotion(motionPreset)}
          >
            <div
              ref={listRef}
              className="flex min-w-0 items-stretch gap-1 overflow-x-auto"
              role="group"
              aria-label="Page list"
              data-testid="page-list"
              onKeyDown={handleKeyDown}
            >
              {rows.map((row, index) => (
                <PageCard
                  key={row.id}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  row={row}
                  pageCount={rows.length}
                  tabIndex={index === focusIndex ? 0 : -1}
                  page={getPage?.(row.id) ?? null}
                  thumbnailRevision={thumbnailRevision}
                  onFocusRow={() => setFocusIndex(index)}
                  onActivate={() => actions?.setActivePage(row.id)}
                  onOpenSettings={() => {
                    actions?.setActivePage(row.id);
                    onOpenPageSettings();
                  }}
                  onDuplicate={() => actions?.duplicatePage(row.id)}
                  onMove={(direction) => {
                    const target = pageMoveTarget(row, direction, rows.length);
                    if (target !== null) actions?.movePage(row.id, target);
                  }}
                  onDelete={() => {
                    const removed = actions?.deletePage(row.id);
                    if (removed !== null && removed !== undefined) {
                      onNotify(describeDeletedPage(row.label, removed));
                    }
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              className="flex w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg text-folio-muted transition-colors hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
              aria-label="Add page"
              data-testid="page-add"
              onClick={() => {
                if (actions?.addPage() !== null) setFocusIndex(rows.length);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

interface PageCardProps {
  readonly row: PageRow;
  readonly pageCount: number;
  readonly tabIndex: number;
  readonly page: Page | null;
  readonly thumbnailRevision: number;
  readonly onFocusRow: () => void;
  readonly onActivate: () => void;
  readonly onOpenSettings: () => void;
  readonly onDuplicate: () => void;
  readonly onMove: (direction: "previous" | "next") => void;
  readonly onDelete: () => void;
  readonly ref?: (element: HTMLButtonElement | null) => void;
}

function PageCard({
  ref,
  row,
  pageCount,
  tabIndex,
  page,
  thumbnailRevision,
  onFocusRow,
  onActivate,
  onOpenSettings,
  onDuplicate,
  onMove,
  onDelete,
}: PageCardProps) {
  const thumbnailSize = pageThumbnailSize(row);
  return (
    <div
      className="group relative shrink-0"
      style={{ maxWidth: thumbnailSize.width + 8 }}
      data-testid={`page-card-${row.id}`}
      data-page-active={row.active}
    >
      <button
        ref={ref}
        type="button"
        tabIndex={tabIndex}
        aria-current={row.active ? "true" : undefined}
        aria-label={`${row.label}, ${row.objectCount} object${row.objectCount === 1 ? "" : "s"}`}
        className={cn(
          "flex flex-col items-center gap-1 rounded-lg p-1 outline-none transition-colors",
          row.active ? "bg-folio-accent-soft" : "hover:bg-folio-hover",
          "focus-visible:ring-2 focus-visible:ring-folio-accent",
        )}
        data-testid={`page-select-${row.id}`}
        onFocus={onFocusRow}
        onClick={onActivate}
        onDoubleClick={onOpenSettings}
      >
        <PageThumbnail
          page={page}
          size={thumbnailSize}
          revision={thumbnailRevision}
          active={row.active}
        />
        <span
          className={cn(
            "truncate text-[10px] tabular-nums",
            row.active ? "font-semibold text-folio-accent" : "text-folio-muted",
          )}
          data-testid={`page-label-${row.id}`}
        >
          {row.label}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded bg-folio-surface/85 text-folio-muted opacity-0 transition-opacity hover:bg-folio-hover hover:text-folio-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent group-focus-within:opacity-100 group-hover:opacity-100"
            aria-label={`${row.label} actions`}
            data-testid={`page-actions-${row.id}`}
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-floating-widget-owned-portal="true"
          data-testid={`page-menu-${row.id}`}
        >
          <DropdownMenuItem data-testid={`page-settings-${row.id}`} onSelect={onOpenSettings}>
            <Settings2 className="size-3.5" aria-hidden="true" />
            Page settings
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`page-duplicate-${row.id}`} onSelect={onDuplicate}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!row.canMovePrevious}
            data-testid={`page-move-previous-${row.id}`}
            onSelect={() => onMove("previous")}
          >
            Move previous
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!row.canMoveNext}
            data-testid={`page-move-next-${row.id}`}
            onSelect={() => onMove("next")}
          >
            Move next
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canDeletePage(pageCount)}
            data-testid={`page-delete-${row.id}`}
            onSelect={onDelete}
          >
            Delete page
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Draws one page preview through the editor's shared thumbnail renderer.
 *
 * Redraw is driven by an explicit revision counter rather than any pointer
 * activity, so a stroke in progress never repaints the navigator.
 */
function PageThumbnail({
  page,
  size,
  revision,
  active,
}: {
  readonly page: Page | null;
  readonly size: Readonly<{ width: number; height: number }>;
  readonly revision: number;
  readonly active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || page === null) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const lineColor =
      getComputedStyle(document.documentElement).getPropertyValue("--folio-page-rule").trim() ||
      "rgba(102, 118, 151, 0.16)";
    renderPageThumbnail(context, page, size, { pageLineColor: lineColor });
  }, [page, revision, size]);
  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "rounded border shadow-sm",
        active ? "border-folio-accent" : "border-folio-border",
      )}
      style={{ width: size.width, height: size.height }}
      data-testid="page-thumbnail"
      aria-hidden="true"
    />
  );
}
