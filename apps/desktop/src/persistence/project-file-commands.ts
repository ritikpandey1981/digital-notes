import type { NotificationInput } from "../components/notifications/NotificationProvider";
import type { ProjectLifecycleCoordinator } from "./project-lifecycle-coordinator";
import type { ProjectPersistenceCoordinator } from "./project-persistence-coordinator";
import type { ProjectSaveResult } from "../../electron/project-save-contract";

/** The four file commands, however they were invoked. */
export interface ProjectFileCommands {
  readonly newProject: () => Promise<void>;
  readonly openProject: () => Promise<void>;
  readonly save: () => Promise<void>;
  readonly saveAs: () => Promise<void>;
}

export interface ProjectFileCommandOptions {
  readonly lifecycle: ProjectLifecycleCoordinator | null;
  readonly persistence: ProjectPersistenceCoordinator | null;
  readonly notify: (notification: NotificationInput) => void;
}

/**
 * What each outcome is worth telling the user.
 *
 * Cancelling is a decision, not a problem, so it says nothing. A request that
 * arrived while another was running says nothing either: the answer is already
 * on screen, and a second dialog or a "busy" toast would only describe Folio to
 * itself. Everything else that did not do what the user asked is reported once,
 * in the shell, in plain words.
 */
const SAVE_UNCONFIRMED: NotificationInput = {
  title: "Couldn't confirm the project was saved",
  description: "Folio could not tell whether the file was written. Check it before closing.",
  tone: "error",
};

/**
 * Turns the project lifecycle into commands a menu or a keystroke can invoke.
 *
 * One path for both. New and Open go through the unsaved-change guard rather
 * than the raw operations beneath it, Save and Save As go through the
 * persistence coordinator that already owns them, and nothing here re-decides
 * anything those layers decide.
 */
export function createProjectFileCommands(options: ProjectFileCommandOptions): ProjectFileCommands {
  const { notify } = options;

  const reportSave = (result: ProjectSaveResult): void => {
    if (result.status === "saved") {
      notify({ title: "Project saved", tone: "success" });
      return;
    }
    if (result.status === "cancelled") return;
    if (result.error.code === "BUSY") return;
    // An unconfirmed write is never reported as a save. P4 leaves the
    // checkpoint alone for exactly the same reason.
    notify(
      result.error.code === "UNKNOWN"
        ? SAVE_UNCONFIRMED
        : {
            title: "Couldn't save the project",
            description: "Your drawing is unchanged and still open.",
            tone: "error",
          },
    );
  };

  const save = async (explicitDestination: boolean): Promise<void> => {
    const persistence = options.persistence;
    if (persistence === null) return;
    reportSave(await (explicitDestination ? persistence.saveAs() : persistence.save()));
  };

  const replace = async (intent: "new" | "open"): Promise<void> => {
    const lifecycle = options.lifecycle;
    if (lifecycle === null) return;
    const result = await (intent === "new"
      ? lifecycle.requestNewProject()
      : lifecycle.requestOpenProject());
    if (result.status === "cancelled") return;
    if (result.status === "proceeded") {
      if (result.warning === "backing-unconfirmed")
        notify({
          title: "Opened without a confirmed file",
          description: "The drawing is open. Use Save As to keep your changes.",
          tone: "error",
        });
      return;
    }
    if (result.error.code === "BUSY") return;
    // A save the user asked for on the way here already reported itself; this
    // says only what became of the request they actually made.
    if (result.error.code === "SAVE_UNCONFIRMED") {
      notify(SAVE_UNCONFIRMED);
      return;
    }
    if (result.error.code === "SAVE_FAILED") {
      notify({
        title: "Couldn't save the project",
        description: "Nothing was replaced, so your drawing is still open.",
        tone: "error",
      });
      return;
    }
    notify(
      intent === "new"
        ? {
            title: "Couldn't start a new project",
            description: "Your current drawing is still open.",
            tone: "error",
          }
        : {
            title: "Couldn't open the project",
            description: "Your current drawing is still open.",
            tone: "error",
          },
    );
  };

  return {
    newProject: () => replace("new"),
    openProject: () => replace("open"),
    save: () => save(false),
    saveAs: () => save(true),
  };
}
