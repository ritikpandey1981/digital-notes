import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@folio/ui";
import { cn } from "@folio/ui";
import {
  BookOpen,
  FilePlus2,
  FolderOpen,
  History,
  Menu,
  Moon,
  Redo2,
  Save,
  Settings2,
  SlidersHorizontal,
  Sun,
  Undo2,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { ToolTooltip } from "../editor/ToolTooltip";
import type { WorkspaceHistoryAvailability } from "../editor/workspace-history";
import { useTheme } from "../theme/ThemeProvider";

/**
 * What to call a project whose own title is missing.
 *
 * The title shown here is the active project's metadata title, which is the
 * only name Folio has: never a filename, and never the active page's name.
 * This is a display fallback for the case where that title is somehow empty --
 * rendering it changes nothing about the project, which keeps a presentation
 * problem from becoming a document edit.
 */
const SKETCH_NAME_FALLBACK = "Untitled Sketch";

/** What the top chrome shows and offers for the active project. */
export interface ProjectChromeModel {
  readonly title: string;
  /** Content differs from the last confirmed baseline or checkpoint. */
  readonly isDirty: boolean;
  /** An exclusive project operation is running, so another must not start. */
  readonly isBusy: boolean;
  readonly onNewProject: () => void;
  readonly onOpenProject: () => void;
  readonly onSaveProject: () => void;
  readonly onSaveProjectAs: () => void;
  readonly onShowRecovery: () => void;
}

interface SegmentedTopChromeProps extends WorkspaceHistoryAvailability {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly pageNavigatorOpen: boolean;
  readonly onTogglePageNavigator: () => void;
  readonly pageSettingsOpen: boolean;
  readonly onTogglePageSettings: () => void;
  readonly project: ProjectChromeModel;
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
  project,
}: SegmentedTopChromeProps) {
  const { openDialog } = useShellDialog();
  const { theme, toggleTheme } = useTheme();
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

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
                ref={menuTriggerRef}
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
                What becomes of the project, then what becomes of a project a
                previous run left behind, then how the application looks. Each
                one does what it says: nothing here is a placeholder, and an
                operation already running disables the rest rather than
                queueing a second one behind it.
              */}
              <DropdownMenuItem
                disabled={project.isBusy}
                onSelect={project.onNewProject}
                data-testid="menu-new-project"
              >
                <FilePlus2 className="size-4" aria-hidden="true" />
                New
                <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={project.isBusy}
                onSelect={project.onOpenProject}
                data-testid="menu-open-project"
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                Open…
                <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
              </DropdownMenuItem>
              {/*
                Saving a project nothing has changed is a perfectly ordinary
                thing to ask for, so Save is not disabled for being clean.
              */}
              <DropdownMenuItem
                disabled={project.isBusy}
                onSelect={project.onSaveProject}
                data-testid="menu-save-project"
              >
                <Save className="size-4" aria-hidden="true" />
                Save
                <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={project.isBusy}
                onSelect={project.onSaveProjectAs}
                data-testid="menu-save-project-as"
              >
                <Save className="size-4" aria-hidden="true" />
                Save As…
                <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={project.isBusy}
                onSelect={project.onShowRecovery}
                data-testid="menu-show-recovery"
              >
                <History className="size-4" aria-hidden="true" />
                Recovered drawings…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={toggleTheme}>
                {theme === "dark" ? (
                  <Sun className="size-4" aria-hidden="true" />
                ) : (
                  <Moon className="size-4" aria-hidden="true" />
                )}
                Use {theme === "dark" ? "light" : "dark"} appearance
              </DropdownMenuItem>
              {/*
                The menu item is gone by the time the dialog closes, so tell
                the dialog where to put focus back: the control that opened it.
              */}
              <DropdownMenuItem
                onSelect={() =>
                  openDialog("settings", { returnFocus: () => menuTriggerRef.current })
                }
              >
                <Settings2 className="size-4" aria-hidden="true" />
                Appearance settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ChromeIsland>
        <ChromeIsland testId="top-chrome-sketch">
          {/*
            Identity, not a control. Nothing here opens, renames or saves
            anything; the max width keeps a long project title from eating into
            the workspace.

            The visible name and the dot are one sentence to a screen reader
            rather than a name followed by a bullet, so the spoken form is the
            written one and the marker is never the only signal.
          */}
          <span
            className="max-w-[220px] truncate px-2 text-xs font-medium text-folio-ink"
            data-testid="sketch-name"
            aria-hidden="true"
          >
            {project.title.trim() === "" ? SKETCH_NAME_FALLBACK : project.title}
          </span>
          {project.isDirty ? (
            <span
              className="-ml-1.5 pr-2 text-xs leading-none text-folio-muted"
              data-testid="sketch-dirty-indicator"
              aria-hidden="true"
            >
              •
            </span>
          ) : null}
          <span className="sr-only">
            {project.title.trim() === "" ? SKETCH_NAME_FALLBACK : project.title}
            {project.isDirty ? ", unsaved changes" : ""}
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
