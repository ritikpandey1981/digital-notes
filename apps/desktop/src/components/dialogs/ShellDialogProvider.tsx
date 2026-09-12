import * as React from "react";
import { Settings2, TriangleAlert } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
} from "@folio/ui";
import type {
  UnsavedChangesDecision,
  UnsavedChangesRequest,
} from "../../persistence/project-lifecycle-coordinator";
import { useNotifications } from "../notifications/NotificationProvider";
import { useTheme } from "../theme/ThemeProvider";

/**
 * The dialogs the shell can actually open.
 *
 * There used to be five more -- open, save, delete, rename, confirm -- written
 * as placeholders for a file workflow that does not exist and reachable only
 * from a menu bar that no longer does either. They described saving and
 * deleting notebooks in copy that said, in the dialog itself, that nothing was
 * being saved or deleted. Folio will get them back when the operations are
 * real.
 */
export type ShellDialogKind = "settings";

/** How a dialog gives focus back to whatever opened it. */
export interface ShellDialogOptions {
  readonly returnFocus?: () => HTMLElement | null;
}

interface DialogCopy {
  title: string;
  description: string;
  primaryLabel: string;
  notificationTitle: string;
}

interface ShellDialogContextValue {
  openDialog: (kind: ShellDialogKind, options?: ShellDialogOptions) => void;
  /**
   * Asks whether unsaved work should be saved before the project is replaced.
   *
   * Resolves exactly once. Dismissing the dialog by any route -- Escape, the
   * overlay, a close button -- answers "cancel", because silence must never be
   * read as permission to discard.
   */
  confirmUnsavedChanges: (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>;
}

interface UnsavedChangesDialogState {
  readonly request: UnsavedChangesRequest;
  readonly resolve: (decision: UnsavedChangesDecision) => void;
}

const dialogCopy: Record<ShellDialogKind, DialogCopy> = {
  settings: {
    title: "Appearance",
    description: "Choose how the Folio shell appears on this screen.",
    primaryLabel: "Done",
    notificationTitle: "Appearance updated",
  },
};

const dialogIcons = {
  settings: Settings2,
} satisfies Record<ShellDialogKind, React.ComponentType<{ className?: string }>>;

const ShellDialogContext = React.createContext<ShellDialogContextValue | null>(null);

export function ShellDialogProvider({ children }: React.PropsWithChildren) {
  const [activeDialog, setActiveDialog] = React.useState<ShellDialogKind | null>(null);
  const { notify } = useNotifications();
  const { theme, setTheme } = useTheme();

  // Whatever opened the dialog, so closing it can hand focus back. The menu
  // item that was clicked has already unmounted by then, and without this the
  // keyboard lands on the document body.
  const returnFocusRef = React.useRef<(() => HTMLElement | null) | null>(null);
  const [unsaved, setUnsaved] = React.useState<UnsavedChangesDialogState | null>(null);
  const value = React.useMemo(
    () => ({
      openDialog: (kind: ShellDialogKind, options?: ShellDialogOptions) => {
        returnFocusRef.current = options?.returnFocus ?? null;
        setActiveDialog(kind);
      },
      confirmUnsavedChanges: (request: UnsavedChangesRequest) =>
        new Promise<UnsavedChangesDecision>((resolve) => {
          setUnsaved((previous) => {
            // A second question can only mean the first was abandoned. Answering
            // it keeps its caller from waiting on a promise nothing will settle.
            previous?.resolve("cancel");
            return { request, resolve };
          });
        }),
    }),
    [],
  );
  const answerUnsaved = React.useCallback((decision: UnsavedChangesDecision) => {
    setUnsaved((previous) => {
      previous?.resolve(decision);
      return null;
    });
  }, []);

  const copy = activeDialog ? dialogCopy[activeDialog] : null;
  const DialogIcon = activeDialog ? dialogIcons[activeDialog] : null;

  const completeAction = () => {
    if (!activeDialog || !copy) return;
    notify({
      title: copy.notificationTitle,
      description: "The workspace already shows the appearance you chose.",
      tone: "success",
    });
    setActiveDialog(null);
  };

  return (
    <ShellDialogContext.Provider value={value}>
      {children}
      <Dialog open={activeDialog !== null} onOpenChange={(open) => !open && setActiveDialog(null)}>
        {copy && DialogIcon ? (
          <DialogContent
            className="folio-dialog-motion overflow-hidden p-0 sm:max-w-[520px]"
            onCloseAutoFocus={(event) => {
              const target = returnFocusRef.current?.();
              if (target === null || target === undefined) return;
              event.preventDefault();
              target.focus();
            }}
          >
            <div className="p-6">
              <DialogHeader>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-folio-accent-soft text-folio-accent">
                  <DialogIcon className="size-5" aria-hidden="true" />
                </div>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>

              {activeDialog === "settings" ? (
                <div className="mt-5 grid grid-cols-2 gap-3" role="group" aria-label="Theme">
                  {(["light", "dark"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={cn(
                        "rounded-[14px] border border-folio-border bg-folio-surface p-3 text-left transition-[border-color,transform,box-shadow] duration-100 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-folio-accent active:translate-y-0 active:scale-[0.99]",
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
              <Button
                variant="ghost"
                className="transition-[background-color,transform,box-shadow] duration-100 ease-out active:scale-[0.98]"
                onClick={() => setActiveDialog(null)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                className="transition-[background-color,transform,box-shadow] duration-100 ease-out active:scale-[0.98]"
                onClick={completeAction}
              >
                {copy.primaryLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog
        open={unsaved !== null}
        onOpenChange={(open) => {
          if (!open) answerUnsaved("cancel");
        }}
      >
        {unsaved ? (
          <DialogContent
            className="folio-dialog-motion overflow-hidden p-0 sm:max-w-[460px]"
            data-testid="unsaved-changes-dialog"
          >
            <div className="p-6">
              <DialogHeader>
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-folio-accent-soft text-folio-accent">
                  <TriangleAlert className="size-5" aria-hidden="true" />
                </div>
                <DialogTitle>{`Save changes to ${unsaved.request.title}?`}</DialogTitle>
                <DialogDescription>
                  Your drawing will be lost if you do not save it.
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter className="border-t border-folio-border bg-folio-surface-muted px-6 py-4">
              <Button
                variant="ghost"
                data-testid="unsaved-changes-cancel"
                onClick={() => answerUnsaved("cancel")}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                data-testid="unsaved-changes-discard"
                onClick={() => answerUnsaved("discard")}
              >
                Discard
              </Button>
              <Button
                variant="default"
                data-testid="unsaved-changes-save"
                onClick={() => answerUnsaved("save")}
              >
                Save
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
