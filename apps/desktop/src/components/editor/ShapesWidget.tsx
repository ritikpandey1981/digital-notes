import { cn } from "@folio/ui";
import { Circle, Minus, Square } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRef } from "react";
import type { ShapeToolKind } from "./editor-types";
import { ToolTooltip } from "./ToolTooltip";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";
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
  const motionPreset = useFloatingSurfaceMotion();
  const boundaryRef = useRef<HTMLElement | null>(null);
  const floatingWidgetScope = useFloatingWidgetDismissal(open, onDismiss, boundaryRef);
  return (
    <div className="pointer-events-none absolute left-[76px] top-[calc(50%+125px)] z-20 -translate-y-1/2">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={boundaryRef}
            data-floating-widget-scope={floatingWidgetScope}
            className="folio-floating-surface pointer-events-auto flex w-[52px] flex-col items-center gap-0.5 p-1"
            role="toolbar"
            aria-label="Shapes"
            aria-orientation="vertical"
            data-testid="shapes-widget"
            data-elevation="temporary"
            data-floating-surface="folio"
            data-motion-profile="fade-slide-140ms"
            {...floatingSurfaceMotion(motionPreset, "left")}
          >
            {shapes.map(({ id, label, icon: Icon }) => {
              const active = id === activeShape;
              return (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    "group relative flex size-9 items-center justify-center rounded-lg text-[var(--folio-icon-neutral)] transition-[background-color,color] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                    active &&
                      "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft hover:text-folio-accent",
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
