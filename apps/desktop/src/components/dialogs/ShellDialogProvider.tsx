import * as React from "react";
import { AlertTriangle, FileInput, FileOutput, Pencil, Settings2, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from "@folio/ui";
import { useNotifications } from "../notifications/NotificationProvider";
import { useTheme } from "../theme/ThemeProvider";

export type ShellDialogKind = "open" | "save" | "delete" | "confirm" | "rename" | "settings";

interface DialogCopy {
  title: string;
  description: string;
  primaryLabel: string;
  notificationTitle: string;
}

interface ShellDialogContextValue {
  openDialog: (kind: ShellDialogKind) => void;
}

const dialogCopy: Record<ShellDialogKind, DialogCopy> = {
  open: {
    title: "Open a notebook",
    description: "File selection is represented by this Phase 2 shell placeholder.",
    primaryLabel: "Choose file",
    notificationTitle: "Open action previewed",
  },
  save: {
    title: "Save notebook",
    description: "Saving is not connected to persistence during Phase 2.",
    primaryLabel: "Save placeholder",
    notificationTitle: "Save notification previewed",
  },
  delete: {
    title: "Move notebook to Trash?",
    description: "This confirmation demonstrates destructive dialog styling without deleting data.",
    primaryLabel: "Move to Trash",
    notificationTitle: "Delete action cancelled safely",
  },
  confirm: {
    title: "Confirm shell action",
    description: "Reusable confirmation dialogs are ready for future feature modules.",
    primaryLabel: "Confirm",
    notificationTitle: "Action confirmed",
  },
  rename: {
    title: "Rename notebook",
    description: "The field is interactive, but no notebook data is changed in this phase.",
    primaryLabel: "Rename placeholder",
    notificationTitle: "Rename action previewed",
  },
  settings: {
    title: "Appearance",
    description: "Choose how the Folio shell appears on this screen.",
    primaryLabel: "Done",
    notificationTitle: "Appearance updated",
  },
};

const dialogIcons = {
  open: FileInput,
  save: FileOutput,
  delete: Trash2,
  confirm: AlertTriangle,
  rename: Pencil,
  settings: Settings2,
} satisfies Record<ShellDialogKind, React.ComponentType<{ className?: string }>>;

const ShellDialogContext = React.createContext<ShellDialogContextValue | null>(null);

export function ShellDialogProvider({ children }: React.PropsWithChildren) {
  const [activeDialog, setActiveDialog] = React.useState<ShellDialogKind | null>(null);
  const { notify } = useNotifications();
  const { theme, setTheme } = useTheme();

  const value = React.useMemo(
    () => ({ openDialog: (kind: ShellDialogKind) => setActiveDialog(kind) }),
    [],
  );

  const copy = activeDialog ? dialogCopy[activeDialog] : null;
  const DialogIcon = activeDialog ? dialogIcons[activeDialog] : null;

  const completeAction = () => {
    if (!activeDialog || !copy) return;
    notify({
      title: copy.notificationTitle,
      description: "This is placeholder shell feedback; no notebook data was changed.",
      tone: activeDialog === "delete" ? "error" : "success",
    });
    setActiveDialog(null);
  };

  return (
    <ShellDialogContext.Provider value={value}>
      {children}
      <Dialog open={activeDialog !== null} onOpenChange={(open) => !open && setActiveDialog(null)}>
        {copy && DialogIcon ? (
          <DialogContent className="overflow-hidden p-0 sm:max-w-[520px]">
            <div className="p-6">
              <DialogHeader>
                <div
                  className={cn(
                    "mb-3 flex size-10 items-center justify-center rounded-xl bg-folio-accent-soft text-folio-accent",
                    activeDialog === "delete" && "bg-red-500/10 text-red-600 dark:text-red-400",
                  )}
                >
                  <DialogIcon className="size-5" aria-hidden="true" />
                </div>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>

              {activeDialog === "rename" ? (
                <label className="mt-5 block text-sm font-medium">
                  Notebook name
                  <Input className="mt-2" defaultValue="Studio Notes" autoFocus />
                </label>
              ) : null}

              {activeDialog === "settings" ? (
                <div className="mt-5 grid grid-cols-2 gap-3" role="group" aria-label="Theme">
                  {(["light", "dark"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "rounded-[14px] border border-folio-border bg-folio-surface p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent",
                        theme === option && "border-folio-accent ring-1 ring-folio-accent",
                      )}
                      aria-pressed={theme === option}
                      onClick={() => setTheme(option)}
                    >
                      <span className="block text-sm font-semibold capitalize">{option}</span>
                      <span className="mt-1 block text-xs text-folio-muted">
                        {option === "light"
                          ? "Warm paper and soft gray"
                          : "Charcoal workspace and ivory ink"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-t border-folio-border bg-folio-surface-muted px-6 py-4">
              <Button variant="ghost" onClick={() => setActiveDialog(null)}>
                Cancel
              </Button>
              <Button
                variant={activeDialog === "delete" ? "destructive" : "default"}
                onClick={completeAction}
              >
                {copy.primaryLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </ShellDialogContext.Provider>
  );
}

export function useShellDialog(): ShellDialogContextValue {
  const context = React.useContext(ShellDialogContext);
  if (!context) {
    throw new Error("useShellDialog must be used within ShellDialogProvider.");
  }

  return context;
}
