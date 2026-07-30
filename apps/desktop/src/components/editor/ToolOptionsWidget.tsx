import type { EditorColorSystemSnapshot } from "@folio/editor";
import { cn } from "@folio/ui";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type ChangeEvent, type FocusEvent, type ReactNode } from "react";
import { ContinuousSlider } from "./ContinuousSlider";
import { StrokePreviewCanvas } from "./StrokePreviewCanvas";
import type { ToolOptionPropertyDescriptor, ToolOptionsDescriptor } from "./tool-options-registry";

interface ToolOptionsWidgetProps {
  readonly descriptor: ToolOptionsDescriptor | null;
  readonly colors: EditorColorSystemSnapshot;
  readonly onChangeColor: (color: string) => void;
  readonly onChangeWidth: (width: number) => void;
  readonly onChangeOpacity: (opacity: number) => void;
  readonly onDismiss: () => void;
}

interface PropertyControlContext {
  readonly colors: EditorColorSystemSnapshot;
  readonly onChange: (value: string | number) => void;
}

type PropertyControlRenderer = (
  descriptor: ToolOptionPropertyDescriptor,
  context: PropertyControlContext,
) => ReactNode;

const propertyControlRenderers: Readonly<Record<string, PropertyControlRenderer>> = Object.freeze({
  strokeColor: (descriptor, context) => (
    <ColorOptions
      descriptor={descriptor}
      colors={context.colors}
      onChange={(color) => context.onChange(color)}
    />
  ),
  strokeWidth: (descriptor, context) => (
    <ContinuousSlider descriptor={descriptor} onChange={(value) => context.onChange(value)} />
  ),
  opacity: (descriptor, context) => (
    <ContinuousSlider
      descriptor={descriptor}
      onChange={(value) => context.onChange(descriptor.toModelValue?.(value) ?? value)}
    />
  ),
});

export function ToolOptionsWidget({
  descriptor,
  colors,
  onChangeColor,
  onChangeWidth,
  onChangeOpacity,
  onDismiss,
}: ToolOptionsWidgetProps) {
  const paletteRef = useRef<HTMLElement | null>(null);
  const paletteVisible = descriptor !== null;
  useEffect(() => {
    if (!paletteVisible) return;
    const handleOutsidePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (paletteRef.current?.contains(event.target) === true) return;
      if (
        event.target instanceof Element &&
        event.target.closest("[data-tool-dock-layout]") !== null
      ) {
        return;
      }
      const canvasRegion = resolveCanvasPointerRegion(event);
      if (canvasRegion === "workspace") {
        event.preventDefault();
        event.stopPropagation();
      }
      onDismiss();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [onDismiss, paletteVisible]);

  const propertyActions: Readonly<Record<string, (value: string | number) => void>> = {
    strokeColor: (value) => onChangeColor(requireString(value, "Stroke color")),
    strokeWidth: (value) => onChangeWidth(requireNumber(value, "Stroke width")),
    opacity: (value) => onChangeOpacity(requireNumber(value, "Opacity")),
  };

  return (
    <div className="pointer-events-none absolute left-[76px] top-1/2 z-20 -translate-y-1/2">
      <AnimatePresence initial={false}>
        {descriptor === null ? null : (
          <motion.section
            ref={paletteRef}
            key="context-tool-palette"
            className="pointer-events-auto w-[304px] rounded-[20px] border border-folio-border bg-folio-glass p-3 shadow-lg backdrop-blur-xl"
            role="group"
            aria-label={`${descriptor.displayName} tool options`}
            data-testid="context-tool-palette"
            data-tool-options-tool={descriptor.tool}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <motion.div
              key={descriptor.id}
              className="flex flex-col gap-1"
              initial={{ opacity: 0.78, x: -2 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <div>
                  <p className="text-xs font-semibold text-folio-ink">{descriptor.displayName}</p>
                  <p className="text-[10px] text-folio-muted">Tool options</p>
                </div>
                <span className="rounded-full bg-folio-hover px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
                  Live
                </span>
              </div>
              <StrokePreviewCanvas descriptor={descriptor} />
              <span className="my-1 h-px w-full bg-folio-border" aria-hidden="true" />
              {descriptor.properties.map((property) => {
                const render = propertyControlRenderers[property.key];
                const action = propertyActions[property.key];
                if (render === undefined || action === undefined) return null;
                return (
                  <div key={property.key}>{render(property, { colors, onChange: action })}</div>
                );
              })}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function ColorOptions({
  descriptor,
  colors,
  onChange,
}: {
  readonly descriptor: ToolOptionPropertyDescriptor;
  readonly colors: EditorColorSystemSnapshot;
  readonly onChange: (color: string) => void;
}) {
  const activeColor = requireString(descriptor.value, "Stroke color");
  const commitHex = (event: FocusEvent<HTMLInputElement>): void => {
    try {
      onChange(event.currentTarget.value);
    } catch {
      event.currentTarget.value = activeColor;
    }
  };

  return (
    <div
      className="rounded-xl px-2 py-1.5 transition-colors hover:bg-folio-hover"
      data-tool-option="strokeColor"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
          Current color
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className="size-5 rounded-full border border-black/15 shadow-sm"
            style={{ backgroundColor: activeColor }}
            aria-hidden="true"
          />
          <span className="font-mono text-[10px] uppercase text-folio-ink">{activeColor}</span>
        </div>
      </div>
      <div className="mb-1 flex min-h-5 items-center justify-between">
        <span className="text-[9px] font-medium text-folio-muted">Recent</span>
        <div className="flex items-center gap-1" aria-label="Recent colors">
          {colors.recentColors.length === 0 ? (
            <span className="text-[9px] text-folio-muted">No recent colors</span>
          ) : (
            colors.recentColors
              .slice(0, 5)
              .map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  className="size-4 rounded-full border border-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                  style={{ backgroundColor: color.hex }}
                  aria-label={`Use recent color ${color.hex}`}
                  onClick={() => onChange(color.hex)}
                />
              ))
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1" aria-label="Color palette">
        {colors.presetColors.map((color) => (
          <button
            key={color.hex}
            type="button"
            className={cn(
              "size-[18px] rounded-full border border-black/15 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
              color.hex === activeColor && "ring-2 ring-folio-accent ring-offset-1",
            )}
            style={{ backgroundColor: color.hex }}
            aria-label={`Use color ${color.hex}`}
            onClick={() => onChange(color.hex)}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="size-7 shrink-0 cursor-pointer rounded-lg border border-folio-border bg-transparent p-0.5"
          value={activeColor}
          aria-label="Custom stroke color"
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value)}
        />
        <input
          key={activeColor}
          type="text"
          className="h-7 min-w-0 flex-1 rounded-lg border border-folio-border bg-folio-surface px-2 font-mono text-[10px] uppercase text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          defaultValue={activeColor}
          aria-label="Stroke color hex value"
          maxLength={7}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

function requireNumber(value: string | number, label: string): number {
  if (typeof value !== "number") throw new TypeError(`${label} must be numeric.`);
  return value;
}

function requireString(value: string | number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text.`);
  return value;
}

type CanvasPointerRegion = "outside" | "page" | "workspace";

function resolveCanvasPointerRegion(event: PointerEvent): CanvasPointerRegion {
  if (!(event.target instanceof Element)) return "outside";
  const surface = event.target.closest('[data-testid="canvas-surface"]');
  if (surface === null) return "outside";
  const canvas = surface?.querySelector('canvas[data-folio-renderer="true"]');
  if (!(canvas instanceof HTMLCanvasElement)) return "page";
  const bounds = canvas.getBoundingClientRect();
  const logicalWidth = Number(canvas.dataset.logicalWidth);
  const logicalHeight = Number(canvas.dataset.logicalHeight);
  const pageX = Number(canvas.dataset.pageX);
  const pageY = Number(canvas.dataset.pageY);
  const pageWidth = Number(canvas.dataset.pageWidth);
  const pageHeight = Number(canvas.dataset.pageHeight);
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    ![logicalWidth, logicalHeight, pageX, pageY, pageWidth, pageHeight].every(Number.isFinite)
  ) {
    return "page";
  }
  const canvasX = (event.clientX - bounds.left) * (logicalWidth / bounds.width);
  const canvasY = (event.clientY - bounds.top) * (logicalHeight / bounds.height);
  const isPage =
    canvasX >= pageX &&
    canvasX <= pageX + pageWidth &&
    canvasY >= pageY &&
    canvasY <= pageY + pageHeight;
  return isPage ? "page" : "workspace";
}
