import type {
  RecoveryCandidateSummary,
  RecoveryClearResult,
  RecoveryErrorCode,
  RecoveryListResult,
  RecoveryReadResult,
} from "../../electron/recovery-contract";
import type { ProjectOpenErrorCode } from "../../electron/project-open-contract";
import type {
  ProjectLifecycleCoordinator,
  ProjectReplacementRefusal,
} from "./project-lifecycle-coordinator";
import type {
  ProjectPersistenceCoordinator,
  ProjectRecoveryActivationResult,
} from "./project-persistence-coordinator";

export type ProjectRecoveryErrorCode =
  | "BUSY"
  | "NOT_FOUND"
  | "INVALID_RECOVERY"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_VERSION"
  | "RESOURCE_LIMIT"
  | "READ_FAILED"
  | "DELETE_FAILED"
  | "RUNTIME_FAILED"
  | "ORIGINAL_UNAVAILABLE"
  | "SAVE_FAILED"
  | "SAVE_UNCONFIRMED"
  | "UNKNOWN";

/**
 * What a scan found, or that it could not look.
 *
 * An empty directory and an unreadable one are different answers, and telling
 * the user there is nothing to recover when Folio simply could not check would
 * be the more damaging of the two to get wrong.
 */
export type RecoveryCandidateListing =
  | Readonly<{ status: "listed"; candidates: readonly RecoveryCandidateSummary[] }>
  | Readonly<{ status: "unavailable" }>;

export type ProjectRecoveryResult =
  | Readonly<{ status: "recovered" }>
  /** `backingConfirmed` false means the file behind it could not be confirmed. */
  | Readonly<{ status: "opened-original"; backingConfirmed: boolean }>
  | Readonly<{ status: "discarded" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{ code: ProjectRecoveryErrorCode; message: string }>;
    }>;

/**
 * The recovery capabilities this flow needs, all scoped to a candidate id.
 *
 * Opening the original file is not here: that goes through the persistence
 * coordinator, so it reuses the one Open pipeline rather than growing a second
 * way to load a project.
 */
export interface ProjectRecoveryPort {
  readonly list: () => Promise<RecoveryListResult>;
  readonly read: (recoveryId: string) => Promise<RecoveryReadResult>;
  readonly clear: (recoveryId: string) => Promise<RecoveryClearResult>;
}

/**
 * Who keeps rescued artwork protected once it is on screen.
 *
 * Background recovery takes over from the record the artwork came from, and is
 * the only thing that knows when this run has a durable copy of its own.
 */
export interface ProjectRecoveryHandover {
  readonly adoptPredecessorRecovery: (recoveryId: string) => void;
}

function failure(code: ProjectRecoveryErrorCode, message: string): ProjectRecoveryResult {
  return { status: "failed", error: { code, message } };
}

/**
 * What the user does about drawings a previous run left behind.
 *
 * Recovering or opening an original replaces the active project, so both go
 * through the one unsaved-change guard rather than carrying a copy of it. A
 * candidate is consumed only once its replacement has actually committed: every
 * failure on the way there leaves both the current project and the candidate
 * exactly as they were, so the user can simply try again.
 */
export class ProjectRecoveryCoordinator {
  constructor(
    private readonly persistence: ProjectPersistenceCoordinator,
    private readonly lifecycle: ProjectLifecycleCoordinator,
    private readonly port: ProjectRecoveryPort,
    /** Keeps a rescued drawing protected until this run has its own copy. */
    private readonly handover: ProjectRecoveryHandover,
    /** The record protecting the drawing that is open right now, if any. */
    private readonly activeRecoveryId: () => string | null = () => null,
  ) {}

  /**
   * The candidates worth offering, newest capture first.
   *
   * The snapshot this run is currently maintaining is not among them: it
   * protects the drawing already on screen, and offering someone their own open
   * work as something rescued from a crash would be nonsense. A scan that fails
   * offers nothing and deletes nothing; the records stay for the next start.
   */
  async listCandidates(): Promise<RecoveryCandidateListing> {
    try {
      const result = await this.port.list();
      if (result.status !== "listed") return { status: "unavailable" };
      const live = this.activeRecoveryId();
      return {
        status: "listed",
        candidates: result.candidates.filter((one) => one.recoveryId !== live),
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  /**
   * Brings back the artwork a candidate holds, detached from any file.
   *
   * The original is never written to, never adopted, and never consulted, which
   * is what makes recovering safe when the two have diverged.
   */
  recover(recoveryId: string): Promise<ProjectRecoveryResult> {
    return this.lifecycle.runGuarded(
      "recover",
      async () => {
        const read = await this.port.read(recoveryId).catch(() => null);
        if (read === null) return failure("UNKNOWN", "That recovered drawing could not be read.");
        if (read.status !== "read")
          return failure(readErrorCode(read.error.code), read.error.message);
        const activation = await this.persistence.adoptRecoveredProject(read.content);
        if (activation.status !== "activated") return activationFailure(activation);
        // Not deleted here. Between this line and the first snapshot of the
        // rescued drawing, that record is the only copy of it anywhere, so it
        // is handed over rather than dropped: background recovery removes it
        // once something durable holds the same artwork.
        this.handover.adoptPredecessorRecovery(recoveryId);
        return { status: "recovered" };
      },
      (refusal) => refused(refusal),
    );
  }

  /**
   * Opens the file the candidate was made from, as it stands today.
   *
   * No merge and no comparison: this is the ordinary Open, pointed at a
   * location main already knows. The candidate survives anything short of a
   * fully adopted project, so choosing wrong here costs nothing.
   */
  openOriginal(recoveryId: string): Promise<ProjectRecoveryResult> {
    return this.lifecycle.runGuarded(
      "recover",
      async () => {
        const result = await this.persistence.openRecoveryOriginal(recoveryId);
        if (result.status === "cancelled") return { status: "cancelled" };
        if (result.status === "failed")
          return failure(openErrorCode(result.error.code), result.error.message);
        // An activated-unbacked open replaced the project without confirming
        // its file, so the candidate stays: nothing durable holds this content,
        // and the outcome says which of the two happened.
        const backingConfirmed = result.status === "opened";
        if (backingConfirmed) await this.retire(recoveryId);
        return { status: "opened-original", backingConfirmed };
      },
      (refusal) => refused(refusal),
    );
  }

  /**
   * Removes one candidate because the user said so.
   *
   * It replaces no project, so it asks no unsaved question and touches neither
   * the active drawing nor any other candidate. A delete that fails is reported
   * as a failure rather than quietly reported as done.
   */
  async discard(recoveryId: string): Promise<ProjectRecoveryResult> {
    const cleared = await this.port.clear(recoveryId).catch(() => null);
    if (cleared === null || cleared.status !== "cleared")
      return failure("DELETE_FAILED", "That recovered drawing could not be removed.");
    return { status: "discarded" };
  }

  /**
   * Consumes a candidate that has been acted on.
   *
   * A cleanup that fails must never undo the activation it follows: the drawing
   * is already on screen, and the record simply reappears next time, which is
   * the truthful thing for it to do.
   */
  private async retire(recoveryId: string): Promise<void> {
    await this.port.clear(recoveryId).catch(() => undefined);
  }
}

function refused(refusal: ProjectReplacementRefusal): ProjectRecoveryResult {
  if (refusal.status === "cancelled") return { status: "cancelled" };
  const code = refusal.error.code;
  return failure(
    code === "BUSY" ? "BUSY" : code === "SAVE_UNCONFIRMED" ? "SAVE_UNCONFIRMED" : "SAVE_FAILED",
    refusal.error.message,
  );
}

function activationFailure(
  activation: Extract<ProjectRecoveryActivationResult, { status: "failed" }>,
): ProjectRecoveryResult {
  const code = activation.error.code;
  return failure(code === "TARGET_UNAVAILABLE" ? "UNKNOWN" : code, activation.error.message);
}

function readErrorCode(code: RecoveryErrorCode): ProjectRecoveryErrorCode {
  switch (code) {
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_REQUEST":
    case "INVALID_RECOVERY":
      return "INVALID_RECOVERY";
    case "READ_FAILED":
    case "PERMISSION_DENIED":
    case "TOO_LARGE":
      return "READ_FAILED";
    default:
      return "UNKNOWN";
  }
}

function openErrorCode(code: ProjectOpenErrorCode): ProjectRecoveryErrorCode {
  switch (code) {
    case "BUSY":
      return "BUSY";
    case "TARGET_UNAVAILABLE":
      return "ORIGINAL_UNAVAILABLE";
    case "READ_FAILED":
    case "PERMISSION_DENIED":
    case "FILE_TOO_LARGE":
      return "READ_FAILED";
    case "INVALID_PROJECT":
      return "INVALID_PROJECT";
    case "UNSUPPORTED_VERSION":
      return "UNSUPPORTED_VERSION";
    case "RESOURCE_LIMIT":
      return "RESOURCE_LIMIT";
    case "RUNTIME_FAILED":
      return "RUNTIME_FAILED";
    default:
      return "UNKNOWN";
  }
}
