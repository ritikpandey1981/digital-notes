import { cn } from "@folio/ui";
import { Circle, Minus, Square } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ShapeToolKind } from "./editor-types";
import { ToolTooltip } from "./ToolTooltip";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface ShapesWidgetProps {
  readonly open: boolean;
  readonly activeShape: ShapeToolKind;
  readonly onSelectShape: (shape: ShapeToolKind) => void;
  readonly onDismiss: () => void;
}

const shapes = [
  { id: "line", label: "Line", icon: Minus },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
] as const;

export function ShapesWidget({ open, activeShape, onSelectShape, onDismiss }: ShapesWidgetProps) {
  const reducedMotion = useReducedMotion() === true;
  const boundaryRef = useFloatingWidgetDismissal(open, onDismiss);
  return (
    <div className="pointer-events-none absolute left-[76px] top-[calc(50%+20px)] z-20 -translate-y-1/2">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={boundaryRef}
            className="folio-floating-surface pointer-events-auto flex w-[52px] flex-col items-center gap-0.5 p-1"
            role="toolbar"
            aria-label="Shapes"
            aria-orientation="vertical"
            data-testid="shapes-widget"
            data-elevation="temporary"
            data-floating-surface="folio"
            data-motion-profile="fade-slide-140ms"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{
              duration: motionSeconds(INTERACTION_MOTION.floatingMilliseconds, reducedMotion),
              ease: PROFESSIONAL_EASE,
            }}
          >
            {shapes.map(({ id, label, icon: Icon }) => {
              const active = id === activeShape;
              return (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "group relative flex size-9 items-center justify-center rounded-[10px] text-[var(--folio-icon-neutral)] transition-[background-color,color] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                    active && "bg-folio-accent text-white hover:bg-folio-accent hover:text-white",
                  )}
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => onSelectShape(id)}
                >
                  <Icon
                    className="size-[15px]"
                    aria-hidden="true"
                    data-optical-alignment="centered-symmetric"
                  />
                  <ToolTooltip label={label} />
                </button>
              );
            })}
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
