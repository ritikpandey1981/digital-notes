import type { ProjectSession } from "@folio/editor";
import { encodeFolioProject } from "@folio/persistence/project";
import {
  saveFailure,
  type DesktopProjectBacking,
  type DesktopProjectSavePort,
  type ProjectSaveResult,
} from "../../electron/project-save-contract";

/** One manual save at a time for the workspace's existing project authority. */
export class ProjectPersistenceCoordinator {
  private backingValue: DesktopProjectBacking | null = null;
  private busy = false;
  private backingProject: ProjectSession | null = null;

  constructor(
    private readonly project: ProjectSession | (() => ProjectSession),
    private readonly port: DesktopProjectSavePort,
    private readonly canSave: () => boolean = () => true,
  ) {}

  get backing(): DesktopProjectBacking | null {
    return this.backingProject === this.currentProject() ? this.backingValue : null;
  }

  get isSaving(): boolean {
    return this.busy;
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
    if (this.busy || !this.canSave())
      return saveFailure("BUSY", "A project operation is already in progress.");
    this.busy = true;
    const project = this.currentProject();
    try {
      let content: string;
      let title: string;
      try {
        const snapshot = project.captureSnapshot();
        title = snapshot.metadata.title;
        content = encodeFolioProject(snapshot);
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
      }
      return result;
    } catch {
      return saveFailure("UNKNOWN", "The desktop save result could not be confirmed.");
    } finally {
      this.busy = false;
    }
  }
}
