import { hexToRgb, type EditorColorSystemSnapshot, type HsvColor } from "@folio/editor";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@folio/ui";
import { motion } from "framer-motion";
import { Check, ChevronDown, Pipette, Star } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  adjustSvWithKeyboard,
  completeHexDraft,
  favoriteCollectionDisplayPolicy,
  hsvFromSvPointer,
  isFavoriteColor,
  resolveColorPickerPlacement,
  resolveColorPickerMaximumHeight,
  resolveColorPickerUsableBounds,
  rgbDraftToHex,
  type PickerRect,
  type RgbDraft,
} from "./color-picker-model";
import {
  collectEditorOccupiedZones,
  measureSurfaceRect,
  OCCUPIED_SURFACE_SELECTOR,
} from "./editor-workspace-zones";
import {
  floatingSurfaceMotion,
  useFloatingSurfaceMotion,
} from "../../motion/floating-surface-motion";
import type { ColorPickerSessionSnapshot, ColorPreviewSchedule } from "./useColorPickerSession";
import { useFloatingWidgetDismissal } from "./useFloatingWidgetDismissal";

interface FullColorPickerProps {
  readonly session: ColorPickerSessionSnapshot;
  readonly colors: EditorColorSystemSnapshot;
  readonly eyedropperActive: boolean;
  readonly eyedropperMessage: string | null;
  readonly eyedropperSampledColor: string | null;
  readonly floatingScope: string;
  readonly workspaceAvoidRect?:
    | Readonly<{
        x: number;
        y: number;
        width: number;
        height: number;
      }>
    | undefined;
  readonly onPreviewHex: (
    color: string,
    schedule?: ColorPreviewSchedule,
  ) => ColorPickerSessionSnapshot | null;
  readonly onPreviewHsv: (
    hsv: HsvColor,
    schedule?: ColorPreviewSchedule,
  ) => ColorPickerSessionSnapshot | null;
  readonly onSelectPalette: (paletteId: string) => void;
  readonly onToggleFavorite: (color: string) => void;
  readonly onEyedropperActiveChange: (active: boolean) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

const FALLBACK_PICKER_SIZE = Object.freeze({ width: 332, height: 594 });

export function FullColorPicker({
  session,
  colors,
  eyedropperActive,
  eyedropperMessage,
  eyedropperSampledColor,
  floatingScope,
  workspaceAvoidRect,
  onPreviewHex,
  onPreviewHsv,
  onSelectPalette,
  onToggleFavorite,
  onEyedropperActiveChange,
  onCommit,
  onCancel,
}: FullColorPickerProps) {
  const motionPreset = useFloatingSurfaceMotion();
  const pickerRef = useRef<HTMLElement | null>(null);
  const eyedropperButtonRef = useRef<HTMLButtonElement | null>(null);
  const [presentation, setPresentation] = useState(() => ({
    currentColor: session.currentColor,
    hsv: session.hsv,
  }));
  const lastMeaningfulHueRef = useRef(session.hsv.hue);
  const [pickerSize, setPickerSize] = useState<{ width: number; height: number }>(
    FALLBACK_PICKER_SIZE,
  );
  const [, setPositionVersion] = useState(0);
  const cancelAndRestoreFocus = useCallback((): void => {
    const anchor = session.anchor;
    onCancel();
    queueMicrotask(() => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    });
  }, [onCancel, session.anchor]);
  const handleEscape = useCallback((): void => {
    if (!eyedropperActive) {
      cancelAndRestoreFocus();
      return;
    }
    onEyedropperActiveChange(false);
    queueMicrotask(() => eyedropperButtonRef.current?.focus({ preventScroll: true }));
  }, [cancelAndRestoreFocus, eyedropperActive, onEyedropperActiveChange]);
  const resolvedFloatingScope = useFloatingWidgetDismissal(true, onCommit, pickerRef, {
    onEscape: handleEscape,
    canvasPageDismissal: "synchronous",
    scopeId: floatingScope,
  });
  const positioningAnchor =
    session.source === "selected-vector"
      ? (session.anchor.closest<HTMLElement>('[data-testid="shape-editing-toolbar"]') ??
        session.anchor)
      : session.anchor;
  const anchorBounds = positioningAnchor.getBoundingClientRect();
  const workspace = positioningAnchor.closest<HTMLElement>('[data-testid="editor-workspace"]');
  const workspaceBounds = rectFromDom(
    workspace?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    },
  );
  const viewportControlBounds = measureSurfaceRect(
    document.querySelector('[data-testid="viewport-controls"]'),
  );
  const toolDockBounds = measureSurfaceRect(document.querySelector("[data-tool-dock-layout]"));
  const artworkAvoidRect =
    workspaceAvoidRect === undefined
      ? undefined
      : {
          left: workspaceBounds.left + workspaceAvoidRect.x,
          top: workspaceBounds.top + workspaceAvoidRect.y,
          width: workspaceAvoidRect.width,
          height: workspaceAvoidRect.height,
        };
  // One shared measurement of every editor surface, including the selection
  // toolbar at its real expanded size, replaces the per-surface lists this
  // component used to keep in sync by hand.
  const zones = collectEditorOccupiedZones({
    soft: [{ id: "selected-artwork", rect: artworkAvoidRect }],
  });
  const maximumPickerHeight = resolveColorPickerMaximumHeight(
    workspaceBounds,
    viewportControlBounds,
  );
  const placementBounds = resolveColorPickerUsableBounds(
    workspaceBounds,
    viewportControlBounds,
    toolDockBounds,
  );
  const placementPickerSize = {
    width: Math.min(pickerSize.width, Math.max(0, workspaceBounds.width - 24)),
    height: Math.min(pickerSize.height, maximumPickerHeight),
  };
  const placement = resolveColorPickerPlacement(
    anchorBounds,
    placementPickerSize,
    { width: window.innerWidth, height: window.innerHeight },
    session.source,
    { bounds: placementBounds, zones },
  );
  const style = {
    left: placement.left,
    top: placement.top,
    maxHeight: maximumPickerHeight,
  } satisfies CSSProperties;
  const ownerScopes = [resolvedFloatingScope, session.ownerScope].filter(Boolean).join(" ");
  const currentIsFavorite = isFavoriteColor(colors.favoriteColors, presentation.currentColor);
  const previewHex = useCallback(
    (color: string, schedule?: ColorPreviewSchedule): boolean => {
      const next = onPreviewHex(color, schedule);
      if (next === null) return false;
      const hsv =
        next.hsv.saturation > 0
          ? next.hsv
          : Object.freeze({ ...next.hsv, hue: lastMeaningfulHueRef.current });
      if (next.hsv.saturation > 0) lastMeaningfulHueRef.current = next.hsv.hue;
      setPresentation({ currentColor: next.currentColor, hsv });
      return true;
    },
    [onPreviewHex],
  );
  const previewHsv = (hsv: HsvColor, schedule?: ColorPreviewSchedule): boolean => {
    const next = onPreviewHsv(hsv, schedule);
    if (next === null) return false;
    lastMeaningfulHueRef.current = hsv.hue;
    setPresentation({ currentColor: next.currentColor, hsv: next.hsv });
    return true;
  };

  useLayoutEffect(() => {
    const picker = pickerRef.current;
    if (picker === null) return;
    const measure = (): void => {
      const bounds = picker.getBoundingClientRect();
      setPickerSize((previous) =>
        previous.width === bounds.width && previous.height === bounds.height
          ? previous
          : { width: bounds.width, height: bounds.height },
      );
      setPositionVersion((version) => version + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(picker);
    const anchorObserver = new ResizeObserver(measure);
    anchorObserver.observe(positioningAnchor);
    if (workspace !== null) anchorObserver.observe(workspace);
    // Reposition when any occupied surface changes shape, not only the anchor.
    for (const surface of document.querySelectorAll(OCCUPIED_SURFACE_SELECTOR)) {
      anchorObserver.observe(surface);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      anchorObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [positioningAnchor, session.anchor, workspace]);

  useEffect(() => {
    addFloatingOwner(session.anchor, floatingScope);
    return () => removeFloatingOwner(session.anchor, floatingScope);
  }, [floatingScope, session.anchor]);

  useEffect(() => {
    const cancelForWindowBlur = (): void => onCancel();
    window.addEventListener("blur", cancelForWindowBlur);
    return () => window.removeEventListener("blur", cancelForWindowBlur);
  }, [onCancel]);

  useEffect(() => {
    if (eyedropperSampledColor !== null) previewHex(eyedropperSampledColor);
  }, [eyedropperSampledColor, previewHex]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.key.toLowerCase() !== "i" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        textEntryOwnsKeyboard(event.target)
      ) {
        return;
      }
      event.preventDefault();
      onEyedropperActiveChange(!eyedropperActive);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [eyedropperActive, onEyedropperActiveChange]);

  const previouslyActiveRef = useRef(eyedropperActive);
  useEffect(() => {
    if (previouslyActiveRef.current && !eyedropperActive) {
      queueMicrotask(() => eyedropperButtonRef.current?.focus({ preventScroll: true }));
    }
    previouslyActiveRef.current = eyedropperActive;
  }, [eyedropperActive]);

  const entrance = floatingSurfaceMotion(
    motionPreset,
    placement.side === "left" ? "right" : "left",
  );
  return (
    // Entrance only: the picker is unmounted by its owner on commit, and an
    // exit animation on a surface this large is exactly what starts swallowing
    // the first canvas press after it closes.
    <motion.section
      ref={pickerRef}
      initial={entrance.initial}
      animate={entrance.animate}
      transition={entrance.transition}
      data-motion-preset={entrance["data-motion-preset"]}
      className="folio-floating-surface fixed z-40 flex w-[332px] max-w-[calc(100vw-24px)] flex-col overflow-hidden"
      style={style}
      role="dialog"
      aria-label={`${session.target.label} picker`}
      data-testid="full-color-picker"
      data-color-target-id={session.target.id}
      data-color-target-label={session.target.label}
      data-picker-source={session.source}
      data-picker-side={placement.side}
      data-picker-maximum-height={maximumPickerHeight}
      data-picker-avoid-left={artworkAvoidRect?.left}
      data-picker-avoid-top={artworkAvoidRect?.top}
      data-picker-avoid-width={artworkAvoidRect?.width}
      data-picker-avoid-height={artworkAvoidRect?.height}
      data-picker-occupied-zones={zones.map(({ id }) => id).join(" ")}
      data-floating-widget-scope={resolvedFloatingScope}
      data-floating-widget-owner={session.ownerScope}
      data-floating-surface="folio"
      data-eyedropper-state={eyedropperActive ? "active" : "inactive"}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <h2 className="text-xs font-semibold text-folio-ink">{session.target.label}</h2>
          <p className="text-[10px] text-folio-muted">Full color picker</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            ref={eyedropperButtonRef}
            type="button"
            className={cn(
              "grid size-7 place-items-center rounded-lg border border-folio-border text-folio-muted hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
              eyedropperActive && "border-folio-accent bg-folio-accent-soft text-folio-accent",
            )}
            aria-label="Pick color from canvas"
            aria-pressed={eyedropperActive}
            title="Pick color from canvas (I)"
            data-testid="eyedropper-toggle"
            onClick={() => onEyedropperActiveChange(!eyedropperActive)}
          >
            <Pipette className="size-3.5" aria-hidden="true" />
          </button>
          <span className="rounded-full bg-folio-accent-soft px-2 py-1 font-mono text-[9px] uppercase text-folio-accent">
            {presentation.currentColor}
          </span>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        aria-label="Color picker controls"
        data-testid="full-color-picker-scroll-region"
      >
        {eyedropperActive || eyedropperMessage !== null ? (
          <p
            className={cn(
              "mb-2 rounded-lg px-2 py-1.5 text-[9px]",
              eyedropperMessage === null
                ? "bg-folio-accent-soft text-folio-accent"
                : "bg-folio-surface-muted text-folio-muted",
            )}
            role="status"
            aria-live="polite"
            data-testid="eyedropper-status"
          >
            {eyedropperMessage ?? "Click the page to sample a color. Press Escape to exit."}
          </p>
        ) : null}

        <SaturationValueField hsv={presentation.hsv} onPreview={previewHsv} />
        <label className="mt-2 block">
          <span className="sr-only">Hue</span>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(presentation.hsv.hue)}
            className="folio-hue-slider h-3 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent focus-visible:ring-offset-2"
            aria-label={`Hue ${Math.round(presentation.hsv.hue)} degrees`}
            onChange={(event) =>
              previewHsv(
                { ...presentation.hsv, hue: Number(event.currentTarget.value) },
                "animation-frame",
              )
            }
          />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Current and previous colors">
          <CurrentColorReadout
            color={presentation.currentColor}
            favorite={currentIsFavorite}
            onToggleFavorite={() => onToggleFavorite(presentation.currentColor)}
          />
          <ColorReadout
            label="Previous"
            color={session.previousColor}
            onSelect={() => previewHex(session.previousColor)}
          />
        </div>

        <HexEditor color={presentation.currentColor} onPreview={previewHex} />
        <RgbEditors color={presentation.currentColor} onPreview={previewHex} />

        <ColorCollection
          label="Recent"
          kind="recent"
          emptyLabel="Colors you draw with appear here"
          colors={colors.recentColors}
          currentColor={presentation.currentColor}
          onSelect={(color) => previewHex(color)}
        />

        <ColorCollection
          label="Favorites"
          kind="favorite"
          emptyLabel="No favorites yet"
          colors={colors.favoriteColors}
          currentColor={presentation.currentColor}
          displayPolicy={favoriteCollectionDisplayPolicy(colors.favoriteColors.length)}
          compactEmpty
          testId="favorite-colors"
          onSelect={(color) => previewHex(color)}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-folio-muted">
            Palette
          </span>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 min-w-32 items-center justify-between gap-2 rounded-lg border border-folio-border bg-folio-surface px-2 text-[11px] font-medium text-folio-ink hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                aria-label={`Active color palette, ${colors.activePalette.name}`}
                data-testid="color-palette-trigger"
              >
                {colors.activePalette.name}
                <ChevronDown className="size-3.5 text-folio-muted" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              collisionPadding={12}
              className="z-[55] min-w-44"
              data-floating-widget-owner={ownerScopes}
              data-testid="color-palette-menu"
            >
              {colors.palettes
                .filter(({ source }) => source === "built-in")
                .map((palette) => (
                  <DropdownMenuItem
                    key={palette.id}
                    role="menuitemradio"
                    aria-checked={palette.id === colors.activePaletteId}
                    className="justify-between"
                    onSelect={() => onSelectPalette(palette.id)}
                  >
                    <span className="flex-1">{palette.name}</span>
                    <span className="flex items-center gap-0.5" aria-hidden="true">
                      {palette.colors.slice(0, 5).map((color) => (
                        <span
                          key={color}
                          className="size-2 rounded-full border border-black/15"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </span>
                    {palette.id === colors.activePaletteId ? (
                      <Check className="size-4 text-folio-accent" aria-hidden="true" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ColorCollection
          label={`${colors.activePalette.name} colors`}
          kind="palette"
          colors={colors.activePalette.colors}
          currentColor={presentation.currentColor}
          onSelect={(color) => previewHex(color)}
        />
      </div>
    </motion.section>
  );
}

function CurrentColorReadout({
  color,
  favorite,
  onToggleFavorite,
}: {
  readonly color: string;
  readonly favorite: boolean;
  readonly onToggleFavorite: () => void;
}) {
  const actionLabel = favorite ? `Remove ${color} from favorites` : `Add ${color} to favorites`;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-folio-border bg-folio-surface-muted p-1.5"
      aria-label={`Current color ${color}`}
    >
      <span
        className="size-6 shrink-0 rounded-md border border-black/15 shadow-sm"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-medium text-folio-muted">Current</span>
        <span className="block truncate font-mono text-[9px] uppercase text-folio-ink">
          {color}
        </span>
      </span>
      <button
        type="button"
        className="grid size-7 shrink-0 place-items-center rounded-md text-folio-muted hover:bg-folio-surface-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
        aria-label={actionLabel}
        aria-pressed={favorite}
        data-testid="favorite-current-toggle"
        onClick={onToggleFavorite}
      >
        <Star
          className={cn("size-3.5", favorite && "fill-current text-folio-accent")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function SaturationValueField({
  hsv,
  onPreview,
}: {
  readonly hsv: HsvColor;
  readonly onPreview: (hsv: HsvColor, schedule?: ColorPreviewSchedule) => boolean;
}) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);
  const previewAtPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onPreview(hsvFromSvPointer(bounds, event.clientX, event.clientY, hsv.hue), "animation-frame");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = adjustSvWithKeyboard(hsv, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onPreview(next, "animation-frame");
  };
  return (
    <div
      ref={fieldRef}
      className="relative h-36 touch-none overflow-hidden rounded-xl border border-black/15 shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent focus-visible:ring-offset-2"
      style={{ backgroundColor: `hsl(${hsv.hue} 100% 50%)` }}
      role="group"
      tabIndex={0}
      aria-label={`Saturation ${Math.round(hsv.saturation * 100)} percent, value ${Math.round(hsv.value * 100)} percent. Use arrow keys to adjust.`}
      data-testid="color-sv-field"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        previewAtPointer(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) previewAtPointer(event);
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        previewAtPointer(event);
        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
    >
      <span
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white to-transparent"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black"
        aria-hidden="true"
      />
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.75)]"
        style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

function ColorReadout({
  label,
  color,
  onSelect,
}: {
  readonly label: "Current" | "Previous";
  readonly color: string;
  readonly onSelect?: () => void;
}) {
  const content = (
    <>
      <span
        className="size-6 shrink-0 rounded-md border border-black/15 shadow-sm"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-[9px] font-medium text-folio-muted">{label}</span>
        <span className="block truncate font-mono text-[9px] uppercase text-folio-ink">
          {color}
        </span>
      </span>
    </>
  );
  const className =
    "flex items-center gap-2 rounded-lg border border-folio-border bg-folio-surface-muted p-1.5 text-left";
  if (onSelect !== undefined) {
    return (
      <button
        type="button"
        className={`${className} hover:bg-folio-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent`}
        aria-label={`${label} color ${color}`}
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={className} role="status" aria-label={`${label} color ${color}`}>
      {content}
    </div>
  );
}

function HexEditor({
  color,
  onPreview,
}: {
  readonly color: string;
  readonly onPreview: (color: string) => boolean;
}) {
  const [draft, setDraft] = useState(color.toUpperCase());
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(color.toUpperCase());
  }, [color]);
  const previewValid = (value: string): string | null => {
    const normalized = completeHexDraft(value);
    if (normalized !== null) onPreview(normalized);
    return normalized;
  };
  return (
    <label className="mt-3 grid grid-cols-[36px_1fr] items-center gap-2">
      <span className="text-[10px] font-semibold text-folio-muted">Hex</span>
      <input
        type="text"
        value={draft}
        maxLength={7}
        spellCheck={false}
        className="h-8 rounded-lg border border-folio-border bg-folio-surface px-2 font-mono text-[11px] uppercase text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
        aria-label="Hex color"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          previewValid(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const normalized = previewValid(event.currentTarget.value);
          if (normalized !== null) setDraft(normalized.toUpperCase());
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          const normalized = previewValid(event.currentTarget.value);
          setDraft((normalized ?? color).toUpperCase());
        }}
      />
    </label>
  );
}

function RgbEditors({
  color,
  onPreview,
}: {
  readonly color: string;
  readonly onPreview: (color: string) => boolean;
}) {
  const [draft, setDraft] = useState<RgbDraft>(() => rgbDraftFromHex(color));
  const focusCountRef = useRef(0);
  useEffect(() => {
    if (focusCountRef.current === 0) setDraft(rgbDraftFromHex(color));
  }, [color]);
  const change = (channel: keyof RgbDraft, value: string): void => {
    const next = { ...draft, [channel]: value };
    setDraft(next);
    const normalized = rgbDraftToHex(next);
    if (normalized !== null) onPreview(normalized);
  };
  const blur = (event: FocusEvent<HTMLInputElement>): void => {
    focusCountRef.current = Math.max(0, focusCountRef.current - 1);
    if (rgbDraftToHex(draft) === null) setDraft(rgbDraftFromHex(color));
    else if (!(event.relatedTarget instanceof HTMLInputElement)) setDraft(rgbDraftFromHex(color));
  };
  return (
    <fieldset className="mt-2 grid grid-cols-[36px_repeat(3,1fr)] items-end gap-2">
      <legend className="sr-only">RGB color channels</legend>
      <span className="self-center text-[10px] font-semibold text-folio-muted">RGB</span>
      {(["red", "green", "blue"] as const).map((channel) => (
        <label key={channel} className="min-w-0">
          <span className="mb-1 block text-center text-[9px] uppercase text-folio-muted">
            {channel.charAt(0)}
          </span>
          <input
            type="number"
            min={0}
            max={255}
            step={1}
            inputMode="numeric"
            value={draft[channel]}
            className="h-8 w-full rounded-lg border border-folio-border bg-folio-surface px-1 text-center text-[11px] tabular-nums text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
            aria-label={`${channel} channel`}
            onFocus={() => {
              focusCountRef.current += 1;
            }}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              change(channel, event.currentTarget.value)
            }
            onBlur={blur}
          />
        </label>
      ))}
    </fieldset>
  );
}

function ColorCollection({
  label,
  kind,
  emptyLabel,
  colors,
  currentColor,
  displayPolicy = "compact",
  compactEmpty = false,
  testId,
  onSelect,
}: {
  readonly label: string;
  readonly kind: "recent" | "favorite" | "palette";
  readonly emptyLabel?: string;
  readonly colors: readonly string[];
  readonly currentColor: string;
  readonly displayPolicy?: "compact" | "bounded-scroll";
  readonly compactEmpty?: boolean;
  readonly testId?: string;
  readonly onSelect: (color: string) => void;
}) {
  const accessiblePrefix =
    kind === "recent"
      ? "Use recent color"
      : kind === "favorite"
        ? "Use favorite color"
        : "Use color";
  return (
    <div
      className="mt-3"
      data-testid={testId}
      data-display-policy={displayPolicy}
      data-color-count={colors.length}
    >
      <p className="mb-1.5 text-[10px] font-semibold text-folio-muted">{label}</p>
      {colors.length === 0 ? (
        <p
          className={cn(
            "text-[9px] text-folio-muted",
            compactEmpty
              ? "px-0.5 py-0.5"
              : "rounded-lg border border-dashed border-folio-border px-2 py-1.5",
          )}
          data-testid={kind === "favorite" ? "favorites-empty-state" : undefined}
        >
          {emptyLabel}
        </p>
      ) : (
        <div
          className={cn(
            "grid grid-cols-10 gap-1.5",
            displayPolicy === "bounded-scroll" &&
              "max-h-[58px] overflow-y-auto overscroll-contain py-0.5 pr-1",
          )}
          aria-label={label}
        >
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              className={cn(
                "size-[22px] rounded-full border border-black/15 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                color === currentColor && "ring-2 ring-folio-accent ring-offset-1",
              )}
              style={{ backgroundColor: color }}
              aria-label={`${accessiblePrefix} ${color}`}
              aria-pressed={color === currentColor}
              onClick={() => onSelect(color)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function rgbDraftFromHex(color: string): RgbDraft {
  const rgb = hexToRgb(color);
  return { red: String(rgb.red), green: String(rgb.green), blue: String(rgb.blue) };
}

function rectFromDom(
  rect: Readonly<{ left: number; top: number; width: number; height: number }>,
): PickerRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function textEntryOwnsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return ["email", "number", "password", "search", "tel", "text", "url"].includes(target.type);
}

function addFloatingOwner(element: HTMLElement, scope: string): void {
  const owners = new Set(
    element.getAttribute("data-floating-widget-owner")?.split(/\s+/u).filter(Boolean) ?? [],
  );
  owners.add(scope);
  element.setAttribute("data-floating-widget-owner", [...owners].join(" "));
}

function removeFloatingOwner(element: HTMLElement, scope: string): void {
  const owners = (element.getAttribute("data-floating-widget-owner")?.split(/\s+/u) ?? []).filter(
    (owner) => owner.length > 0 && owner !== scope,
  );
  if (owners.length === 0) element.removeAttribute("data-floating-widget-owner");
  else element.setAttribute("data-floating-widget-owner", owners.join(" "));
}
