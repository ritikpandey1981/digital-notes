import {
  orientPageGeometry,
  PAPER_COLOR_PRESETS,
  PAPER_TYPES,
  pagePreset,
  type PaperType,
} from "@folio/editor";
import type { PageActions, PagesSnapshot } from "@folio/editor";
import { cn } from "@folio/ui";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { activePresetId, PAGE_PRESET_OPTIONS, parsePageExtent } from "./page-navigator-model";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface PageSettingsPanelProps {
  readonly open: boolean;
  readonly snapshot: PagesSnapshot;
  readonly actions: PageActions | null;
  readonly onDismiss: () => void;
}

export function PageSettingsPanel({ open, snapshot, actions, onDismiss }: PageSettingsPanelProps) {
  const reducedMotion = useReducedMotion() === true;
  const boundaryRef = useRef<HTMLElement | null>(null);
  const page = snapshot.pages.find((candidate) => candidate.id === snapshot.activePageId) ?? null;
  const floatingWidgetScope = useFloatingWidgetDismissal(open, onDismiss, boundaryRef, {
    outsidePointerDismissal: "ignore",
    onEscape: () => {
      actions?.cancelPaperColorEdit();
      onDismiss();
    },
  });
  const outsideBounds = page !== null && actions?.hasArtworkOutsideBounds(page.id) === true;

  return (
    <div className="pointer-events-none absolute right-[76px] top-2 z-30">
      <AnimatePresence initial={false}>
        {open && page !== null ? (
          <motion.section
            ref={boundaryRef}
            data-floating-widget-scope={floatingWidgetScope}
            className="folio-floating-surface pointer-events-auto flex w-[248px] flex-col gap-2 overflow-y-auto p-3"
            style={{ maxHeight: "min(560px, calc(100vh - 140px))" }}
            aria-label="Page settings"
            data-testid="page-settings"
            data-elevation="temporary"
            data-floating-surface="folio"
            data-page-orientation={page.orientation}
            data-page-paper-type={page.paperType}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              duration: motionSeconds(INTERACTION_MOTION.floatingMilliseconds, reducedMotion),
              ease: PROFESSIONAL_EASE,
            }}
          >
            <span className="text-[11px] font-semibold text-folio-ink">Page settings</span>

            <Field label="Preset">
              <select
                className="h-7 w-full rounded-lg border border-folio-border bg-folio-surface px-1.5 text-[11px] text-folio-ink outline-none focus:ring-2 focus:ring-folio-accent"
                aria-label="Page preset"
                data-testid="page-preset"
                value={activePresetId(page)}
                onChange={(event) => {
                  const preset = pagePreset(event.currentTarget.value as never);
                  if (preset === undefined) return;
                  const geometry =
                    page.orientation === "landscape" && preset.orientable
                      ? orientPageGeometry(preset.geometry, "landscape")
                      : preset.geometry;
                  actions?.setPageGeometry(page.id, geometry.width, geometry.height);
                }}
              >
                {PAGE_PRESET_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex gap-2">
              <ExtentField
                label="Width"
                testId="page-width"
                value={page.width}
                onCommit={(width) => actions?.setPageGeometry(page.id, width, page.height)}
              />
              <ExtentField
                label="Height"
                testId="page-height"
                value={page.height}
                onCommit={(height) => actions?.setPageGeometry(page.id, page.width, height)}
              />
            </div>

            <Field label="Orientation">
              <div className="flex gap-1" role="group" aria-label="Page orientation">
                {(["portrait", "landscape"] as const).map((orientation) => (
                  <button
                    key={orientation}
                    type="button"
                    className={cn(
                      "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[11px] capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                      page.orientation === orientation
                        ? "border-folio-accent bg-folio-accent-soft text-folio-accent"
                        : "border-folio-border text-folio-muted hover:bg-folio-hover hover:text-folio-ink",
                    )}
                    aria-pressed={page.orientation === orientation}
                    data-testid={`page-orientation-${orientation}`}
                    onClick={() => actions?.setPageOrientation(page.id, orientation)}
                  >
                    <span
                      className="rounded-[2px] border border-current"
                      style={
                        orientation === "portrait"
                          ? { width: 8, height: 11 }
                          : { width: 11, height: 8 }
                      }
                      aria-hidden="true"
                    />
                    {orientation}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Paper">
              <div className="grid grid-cols-2 gap-1" role="group" aria-label="Paper type">
                {PAPER_TYPES.map((paper) => (
                  <button
                    key={paper.id}
                    type="button"
                    className={cn(
                      "h-7 rounded-lg border text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                      page.paperType === paper.id
                        ? "border-folio-accent bg-folio-accent-soft text-folio-accent"
                        : "border-folio-border text-folio-muted hover:bg-folio-hover hover:text-folio-ink",
                    )}
                    aria-pressed={page.paperType === paper.id}
                    data-testid={`paper-type-${paper.id}`}
                    onClick={() => actions?.setPaperType(page.id, paper.id as PaperType)}
                  >
                    {paper.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Paper color">
              <div className="flex items-center gap-1" role="group" aria-label="Paper color">
                {PAPER_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    className={cn(
                      "size-6 rounded-full border transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                      page.paperColor === preset.hex
                        ? "border-folio-accent ring-2 ring-folio-accent"
                        : "border-black/15 hover:scale-105",
                    )}
                    style={{ backgroundColor: preset.hex }}
                    aria-label={`${preset.label} paper`}
                    aria-pressed={page.paperColor === preset.hex}
                    data-testid={`paper-color-${preset.hex.slice(1)}`}
                    onClick={() => {
                      // Discrete swatches commit immediately as one action.
                      actions?.beginPaperColorEdit(page.id);
                      actions?.previewPaperColor(preset.hex);
                      actions?.commitPaperColorEdit();
                    }}
                  >
                    <span className="sr-only">{preset.label}</span>
                  </button>
                ))}
                <label className="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-full border border-black/15 focus-within:ring-2 focus-within:ring-folio-accent">
                  <span className="sr-only">Custom paper color</span>
                  <span
                    className="pointer-events-none size-4 rounded-full border border-black/15"
                    style={{ backgroundColor: page.paperColor }}
                    aria-hidden="true"
                  />
                  <input
                    className="absolute size-px opacity-0"
                    type="color"
                    aria-label="Custom paper color"
                    data-testid="paper-color-custom"
                    value={page.paperColor}
                    onFocus={() => actions?.beginPaperColorEdit(page.id)}
                    onChange={(event) => actions?.previewPaperColor(event.currentTarget.value)}
                    onBlur={() => actions?.commitPaperColorEdit()}
                  />
                </label>
              </div>
            </Field>

            {outsideBounds ? (
              <p
                className="rounded-lg bg-folio-surface-muted px-2 py-1.5 text-[10px] leading-snug text-folio-muted"
                data-testid="page-bounds-warning"
              >
                Some artwork sits outside this page. It is kept and simply clipped.
              </p>
            ) : null}
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * One page-dimension field.
 *
 * Typing is local draft state; only Enter or blur commits, so a partially typed
 * number never reaches History. Escape restores the committed value.
 */
function ExtentField({
  label,
  testId,
  value,
  onCommit,
}: {
  readonly label: string;
  readonly testId: string;
  readonly value: number;
  readonly onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);
  const commit = (): void => {
    const parsed = parsePageExtent(draft);
    if (parsed === null || parsed === value) {
      setDraft(String(value));
      return;
    }
    onCommit(parsed);
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
        {label}
      </span>
      <input
        className="h-7 w-full rounded-lg border border-folio-border bg-folio-surface px-1.5 text-[11px] tabular-nums text-folio-ink outline-none focus:ring-2 focus:ring-folio-accent"
        type="number"
        inputMode="numeric"
        aria-label={`Page ${label.toLowerCase()}`}
        data-testid={testId}
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
