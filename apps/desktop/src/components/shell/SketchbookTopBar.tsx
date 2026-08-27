import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@folio/ui";
import {
  BookOpen,
  MoreHorizontal,
  Moon,
  Redo2,
  Settings2,
  SlidersHorizontal,
  Sun,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import appIconUrl from "../../../../../assets/app-icon.svg";
import type { WorkspaceHistoryAvailability } from "../editor/workspace-history";
import { ToolTooltip } from "../editor/ToolTooltip";
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { useTheme } from "../theme/ThemeProvider";

interface SketchbookTopBarProps extends WorkspaceHistoryAvailability {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly pageNavigatorOpen: boolean;
  readonly onTogglePageNavigator: () => void;
  readonly pageSettingsOpen: boolean;
  readonly onTogglePageSettings: () => void;
}

/**
 * Document-level controls only.
 *
 * Pages, Page Settings, and History belong to the document; Layers and colour
 * are artwork utilities and live on the right-hand rail beside the canvas.
 */
export function SketchbookTopBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  pageNavigatorOpen,
  onTogglePageNavigator,
  pageSettingsOpen,
  onTogglePageSettings,
}: SketchbookTopBarProps) {
  const { openDialog } = useShellDialog();
  const { theme, toggleTheme } = useTheme();

  return (
    <header
      className="flex h-12 shrink-0 items-center border-b border-folio-border bg-folio-topbar px-4 text-folio-ink"
      data-testid="sketchbook-top-bar"
      data-workspace-shell="sketchbook"
    >
      <div
        className="flex min-w-0 items-center gap-2.5"
        data-future-page-drawer-boundary="reserved"
      >
        <img className="size-6" src={appIconUrl} alt="" aria-hidden="true" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold tracking-tight">Folio</p>
          <p className="truncate text-[10px] text-folio-muted">Sketching workspace</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1" aria-label="Workspace actions">
        <TopBarButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="size-4" aria-hidden="true" />
        </TopBarButton>
        <TopBarButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="size-4" aria-hidden="true" />
        </TopBarButton>
        <span className="mx-1 h-5 w-px bg-folio-border" aria-hidden="true" />
        <TopBarButton
          label="Pages"
          testId="pages-toggle"
          pressed={pageNavigatorOpen}
          onClick={onTogglePageNavigator}
        >
          <BookOpen className="size-4" aria-hidden="true" />
        </TopBarButton>
        <TopBarButton
          label="Page settings"
          testId="page-settings-toggle"
          pressed={pageSettingsOpen}
          onClick={onTogglePageSettings}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </TopBarButton>
        <span className="mx-1 h-5 w-px bg-folio-border" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="folio-chrome-button" aria-label="Workspace menu">
              <MoreHorizontal className="size-[18px]" aria-hidden="true" />
              <ToolTooltip label="Workspace menu" side="bottom" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
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
      </div>
    </header>
  );
}

function TopBarButton({
  label,
  disabled = false,
  pressed,
  testId,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly testId?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="folio-chrome-button"
      aria-label={label}
      disabled={disabled}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      {...(testId === undefined ? {} : { "data-testid": testId })}
      onClick={onClick}
    >
      {children}
      <ToolTooltip label={label} side="bottom" />
    </button>
  );
}
