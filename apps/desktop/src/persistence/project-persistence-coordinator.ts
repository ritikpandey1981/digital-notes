import {
  ProjectSession,
  type ProjectPersistenceCapture,
  type ProjectRuntimeHost,
} from "@folio/editor";
import {
  createEmptyFolioProject,
  encodeFolioProject,
  decodeFolioProject,
  FolioProjectCodecError,
} from "@folio/persistence/project";
import type { FolioProjectSnapshot } from "@folio/persistence/project";
import {
  openFailure,
  isProjectTargetId,
  type DesktopProjectOpenPort,
  type ProjectOpenResult,
  type ProjectReadResult,
} from "../../electron/project-open-contract";
import {
  saveFailure,
  type DesktopProjectBacking,
  type DesktopProjectSavePort,
  type ProjectSaveResult,
} from "../../electron/project-save-contract";

/**
 * Two separate questions, deliberately not collapsed into one boolean.
 *
 * `isDirty` asks whether content changed relative to its reference state.
 * `hasUnsavedRisk` asks whether replacing this project could lose something the
 * user would want back. That is true for edited content, and also for a project
 * whose bytes came from a file Folio could not confirm a writable association
 * with -- its content is real even though nothing has changed it. It is
 * deliberately false for the untouched blank sketch Folio itself created, so
 * New and Close do not interrogate the user about nothing.
 */
export interface ProjectPersistenceState {
  readonly isDirty: boolean;
  readonly hasBackingFile: boolean;
  readonly hasConfirmedCheckpoint: boolean;
  readonly hasUnsavedRisk: boolean;
}

/** Outcome of creating a fresh project over the active one. */
export type ProjectNewResult =
  | Readonly<{ status: "created" }>
  | Readonly<{ status: "failed"; error: Readonly<{ code: ProjectNewErrorCode; message: string }> }>;

export type ProjectNewErrorCode = "BUSY" | "RUNTIME_FAILED" | "TARGET_UNAVAILABLE";

function newFailure(code: ProjectNewErrorCode, message: string): ProjectNewResult {
  return { status: "failed", error: { code, message } };
}

export type ProjectRecoveryActivationErrorCode =
  | "BUSY"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_VERSION"
  | "RESOURCE_LIMIT"
  | "RUNTIME_FAILED"
  | "TARGET_UNAVAILABLE";

/** Outcome of activating artwork read back from a crash snapshot. */
export type ProjectRecoveryActivationResult =
  | Readonly<{ status: "activated" }>
  | Readonly<{
      status: "failed";
      error: Readonly<{ code: ProjectRecoveryActivationErrorCode; message: string }>;
    }>;

function recoveryFailure(
  code: ProjectRecoveryActivationErrorCode,
  message: string,
): ProjectRecoveryActivationResult {
  return { status: "failed", error: { code, message } };
}

/** What a lifecycle operation needs to swap the active project for another. */
export interface ProjectOpeningServices {
  readonly host: ProjectRuntimeHost;
  readonly port: DesktopProjectOpenPort;
  /**
   * Reads the file a recovery candidate came from.
   *
   * Main chooses the location from its own record, so this takes a recovery id
   * and the renderer never holds a path.
   */
  readonly openOriginal?: (recoveryId: string) => Promise<ProjectReadResult>;
}

/** Raw lifecycle commands, intentionally not exposed in File UI until unsaved protection exists. */
export class ProjectPersistenceCoordinator {
  private backingValue: DesktopProjectBacking | null = null;
  private operation: "save" | "open" | "new" | "recover" | null = null;
  private requestingReplacement = false;
  private backingProject: ProjectSession | null = null;

  constructor(
    private readonly project: ProjectSession | (() => ProjectSession),
    private readonly port: DesktopProjectSavePort,
    private readonly canSave: () => boolean = () => true,
    private readonly opening?: ProjectOpeningServices,
    private readonly createProject: () => FolioProjectSnapshot = createEmptyFolioProject,
  ) {}

  get backing(): DesktopProjectBacking | null {
    return this.backingProject === this.currentProject() ? this.backingValue : null;
  }

  get isSaving(): boolean {
    return this.operation === "save";
  }

  /** True while any project operation holds the coordinator. */
  get isBusy(): boolean {
    return this.operation !== null;
  }

  /** The active project's logical title. Never a filename, never a path. */
  get projectTitle(): string {
    return this.currentProject().metadata.title;
  }

  /** Narrow read model for the future unsaved-change guard. It mutates nothing. */
  get persistenceState(): ProjectPersistenceState {
    const content = this.currentProject().contentState();
    return Object.freeze({
      isDirty: content.isDirty,
      hasBackingFile: this.backing !== null,
      hasConfirmedCheckpoint: content.hasConfirmedCheckpoint,
      // Nothing is at risk when the project is either the untouched blank sketch
      // Folio made, or byte-identical to a durable copy it confirmed. Everything
      // else is: edited content, and content loaded from a file whose writable
      // association was never confirmed.
      hasUnsavedRisk: !(
        content.isDisposableBaseline ||
        (!content.isDirty && content.hasConfirmedCheckpoint)
      ),
    });
  }

  get canReplaceRuntime(): boolean {
    return this.operation === null || this.requestingReplacement;
  }

  /**
   * Replaces the active project with a fresh one through the same transactional
   * handoff Open uses.
   *
   * Raw lifecycle: it performs no unsaved-change protection. The guard above it
   * decides whether the current project may be replaced at all.
   */
  async newProject(): Promise<ProjectNewResult> {
    const opening = this.opening;
    if (this.operation !== null || !this.canSave())
      return newFailure("BUSY", "A project operation is already in progress.");
    if (opening === undefined)
      return newFailure("TARGET_UNAVAILABLE", "New Project is unavailable.");
    this.operation = "new";
    try {
      const project = new ProjectSession(this.createProject());
      this.requestingReplacement = true;
      let replacement: ReturnType<ProjectRuntimeHost["replace"]>;
      try {
        replacement = opening.host.replace(project);
      } finally {
        this.requestingReplacement = false;
      }
      const result = await replacement;
      if (result.status === "busy")
        return newFailure("BUSY", "A project replacement is already in progress.");
      if (result.status === "failed")
        return newFailure(
          "RUNTIME_FAILED",
          "The new project could not be activated. The current project was preserved.",
        );
      // The previous project's approved file must never follow a different
      // project, so the fresh one starts unbacked and Save falls back to Save As.
      this.backingProject = null;
      this.backingValue = null;
      return { status: "created" };
    } catch {
      return newFailure("RUNTIME_FAILED", "The new project could not be activated.");
    } finally {
      this.operation = null;
    }
  }

  /**
   * Activates artwork read back from a crash snapshot.
   *
   * Recovered content is deliberately detached. It is not what the original
   * file holds -- that file may be older, newer, or something else entirely --
   * so the recovered project adopts no file and confirms no durable copy.
   * Saving it asks for a destination, which is the only way recovery can never
   * silently overwrite the project it was rescued from.
   *
   * Raw lifecycle: the guard above it decides whether the current project may
   * be replaced at all.
   */
  async adoptRecoveredProject(content: string): Promise<ProjectRecoveryActivationResult> {
    const opening = this.opening;
    if (this.operation !== null || !this.canSave())
      return recoveryFailure("BUSY", "A project operation is already in progress.");
    if (opening === undefined)
      return recoveryFailure("TARGET_UNAVAILABLE", "Project recovery is unavailable.");
    this.operation = "recover";
    try {
      let project: ProjectSession;
      try {
        // Loaded, not created: this content existed outside Folio's own blank
        // sketch, so it is never the disposable baseline New and Close ignore.
        project = new ProjectSession(decodeFolioProject(content), { origin: "loaded" });
      } catch (error) {
        const code =
          error instanceof FolioProjectCodecError &&
          (error.code === "UNSUPPORTED_VERSION" || error.code === "RESOURCE_LIMIT")
            ? error.code
            : "INVALID_PROJECT";
        return recoveryFailure(code, "The recovered drawing could not be read.");
      }
      this.requestingReplacement = true;
      let replacement: ReturnType<ProjectRuntimeHost["replace"]>;
      try {
        replacement = opening.host.replace(project);
      } finally {
        this.requestingReplacement = false;
      }
      const result = await replacement;
      if (result.status === "busy")
        return recoveryFailure("BUSY", "A project replacement is already in progress.");
      if (result.status === "failed")
        return recoveryFailure(
          "RUNTIME_FAILED",
          "The recovered drawing could not be opened. The current project was preserved.",
        );
      this.backingProject = null;
      this.backingValue = null;
      return { status: "activated" };
    } catch {
      return recoveryFailure("RUNTIME_FAILED", "The recovered drawing could not be opened.");
    } finally {
      this.operation = null;
    }
  }

  async open(): Promise<ProjectOpenResult> {
    return this.performOpen((opening) => opening.port.open());
  }

  /**
   * Opens the file a recovery candidate was made from, not the candidate itself.
   *
   * It is the ordinary Open pipeline with the location supplied by main's own
   * recovery record instead of by a file dialog, so the opened project adopts
   * its file and starts confirmed exactly as any opened project does.
   */
  async openRecoveryOriginal(recoveryId: string): Promise<ProjectOpenResult> {
    return this.performOpen(
      (opening) =>
        opening.openOriginal?.(recoveryId) ??
        Promise.resolve(
          openFailure("TARGET_UNAVAILABLE", "Opening the original file is unavailable."),
        ),
    );
  }

  private async performOpen(
    readProject: (opening: ProjectOpeningServices) => Promise<ProjectReadResult>,
  ): Promise<ProjectOpenResult> {
    const opening = this.opening;
    if (this.operation !== null || !this.canSave())
      return openFailure("BUSY", "A project operation is already in progress.");
    if (opening === undefined)
      return openFailure("TARGET_UNAVAILABLE", "Project Open is unavailable.");
    this.operation = "open";
    let provisional: string | null = null;
    let activated = false;
    let adopted = false;
    try {
      const read = await readProject(opening);
      if (read?.status === "cancelled" || read?.status === "failed") return read;
      if (read?.status === "read" && isProjectTargetId(read.backing?.id))
        provisional = read.backing.id;
      if (
        read?.status !== "read" ||
        !isProjectTargetId(read.backing?.id) ||
        typeof read.backing.displayName !== "string" ||
        typeof read.content !== "string"
      )
        return openFailure("UNKNOWN", "The desktop Open result could not be confirmed.");
      provisional = read.backing.id;
      let project: ProjectSession;
      try {
        project = new ProjectSession(decodeFolioProject(read.content), { origin: "loaded" });
      } catch (error) {
        const code =
          error instanceof FolioProjectCodecError &&
          (error.code === "UNSUPPORTED_VERSION" || error.code === "RESOURCE_LIMIT")
            ? error.code
            : "INVALID_PROJECT";
        return openFailure(code, "The selected file is not a supported, valid Folio project.");
      }
      this.requestingReplacement = true;
      let replacement: ReturnType<ProjectRuntimeHost["replace"]>;
      try {
        replacement = opening.host.replace(project);
      } finally {
        this.requestingReplacement = false;
      }
      const result = await replacement;
      if (result.status === "busy")
        return openFailure("BUSY", "A project replacement is already in progress.");
      if (result.status === "failed")
        return openFailure(
          "RUNTIME_FAILED",
          "The project runtime could not be activated. The current project was preserved.",
        );
      activated = true;
      this.backingProject = null;
      this.backingValue = null;
      const target = await opening.port.adopt(provisional);
      if (
        target?.status !== "adopted" ||
        target.backing?.id !== provisional ||
        typeof target.backing.displayName !== "string"
      )
        return {
          status: "activated-unbacked",
          error: {
            code: "TARGET_UNAVAILABLE",
            message:
              "The project is active, but its file target could not be confirmed. Use Save As.",
          },
        };
      this.backingProject = project;
      this.backingValue = Object.freeze({ ...target.backing });
      // The file holds the decoded bytes, not whatever was drawn while adoption
      // was in flight, so the baseline is the only identity the disk confirms.
      project.confirmDurableCheckpoint(project.baselineStateId);
      adopted = true;
      return { status: "opened", backing: this.backingValue };
    } catch {
      return activated
        ? {
            status: "activated-unbacked",
            error: {
              code: "UNKNOWN",
              message: "The project is active without a confirmed file target. Use Save As.",
            },
          }
        : openFailure(
            "UNKNOWN",
            "The desktop Open result could not be confirmed. The current project was preserved.",
          );
    } finally {
      if (!adopted) {
        try {
          await opening.port.release(provisional ?? undefined);
        } catch {
          /* Main revokes orphans on the next Open, navigation, crash or close. */
        }
      }
      this.operation = null;
    }
  }

  private currentProject(): ProjectSession {
    return typeof this.project === "function" ? this.project() : this.project;
  }

  save(): Promise<ProjectSaveResult> {
    return this.performSave(false);
  }
  saveAs(): Promise<ProjectSaveResult> {
    return this.performSave(true);
  }

  private async performSave(saveAs: boolean): Promise<ProjectSaveResult> {
    if (this.operation !== null || !this.canSave())
      return saveFailure("BUSY", "A project operation is already in progress.");
    this.operation = "save";
    const project = this.currentProject();
    try {
      let content: string;
      let title: string;
      let capture: ProjectPersistenceCapture;
      try {
        capture = project.capturePersistenceSnapshot();
        title = capture.project.metadata.title;
        content = encodeFolioProject(capture.project);
      } catch {
        return saveFailure("ENCODE_FAILED", "The project could not be encoded for saving.");
      }
      const result = await this.port.save(
        saveAs || this.backing === null
          ? { kind: "saveAs", title, content }
          : { kind: "save", targetId: this.backing!.id, content },
      );
      if (result.status === "saved") {
        this.backingProject = project;
        this.backingValue = Object.freeze({ ...result.backing });
        // Checkpoint what the disk actually received. Editing continued during
        // the write, so a later state must stay dirty.
        project.confirmDurableCheckpoint(capture.stateId);
      }
      return result;
    } catch {
      return saveFailure("UNKNOWN", "The desktop save result could not be confirmed.");
    } finally {
      this.operation = null;
    }
  }
}
