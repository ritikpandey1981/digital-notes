import {
  EDITOR_STROKE_WIDTHS,
  type EditorColorSystemSnapshot,
  type PenPreset,
} from "@folio/editor";
import { cn } from "@folio/ui";
import {
  CopyPlus,
  Eraser,
  Highlighter,
  Image,
  MousePointer2,
  PenLine,
  Shapes,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import type { ChangeEvent, FocusEvent } from "react";
import type { EditorTool } from "./editor-types";

interface FloatingToolbarProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  activePreset: PenPreset;
  availablePresets: readonly PenPreset[];
  colors: EditorColorSystemSnapshot;
  onSelectPreset: (presetId: string) => void;
  onChangeDrawingColor: (color: string) => void;
  onChangeDrawingWidth: (width: number) => void;
  onChangeDrawingOpacity: (opacity: number) => void;
}

const tools = [
  { label: "Select", icon: MousePointer2 },
  { label: "Pen", icon: PenLine },
  { label: "Highlighter", icon: Highlighter },
  { label: "Eraser", icon: Eraser },
  { label: "Text", icon: TextCursorInput },
  { label: "Image", icon: Image },
  { label: "Shape", icon: Shapes },
  { label: "Table", icon: Table2 },
  { label: "Sticky Note", icon: StickyNote },
] satisfies ReadonlyArray<{ label: EditorTool; icon: typeof MousePointer2 }>;

export function FloatingToolbar({
  activeTool,
  onSelectTool,
  onDeleteSelection,
  onDuplicateSelection,
  activePreset,
  availablePresets,
  colors,
  onSelectPreset,
  onChangeDrawingColor,
  onChangeDrawingWidth,
  onChangeDrawingOpacity,
}: FloatingToolbarProps) {
  const drawingTool = activeTool === "Pen" || activeTool === "Highlighter";
  const activeColor = activePreset.style.strokeColor;
  const commitHex = (event: FocusEvent<HTMLInputElement>): void => {
    try {
      onChangeDrawingColor(event.currentTarget.value);
    } catch {
      event.currentTarget.value = activeColor.hex;
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
      <div
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-[18px] border border-folio-border bg-folio-glass p-1.5 shadow-lg backdrop-blur-xl"
        role="toolbar"
        aria-label="Notebook tools"
      >
        {tools.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            className={cn(
              "group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
              activeTool === label &&
                "bg-folio-accent text-white shadow-sm hover:bg-folio-accent hover:text-white",
            )}
            aria-label={label}
            aria-pressed={activeTool === label}
            title={label}
            onClick={() => onSelectTool(label)}
          >
            <Icon className="size-[17px]" aria-hidden="true" />
          </button>
        ))}

        <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
        <button
          type="button"
          className="group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
          aria-label="Duplicate selected object"
          title="Duplicate selected object"
          onClick={onDuplicateSelection}
        >
          <CopyPlus className="size-[17px]" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="group relative flex size-9 shrink-0 items-center justify-center rounded-xl text-folio-muted transition-all duration-150 hover:bg-folio-hover hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent dark:hover:text-red-400"
          aria-label="Delete selected object"
          title="Delete selected object"
          onClick={onDeleteSelection}
        >
          <Trash2 className="size-[17px]" aria-hidden="true" />
        </button>

        {drawingTool ? (
          <>
            <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
            <div className="flex items-center gap-1" aria-label={activeTool + " presets"}>
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-folio-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                    preset.id === activePreset.id && "bg-folio-hover ring-1 ring-folio-accent",
                  )}
                  aria-label={activeTool + " preset " + preset.name}
                  aria-pressed={preset.id === activePreset.id}
                  onClick={() => onSelectPreset(preset.id)}
                >
                  <span
                    className="rounded-full border border-black/15"
                    style={{
                      width: Math.min(18, Math.max(6, preset.style.strokeWidth)),
                      height: Math.min(18, Math.max(6, preset.style.strokeWidth)),
                      backgroundColor: preset.style.strokeColor.hex,
                      opacity: Math.max(0.55, preset.style.strokeColor.opacity),
                    }}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>

            <span className="mx-0.5 h-6 w-px shrink-0 bg-folio-border" aria-hidden="true" />
            <div className="flex items-center gap-1" aria-label="Preset colors">
              {colors.presetColors.slice(0, 8).map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  className={cn(
                    "size-5 shrink-0 rounded-full border border-black/15 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                    color.hex === activeColor.hex && "ring-2 ring-folio-accent ring-offset-1",
                  )}
                  style={{ backgroundColor: color.hex }}
                  aria-label={"Use color " + color.hex}
                  onClick={() => onChangeDrawingColor(color.hex)}
                />
              ))}
            </div>
            <input
              type="color"
              className="size-7 shrink-0 cursor-pointer rounded-lg border border-folio-border bg-transparent p-0.5"
              value={activeColor.hex}
              aria-label="Custom stroke color"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                onChangeDrawingColor(event.currentTarget.value)
              }
            />
            <input
              key={activeColor.hex}
              type="text"
              className="h-7 w-[72px] shrink-0 rounded-lg border border-folio-border bg-folio-surface px-2 font-mono text-[10px] uppercase text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
              defaultValue={activeColor.hex}
              aria-label="Stroke color hex value"
              maxLength={7}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <select
              className="h-7 shrink-0 rounded-lg border border-folio-border bg-folio-surface px-1.5 text-[11px] font-medium text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
              value={activePreset.style.strokeWidth}
              aria-label="Stroke width"
              onChange={(event) => onChangeDrawingWidth(Number(event.currentTarget.value))}
            >
              {EDITOR_STROKE_WIDTHS.map((width) => (
                <option key={width} value={width}>
                  {width}px
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[10px] font-medium text-folio-muted">
              <span className="sr-only">Stroke opacity</span>
              <input
                type="range"
                className="w-16 accent-folio-accent"
                min="0.1"
                max="1"
                step="0.05"
                value={activeColor.opacity}
                aria-label="Stroke opacity"
                onChange={(event) => onChangeDrawingOpacity(Number(event.currentTarget.value))}
              />
              <span className="w-7 text-right">{Math.round(activeColor.opacity * 100)}%</span>
            </label>
          </>
        ) : null}

        {colors.recentColors.length > 0 && drawingTool ? (
          <div className="flex items-center gap-1" aria-label="Recent colors">
            {colors.recentColors.slice(0, 4).map((color) => (
              <button
                key={color.hex + "-" + color.opacity}
                type="button"
                className="size-4 rounded-full border border-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                style={{ backgroundColor: color.hex }}
                aria-label={"Use recent color " + color.hex}
                onClick={() => onChangeDrawingColor(color.hex)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
