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

  constructor(
    private readonly project: ProjectSession,
    private readonly port: DesktopProjectSavePort,
  ) {}

  get backing(): DesktopProjectBacking | null {
    return this.backingValue;
  }

  save(): Promise<ProjectSaveResult> {
    return this.performSave(false);
  }
  saveAs(): Promise<ProjectSaveResult> {
    return this.performSave(true);
  }

  private async performSave(saveAs: boolean): Promise<ProjectSaveResult> {
    if (this.busy) return saveFailure("BUSY", "A project save is already in progress.");
    this.busy = true;
    try {
      let content: string;
      let title: string;
      try {
        const snapshot = this.project.captureSnapshot();
        title = snapshot.metadata.title;
        content = encodeFolioProject(snapshot);
      } catch {
        return saveFailure("ENCODE_FAILED", "The project could not be encoded for saving.");
      }
      const result = await this.port.save(
        saveAs || this.backingValue === null
          ? { kind: "saveAs", title, content }
          : { kind: "save", targetId: this.backingValue.id, content },
      );
      if (result.status === "saved") this.backingValue = Object.freeze({ ...result.backing });
      return result;
    } catch {
      return saveFailure("UNKNOWN", "The desktop save result could not be confirmed.");
    } finally {
      this.busy = false;
    }
  }
}
