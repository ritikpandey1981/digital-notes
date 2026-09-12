import type {
  ProjectNewResult,
  ProjectPersistenceCoordinator,
} from "./project-persistence-coordinator";
import type { ProjectOpenResult } from "../../electron/project-open-contract";
import type { ProjectSaveResult } from "../../electron/project-save-contract";

/** Why the active project is about to be replaced or put away. */
export type ProjectReplacementIntent = "new" | "open" | "close";

/** What the user chose when asked about unsaved work. */
export type UnsavedChangesDecision = "save" | "discard" | "cancel";

export interface UnsavedChangesRequest {
  readonly intent: ProjectReplacementIntent;
  /** The project's logical title, for wording the question. Never a filename. */
  readonly title: string;
}

/**
 * How the guard asks the user. The shell supplies a dialog; tests supply a
 * script. Nothing here knows about Electron, windows, or files.
 */
export interface UnsavedChangesPrompt {
  readonly confirmReplacement: (request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>;
}

/**
 * A prompt whose answering surface is installed after construction.
 *
 * The lifecycle coordinator outlives every render, while the dialog that can
 * actually ask the user belongs to the mounted shell. Until one is installed the
 * guard answers "cancel", so a shell that cannot ask never discards a drawing.
 */
export class DeferredUnsavedChangesPrompt implements UnsavedChangesPrompt {
  #ask: ((request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>) | null = null;

  setHandler(
    ask: ((request: UnsavedChangesRequest) => Promise<UnsavedChangesDecision>) | null,
  ): void {
    this.#ask = ask;
  }

  readonly confirmReplacement = async (
    request: UnsavedChangesRequest,
  ): Promise<UnsavedChangesDecision> => (await this.#ask?.(request)) ?? "cancel";
}

export type ProjectLifecycleErrorCode =
  "BUSY" | "SAVE_FAILED" | "SAVE_UNCONFIRMED" | "NEW_FAILED" | "OPEN_FAILED" | "UNAVAILABLE";

export type ProjectLifecycleResult =
  | Readonly<{ status: "proceeded" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{ code: ProjectLifecycleErrorCode; message: string }>;
    }>;

function lifecycleFailure(
  code: ProjectLifecycleErrorCode,
  message: string,
): ProjectLifecycleResult {
  return { status: "failed", error: { code, message } };
}

/** Authorization to replace the current project, not an instruction to destroy it. */
type ReplacementPermission =
  | Readonly<{ status: "granted" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{ code: ProjectLifecycleErrorCode; message: string }>;
    }>;

/**
 * The single destructive-project guard for New, Open and Close.
 *
 * It owns one decision -- may the active project be replaced -- and then hands
 * off to the raw transactional operations underneath. Those operations still
 * decide whether a replacement actually commits, so a granted permission never
 * destroys anything on its own: if the new project fails to activate, the
 * current one simply stays.
 */
export class ProjectLifecycleCoordinator {
  #pending: ProjectReplacementIntent | null = null;

  constructor(
    private readonly persistence: ProjectPersistenceCoordinator,
    private readonly prompt: UnsavedChangesPrompt,
  ) {}

  /** True while a guarded lifecycle request is awaiting a decision or a result. */
  get isPending(): boolean {
    return this.#pending !== null;
  }

  /** Whether replacing the active project right now would risk losing work. */
  get requiresConfirmation(): boolean {
    return this.persistence.persistenceState.hasUnsavedRisk;
  }

  requestNewProject(): Promise<ProjectLifecycleResult> {
    return this.#run("new", async () => this.#reportNew(await this.persistence.newProject()));
  }

  requestOpenProject(): Promise<ProjectLifecycleResult> {
    return this.#run("open", async () => this.#reportOpen(await this.persistence.open()));
  }

  /**
   * Resolves whether the active project may be put away.
   *
   * Closing has no replacement underneath it, so granted permission is the
   * whole outcome; the caller owns the window.
   */
  requestCloseProject(): Promise<ProjectLifecycleResult> {
    return this.#run("close", async () => ({ status: "proceeded" }));
  }

  async #run(
    intent: ProjectReplacementIntent,
    perform: () => Promise<ProjectLifecycleResult>,
  ): Promise<ProjectLifecycleResult> {
    // One question at a time. Two dialogs, or a New racing a Save, would each
    // decide the fate of the same project without knowing about the other.
    if (this.#pending !== null || this.persistence.isBusy)
      return lifecycleFailure("BUSY", "A project operation is already in progress.");
    this.#pending = intent;
    try {
      const permission = await this.#requestPermission(intent);
      if (permission.status === "cancelled") return { status: "cancelled" };
      if (permission.status === "failed") return permission;
      return await perform();
    } finally {
      this.#pending = null;
    }
  }

  async #requestPermission(intent: ProjectReplacementIntent): Promise<ReplacementPermission> {
    if (!this.persistence.persistenceState.hasUnsavedRisk) return { status: "granted" };
    const decision = await this.prompt.confirmReplacement({
      intent,
      title: this.persistence.projectTitle,
    });
    if (decision === "cancel") return { status: "cancelled" };
    // Discard is permission to replace, not an instruction to clear anything now.
    if (decision === "discard") return { status: "granted" };
    return this.#saveBeforeReplacement(await this.persistence.save());
  }

  #saveBeforeReplacement(result: ProjectSaveResult): ReplacementPermission {
    if (result.status === "saved") return { status: "granted" };
    // Backing out of the destination picker cancels the whole request; it is a
    // change of mind about saving, never consent to throw the work away.
    if (result.status === "cancelled") return { status: "cancelled" };
    // An unconfirmed write is not a write. Proceeding here would discard work
    // on the guess that the disk took it.
    if (result.error.code === "UNKNOWN")
      return {
        status: "failed",
        error: {
          code: "SAVE_UNCONFIRMED",
          message: "Folio could not confirm the project was saved, so nothing was replaced.",
        },
      };
    return {
      status: "failed",
      error: {
        code: "SAVE_FAILED",
        message: "The project could not be saved, so nothing was replaced.",
      },
    };
  }

  #reportNew(result: ProjectNewResult): ProjectLifecycleResult {
    if (result.status === "created") return { status: "proceeded" };
    return lifecycleFailure(
      result.error.code === "BUSY" ? "BUSY" : "NEW_FAILED",
      result.error.message,
    );
  }

  #reportOpen(result: ProjectOpenResult): ProjectLifecycleResult {
    // An activated-unbacked Open did replace the project; its missing file
    // association is reported by the persistence state, not as a lifecycle failure.
    if (result.status === "opened" || result.status === "activated-unbacked")
      return { status: "proceeded" };
    if (result.status === "cancelled") return { status: "cancelled" };
    return lifecycleFailure(
      result.error.code === "BUSY" ? "BUSY" : "OPEN_FAILED",
      result.error.message,
    );
  }
}
