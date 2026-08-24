import {
  Bell,
  ChevronDown,
  FileInput,
  Image,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paintbrush,
  Pencil,
  PenLine,
  Save,
  Settings2,
  Shapes,
  StickyNote,
  Sun,
  Table2,
  TextCursorInput,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@folio/ui";
import appIconUrl from "../../../../../assets/app-icon.svg";
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { useNotifications } from "../notifications/NotificationProvider";
import { useTheme } from "../theme/ThemeProvider";
import type { EditorTool } from "../editor/editor-types";

interface AppMenuBarProps {
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  onSelectTool: (tool: EditorTool) => void;
}

function MenuTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-folio-muted transition-[background-color,color,transform,box-shadow] duration-100 ease-out hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:scale-[0.98] data-[state=open]:bg-folio-hover data-[state=open]:text-folio-ink"
    >
      {label}
      <ChevronDown className="size-3" aria-hidden="true" />
    </button>
  );
}

export function AppMenuBar({ sidebarExpanded, onToggleSidebar, onSelectTool }: AppMenuBarProps) {
  const { openDialog } = useShellDialog();
  const { notify } = useNotifications();
  const { theme, toggleTheme } = useTheme();

  const showPlaceholder = (title: string) =>
    notify({
      title,
      description: "The shell interaction is ready; feature logic arrives in a later phase.",
      tone: "info",
    });

  return (
    <header className="flex h-11 shrink-0 items-center border-b border-folio-border bg-folio-menubar px-3 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center gap-2 pr-2.5">
          <img className="size-6" src={appIconUrl} alt="" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">Folio</span>
        </div>
        <div className="hidden h-5 w-px bg-folio-border sm:block" aria-hidden="true" />

        <nav className="hidden items-center sm:flex" aria-label="Application menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="File" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Notebook</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => openDialog("open")}>
                <FileInput className="size-4" aria-hidden="true" />
                Open…
                <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog("save")}>
                <Save className="size-4" aria-hidden="true" />
                Save
                <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openDialog("rename")}>Rename…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => openDialog("delete")}
                className="text-red-600 dark:text-red-400"
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="Edit" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem disabled>
                Undo
                <DropdownMenuShortcut>Ctrl+Z</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                Redo
                <DropdownMenuShortcut>Ctrl+Y</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => showPlaceholder("Clipboard tools previewed")}>
                Copy
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => showPlaceholder("Clipboard tools previewed")}>
                Paste
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="Insert" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onSelectTool("Text")}>
                <TextCursorInput className="size-4" aria-hidden="true" /> Text
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Image")}>
                <Image className="size-4" aria-hidden="true" /> Image
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Shapes")}>
                <Shapes className="size-4" aria-hidden="true" /> Shapes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Table")}>
                <Table2 className="size-4" aria-hidden="true" /> Table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Sticky Note")}>
                <StickyNote className="size-4" aria-hidden="true" /> Sticky note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="Draw" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onSelectTool("Pencil")}>
                <Pencil className="size-4" aria-hidden="true" /> Pencil
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Pen")}>
                <PenLine className="size-4" aria-hidden="true" /> Pen
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Marker")}>
                <Paintbrush className="size-4" aria-hidden="true" /> Marker
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Highlighter")}>
                Highlighter
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSelectTool("Eraser")}>Eraser</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="Format" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => showPlaceholder("Formatting controls previewed")}>
                Text style
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => showPlaceholder("Formatting controls previewed")}>
                Object appearance
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <MenuTrigger label="View" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={onToggleSidebar}>
                {sidebarExpanded ? (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                )}
                {sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
                Use {theme === "light" ? "dark" : "light"} theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openDialog("settings")}>
                <Settings2 className="size-4" aria-hidden="true" /> Appearance settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <div className="mr-1 hidden items-center gap-1.5 rounded-full border border-folio-border bg-folio-surface px-2.5 py-1 text-[11px] font-medium text-folio-muted md:flex">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Offline
        </div>
        <button
          type="button"
          className="shell-icon-button"
          aria-label="Show notification preview"
          title="Notification preview"
          onClick={() =>
            notify({
              title: "Shell ready",
              description: "Notifications appear quietly in the bottom-right corner.",
              tone: "success",
            })
          }
        >
          <Bell className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell-icon-button"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
          aria-pressed={theme === "dark"}
          onClick={toggleTheme}
        >
          {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
        <span className="ml-1 flex size-7 items-center justify-center rounded-full bg-folio-accent-soft text-[11px] font-bold text-folio-accent">
          F
        </span>
      </div>
    </header>
  );
}
