import type { NotificationInput } from "../components/notifications/NotificationProvider";
import type {
  ProjectLifecycleCoordinator,
  ProjectLifecycleResult,
} from "./project-lifecycle-coordinator";
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
/**
 * Says what became of one lifecycle request, once.
 *
 * Every route into the lifecycle reports through here -- the menu, a keystroke,
 * and the window's own close button -- because a request that quietly did
 * nothing is the one outcome a user cannot act on. A refusal that keeps their
 * drawing on screen has to say so, or the window simply appears not to close.
 */
export function notifyLifecycleOutcome(
  notify: (notification: NotificationInput) => void,
  intent: "new" | "open" | "close",
  result: ProjectLifecycleResult,
): void {
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
  // Already running is not a failure the user needs told about.
  if (result.error.code === "BUSY") return;
  if (result.error.code === "SAVE_UNCONFIRMED") {
    notify(SAVE_UNCONFIRMED);
    return;
  }
  // The save worked. What it wrote is simply no longer everything there is, and
  // the work that came after it is still only here.
  if (result.error.code === "SAVE_SUPERSEDED") {
    notify({
      title: "Saved, but the drawing changed again",
      description:
        intent === "close"
          ? "Your newest changes are not in the file yet, so Folio stayed open."
          : "Nothing was replaced. Save once more, then try again.",
      tone: "error",
    });
    return;
  }
  if (result.error.code === "SAVE_FAILED") {
    notify({
      title: "Couldn't save the project",
      description:
        intent === "close"
          ? "Folio stayed open so your drawing is not lost."
          : "Nothing was replaced, so your drawing is still open.",
      tone: "error",
    });
    return;
  }
  notify({
    title:
      intent === "new"
        ? "Couldn't start a new project"
        : intent === "open"
          ? "Couldn't open the project"
          : "Couldn't close the project",
    description: "Your current drawing is still open.",
    tone: "error",
  });
}

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
    notifyLifecycleOutcome(
      notify,
      intent,
      await (intent === "new" ? lifecycle.requestNewProject() : lifecycle.requestOpenProject()),
    );
  };

  return {
    newProject: () => replace("new"),
    openProject: () => replace("open"),
    save: () => save(false),
    saveAs: () => save(true),
  };
}
