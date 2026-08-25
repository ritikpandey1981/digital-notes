import type { EditorColorSystemSnapshot } from "@folio/editor";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@folio/ui";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import type { ChangeEvent, FocusEvent, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { ContinuousSlider } from "./ContinuousSlider";
import { StrokePreviewCanvas } from "./StrokePreviewCanvas";
import type { ToolOptionPropertyDescriptor, ToolOptionsDescriptor } from "./tool-options-registry";
import { useFrameCoalescedCallback } from "./useFrameCoalescedCallback";
import {
  INTERACTION_MOTION,
  motionSeconds,
  PROFESSIONAL_EASE,
} from "../../motion/interaction-motion";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface ToolOptionsWidgetProps {
  readonly descriptor: ToolOptionsDescriptor | null;
  readonly colors: EditorColorSystemSnapshot;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onChangeColor: (color: string) => void;
  readonly onChangeWidth: (width: number) => void;
  readonly onChangeOpacity: (opacity: number) => void;
  readonly onChangeSmoothing: (amount: number) => void;
  readonly onDismiss: () => void;
  readonly previewScale: number;
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
  smoothing: (descriptor, context) => (
    <ContinuousSlider descriptor={descriptor} onChange={(value) => context.onChange(value)} />
  ),
});

export function ToolOptionsWidget({
  descriptor,
  colors,
  onSelectPreset,
  onChangeColor,
  onChangeWidth,
  onChangeOpacity,
  onChangeSmoothing,
  onDismiss,
  previewScale,
}: ToolOptionsWidgetProps) {
  const renderCountRef = useRef(0);
  const reducedMotion = useReducedMotion() === true;
  const paletteVisible = descriptor !== null;
  const paletteRef = useRef<HTMLElement | null>(null);
  const floatingWidgetScope = useFloatingWidgetDismissal(paletteVisible, onDismiss, paletteRef);
  useLayoutEffect(() => {
    renderCountRef.current += 1;
    if (paletteRef.current !== null) {
      paletteRef.current.dataset.renderCount = String(renderCountRef.current);
    }
  });

  const propertyActions: Readonly<Record<string, (value: string | number) => void>> = {
    strokeColor: (value) => onChangeColor(requireString(value, "Stroke color")),
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
            className="folio-floating-surface pointer-events-auto w-[304px] p-3"
            role="group"
            aria-label={`${descriptor.displayName} tool options`}
            data-testid="context-tool-palette"
            data-tool-options-tool={descriptor.tool}
            data-elevation="temporary"
            data-motion-profile="professional"
            data-floating-surface="folio"
            initial={{ opacity: 0, x: -8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: {
                duration: motionSeconds(INTERACTION_MOTION.paletteOpenMilliseconds, reducedMotion),
                ease: PROFESSIONAL_EASE,
              },
            }}
            exit={{
              opacity: 0,
              x: -6,
              transition: {
                duration: motionSeconds(INTERACTION_MOTION.paletteCloseMilliseconds, reducedMotion),
                ease: PROFESSIONAL_EASE,
              },
            }}
          >
            <motion.div
              key={descriptor.id}
              className="flex flex-col gap-1"
              initial={{ opacity: 0.84, x: -3 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: motionSeconds(INTERACTION_MOTION.contentMilliseconds, reducedMotion),
                ease: PROFESSIONAL_EASE,
              }}
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
              {descriptor.preset === null ? null : (
                <div className="mb-1 flex items-center gap-2 rounded-xl px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted transition-colors duration-100 hover:bg-folio-hover">
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
  const reducedMotion = useReducedMotion() === true;
  const activeColor = requireString(descriptor.value, "Stroke color");
  const [queueColorChange] = useFrameCoalescedCallback(onChange);
  const commitHex = (event: FocusEvent<HTMLInputElement>): void => {
    try {
      onChange(event.currentTarget.value);
    } catch {
      event.currentTarget.value = activeColor;
    }
  };

  return (
    <div
      className="rounded-xl px-2 py-1.5 transition-colors duration-100 ease-out hover:bg-folio-hover"
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
            <AnimatePresence initial={false}>
              {colors.recentColors.slice(0, 5).map((color) => (
                <motion.button
                  key={color}
                  layout="position"
                  type="button"
                  className="size-4 rounded-full border border-black/15 transition-[transform,box-shadow] duration-100 ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95"
                  style={{ backgroundColor: color }}
                  aria-label={`Use recent color ${color}`}
                  aria-pressed={color === activeColor}
                  initial={{ opacity: 0, scale: 0.86 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{
                    duration: motionSeconds(INTERACTION_MOTION.hoverMilliseconds, reducedMotion),
                    ease: PROFESSIONAL_EASE,
                  }}
                  onClick={() => onChange(color)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-1" aria-label="Color palette">
        {colors.presetColors.map((color) => (
          <button
            key={color}
            type="button"
            className={cn(
              "size-[18px] rounded-full border border-black/15 shadow-sm transition-[transform,box-shadow] duration-100 ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95",
              color === activeColor && "ring-2 ring-folio-accent ring-offset-1",
            )}
            style={{ backgroundColor: color }}
            aria-label={`Use color ${color}`}
            aria-pressed={color === activeColor}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="color"
          className="size-7 shrink-0 cursor-pointer rounded-lg border border-folio-border bg-transparent p-0.5 transition-[transform,box-shadow] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95"
          value={activeColor}
          aria-label="Custom stroke color"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            queueColorChange(event.currentTarget.value)
          }
        />
        <input
          key={activeColor}
          type="text"
          className="h-7 min-w-0 flex-1 rounded-lg border border-folio-border bg-folio-surface px-2 font-mono text-[10px] uppercase text-folio-ink transition-[border-color,box-shadow] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
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
