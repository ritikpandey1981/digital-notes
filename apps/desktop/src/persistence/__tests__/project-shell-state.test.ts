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
import {
  ProjectPersistenceCoordinator,
  type ProjectShellState,
} from "../project-persistence-coordinator";

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
  const opened = encodeFolioProject(
    createEmptyFolioProject({ documentId: "B", title: "Study B", pageId: "page-B" }),
  );
  const read = vi.fn<() => Promise<ProjectReadResult>>().mockResolvedValue({
    status: "read",
    content: opened,
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
  const recovered = encodeFolioProject(
    createEmptyFolioProject({ documentId: "R", title: "Rescued study", pageId: "page-R" }),
  );
  const host = new ProjectRuntimeHost(a, () => persistence.canReplaceRuntime);
  const persistence: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    { save },
    () => !host.replacing,
    { host, port },
  );

  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    host.prepared(entry, scope.finishPreparation(vi.fn()));
  };
  prepare(host.active);
  const unsubscribeHost = host.subscribe(() => {
    const candidate = host.getSnapshot()[1];
    if (candidate && candidate.activation === null) prepare(candidate);
  });

  // Everything the shell would see, in the order it would see it. Nothing polls.
  const published: ProjectShellState[] = [];
  const unsubscribeState = persistence.subscribeState((state) => published.push(state));

  const history = () =>
    createEditorHistoryCoordinator({
      documentSession: host.active.project.documentSession,
      onDocumentChange: () => undefined,
    });

  return {
    a,
    host,
    save,
    adopt,
    read,
    recovered,
    persistence,
    published,
    history,
    latest: () => published.at(-1) ?? persistence.shellState,
    edit: (name: string) => {
      const editor = history();
      editor.executePageRename(host.active.project.documentSession.activePageId, name);
      editor.destroy();
    },
    cleanup: () => {
      unsubscribeState();
      unsubscribeHost();
      host.active.activation?.dispose();
    },
  };
}

describe("what the shell is told about the active project", () => {
  it("starts from the active project's own metadata", () => {
    const s = setup();
    try {
      expect(s.persistence.shellState).toMatchObject({
        title: "Study A",
        isDirty: false,
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        hasUnsavedRisk: false,
        isBusy: false,
      });
    } finally {
      s.cleanup();
    }
  });

  it("follows the title through New, Open and Recover", async () => {
    const s = setup();
    try {
      expect(await s.persistence.open()).toMatchObject({ status: "opened" });
      expect(s.latest().title).toBe("Study B");

      expect(await s.persistence.adoptRecoveredProject(s.recovered)).toEqual({
        status: "activated",
      });
      expect(s.latest().title).toBe("Rescued study");

      expect(await s.persistence.newProject()).toEqual({ status: "created" });
      expect(s.latest().title).toBe("Untitled Sketch");
    } finally {
      s.cleanup();
    }
  });

  it("reports an edit, an undo back to the checkpoint, and a redo, as they happen", () => {
    const s = setup();
    try {
      const editor = s.history();
      try {
        editor.executePageRename(s.a.documentSession.activePageId, "Harbour");
        expect(s.latest().isDirty).toBe(true);

        // Back to the exact content the baseline holds: not dirty any more,
        // and nobody had to ask.
        editor.controller.undo();
        expect(s.latest().isDirty).toBe(false);

        editor.controller.redo();
        expect(s.latest().isDirty).toBe(true);
      } finally {
        editor.destroy();
      }
      expect(s.published.filter((state) => state.isDirty).length).toBeGreaterThan(1);
    } finally {
      s.cleanup();
    }
  });

  it("clears the marker when the saved content is the content on screen", async () => {
    const s = setup();
    try {
      s.edit("Worth saving");
      expect(s.latest().isDirty).toBe(true);

      expect((await s.persistence.saveAs()).status).toBe("saved");
      expect(s.latest()).toMatchObject({
        isDirty: false,
        hasBackingFile: true,
        hasConfirmedCheckpoint: true,
        hasUnsavedRisk: false,
      });
    } finally {
      s.cleanup();
    }
  });

  it("keeps the marker when the drawing moved on while the save was in flight", async () => {
    const s = setup();
    try {
      s.edit("First");
      let release = (): void => undefined;
      s.save.mockImplementation(
        () =>
          new Promise<ProjectSaveResult>((resolve) => {
            release = () => resolve({ status: "saved", backing: SAVED_BACKING });
          }),
      );

      const saving = s.persistence.saveAs();
      expect(s.latest().isBusy).toBe(true);
      // The disk is taking the first state; the second one is not in it.
      s.edit("Second");
      release();
      expect((await saving).status).toBe("saved");

      expect(s.latest()).toMatchObject({
        isDirty: true,
        hasBackingFile: true,
        hasConfirmedCheckpoint: true,
        isBusy: false,
      });
    } finally {
      s.cleanup();
    }
  });

  it("announces a backing target the moment it is adopted or dropped", async () => {
    const s = setup();
    try {
      s.edit("Worth saving");
      await s.persistence.saveAs();
      const afterSave = s.published.length;
      expect(s.latest().hasBackingFile).toBe(true);

      // No edit follows, so only an explicit announcement can move this.
      expect(await s.persistence.newProject()).toEqual({ status: "created" });
      expect(s.published.length).toBeGreaterThan(afterSave);
      expect(s.latest()).toMatchObject({
        title: "Untitled Sketch",
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        isDirty: false,
        hasUnsavedRisk: false,
      });
    } finally {
      s.cleanup();
    }
  });

  it("shows an opened project that lost its file as work at risk", async () => {
    const s = setup();
    try {
      s.adopt.mockResolvedValue({
        status: "failed",
        error: { code: "TARGET_UNAVAILABLE", message: "revoked" },
      });

      expect(await s.persistence.open()).toMatchObject({ status: "activated-unbacked" });
      expect(s.latest()).toMatchObject({
        title: "Study B",
        hasBackingFile: false,
        hasConfirmedCheckpoint: false,
        // Nothing changed it, so it is not dirty -- but no file holds it either.
        isDirty: false,
        hasUnsavedRisk: true,
        isBusy: false,
      });
    } finally {
      s.cleanup();
    }
  });

  it("publishes a new value only when something actually changed", async () => {
    const s = setup();
    try {
      const before = s.persistence.shellState;
      expect(s.persistence.shellState).toBe(before);

      s.edit("Changed");
      const dirty = s.persistence.shellState;
      expect(dirty).not.toBe(before);
      expect(s.persistence.shellState).toBe(dirty);

      const count = s.published.length;
      await s.persistence.newProject();
      // A replacement really did change things, so it reported; the point is
      // that reads in between did not invent transitions.
      expect(s.published.length).toBeGreaterThan(count);
      expect(s.published.every((state, index) => state !== s.published[index - 1])).toBe(true);
    } finally {
      s.cleanup();
    }
  });

  it("stops listening when the last subscriber goes", () => {
    const s = setup();
    try {
      const seen: ProjectShellState[] = [];
      const release = s.persistence.subscribeState((state) => seen.push(state));
      s.edit("One");
      expect(seen).toHaveLength(1);

      release();
      s.edit("Two");
      expect(seen).toHaveLength(1);
    } finally {
      s.cleanup();
    }
  });
});
