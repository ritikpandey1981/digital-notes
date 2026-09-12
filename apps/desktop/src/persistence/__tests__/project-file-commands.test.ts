import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import type {
  DesktopProjectOpenPort,
  ProjectReadResult,
  ProjectTargetResult,
} from "../../../electron/project-open-contract";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import type { NotificationInput } from "../../components/notifications/NotificationProvider";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import {
  ProjectLifecycleCoordinator,
  type UnsavedChangesDecision,
  type UnsavedChangesRequest,
} from "../project-lifecycle-coordinator";
import { createProjectFileCommands } from "../project-file-commands";

const SAVED_BACKING = { id: "00000000-0000-4000-8000-000000000001", displayName: "a.folio" };
const OPENED_BACKING = { id: "00000000-0000-4000-8000-0000000000b0", displayName: "b.folio" };

afterEach(() => vi.restoreAllMocks());

function setup() {
  const a = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const save = vi
    .fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>()
    .mockResolvedValue({ status: "saved", backing: SAVED_BACKING });
  const read = vi.fn<() => Promise<ProjectReadResult>>().mockResolvedValue({
    status: "read",
    content: encodeFolioProject(
      createEmptyFolioProject({ documentId: "B", title: "Study B", pageId: "page-B" }),
    ),
    backing: OPENED_BACKING,
  });
  const adopt = vi.fn<(targetId: string) => Promise<ProjectTargetResult>>(async (targetId) => ({
    status: "adopted",
    backing: { id: targetId, displayName: OPENED_BACKING.displayName },
  }));
  const port: DesktopProjectOpenPort = {
    open: read,
    adopt,
    release: vi.fn(async () => ({ status: "released" }) as const),
  };
  const host = new ProjectRuntimeHost(a, () => persistence.canReplaceRuntime);
  const persistence: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    { save },
    () => !host.replacing,
    { host, port },
  );
  const decisions: UnsavedChangesDecision[] = [];
  const asked: UnsavedChangesRequest[] = [];
  const confirmReplacement = vi.fn(
    async (request: UnsavedChangesRequest): Promise<UnsavedChangesDecision> => {
      asked.push(request);
      return decisions.shift() ?? "cancel";
    },
  );
  const lifecycle = new ProjectLifecycleCoordinator(persistence, { confirmReplacement });

  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    host.prepared(entry, scope.finishPreparation(vi.fn()));
  };
  prepare(host.active);
  const unsubscribe = host.subscribe(() => {
    const candidate = host.getSnapshot()[1];
    if (candidate && candidate.activation === null) prepare(candidate);
  });

  const notifications: NotificationInput[] = [];
  const commands = createProjectFileCommands({
    lifecycle,
    persistence,
    notify: (notification) => notifications.push(notification),
  });

  return {
    a,
    host,
    save,
    adopt,
    persistence,
    lifecycle,
    commands,
    notifications,
    confirmReplacement,
    asked,
    decide: (...next: UnsavedChangesDecision[]) => decisions.push(...next),
    edit: (name: string) => {
      const editor = createEditorHistoryCoordinator({
        documentSession: host.active.project.documentSession,
        onDocumentChange: () => undefined,
      });
      editor.executePageRename(host.active.project.documentSession.activePageId, name);
      editor.destroy();
    },
    cleanup: () => {
      unsubscribe();
      host.active.activation?.dispose();
    },
  };
}

describe("the file commands a menu or a keystroke invokes", () => {
  it("puts New and Open through the unsaved-change guard", async () => {
    for (const command of ["newProject", "openProject"] as const) {
      const s = setup();
      try {
        s.edit("Worth keeping");
        s.decide("discard");

        await s.commands[command]();

        expect(s.confirmReplacement).toHaveBeenCalledTimes(1);
        expect(s.asked.map((one) => one.intent)).toEqual([
          command === "newProject" ? "new" : "open",
        ]);
        expect(s.host.active.project).not.toBe(s.a);
        expect(s.notifications).toEqual([]);
      } finally {
        s.cleanup();
      }
    }
  });

  it("asks for a destination the first time, and reuses it afterwards", async () => {
    const s = setup();
    try {
      s.edit("Worth saving");
      await s.commands.save();
      expect(s.save).toHaveBeenCalledWith(expect.objectContaining({ kind: "saveAs" }));

      s.edit("More");
      await s.commands.save();
      expect(s.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "save", targetId: SAVED_BACKING.id }),
      );

      await s.commands.saveAs();
      expect(s.save).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "saveAs" }));
      expect(s.notifications.map((one) => one.title)).toEqual([
        "Project saved",
        "Project saved",
        "Project saved",
      ]);
      expect(s.notifications.every((one) => one.tone === "success")).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("says nothing at all when the user backs out", async () => {
    const s = setup();
    try {
      // Backing out of the destination picker.
      s.save.mockResolvedValue({ status: "cancelled" });
      await s.commands.save();
      await s.commands.saveAs();

      // Backing out of the unsaved-changes question.
      s.edit("Worth keeping");
      s.decide("cancel", "cancel");
      await s.commands.newProject();
      await s.commands.openProject();

      expect(s.notifications).toEqual([]);
      expect(s.host.active.project).toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it("reports one failure, once, for each kind of thing that can go wrong", async () => {
    const s = setup();
    try {
      s.save.mockResolvedValue({
        status: "failed",
        error: { code: "PERMISSION_DENIED", message: "denied" },
      });
      await s.commands.save();
      expect(s.notifications).toHaveLength(1);
      expect(s.notifications[0]).toMatchObject({
        title: "Couldn't save the project",
        tone: "error",
      });

      s.edit("Worth keeping");
      s.decide("save");
      await s.commands.newProject();
      expect(s.notifications).toHaveLength(2);
      expect(s.notifications[1]).toMatchObject({
        title: "Couldn't save the project",
        description: "Nothing was replaced, so your drawing is still open.",
      });
      expect(s.host.active.project).toBe(s.a);
    } finally {
      s.cleanup();
    }
  });

  it("never calls an unconfirmed write a save", async () => {
    const s = setup();
    try {
      s.save.mockResolvedValue({ status: "failed", error: { code: "UNKNOWN", message: "?" } });
      await s.commands.save();

      expect(s.notifications).toHaveLength(1);
      expect(s.notifications[0]?.title).toBe("Couldn't confirm the project was saved");
      expect(s.notifications[0]?.tone).toBe("error");
      expect(s.persistence.shellState.hasConfirmedCheckpoint).toBe(false);

      // The same indeterminate answer reaches a guarded replacement too.
      s.edit("Worth keeping");
      s.decide("save");
      await s.commands.openProject();
      expect(s.notifications).toHaveLength(2);
      expect(s.notifications[1]?.title).toBe("Couldn't confirm the project was saved");
      expect(s.host.active.project).toBe(s.a);
      expect(s.notifications.some((one) => one.title === "Project saved")).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("says an opened project has no file rather than calling it opened", async () => {
    const s = setup();
    try {
      s.adopt.mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "revoked" },
      });

      await s.commands.openProject();

      expect(s.host.active.project).not.toBe(s.a);
      expect(s.notifications).toEqual([
        {
          title: "Opened without a confirmed file",
          description: "The drawing is open. Use Save As to keep your changes.",
          tone: "error",
        },
      ]);
    } finally {
      s.cleanup();
    }
  });

  it("ignores a second request while the first is still running", async () => {
    const s = setup();
    try {
      let release = (): void => undefined;
      s.save.mockImplementation(
        () =>
          new Promise<ProjectSaveResult>((resolve) => {
            release = () => resolve({ status: "saved", backing: SAVED_BACKING });
          }),
      );

      const saving = s.commands.save();
      expect(s.persistence.shellState.isBusy).toBe(true);
      // Whatever arrives now -- a second Ctrl+S, a menu click -- is refused by
      // the coordinator, and refusing is not worth a notification.
      await s.commands.save();
      await s.commands.newProject();
      expect(s.notifications).toEqual([]);

      release();
      await saving;
      expect(s.save).toHaveBeenCalledTimes(1);
      expect(s.notifications.map((one) => one.title)).toEqual(["Project saved"]);
    } finally {
      s.cleanup();
    }
  });

  it("does nothing before the workspace has built a project", async () => {
    const notifications: NotificationInput[] = [];
    const commands = createProjectFileCommands({
      lifecycle: null,
      persistence: null,
      notify: (notification) => notifications.push(notification),
    });

    await Promise.all([
      commands.newProject(),
      commands.openProject(),
      commands.save(),
      commands.saveAs(),
    ]);
    expect(notifications).toEqual([]);
  });
});
