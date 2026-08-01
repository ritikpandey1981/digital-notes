import { CheckCircle2, MousePointer2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { EditorTool } from "../editor/editor-types";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useContextHint } from "./context-hint-context";

interface StatusBarProps {
  activeTool: EditorTool;
}

export function StatusBar({ activeTool }: StatusBarProps) {
  const hint = useContextHint(activeTool);
  const reducedMotion = useReducedMotion() === true;
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
        <span className="shrink-0 rounded-md bg-folio-hover px-1.5 py-0.5 font-medium text-folio-ink">
          100%
        </span>
      </div>
    </footer>
  );
}
