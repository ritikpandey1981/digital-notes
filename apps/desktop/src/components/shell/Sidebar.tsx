import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileStack,
  Library,
  Plus,
  Search,
  Settings2,
  Tags,
  Trash2,
} from "lucide-react";
import { cn } from "@folio/ui";
import { placeholderNotebooks, placeholderRecentFiles } from "../../data/placeholder-data";
import { useShellDialog } from "../dialogs/ShellDialogProvider";
import { useNotifications } from "../notifications/NotificationProvider";
import type { ShellSection } from "./shell-types";

interface SidebarProps {
  expanded: boolean;
  activeSection: ShellSection;
  onToggle: () => void;
  onSelectSection: (section: ShellSection) => void;
}

const navigationItems = [
  { label: "Library", icon: Library },
  { label: "Pages", icon: FileStack },
  { label: "Bookmarks", icon: Bookmark },
  { label: "Search", icon: Search },
  { label: "Tags", icon: Tags },
  { label: "Trash", icon: Trash2 },
] satisfies ReadonlyArray<{ label: ShellSection; icon: typeof Library }>;

export function Sidebar({ expanded, activeSection, onToggle, onSelectSection }: SidebarProps) {
  const { openDialog } = useShellDialog();
  const { notify } = useNotifications();

  const previewNotebook = (title: string) =>
    notify({
      title,
      description: "Notebook opening remains a placeholder until its feature phase.",
      tone: "info",
    });

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-r border-folio-border bg-folio-sidebar transition-[width] duration-[250ms] ease-in-out",
        expanded ? "w-[260px] max-[1100px]:w-[72px]" : "w-[72px]",
      )}
      data-sidebar-expanded={expanded}
      aria-label="Sidebar"
    >
      <div className="flex h-14 shrink-0 items-center border-b border-folio-border px-3">
        <div className={cn("min-w-0 flex-1 pl-1 max-[1100px]:hidden", !expanded && "hidden")}>
          <p className="truncate text-sm font-semibold">Studio Notes</p>
          <p className="truncate text-[11px] text-folio-muted">Personal workspace</p>
        </div>
        <button
          type="button"
          className="shell-icon-button mx-auto"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronLeft className="size-4 max-[1100px]:hidden" aria-hidden="true" />
          ) : null}
          {!expanded ? <ChevronRight className="size-4" aria-hidden="true" /> : null}
          {expanded ? <ChevronRight className="hidden size-4 max-[1100px]:block" /> : null}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        <nav className="space-y-1" aria-label="Primary navigation">
          {navigationItems.map(({ label, icon: Icon }) => {
            const active = activeSection === label;
            return (
              <button
                key={label}
                type="button"
                className={cn("sidebar-nav-item", active && "sidebar-nav-item-active")}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                title={label}
                onClick={() => onSelectSection(label)}
              >
                <Icon className="size-[18px] shrink-0" aria-hidden="true" />
                <span className={cn("truncate max-[1100px]:hidden", !expanded && "hidden")}>
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className={cn("mt-6 max-[1100px]:hidden", !expanded && "hidden")}>
          <div className="mb-2 flex items-center justify-between px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-folio-muted">
              Notebooks
            </p>
            <button
              type="button"
              className="rounded-md p-1 text-folio-muted hover:bg-folio-hover hover:text-folio-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
              aria-label="New notebook placeholder"
              title="New notebook placeholder"
              onClick={() => openDialog("confirm")}
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-1">
            {placeholderNotebooks.map((notebook, index) => (
              <button
                key={notebook.title}
                type="button"
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-folio-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                  index === 0 && "bg-folio-hover",
                )}
                onClick={() => previewNotebook(notebook.title)}
              >
                <span
                  className="h-8 w-6 shrink-0 rounded-[6px] shadow-sm transition-transform group-hover:-translate-y-0.5"
                  style={{ backgroundColor: notebook.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{notebook.title}</span>
                  <span className="block truncate text-[10px] text-folio-muted">
                    {notebook.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mb-2 mt-5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-folio-muted">
            <Clock3 className="size-3" aria-hidden="true" /> Recent files
          </div>
          <div className="space-y-1">
            {placeholderRecentFiles.map((file) => (
              <button
                key={file.title}
                type="button"
                className="w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-folio-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent"
                onClick={() => previewNotebook(file.title)}
              >
                <span className="block truncate text-xs font-medium">{file.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-folio-muted">
                  {file.detail}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-folio-border p-2">
        <button
          type="button"
          className="sidebar-nav-item"
          aria-label="Settings"
          title="Settings"
          onClick={() => openDialog("settings")}
        >
          <Settings2 className="size-[18px] shrink-0" aria-hidden="true" />
          <span className={cn("max-[1100px]:hidden", !expanded && "hidden")}>Settings</span>
        </button>
      </div>
    </aside>
  );
}
