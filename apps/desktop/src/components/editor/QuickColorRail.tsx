import type { ColorPalette, ColorTargetAdapter } from "@folio/editor";
import { Palette } from "lucide-react";
import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ToolTooltip } from "./ToolTooltip";
import { quickColorRailSwatchCount } from "./color-picker-model";
import type { EditorTool } from "./editor-types";

interface QuickColorRailProps {
  readonly activeTool: EditorTool;
  readonly target: ColorTargetAdapter | null;
  readonly palette: ColorPalette;
  readonly onOpenPicker: (anchor: HTMLElement) => void;
  readonly onApplyColor: (color: string) => void;
}

export function QuickColorRail({
  activeTool,
  target,
  palette,
  onOpenPicker,
  onApplyColor,
}: QuickColorRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [workspaceHeight, setWorkspaceHeight] = useState(730);
  const [focusIndex, setFocusIndex] = useState(0);
  const visible = target !== null;
  const swatches = palette.colors.slice(0, quickColorRailSwatchCount(workspaceHeight));
  const currentColor = target?.getCurrentColor() ?? "#111111";
  const buttonCount = swatches.length + 2;
  const activeFocusIndex = Math.min(focusIndex, buttonCount - 1);

  useLayoutEffect(() => {
    const workspace = railRef.current?.closest<HTMLElement>('[data-testid="editor-workspace"]');
    if (workspace === undefined || workspace === null) return;
    const measure = (): void => setWorkspaceHeight(workspace.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible || target === null) return null;

  const moveFocus = (index: number): void => {
    const next = ((index % buttonCount) + buttonCount) % buttonCount;
    setFocusIndex(next);
    buttonRefs.current[next]?.focus();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = buttonRefs.current.findIndex((button) => button === document.activeElement);
    if (current < 0) return;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(current - 1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(current + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(buttonCount - 1);
    } else if (event.key === "Enter" || event.key === " " || event.code === "Space") {
      event.preventDefault();
      buttonRefs.current[current]?.click();
    }
  };

  return (
    <div className="pointer-events-none absolute right-4 top-1/2 z-20 -translate-y-1/2">
      <div
        ref={railRef}
        className="folio-floating-surface pointer-events-auto flex w-12 flex-col items-center gap-1 p-1"
        role="toolbar"
        aria-label={`${activeTool} quick colors`}
        aria-orientation="vertical"
        data-testid="quick-color-rail"
        data-active-color-target={target.id}
        data-palette-id={palette.id}
        data-visible-swatch-count={swatches.length}
        data-floating-surface="folio"
        onKeyDown={handleKeyDown}
      >
        <RailButton
          ref={(button) => {
            buttonRefs.current[0] = button;
          }}
          tabIndex={activeFocusIndex === 0 ? 0 : -1}
          label={`Current color ${currentColor}. Open full color picker`}
          pressed
          testId="quick-color-current"
          onClick={(event) => onOpenPicker(event.currentTarget)}
        >
          <span
            className="size-[22px] rounded-full border border-black/20 shadow-sm ring-2 ring-folio-accent ring-offset-1 ring-offset-folio-surface"
            style={{ backgroundColor: currentColor }}
            aria-hidden="true"
          />
        </RailButton>
        <span className="my-0.5 h-px w-7 bg-folio-border" aria-hidden="true" />
        {swatches.map((color, index) => {
          const buttonIndex = index + 1;
          return (
            <RailButton
              key={color}
              ref={(button) => {
                buttonRefs.current[buttonIndex] = button;
              }}
              tabIndex={activeFocusIndex === buttonIndex ? 0 : -1}
              label={`Use color ${color}`}
              pressed={color === currentColor}
              color={color}
              onClick={() => onApplyColor(color)}
            >
              <span
                className="size-[20px] rounded-full border border-black/20 shadow-sm"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
            </RailButton>
          );
        })}
        <span className="my-0.5 h-px w-7 bg-folio-border" aria-hidden="true" />
        <RailButton
          ref={(button) => {
            buttonRefs.current[buttonCount - 1] = button;
          }}
          tabIndex={activeFocusIndex === buttonCount - 1 ? 0 : -1}
          label="More Colors"
          pressed={false}
          testId="quick-color-more"
          onClick={(event) => onOpenPicker(event.currentTarget)}
        >
          <Palette className="size-[17px]" aria-hidden="true" />
        </RailButton>
      </div>
    </div>
  );
}

const RailButton = forwardRef<
  HTMLButtonElement,
  {
    readonly label: string;
    readonly pressed: boolean;
    readonly tabIndex: number;
    readonly color?: string;
    readonly testId?: string;
    readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    readonly children: ReactNode;
  }
>(function RailButton({ label, pressed, tabIndex, color, testId, onClick, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="group relative grid size-9 shrink-0 place-items-center rounded-[9px] text-[var(--folio-icon-neutral)] transition-[background-color,color,transform,box-shadow] duration-100 hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-95"
      aria-label={label}
      aria-pressed={pressed}
      tabIndex={tabIndex}
      data-color={color}
      data-testid={testId}
      onClick={onClick}
    >
      {children}
      <ToolTooltip label={label} side="left" />
    </button>
  );
});
