import { readFile } from "node:fs/promises";
import { SketchbookDocument } from "@folio/document";
import {
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
} from "@folio/persistence/project";
import { describe, expect, it } from "vitest";
import { InkDocumentSession } from "../InkDocumentSession";
import { ProjectSession } from "../project-session";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";

function createProject() {
  return new ProjectSession(
    createEmptyFolioProject({
      documentId: "project-session-test",
      title: "Session study",
      createdAt: "2026-09-11T09:00:00.000Z",
      pageId: "initial-page",
    }),
  );
}

function createHistory(project: ProjectSession) {
  return createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    onDocumentChange: () => undefined,
  });
}

describe("ProjectSession", () => {
  it("installs the supplied root directly and owns only metadata plus one document session", () => {
    const initial = createEmptyFolioProject({ pageId: "supplied-page" });
    const project = new ProjectSession(initial);

    expect(project.documentSession).toBeInstanceOf(InkDocumentSession);
    expect(project.documentSession.getDocument()).toBe(initial.sketchbook);
    expect(project.documentSession.activePageId).toBe("supplied-page");
    expect(project.captureSnapshot().sketchbook).toBe(initial.sketchbook);
    expect(Object.keys(project).sort()).toEqual(["documentSession", "metadata"]);
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.metadata)).toBe(true);
  });

  it("retains immutable capture A while History edits the same session to B and later encodes A", () => {
    const project = createProject();
    const session = project.documentSession;
    const history = createHistory(project);
    const before = project.captureSnapshot();
    const encodedBefore = encodeFolioProject(before);
    const object = session.createRectangleObject(
      { x: 10, y: 20, width: 30, height: 40 },
      { strokeColor: "#123456", strokeWidth: 2 },
    );
    history.executeObjectCreation(object);
    const after = project.captureSnapshot();

    expect(project.documentSession).toBe(session);
    expect(after.sketchbook).toBe(session.getDocument());
    expect(after.sketchbook).not.toBe(before.sketchbook);
    expect(before.sketchbook.firstPage.content.size).toBe(0);
    expect(after.sketchbook.firstPage.content.lookup(object.id)).toBeDefined();
    expect(after.metadata).toBe(before.metadata);
    expect(Object.isFrozen(before)).toBe(true);
    expect(encodeFolioProject(before)).toBe(encodedBefore);
    expect(decodeFolioProject(encodeFolioProject(after)).sketchbook.firstPage.content.size).toBe(1);
    expect(history.controller.getHistoryState().undoDepth).toBe(1);

    history.undo();
    expect(project.captureSnapshot().sketchbook.firstPage.content.size).toBe(0);
    history.redo();
    expect(project.captureSnapshot().sketchbook.firstPage.content.lookup(object.id)).toBeDefined();
    expect(encodeFolioProject(before)).toBe(encodedBefore);
    history.destroy();
  });

  it("keeps metadata and session identity stable through page and Layer commands and navigation", () => {
    const project = createProject();
    const session = project.documentSession;
    const metadata = project.metadata;
    const history = createHistory(project);
    const firstPage = session.activePageId;
    const addedLayer = history.executeAddLayer("Study marks");
    session.setActiveLayerId(addedLayer.layerId);
    session.rememberViewport(firstPage, { zoom: 2, position: { x: 3, y: 4 }, mode: "manual" });
    const addedPage = history.executeAddPage();
    history.executePageRename(addedPage.pageId, "Second study");
    session.setActivePageId(addedPage.pageId);
    const depth = history.controller.getHistoryState().undoDepth;
    session.setActivePageId(firstPage);

    expect(session.activeLayerId).toBe(addedLayer.layerId);
    expect(session.viewportMemory(firstPage)?.zoom).toBe(2);
    expect(history.controller.getHistoryState().undoDepth).toBe(depth);
    expect(project.documentSession).toBe(session);
    expect(project.captureSnapshot().metadata).toBe(metadata);
    expect(metadata).toEqual({
      documentId: "project-session-test",
      title: "Session study",
      createdAt: "2026-09-11T09:00:00.000Z",
    });
    expect(Object.keys(project.captureSnapshot()).sort()).toEqual(["metadata", "sketchbook"]);
    history.destroy();
  });

  it("does not retain a caller's writable metadata object", () => {
    const initial = createEmptyFolioProject();
    const metadata = { ...initial.metadata };
    const project = new ProjectSession({ metadata, sketchbook: initial.sketchbook });
    metadata.title = "Changed outside the project";
    expect(project.metadata.title).toBe(initial.metadata.title);
  });

  it("keeps project artwork after surface-owned History cleanup", () => {
    const project = createProject();
    const history = createHistory(project);
    history.executePageRename(project.documentSession.activePageId, "Retained study");
    const captured = project.captureSnapshot();
    history.destroy();

    expect(project.captureSnapshot().sketchbook).toBe(captured.sketchbook);
    expect(project.documentSession.activePage.name).toBe("Retained study");
  });

  it("preserves default construction and rejects an invalid initial document", () => {
    const session = new InkDocumentSession();
    expect(session.getDocument()).toBeInstanceOf(SketchbookDocument);
    expect(session.activePageId).toBe("page-1");
    expect(session.page.size).toBe(0);
    expect(() => new InkDocumentSession({ initialDocument: {} as SketchbookDocument })).toThrow(
      TypeError,
    );
  });

  it("requires injection and prevents the canvas from constructing or clearing the project session", async () => {
    const source = await readFile(new URL("../CanvasSurface.tsx", import.meta.url), "utf8");
    expect(source).toContain("readonly session: InkDocumentSession");
    expect(source).toContain("const documentSession = session;");
    expect(source).not.toContain("new InkDocumentSession");
    expect(source).not.toContain("documentSession.clear()");
    expect(source).toContain("historyCoordinator?.destroy()");
    expect(source).toContain("controller.destroy()");
  });

  it("keeps workspace creation lazy and forwards the same instance through the host", async () => {
    const [workspace, host] = await Promise.all([
      readFile(
        new URL(
          "../../../../apps/desktop/src/components/editor/EditorWorkspace.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../../../../apps/desktop/src/components/editor/CanvasHost.tsx", import.meta.url),
        "utf8",
      ),
    ]);
    expect(workspace).toContain("useState(() => {");
    expect(workspace).toContain("new ProjectSession(createEmptyFolioProject())");
    expect(workspace).toContain("const projectSession = entry.project;");
    expect(workspace).toContain("session={projectSession.documentSession}");
    expect(host).toContain("session={session}");
    expect(host).not.toContain("new InkDocumentSession");
    expect(host).not.toContain("new ProjectSession");
  });
});
