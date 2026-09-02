import { cn } from "@folio/ui";
import type { MouseEvent } from "react";
import { ToolTooltip } from "./ToolTooltip";
import type {
  DrawingPropertyControl,
  DrawingPropertyRailModel,
} from "./drawing-property-rail-model";

interface DrawingPropertyRailProps {
  readonly model: DrawingPropertyRailModel | null;
  /** Opens the existing tool options palette — the production adjustment path. */
  readonly onOpenToolOptions: () => void;
  /** Opens the existing full colour picker against the active colour target. */
  readonly onOpenColorPicker: (anchor: HTMLElement) => void;
}

/**
 * The compact contextual property rail, inward of the drawing capsule.
 *
 * Four controls — width, opacity, smoothness, colour — reading the active
 * drawing preset. The three parameter icons are deliberately *fixed*: they name
 * the property, and the number printed beneath them carries the value. An
 * earlier version drew each glyph from its live value, which made the opacity
 * disc at 100% indistinguishable from the colour swatch directly below it.
 *
 * Placement is coupled to the dock: the dock is 344px tall and centred on the
 * workspace, so its 206px drawing capsule is centred 69px above the workspace
 * centre. Anchoring there keeps the rail centred on the drawing capsule and
 * clear of the utility capsule below, whatever the rail's own height becomes.
 *
 * Adjustment deliberately routes to the existing Tool Options palette and the
 * existing colour picker. The Concepts-style direct-manipulation interaction is
 * a separate, later design step; inventing a drag here would pre-empt it.
 */
export function DrawingPropertyRail({
  model,
  onOpenToolOptions,
  onOpenColorPicker,
}: DrawingPropertyRailProps) {
  if (model === null) return null;
  return (
    // left-[67px] leaves a 3px seam beyond the dock's 64px right edge: the two
    // surfaces read as one instrument while retaining independent hit regions.
    //
    // z-20 matches the Tool Dock so both sit in the same foreground band. A
    // future radial Brush Library unfolds from a slot at a lower z-index and
    // therefore paints behind both without either needing to move.
    <div
      className="pointer-events-none absolute left-[67px] top-[calc(50%-69px)] z-20 -translate-y-1/2"
      data-testid="drawing-property-rail-anchor"
    >
      <div
        className="folio-floating-surface pointer-events-auto flex w-[46px] flex-col items-center gap-1 p-1"
        role="group"
        aria-label={`${model.tool} properties`}
        data-testid="drawing-property-rail"
        data-property-rail-tool={model.tool}
        data-floating-surface="folio"
        data-elevation="permanent"
      >
        {model.controls.map((control) => (
          <PropertyButton
            key={control.key}
            control={control}
            onOpenToolOptions={onOpenToolOptions}
            onOpenColorPicker={onOpenColorPicker}
          />
        ))}
      </div>
    </div>
  );
}

function PropertyButton({
  control,
  onOpenToolOptions,
  onOpenColorPicker,
}: {
  readonly control: DrawingPropertyControl;
  readonly onOpenToolOptions: () => void;
  readonly onOpenColorPicker: (anchor: HTMLElement) => void;
}) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (control.key === "strokeColor") {
      onOpenColorPicker(event.currentTarget);
      return;
    }
    onOpenToolOptions();
  };
  return (
    <button
      type="button"
      className={cn(
        "group relative flex w-full shrink-0 flex-col items-center justify-center gap-0.5 rounded-[8px] py-1 text-[var(--folio-icon-neutral)] transition-[background-color,color] duration-100 ease-out hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
        control.displayValue === null && "py-1.5",
        !control.available && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
      aria-label={control.accessibleLabel}
      disabled={!control.available}
      data-property-key={control.key}
      data-property-value={String(control.value)}
      data-property-display={control.displayValue ?? ""}
      data-property-available={control.available}
      onClick={handleClick}
    >
      <PropertyGlyph control={control} />
      {control.displayValue === null ? null : (
        <span
          // Tabular figures keep 9 px → 10 px from shifting the column.
          className="text-[9px] leading-none font-semibold text-folio-ink tabular-nums"
          data-testid={`drawing-property-value-${control.key}`}
          data-property-emphasis="primary"
          aria-hidden="true"
        >
          {control.displayValue}
        </span>
      )}
      <ToolTooltip label={control.accessibleLabel} />
    </button>
  );
}

/**
 * Fixed property symbols.
 *
 * None of these respond to their value — that is the point. Only the colour
 * swatch shows live state, because the colour *is* its own value.
 */
function PropertyGlyph({ control }: { readonly control: DrawingPropertyControl }) {
  if (control.key === "strokeColor") {
    return (
      <span
        className="size-[18px] rounded-full border border-black/20 shadow-sm"
        style={{ backgroundColor: String(control.value) }}
        data-testid="drawing-property-color-swatch"
        data-property-emphasis="standalone"
        aria-hidden="true"
      />
    );
  }
  if (control.key === "strokeWidth") {
    // Two fixed rules, thin above thick: "stroke weight", not "this weight".
    return (
      <svg
        viewBox="0 0 16 16"
        className="size-[15px] opacity-80"
        aria-hidden="true"
        focusable="false"
        data-property-emphasis="secondary"
      >
        <rect x="1.5" y="5" width="13" height="1.5" rx="0.75" fill="currentColor" />
        <rect x="1.5" y="9" width="13" height="3.25" rx="1.625" fill="currentColor" />
      </svg>
    );
  }
  if (control.key === "opacity") {
    // A half-filled disc, fixed at half regardless of the actual opacity.
    return (
      <svg
        viewBox="0 0 16 16"
        className="size-[15px] opacity-80"
        aria-hidden="true"
        focusable="false"
        data-property-emphasis="secondary"
      >
        <path d="M8 1.75 A6.25 6.25 0 0 0 8 14.25 Z" fill="currentColor" />
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  // A fixed smoothing waveform: constant amplitude, constant geometry.
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-[15px] opacity-80"
      aria-hidden="true"
      focusable="false"
      data-property-emphasis="secondary"
    >
      <path
        d="M1.5 9.75 C3.5 4.75 5.5 4.75 7.5 8 S11.5 11.25 14.5 6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
