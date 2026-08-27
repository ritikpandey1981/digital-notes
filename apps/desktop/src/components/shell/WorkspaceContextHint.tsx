import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { EditorTool, ShapeToolKind } from "../editor/editor-types";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useContextHint } from "./context-hint-context";

interface WorkspaceContextHintProps {
  readonly activeTool: EditorTool;
  readonly armedShape: ShapeToolKind | null;
  readonly navigationTeachingAvailable: boolean;
}

export function WorkspaceContextHint({
  activeTool,
  armedShape,
  navigationTeachingAvailable,
}: WorkspaceContextHintProps) {
  const hint = useContextHint({
    tool: activeTool,
    ...(armedShape === null ? {} : { shapeKind: armedShape }),
    navigationTeachingAvailable,
  });
  const reducedMotion = useReducedMotion() === true;

  // No hint means no surface. An empty bordered pill reads as a broken element.
  if (hint === null) {
    return (
      <div
        className="pointer-events-none absolute bottom-4 left-4 z-20"
        data-testid="context-hint"
        data-context-hint-state="empty"
        data-workspace-corner="bottom-left"
        aria-live="polite"
      />
    );
  }

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-4 z-20 flex min-h-8 max-w-[min(420px,calc(100%-220px))] items-center rounded-[10px] border border-folio-border bg-folio-surface px-3 text-[11px] text-folio-muted shadow-[var(--folio-shadow-quiet)]"
      data-testid="context-hint"
      data-context-hint-state="visible"
      data-context-hint-tool={hint.tool ?? ""}
      data-context-hint-shape={hint.shapeKind ?? ""}
      data-context-hint-motion="fade-150ms"
      data-workspace-corner="bottom-left"
      aria-live="polite"
    >
      <AnimatePresence initial={false} mode="wait">
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
      </AnimatePresence>
    </div>
  );
}
