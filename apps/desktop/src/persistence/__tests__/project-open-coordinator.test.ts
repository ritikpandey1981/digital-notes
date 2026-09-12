import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSession, ProjectRuntimeHost, type ProjectRuntime } from "@folio/editor";
import {
  createEmptyFolioProject,
  encodeFolioProject,
  decodeFolioProject,
} from "@folio/persistence/project";
import { RuntimeActivation } from "../../../../../packages/editor/src/runtime-activation";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import { EditorSelectionSet } from "../../../../../packages/editor/src/EditorSelectionSet";
import { EditorClipboard } from "../../../../../packages/editor/src/EditorClipboard";
import { DesktopProjectFileService } from "../../../electron/project-file-service";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";
import type {
  DesktopProjectOpenPort,
  ProjectReadResult,
} from "../../../electron/project-open-contract";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "folio-open-coordinator-"));
  directories.push(directory);
  const aPath = path.join(directory, "A.folio");
  const bPath = path.join(directory, "filename-is-not-title.folio");
  const bSnapshot = createEmptyFolioProject({
    documentId: "B",
    title: "Logical B",
    pageId: "B-page",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  await writeFile(bPath, encodeFolioProject(bSnapshot));
  const chooseSource = vi.fn<() => Promise<readonly string[] | null>>().mockResolvedValue([bPath]);
  const chooseDestination = vi.fn<() => Promise<string | null>>().mockResolvedValue(aPath);
  const service = new DesktopProjectFileService({
    chooseSource,
    chooseDestination,
    confirmReplacement: async () => true,
  });
  const a = new ProjectSession(createEmptyFolioProject({ documentId: "A", pageId: "A-page" }));
  const host = new ProjectRuntimeHost(a, () => coordinator.canReplaceRuntime);
  const port: DesktopProjectOpenPort = {
    open: vi.fn(() => service.open()),
    adopt: vi.fn(async (id) => service.adopt(id)),
    release: vi.fn(async (id) => service.release(id)),
  };
  const coordinator: ProjectPersistenceCoordinator = new ProjectPersistenceCoordinator(
    () => host.active.project,
    service,
    () => !host.replacing,
    { host, port },
  );
  let failure: "none" | "prepare" | "activate" | "publish" = "none";
  let projection = "";
  const prepare = (entry: ProjectRuntime) => {
    const scope = new RuntimeActivation(() => host.active === entry, vi.fn());
    host.attach(entry, scope);
    const history = createEditorHistoryCoordinator({
      documentSession: entry.project.documentSession,
      onDocumentChange: () => undefined,
    });
    const selection = new EditorSelectionSet();
    const clipboard = new EditorClipboard();
    const dispose = vi.fn(() => {
      history.destroy();
      selection.clear();
      clipboard.clear();
    });
    scope.publish({}, () => {
      projection = entry.project.metadata.documentId;
    });
    if (failure === "prepare") scope.report(new Error("preparation rejected"));
    if (failure === "activate")
      scope.onActive(() => {
        throw new Error("activation rejected");
      });
    if (failure === "publish")
      scope.publish({}, () => {
        throw new Error("publication rejected");
      });
    host.prepared(entry, scope.finishPreparation(dispose));
    return { history, selection, clipboard, dispose, scope };
  };
  const aRuntime = host.active;
  const state = prepare(aRuntime);
  const object = a.documentSession.createRectangleObject(
    { x: 2, y: 3, width: 20, height: 30 },
    { strokeColor: "#123456", strokeWidth: 2 },
  );
  state.history.executeObjectCreation(object);
  state.history.executePageRename("A-page", "temporary");
  state.history.undo();
  state.selection.replace([object.id]);
  state.clipboard.copy([object]);
  a.documentSession.rememberViewport("A-page", {
    zoom: 2,
    position: { x: 3, y: 4 },
    mode: "manual",
  });
  await coordinator.saveAs();
  const before = {
    root: a.documentSession.getDocument(),
    history: state.history.controller,
    timeline: state.history.controller.getHistoryState(),
    viewport: a.documentSession.viewportMemory("A-page"),
    backing: coordinator.backing,
    clipboard: state.clipboard.snapshot(),
    content: a.contentState(),
    persistence: coordinator.persistenceState,
  };
  let candidate: ReturnType<typeof prepare> | undefined;
  const unsubscribe = host.subscribe(() => {
    const entry = host.getSnapshot()[1];
    if (entry && entry.activation === null) candidate = prepare(entry);
  });
  return {
    a,
    host,
    port,
    coordinator,
    service,
    chooseSource,
    chooseDestination,
    aPath,
    bPath,
    bSnapshot,
    state,
    fail: (mode: typeof failure) => {
      failure = mode;
    },
    assertA: () => {
      expect(host.active).toBe(aRuntime);
      expect(host.active.project).toBe(a);
      expect(a.documentSession.getDocument()).toBe(before.root);
      expect(state.history.controller).toBe(before.history);
      expect(state.history.controller.getHistoryState()).toEqual(before.timeline);
      expect(state.selection.ids).toEqual([object.id]);
      expect(state.clipboard.snapshot()).toEqual(before.clipboard);
      expect(a.documentSession.viewportMemory("A-page")).toBe(before.viewport);
      expect(coordinator.backing).toBe(before.backing);
      expect(a.contentState()).toEqual(before.content);
      expect(coordinator.persistenceState).toEqual(before.persistence);
      expect(projection).toBe("A");
      expect(state.dispose).not.toHaveBeenCalled();
    },
    candidate: () => candidate,
    cleanup: () => {
      unsubscribe();
      host.active.activation?.dispose();
      service.dispose();
    },
  };
}

describe("transactional project Open coordinator", () => {
  it.each([
    "cancel",
    "read",
    "json",
    "version",
    "resource",
    "prepare",
    "activate",
    "publish",
  ] as const)("preserves exact A on %s failure, then Save still writes A", async (mode) => {
    const s = await setup();
    try {
      if (mode === "cancel") s.chooseSource.mockResolvedValue(null);
      if (mode === "read") s.chooseSource.mockResolvedValue([`${s.bPath}.missing.folio`]);
      if (mode === "json") await writeFile(s.bPath, "{truncated");
      if (mode === "version") {
        const envelope = JSON.parse(encodeFolioProject(s.bSnapshot));
        envelope.formatVersion = 999;
        await writeFile(s.bPath, JSON.stringify(envelope));
      }
      if (mode === "resource") await writeFile(s.bPath, "[".repeat(100));
      if (mode === "prepare" || mode === "activate" || mode === "publish") s.fail(mode);
      const result = await s.coordinator.open();
      expect(result).toMatchObject(
        mode === "cancel"
          ? { status: "cancelled" }
          : {
              status: "failed",
              error: {
                code: (
                  {
                    read: "READ_FAILED",
                    json: "INVALID_PROJECT",
                    version: "UNSUPPORTED_VERSION",
                    resource: "RESOURCE_LIMIT",
                    prepare: "RUNTIME_FAILED",
                    activate: "RUNTIME_FAILED",
                    publish: "RUNTIME_FAILED",
                  } as const
                )[mode],
              },
            },
      );
      s.assertA();
      if (["prepare", "activate", "publish"].includes(mode))
        expect(s.candidate()?.dispose).toHaveBeenCalledTimes(1);
      if (!["cancel", "read"].includes(mode)) expect(s.port.release).toHaveBeenCalledTimes(1);
      s.state.history.executePageRename("A-page", "A remains editable");
      expect((await s.coordinator.save()).status).toBe("saved");
      expect(decodeFolioProject(await readFile(s.aPath, "utf8")).sketchbook.firstPage.name).toBe(
        "A remains editable",
      );
      expect(s.chooseDestination).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("opens B then C, preserves file metadata and saves real History edits to each opened file", async () => {
    const s = await setup();
    const aBytes = await readFile(s.aPath, "utf8");
    try {
      for (const id of ["B", "C"]) {
        const snapshot = { ...s.bSnapshot, metadata: { ...s.bSnapshot.metadata, documentId: id } };
        await writeFile(s.bPath, encodeFolioProject(snapshot));
        const result = await s.coordinator.open();
        expect(result.status).toBe("opened");
        const current = s.host.active.project;
        expect(current.metadata).toEqual(snapshot.metadata);
        expect(current.documentSession.activePageId).toBe("B-page");
        expect(s.host.getSnapshot()).toEqual([s.host.active]);
        expect(s.candidate()?.history.controller.getHistoryState()).toMatchObject({
          undoDepth: 0,
          redoDepth: 0,
        });
        expect(s.candidate()?.selection.size).toBe(0);
        expect(s.candidate()?.clipboard.snapshot().objectCount).toBe(0);
        s.candidate()!.history.executePageRename("B-page", `Edited ${id}`);
        expect((await s.coordinator.save()).status).toBe("saved");
        const saved = decodeFolioProject(await readFile(s.bPath, "utf8"));
        expect(saved.metadata).toEqual(snapshot.metadata);
        expect(saved.sketchbook.firstPage.name).toBe(`Edited ${id}`);
      }
      expect(s.state.dispose).toHaveBeenCalledTimes(1);
      expect(s.chooseDestination).toHaveBeenCalledTimes(1);
      expect(await readFile(s.aPath, "utf8")).toBe(aBytes);
    } finally {
      s.cleanup();
    }
  });

  it("starts a fully opened project clean against the file it was loaded from", async () => {
    const s = await setup();
    try {
      expect((await s.coordinator.open()).status).toBe("opened");
      const b = s.host.active.project;

      expect(b.contentStateId).toBe(b.baselineStateId);
      expect(b.checkpointStateId).toBe(b.baselineStateId);
      expect(s.coordinator.persistenceState).toEqual({
        isDirty: false,
        hasBackingFile: true,
        hasConfirmedCheckpoint: true,
        hasUnsavedRisk: false,
      });
      expect(s.candidate()?.history.controller.getHistoryState().undoDepth).toBe(0);
      // B must not inherit A's checkpoint, and A must keep its own.
      expect(b.checkpointStateId).not.toBe(s.a.checkpointStateId);
      expect(s.a.isDirty).toBe(false);

      s.candidate()!.history.executePageRename("B-page", "Edited after opening");
      expect(s.coordinator.persistenceState).toMatchObject({ isDirty: true, hasBackingFile: true });
      s.candidate()!.history.undo();
      expect(s.coordinator.persistenceState.isDirty).toBe(false);

      s.candidate()!.history.executePageRename("B-page", "Saved after opening");
      expect((await s.coordinator.save()).status).toBe("saved");
      expect(s.coordinator.persistenceState.isDirty).toBe(false);
      expect(b.checkpointStateId).toBe(b.contentStateId);
    } finally {
      s.cleanup();
    }
  });

  it.each(["reject", "lost-reply"])(
    "reports B active but unbacked after adoption %s; Save uses Save As",
    async (mode) => {
      const s = await setup();
      try {
        vi.mocked(s.port.adopt).mockImplementation(async (id) => {
          expect(s.host.active.project.metadata.documentId).toBe("B");
          expect(s.state.dispose).toHaveBeenCalledTimes(1);
          if (mode === "lost-reply") {
            s.service.adopt(id);
            throw new Error("reply lost");
          }
          return { status: "failed", error: { code: "TARGET_UNAVAILABLE", message: "revoked" } };
        });
        expect((await s.coordinator.open()).status).toBe("activated-unbacked");
        expect(s.host.active.project.metadata.documentId).toBe("B");
        expect(s.coordinator.backing).toBeNull();
        expect(s.port.release).toHaveBeenCalledTimes(1);
        const b = s.host.active.project;
        // Bytes came from disk, but no writable association was confirmed, so
        // nothing may claim a durable copy of B.
        expect(b.checkpointStateId).toBeNull();
        expect(s.coordinator.persistenceState).toEqual({
          isDirty: false,
          hasBackingFile: false,
          hasConfirmedCheckpoint: false,
          hasUnsavedRisk: true,
        });
        s.chooseDestination.mockResolvedValue(`${s.bPath}.copy.folio`);
        expect((await s.coordinator.save()).status).toBe("saved");
        expect(s.chooseDestination).toHaveBeenCalledTimes(2);
        expect(s.coordinator.persistenceState).toEqual({
          isDirty: false,
          hasBackingFile: true,
          hasConfirmedCheckpoint: true,
          hasUnsavedRisk: false,
        });
      } finally {
        s.cleanup();
      }
    },
  );

  it("lost read replies preserve A and release the orphan before a subsequent Save/Open", async () => {
    const s = await setup();
    let orphan = "";
    try {
      vi.mocked(s.port.open).mockImplementationOnce(async () => {
        const result = await s.service.open();
        if (result.status === "read") orphan = result.backing.id;
        throw new Error("reply lost");
      });
      expect(await s.coordinator.open()).toMatchObject({ error: { code: "UNKNOWN" } });
      s.assertA();
      expect(s.service.adopt(orphan).status).toBe("failed");
      expect((await s.coordinator.save()).status).toBe("saved");
      expect((await s.coordinator.open()).status).toBe("opened");
      expect(s.service.adopt(orphan).status).toBe("failed");
    } finally {
      s.cleanup();
    }
  });

  it("gates Save/Save As, second Open and unrelated replacement throughout Open", async () => {
    const s = await setup();
    let finish!: (result: ProjectReadResult) => void;
    try {
      vi.mocked(s.port.open).mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = s.coordinator.open();
      for (const operation of [
        () => s.coordinator.open(),
        () => s.coordinator.save(),
        () => s.coordinator.saveAs(),
      ])
        expect(await operation()).toMatchObject({ error: { code: "BUSY" } });
      expect(await s.host.replace(new ProjectSession(s.bSnapshot))).toEqual({ status: "busy" });
      expect(s.port.open).toHaveBeenCalledTimes(1);
      finish({ status: "cancelled" });
      expect(await pending).toEqual({ status: "cancelled" });
      s.assertA();
    } finally {
      s.cleanup();
    }
  });
  it.each(["save", "saveAs"] as const)("refuses Open while %s is pending", async (method) => {
    const s = await setup();
    let finish!: (value: null) => void;
    try {
      // Remove backing for Save's normal first-save fallback, without altering project state.
      const coordinator = new ProjectPersistenceCoordinator(
        () => s.host.active.project,
        {
          save: () =>
            new Promise((resolve) => {
              finish = () => resolve({ status: "cancelled" });
            }),
        },
        () => true,
        { host: s.host, port: s.port },
      );
      const pending = coordinator[method]();
      expect(await coordinator.open()).toMatchObject({ error: { code: "BUSY" } });
      expect(s.port.open).not.toHaveBeenCalled();
      finish(null);
      await pending;
    } finally {
      s.cleanup();
    }
  });
});
