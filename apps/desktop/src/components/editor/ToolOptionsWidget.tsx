import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@folio/ui";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { ContinuousSlider } from "./ContinuousSlider";
import { StrokePreviewCanvas } from "./StrokePreviewCanvas";
import type { ToolOptionPropertyDescriptor, ToolOptionsDescriptor } from "./tool-options-registry";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface ToolOptionsWidgetProps {
  readonly descriptor: ToolOptionsDescriptor | null;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onOpenColorPicker: (anchor: HTMLElement, ownerScope: string) => void;
  readonly onChangeWidth: (width: number) => void;
  readonly onChangeOpacity: (opacity: number) => void;
  readonly onChangeSmoothing: (amount: number) => void;
  readonly onDismiss: () => void;
  readonly previewScale: number;
}

interface PropertyControlContext {
  readonly onChange: (value: string | number) => void;
  readonly onOpenColorPicker: (anchor: HTMLElement) => void;
}

type PropertyControlRenderer = (
  descriptor: ToolOptionPropertyDescriptor,
  context: PropertyControlContext,
) => ReactNode;

const propertyControlRenderers: Readonly<Record<string, PropertyControlRenderer>> = Object.freeze({
  strokeColor: (descriptor, context) => (
    <CompactColorTrigger descriptor={descriptor} onOpen={context.onOpenColorPicker} />
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
  smoothing: (descriptor, context) => (
    <ContinuousSlider descriptor={descriptor} onChange={(value) => context.onChange(value)} />
  ),
});

export function ToolOptionsWidget({
  descriptor,
  onSelectPreset,
  onOpenColorPicker,
  onChangeWidth,
  onChangeOpacity,
  onChangeSmoothing,
  onDismiss,
  previewScale,
}: ToolOptionsWidgetProps) {
  const renderCountRef = useRef(0);
  const motionPreset = useFloatingSurfaceMotion();
  const paletteVisible = descriptor !== null;
  const paletteRef = useRef<HTMLElement | null>(null);
  // Tool settings belong to the tool, not to the pointer: drawing, opening
  // Layers, or opening Pages must never take them away mid-sketch.
  const floatingWidgetScope = useFloatingWidgetDismissal(paletteVisible, onDismiss, paletteRef, {
    outsidePointerDismissal: "ignore",
  });
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (paletteRef.current !== null) {
      paletteRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });

  const propertyActions: Readonly<Record<string, (value: string | number) => void>> = {
    strokeColor: () => undefined,
    strokeWidth: (value) => onChangeWidth(requireNumber(value, "Stroke width")),
    opacity: (value) => onChangeOpacity(requireNumber(value, "Opacity")),
    smoothing: (value) => onChangeSmoothing(requireNumber(value, "Smoothing")),
  };

  return (
    <div className="pointer-events-none absolute left-[76px] top-1/2 z-20 -translate-y-1/2">
      <AnimatePresence initial={false}>
        {descriptor === null ? null : (
          <motion.section
            ref={paletteRef}
            data-floating-widget-scope={floatingWidgetScope}
            key="context-tool-palette"
            className="folio-floating-surface pointer-events-auto w-[248px] p-2"
            role="group"
            aria-label={`${descriptor.displayName} tool options`}
            data-testid="context-tool-palette"
            data-tool-options-tool={descriptor.tool}
            data-elevation="temporary"
            data-motion-profile="professional"
            data-floating-surface="folio"
            {...floatingSurfaceMotion(motionPreset, "left")}
          >
            <motion.div
              key={descriptor.id}
              className="flex flex-col gap-1"
              initial={{ opacity: 0.84, x: -3 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: motionSeconds(
                  INTERACTION_MOTION.contentMilliseconds,
                  motionPreset.reducedMotion,
                ),
                ease: PROFESSIONAL_EASE,
              }}
            >
              <div className="flex items-center justify-between px-1 pb-0.5">
                <p
                  className="text-[11px] font-semibold text-folio-ink"
                  data-testid="tool-options-title"
                >
                  {descriptor.displayName}
                </p>
              </div>
              {descriptor.preset === null ? null : (
                <div className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted transition-colors duration-100 hover:bg-folio-hover">
                  <span className="shrink-0">Preset</span>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-7 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-folio-border bg-folio-surface px-2 text-[11px] font-medium normal-case tracking-normal text-folio-ink transition-[background-color,border-color,box-shadow] hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                        aria-label={`${descriptor.displayName} preset`}
                        data-testid="brush-preset-trigger"
                        data-active-preset-id={descriptor.preset.activeId}
                      >
                        <span className="truncate">
                          {descriptor.preset.options.find(
                            ({ id }) => id === descriptor.preset?.activeId,
                          )?.name ?? "Preset"}
                        </span>
                        <ChevronDown
                          className="size-3.5 shrink-0 text-folio-muted"
                          aria-hidden="true"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      data-floating-widget-owner={floatingWidgetScope}
                      align="end"
                      side="right"
                      sideOffset={8}
                      collisionPadding={10}
                      className="z-[45] min-w-52"
                      data-testid="brush-preset-menu"
                    >
                      {descriptor.preset.options.map((preset) => {
                        const selected = preset.id === descriptor.preset?.activeId;
                        return (
                          <DropdownMenuItem
                            key={preset.id}
                            className={cn(
                              "justify-between",
                              selected && "bg-folio-accent-soft text-folio-accent",
                            )}
                            aria-checked={selected}
                            role="menuitemradio"
                            data-preset-id={preset.id}
                            onSelect={() => onSelectPreset(preset.id)}
                          >
                            <span>{preset.name}</span>
                            {selected ? <Check className="size-4" aria-hidden="true" /> : null}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              <StrokePreviewCanvas descriptor={descriptor} renderScale={previewScale} />
              <span className="my-0.5 h-px w-full bg-folio-border" aria-hidden="true" />
              {descriptor.properties.map((property) => {
                const render = propertyControlRenderers[property.key];
                const action = propertyActions[property.key];
                if (render === undefined || action === undefined) return null;
                return (
                  <div key={property.key}>
                    {render(property, {
                      onChange: action,
                      onOpenColorPicker: (anchor) => onOpenColorPicker(anchor, floatingWidgetScope),
                    })}
                  </div>
                );
              })}
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompactColorTrigger({
  descriptor,
  onOpen,
}: {
  readonly descriptor: ToolOptionPropertyDescriptor;
  readonly onOpen: (anchor: HTMLElement) => void;
}) {
  const activeColor = requireString(descriptor.value, "Stroke color");
  return (
    <div
      className="rounded-lg px-1 py-0.5 transition-colors duration-100 ease-out hover:bg-folio-hover"
      data-tool-option="strokeColor"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
          Color
        </span>
        <button
          type="button"
          className="flex h-7 min-w-24 items-center gap-2 rounded-lg border border-folio-border bg-folio-surface px-2 transition-[background-color,box-shadow] hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label={`Open ${activeColor} color picker`}
          data-testid="tool-options-color-trigger"
          onClick={(event) => onOpen(event.currentTarget)}
        >
          <span
            className="size-5 shrink-0 rounded-full border border-black/15 shadow-sm"
            style={{ backgroundColor: activeColor }}
            aria-hidden="true"
          />
          <span className="font-mono text-[10px] uppercase text-folio-ink">{activeColor}</span>
        </button>
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
