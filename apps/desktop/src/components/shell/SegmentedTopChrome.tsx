import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@folio/ui";
import { cn } from "@folio/ui";
import {
  BookOpen,
  Menu,
  Moon,
  Redo2,
  Settings2,
  SlidersHorizontal,
  Sun,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { ToolTooltip } from "../editor/ToolTooltip";
import type { WorkspaceHistoryAvailability } from "../editor/workspace-history";
import { useTheme } from "../theme/ThemeProvider";

/**
 * What the workspace calls the sketch until documents have real identity.
 *
 * Display only. It is not persisted, it is not History state, it is not a
 * filename, and it is deliberately not the active page's name -- Folio has no
 * sketch-name authority yet, and inventing one here would put a second name
 * store in the shell. When real document identity arrives, this surface reads
 * that name and this constant goes away.
 */
const SKETCH_NAME_FALLBACK = "Untitled Sketch";

interface SegmentedTopChromeProps extends WorkspaceHistoryAvailability {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly pageNavigatorOpen: boolean;
  readonly onTogglePageNavigator: () => void;
  readonly pageSettingsOpen: boolean;
  readonly onTogglePageSettings: () => void;
}

/**
 * The workspace's top chrome, as a few small islands rather than a bar.
 *
 * A full-width painted strip spends the whole width of the window on three
 * clusters of buttons and a wordmark, and reserves a row of height whether or
 * not anything is in it. This is the same controls with neither: each group is
 * sized by its contents, and the canvas shows through everywhere else.
 *
 * The composition is deliberately two-sided. The application menu and the name
 * of the sketch own the left corner; everything that acts on the work --
 * history, pages -- sits together on the right, where the surfaces those
 * controls open already live. Nothing takes the middle, so the widest part of
 * the top edge stays artwork.
 *
 * The two sides share one inset, one height and one surface treatment, so they
 * read as a single horizontal axis across an empty centre. Both corners are
 * 16 px in, and neither moves for anything: a surface that opens into the same
 * corner -- the Layers mode switch -- takes the row below instead of pushing
 * the persistent controls sideways.
 *
 * Nothing here owns state. History, pages and appearance are reached through
 * the authorities that already have them.
 */
export function SegmentedTopChrome({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  pageNavigatorOpen,
  onTogglePageNavigator,
  pageSettingsOpen,
  onTogglePageSettings,
}: SegmentedTopChromeProps) {
  const { openDialog } = useShellDialog();
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      {/*
        The application corner: what this is, and what you are working on.

        Two islands rather than one control with a caption -- the menu is an
        action and the name is identity, and merging them would make the name
        look pressable. No wordmark: the window frame already says which
        application this is, and the canvas should not have to repeat it.
      */}
      <ChromeGroup className="left-4" testId="top-chrome-left">
        <ChromeIsland label="Application" testId="top-chrome-application">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="folio-chrome-button"
                aria-label="Application menu"
                data-testid="application-menu-trigger"
              >
                <Menu className="size-4" aria-hidden="true" />
                <ToolTooltip label="Application menu" side="bottom" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              {/*
                Only what the application can truthfully do today. File actions
                wait for a persistence boundary rather than appearing greyed out.
              */}
              <DropdownMenuItem onSelect={toggleTheme}>
                {theme === "dark" ? (
                  <Sun className="size-4" aria-hidden="true" />
                ) : (
                  <Moon className="size-4" aria-hidden="true" />
                )}
                Use {theme === "dark" ? "light" : "dark"} appearance
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog("settings")}>
                <Settings2 className="size-4" aria-hidden="true" />
                Appearance settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ChromeIsland>
        <ChromeIsland testId="top-chrome-sketch">
          {/*
            Identity, not a control. Nothing here opens, renames or saves
            anything; the max width is for the real titles this will show
            later, so a long one can never eat into the workspace.
          */}
          <span
            className="max-w-[220px] truncate px-2 text-xs font-medium text-folio-ink"
            data-testid="sketch-name"
          >
            {SKETCH_NAME_FALLBACK}
          </span>
        </ChromeIsland>
      </ChromeGroup>

      {/*
        Everything that acts on the work.

        Two islands rather than one, because history and pages are unrelated
        errands; and two rather than four, because a row of single-button boxes
        is fragmentation, not segmentation.
      */}
      <ChromeGroup className="right-4" testId="top-chrome-right">
        <ChromeIsland label="History" testId="top-chrome-history">
          <ChromeButton label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="size-4" aria-hidden="true" />
          </ChromeButton>
          <ChromeButton label="Redo" hint="Ctrl+Y" disabled={!canRedo} onClick={onRedo}>
            <Redo2 className="size-4" aria-hidden="true" />
          </ChromeButton>
        </ChromeIsland>

        <ChromeIsland label="Page" testId="top-chrome-page">
          <ChromeButton
            label="Pages"
            testId="pages-toggle"
            pressed={pageNavigatorOpen}
            onClick={onTogglePageNavigator}
          >
            <BookOpen className="size-4" aria-hidden="true" />
          </ChromeButton>
          <ChromeButton
            label="Page settings"
            testId="page-settings-toggle"
            pressed={pageSettingsOpen}
            onClick={onTogglePageSettings}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </ChromeButton>
        </ChromeIsland>
      </ChromeGroup>
    </>
  );
}

/**
 * One side of the top chrome.
 *
 * Paints nothing and takes no pointer input, so the canvas stays live in the
 * gaps between the islands and across the whole middle. The inset matches the
 * workspace's other persistent overlays -- the tool dock, the utility rail, the
 * viewport control -- so both sides sit on the same axis as the chrome beneath
 * them.
 */
function ChromeGroup({
  className,
  testId,
  children,
}: {
  readonly className: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn("pointer-events-none absolute top-4 z-20 flex items-center gap-2", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/**
 * One content-sized chrome surface.
 *
 * Intrinsically sized on purpose -- no flex growth, no minimum width. An island
 * is exactly as wide as what it holds, which is what keeps the empty space
 * between them genuinely empty.
 */
function ChromeIsland({
  label,
  testId,
  children,
}: {
  /** Names a group of controls. Omitted for an island that only shows text. */
  readonly label?: string;
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="folio-compact-surface pointer-events-auto flex h-9 items-center gap-0.5 px-1"
      {...(label === undefined ? {} : { role: "group", "aria-label": label })}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function ChromeButton({
  label,
  hint,
  disabled = false,
  pressed,
  testId,
  onClick,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly testId?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "folio-chrome-button",
        // A pressed toggle has always announced itself to assistive technology
        // here without showing anything; it now carries Folio's own selected
        // treatment, scoped to the top chrome rather than to the shared button.
        pressed === true && "bg-folio-accent-soft text-folio-accent hover:bg-folio-accent-soft",
      )}
      aria-label={label}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      onClick={onClick}
    >
      {children}
      <ToolTooltip label={hint === undefined ? label : `${label} — ${hint}`} side="bottom" />
    </button>
  );
}
