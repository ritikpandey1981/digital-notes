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

/**
 * Everything the shell may show about the active project, and nothing else.
 *
 * No content-state identity, no backing target id, no path, no History: those
 * are how persistence works, not what the user is looking at. It is a value,
 * replaced whole whenever any part of it changes, so a view can compare it by
 * reference.
 */
export interface ProjectShellState extends ProjectPersistenceState {
  /** The project's logical title, from its own metadata. Never a filename. */
  readonly title: string;
  /** True while an exclusive project operation holds the coordinator. */
  readonly isBusy: boolean;
}

export type ProjectShellStateListener = (state: ProjectShellState) => void;

function shellStateEquals(first: ProjectShellState, second: ProjectShellState): boolean {
  return (
    first.title === second.title &&
    first.isDirty === second.isDirty &&
    first.hasBackingFile === second.hasBackingFile &&
    first.hasConfirmedCheckpoint === second.hasConfirmedCheckpoint &&
    first.hasUnsavedRisk === second.hasUnsavedRisk &&
    first.isBusy === second.isBusy
  );
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

type ProjectOperation = "save" | "open" | "new" | "recover";

/** The project lifecycle commands the shell drives, and the state it reports back. */
export class ProjectPersistenceCoordinator {
  private backingValue: DesktopProjectBacking | null = null;
  private operation: ProjectOperation | null = null;
  private requestingReplacement = false;
  private backingProject: ProjectSession | null = null;
  private readonly stateListeners = new Set<ProjectShellStateListener>();
  private shellStateValue: ProjectShellState | null = null;
  private observedProject: ProjectSession | null = null;
  private releaseContent: (() => void) | undefined;
  private releaseRuntime: (() => void) | undefined;

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
   * What the shell shows about the active project, as one comparable value.
   *
   * Recomputed only when something actually changed, so a view can hold this
   * reference and re-render on identity.
   */
  get shellState(): ProjectShellState {
    this.shellStateValue ??= this.computeShellState();
    return this.shellStateValue;
  }

  /**
   * Reports project state to the shell as it changes.
   *
   * Everything that can change it publishes: a committed edit, a confirmed
   * checkpoint, a backing target adopted or dropped, a runtime replacement, and
   * an operation starting or finishing. Nothing polls, and no second copy of
   * project state exists anywhere above this.
   */
  subscribeState(listener: ProjectShellStateListener): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("A project shell-state listener must be a function.");
    }
    this.stateListeners.add(listener);
    this.observeActiveProject();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.stateListeners.delete(listener);
      if (this.stateListeners.size === 0) this.stopObserving();
    };
  }

  /**
   * Follows whichever project is active.
   *
   * A replacement swaps the session the shell is describing, so the content
   * subscription moves with it rather than reporting on a project nobody can
   * see any more.
   */
  private observeActiveProject(): void {
    this.releaseRuntime ??= this.opening?.host.subscribe(() => this.observeActiveProject());
    const project = this.currentProject();
    if (project === this.observedProject) return;
    this.releaseContent?.();
    this.observedProject = project;
    this.releaseContent = project.subscribeContentState(() => this.publishState());
    this.publishState();
  }

  private stopObserving(): void {
    this.releaseContent?.();
    this.releaseRuntime?.();
    this.releaseContent = undefined;
    this.releaseRuntime = undefined;
    this.observedProject = null;
  }

  private beginOperation(operation: ProjectOperation): void {
    this.operation = operation;
    this.publishState();
  }

  private endOperation(): void {
    this.operation = null;
    this.publishState();
  }

  /**
   * Records which project a confirmed file belongs to.
   *
   * Adoption and clearing are both real changes to what the shell should say,
   * and neither produces a content edit, so both have to announce themselves.
   */
  private setBacking(project: ProjectSession | null, backing: DesktopProjectBacking | null): void {
    this.backingProject = project;
    this.backingValue = backing;
    this.publishState();
  }

  private computeShellState(): ProjectShellState {
    const state = this.persistenceState;
    return Object.freeze({
      title: this.projectTitle,
      isDirty: state.isDirty,
      hasBackingFile: state.hasBackingFile,
      hasConfirmedCheckpoint: state.hasConfirmedCheckpoint,
      hasUnsavedRisk: state.hasUnsavedRisk,
      isBusy: this.isBusy,
    });
  }

  private publishState(): void {
    const next = this.computeShellState();
    const previous = this.shellStateValue;
    if (previous !== null && shellStateEquals(previous, next)) return;
    this.shellStateValue = next;
    for (const listener of [...this.stateListeners]) {
      try {
        listener(next);
      } catch {
        // A view that throws while reading project state cannot break the
        // operation that produced it.
      }
    }
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
    this.beginOperation("new");
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
      this.setBacking(null, null);
      return { status: "created" };
    } catch {
      return newFailure("RUNTIME_FAILED", "The new project could not be activated.");
    } finally {
      this.endOperation();
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
    this.beginOperation("recover");
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
      this.setBacking(null, null);
      return { status: "activated" };
    } catch {
      return recoveryFailure("RUNTIME_FAILED", "The recovered drawing could not be opened.");
    } finally {
      this.endOperation();
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
    this.beginOperation("open");
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
      this.setBacking(null, null);
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
      const backing = Object.freeze({ ...target.backing });
      this.setBacking(project, backing);
      // The file holds the decoded bytes, not whatever was drawn while adoption
      // was in flight, so the baseline is the only identity the disk confirms.
      project.confirmDurableCheckpoint(project.baselineStateId);
      adopted = true;
      return { status: "opened", backing };
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
      this.endOperation();
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
    this.beginOperation("save");
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
        this.setBacking(project, Object.freeze({ ...result.backing }));
        // Checkpoint what the disk actually received. Editing continued during
        // the write, so a later state must stay dirty.
        project.confirmDurableCheckpoint(capture.stateId);
      }
      return result;
    } catch {
      return saveFailure("UNKNOWN", "The desktop save result could not be confirmed.");
    } finally {
      this.endOperation();
    }
  }
}
