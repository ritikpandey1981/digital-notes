import * as React from "react";
import { History } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@folio/ui";
import type { RecoveryCandidateSummary } from "../../../electron/recovery-contract";
import type {
  ProjectRecoveryCoordinator,
  ProjectRecoveryResult,
} from "../../persistence/project-recovery-coordinator";
import { useNotifications } from "../notifications/NotificationProvider";

interface StartupRecoveryDialogProps {
  /** Null until the workspace has built one; the prompt simply waits. */
  readonly coordinator: ProjectRecoveryCoordinator | null;
  /** True while the shell has asked for this surface from the application menu. */
  readonly requested: boolean;
  readonly onRequestedChange: (requested: boolean) => void;
}

type RecoveryAction = "recover" | "open-original" | "discard";

function perform(
  coordinator: ProjectRecoveryCoordinator,
  action: RecoveryAction,
  recoveryId: string,
): Promise<ProjectRecoveryResult> {
  if (action === "recover") return coordinator.recover(recoveryId);
  if (action === "open-original") return coordinator.openOriginal(recoveryId);
  return coordinator.discard(recoveryId);
}

/** Absolute, because "2 minutes ago" is useless for deciding which copy is newer. */
function describeCapture(capturedAt: string): string {
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return "Time unknown";
  return captured.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Offers the drawings a previous run left behind.
 *
 * Folio keeps a background copy of unsaved work, and if it stops without being
 * closed -- a crash, a power cut, a forced quit -- that copy is still there the
 * next time it starts. This asks what to do with it, and treats every answer
 * except an explicit discard as a reason to keep the copy: dismissing it
 * changes nothing.
 *
 * It opens by itself when a run finds something, and on request from the
 * application menu, so dismissing the offer is no longer the end of it. Asked
 * for directly it will say that there is nothing, which is the honest answer to
 * a question the user asked rather than a menu item that does nothing.
 *
 * It is not a file browser and is not the File menu.
 */
export function StartupRecoveryDialog({
  coordinator,
  requested,
  onRequestedChange,
}: StartupRecoveryDialogProps) {
  const { notify } = useNotifications();
  const [candidates, setCandidates] = React.useState<readonly RecoveryCandidateSummary[]>([]);
  const [offered, setOffered] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (coordinator === null) return;
    let current = true;
    // Discovery is the only thing that happens automatically. Nothing is
    // decoded, opened, or removed until the user chooses.
    void coordinator.listCandidates().then((found) => {
      if (!current) return;
      setCandidates(found);
      setOffered(found.length > 0);
    });
    return () => {
      current = false;
    };
  }, [coordinator]);

  React.useEffect(() => {
    if (!requested || coordinator === null) return;
    let current = true;
    // Asked for directly, so the list is read again rather than shown as it
    // stood at startup.
    void coordinator.listCandidates().then((found) => {
      if (current) setCandidates(found);
    });
    return () => {
      current = false;
    };
  }, [requested, coordinator]);

  const close = React.useCallback(() => {
    setOffered(false);
    onRequestedChange(false);
  }, [onRequestedChange]);

  const act = React.useCallback(
    async (candidate: RecoveryCandidateSummary, action: RecoveryAction) => {
      if (coordinator === null || pending !== null) return;
      setPending(candidate.recoveryId);
      try {
        const result = await perform(coordinator, action, candidate.recoveryId);
        if (result.status === "cancelled") return;
        if (result.status === "failed") {
          notify({
            title: "That drawing could not be restored",
            description: result.error.message,
            tone: "error",
          });
        } else if (result.status === "recovered") {
          notify({
            title: `Restored ${candidate.title}`,
            description: "It has no file yet, so saving it will ask where to keep it.",
            tone: "success",
          });
        } else if (result.status === "opened-original") {
          notify({
            title: `Opened ${candidate.title}`,
            description: "This is the saved file, not the unsaved copy.",
            tone: "success",
          });
        }
        // Re-reading is also how a failure stays honest: a copy that would not
        // delete, or an open that could not confirm its file, is still listed.
        setCandidates(await coordinator.listCandidates());
        // A drawing that is now on screen has been dealt with; the rest of the
        // list is only worth staying open for after a discard.
        if (result.status === "recovered" || result.status === "opened-original") close();
      } finally {
        setPending(null);
      }
    },
    [close, coordinator, notify, pending],
  );

  const open = requested || (offered && candidates.length > 0);
  const busy = pending !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissing decides nothing. Every copy stays exactly where it is.
        if (!next && !busy) close();
      }}
    >
      {open ? (
        <DialogContent
          className="folio-dialog-motion overflow-hidden p-0 sm:max-w-[560px]"
          data-testid="startup-recovery-dialog"
        >
          <div className="p-6">
            <DialogHeader>
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-folio-accent-soft text-folio-accent">
                <History className="size-5" aria-hidden="true" />
              </div>
              <DialogTitle>
                {candidates.length === 0
                  ? "No recovered drawings"
                  : candidates.length === 1
                    ? "Folio kept an unsaved drawing"
                    : `Folio kept ${candidates.length} unsaved drawings`}
              </DialogTitle>
              <DialogDescription>
                {candidates.length === 0
                  ? "There is nothing waiting to be recovered. Folio keeps a copy of unsaved work here only when it stops without being closed."
                  : "Folio closed unexpectedly with work that had not been saved. You can bring it back, or open the file it came from instead."}
              </DialogDescription>
            </DialogHeader>

            {candidates.length === 0 ? null : (
              <ul className="mt-5 flex max-h-[320px] flex-col gap-3 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li
                    key={candidate.recoveryId}
                    className="rounded-[14px] border border-folio-border bg-folio-surface p-4"
                    data-testid="startup-recovery-candidate"
                    data-recovery-id={candidate.recoveryId}
                  >
                    <p className="text-sm font-semibold" data-testid="startup-recovery-title">
                      {candidate.title}
                    </p>
                    <p className="mt-1 text-xs text-folio-muted">
                      {describeCapture(candidate.capturedAt)}
                      {candidate.canOpenOriginal ? " · Saved file available" : " · Never saved"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busy}
                        data-testid="startup-recovery-recover"
                        onClick={() => void act(candidate, "recover")}
                      >
                        Recover
                      </Button>
                      {candidate.canOpenOriginal ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          data-testid="startup-recovery-open-original"
                          onClick={() => void act(candidate, "open-original")}
                        >
                          Open Original
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        data-testid="startup-recovery-discard"
                        onClick={() => void act(candidate, "discard")}
                      >
                        Discard
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t border-folio-border bg-folio-surface-muted px-6 py-4">
            <Button
              variant="ghost"
              disabled={busy}
              data-testid="startup-recovery-later"
              onClick={close}
            >
              {candidates.length === 0 ? "Close" : "Not now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
