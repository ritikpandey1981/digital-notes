import { cn } from "@folio/ui";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";

interface ExpandableToolbarSectionProps {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel?: string;
  readonly summary: string;
  readonly open: boolean;
  readonly disabled?: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}

/** Shared trigger-and-panel interaction for current and future shape toolbar controls. */
export function ExpandableToolbarSection({
  id,
  label,
  ariaLabel,
  summary,
  open,
  disabled = false,
  onOpenChange,
  children,
}: ExpandableToolbarSectionProps) {
  const motionPreset = useFloatingSurfaceMotion();
  const panelId = `shape-toolbar-${id}-panel`;
  return (
    <>
      <button
        type="button"
        className={cn(
          "flex h-8 shrink-0 items-center gap-0.5 rounded-lg px-1.5 text-folio-muted transition-[background-color,color,transform] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35",
          open && "bg-folio-hover text-folio-ink",
        )}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        data-toolbar-expansion-trigger={id}
        onClick={() => onOpenChange(!open)}
      >
        <span className="text-[10px] font-medium">{label}</span>
        <span
          className="inline-flex w-14 shrink-0 justify-center whitespace-nowrap text-[11px] font-semibold tabular-nums text-folio-ink"
          data-toolbar-numeric-summary="reserved"
          data-toolbar-summary-capacity="1000.0 px"
        >
          {summary}
        </span>
        <ChevronDown
          className={cn("size-3 transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panelId}
            className="folio-floating-surface pointer-events-auto absolute left-1/2 top-[calc(100%+8px)] z-10 w-[232px] -translate-x-1/2 p-2"
            role="group"
            aria-label={`${label} options`}
            data-toolbar-expansion-panel={id}
            data-toolbar-expansion-mechanism="shared"
            data-floating-surface="folio"
            {...floatingSurfaceMotion(motionPreset)}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
