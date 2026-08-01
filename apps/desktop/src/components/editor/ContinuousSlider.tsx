import { useState, type CSSProperties, type KeyboardEvent, type WheelEvent } from "react";
import type { ToolOptionPropertyDescriptor } from "./tool-options-registry";

interface ContinuousSliderProps {
  readonly descriptor: ToolOptionPropertyDescriptor;
  readonly onChange: (value: number) => void;
}

export function ContinuousSlider({ descriptor, onChange }: ContinuousSliderProps) {
  if (typeof descriptor.value !== "number" || typeof descriptor.defaultValue !== "number") {
    throw new TypeError("Continuous sliders require numeric descriptors.");
  }
  const value = descriptor.value;
  const minimum = descriptor.constraints.minimum ?? 0;
  const maximum = descriptor.constraints.maximum ?? 1;
  const step = descriptor.constraints.step ?? 0.01;
  const largeStep = descriptor.largeStep ?? step * 10;
  const displayScale = descriptor.displayScale ?? 1;
  const precision = descriptor.precision ?? 1;
  const displayedValue = formatValue(value * displayScale, precision);
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const progress = ((value - minimum) / (maximum - minimum)) * 100;

  const update = (candidate: number): number => {
    const next = clamp(roundToStep(candidate, step), minimum, maximum);
    onChange(next);
    return next;
  };
  const commitDraft = (inputValue: string): void => {
    const candidate = Number(inputValue) / displayScale;
    if (Number.isFinite(candidate)) update(candidate);
    setDraftValue(null);
  };
  const updateDraft = (inputValue: string): void => {
    setDraftValue(inputValue);
    if (inputValue.trim().length === 0) return;
    const candidate = Number(inputValue) / displayScale;
    if (Number.isFinite(candidate)) update(candidate);
  };
  const adjust = (direction: -1 | 1, increment: number): number => {
    const next = value + direction * increment;
    return update(next);
  };
  const handleRangeKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    adjust(event.key === "ArrowRight" ? 1 : -1, largeStep);
  };
  const handleNumberKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const next = adjust(event.key === "ArrowRight" ? 1 : -1, largeStep);
      setDraftValue(formatValue(next * displayScale, precision));
      return;
    }
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraftValue(null);
      event.currentTarget.blur();
    }
  };
  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY === 0) return;
    adjust(event.deltaY < 0 ? 1 : -1, event.shiftKey ? largeStep : step);
  };

  return (
    <div
      className="group/slider min-w-[166px] rounded-xl px-2 py-1.5 transition-colors duration-100 ease-out hover:bg-folio-hover"
      data-tool-option={descriptor.key}
      onWheel={handleWheel}
    >
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted"
          htmlFor={`tool-option-${descriptor.key}`}
        >
          {descriptor.displayName}
        </label>
        <div className="flex h-7 items-center rounded-lg border border-folio-border bg-folio-surface px-1 transition-[border-color,box-shadow] duration-100 ease-out focus-within:ring-2 focus-within:ring-folio-accent">
          <input
            type="number"
            className="w-10 bg-transparent text-right text-[11px] font-semibold text-folio-ink outline-none"
            min={minimum * displayScale}
            max={maximum * displayScale}
            step={step * displayScale}
            value={draftValue ?? displayedValue}
            aria-label={`${descriptor.displayName} value`}
            onFocus={() => setDraftValue(displayedValue)}
            onChange={(event) => updateDraft(event.currentTarget.value)}
            onBlur={(event) => commitDraft(event.currentTarget.value)}
            onKeyDown={handleNumberKeyDown}
          />
          <span className="min-w-3 text-[10px] text-folio-muted" aria-hidden="true">
            {descriptor.unit}
          </span>
        </div>
      </div>
      <input
        id={`tool-option-${descriptor.key}`}
        type="range"
        className="folio-continuous-slider"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        aria-label={descriptor.displayName}
        style={{ "--folio-slider-progress": `${progress}%` } as CSSProperties}
        onChange={(event) => update(Number(event.currentTarget.value))}
        onKeyDown={handleRangeKeyDown}
      />
    </div>
  );
}

function formatValue(value: number, precision: number): string {
  return value.toFixed(precision).replace(/\.0+$/u, "");
}

function roundToStep(value: number, step: number): number {
  const precision = Math.max(0, decimalPlaces(step));
  return Number((Math.round(value / step) * step).toFixed(precision));
}

function decimalPlaces(value: number): number {
  const decimal = value.toString().split(".")[1];
  return decimal?.length ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
