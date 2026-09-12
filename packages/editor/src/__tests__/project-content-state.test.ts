import { isVectorObject } from "@folio/document";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { EditorSelectionSet } from "../EditorSelectionSet";
import { ContinuousLayerOpacityEdit } from "../ContinuousLayerOpacityEdit";
import { ContinuousPaperColorEdit } from "../ContinuousPaperColorEdit";
import { ContinuousSelectionStyleEdit } from "../ContinuousSelectionStyleEdit";
import { ContinuousVectorStyleEdit } from "../ContinuousVectorStyleEdit";
import { ProjectSession } from "../project-session";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";

function createProject() {
  return new ProjectSession(
    createEmptyFolioProject({
      documentId: "content-state",
      title: "Content state study",
      createdAt: "2026-09-12T09:00:00.000Z",
      pageId: "first-page",
    }),
  );
}

function createHistory(project: ProjectSession) {
  return createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    onDocumentChange: () => undefined,
  });
}

/** Stands in for a confirmed durable write without involving any platform port. */
function checkpoint(project: ProjectSession) {
  const capture = project.capturePersistenceSnapshot();
  project.confirmDurableCheckpoint(capture.stateId);
  return capture.stateId;
}

function stroke(id: string) {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint({
    x: 4,
    y: 6,
    timestamp: 0,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
  });
  return builder.finalize();
}

/**
 * One live gesture of each family, wired the way CanvasSurface wires them.
 *
 * Previews deliberately write outside History, so their identity behaviour is
 * the part persistence has to get right.
 */
function createContinuousGestures(
  project: ProjectSession,
  history: ReturnType<typeof createHistory>,
) {
  const documentSession = project.documentSession;
  const object = documentSession.createRectangleObject(
    { x: 5, y: 5, width: 40, height: 25 },
    { strokeColor: "#111111", strokeWidth: 2 },
  );
  history.executeObjectCreation(object);
  const paper = new ContinuousPaperColorEdit({
    documentSession,
    commit: (pageId, color) => history.executePagePaper(pageId, { color }, "Change paper color"),
    onPreviewDocumentChange: () => undefined,
  });
  const layerOpacity = new ContinuousLayerOpacityEdit({
    documentSession,
    commit: (layerId, _initial, opacity) =>
      history.executeLayerPatch(layerId, { opacity }, "Set layer opacity") ??
      history.controller.getHistoryState(),
    onPreviewDocumentChange: () => undefined,
  });
  const vectorStyle = new ContinuousVectorStyleEdit({
    documentSession,
    commit: (target, style) => history.executeVectorStyleUpdate(target, style),
    onPreviewDocumentChange: () => undefined,
    isEditable: () => true,
  });
  const selectionStyle = new ContinuousSelectionStyleEdit({
    documentSession,
    commit: (edits) => history.executeSelectionStyleUpdate(edits),
    onPreviewDocumentChange: () => undefined,
    isEditable: () => true,
  });
  const stored = documentSession.page.lookup(object.id);
  if (!isVectorObject(stored)) throw new Error("The gesture fixture lost its vector object.");
  return {
    paper: {
      begin: () => paper.begin(documentSession.activePageId),
      preview: (step: number) => paper.update(step === 0 ? "#fef08a" : "#bfdbfe"),
      commit: () => paper.commit(),
      cancel: () => paper.cancel(),
    },
    "layer opacity": {
      begin: () => layerOpacity.begin(documentSession.activeLayerId),
      preview: (step: number) => layerOpacity.update(step === 0 ? 0.6 : 0.3),
      commit: () => layerOpacity.commit(),
      cancel: () => layerOpacity.cancel(),
    },
    "vector style": {
      begin: () => vectorStyle.begin(stored),
      preview: (step: number) => vectorStyle.update({ strokeWidth: step === 0 ? 6 : 11 }),
      commit: () => vectorStyle.commit(),
      cancel: () => vectorStyle.cancel(),
    },
    "selection style": {
      begin: () => selectionStyle.begin([object.id]),
      preview: (step: number) => selectionStyle.update({ width: step === 0 ? 7 : 13 }),
      commit: () => selectionStyle.commit(),
      cancel: () => selectionStyle.cancel(),
    },
  };
}

type ContinuousGestureName = keyof ReturnType<typeof createContinuousGestures>;

const CONTINUOUS_GESTURES: readonly ContinuousGestureName[] = [
  "paper",
  "layer opacity",
  "vector style",
  "selection style",
];

describe("project content state", () => {
  it("starts an untouched project clean, with no confirmed durable copy", () => {
    const project = createProject();

    expect(project.contentState()).toEqual({
      contentStateId: project.baselineStateId,
      baselineStateId: project.baselineStateId,
      checkpointStateId: null,
      isDirty: false,
      hasConfirmedCheckpoint: false,
    });
    expect(Object.isFrozen(project.contentState())).toBe(true);
    expect(Object.keys(project).sort()).toEqual(["documentSession", "metadata"]);
  });

  it("dirties on a durable edit, cleans on undo back to the checkpoint, and dirties on redo", () => {
    const project = createProject();
    const history = createHistory(project);
    const saved = checkpoint(project);

    history.executePageRename("first-page", "Edited");
    expect(project.isDirty).toBe(true);
    expect(project.contentStateId).not.toBe(saved);

    history.undo();
    expect(project.contentStateId).toBe(saved);
    expect(project.isDirty).toBe(false);

    history.redo();
    expect(project.isDirty).toBe(true);
    history.destroy();
  });

  it("keeps a mid-history save clean at the saved state in both directions", () => {
    const project = createProject();
    const history = createHistory(project);
    const s = project.contentStateId;
    history.executePageRename("first-page", "T");
    const t = project.contentStateId;
    history.executePageRename("first-page", "U");
    const u = project.contentStateId;
    history.undo();

    expect(project.contentStateId).toBe(t);
    expect(checkpoint(project)).toBe(t);
    expect(project.isDirty).toBe(false);

    history.undo();
    expect(project.contentStateId).toBe(s);
    expect(project.isDirty).toBe(true);
    history.redo();
    expect(project.contentStateId).toBe(t);
    expect(project.isDirty).toBe(false);
    history.redo();
    expect(project.contentStateId).toBe(u);
    expect(project.isDirty).toBe(true);
    history.destroy();
  });

  it("gives a branch created after undo a fresh identity while the checkpoint stays reachable", () => {
    const project = createProject();
    const history = createHistory(project);
    history.executePageRename("first-page", "T");
    const t = checkpoint(project);
    history.executePageRename("first-page", "U");
    const u = project.contentStateId;
    history.undo();
    expect(project.isDirty).toBe(false);

    history.executePageRename("first-page", "V");
    const v = project.contentStateId;

    expect(project.isDirty).toBe(true);
    expect(new Set([t, u, v]).size).toBe(3);
    expect(history.controller.getHistoryState().redoDepth).toBe(0);
    history.undo();
    expect(project.contentStateId).toBe(t);
    expect(project.isDirty).toBe(false);
    history.destroy();
  });

  it.each([
    [
      "ink",
      (project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executeStroke(project.documentSession.createStrokeObject(stroke("stroke-1")));
      },
    ],
    [
      "vector object",
      (project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executeObjectCreation(
          project.documentSession.createRectangleObject(
            { x: 2, y: 3, width: 20, height: 30 },
            { strokeColor: "#123456", strokeWidth: 2 },
          ),
        );
      },
    ],
    [
      "page",
      (_project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executeAddPage();
      },
    ],
    [
      "paper",
      (_project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executePagePaper("first-page", { type: "grid", color: "#fefefe" });
      },
    ],
    [
      "layer",
      (_project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executeAddLayer("Study marks");
      },
    ],
    [
      "layer visibility",
      (project: ProjectSession, history: ReturnType<typeof createHistory>) => {
        history.executeLayerPatch(project.documentSession.activeLayerId, {
          visible: false,
          opacity: 0.4,
        });
      },
    ],
  ])("dirties a saved project on a %s mutation and cleans again on undo", (_name, mutate) => {
    const project = createProject();
    const history = createHistory(project);
    const saved = checkpoint(project);

    mutate(project, history);
    expect(project.isDirty).toBe(true);

    history.undo();
    expect(project.contentStateId).toBe(saved);
    expect(project.isDirty).toBe(false);
    history.destroy();
  });

  it("leaves a saved project clean through session-only changes", () => {
    const project = createProject();
    const history = createHistory(project);
    const session = project.documentSession;
    const added = history.executeAddPage();
    const layer = history.executeAddLayer("Second layer");
    const saved = checkpoint(project);
    const selection = new EditorSelectionSet();
    const object = session.createRectangleObject(
      { x: 1, y: 2, width: 10, height: 10 },
      { strokeColor: "#222222", strokeWidth: 1 },
    );

    session.setActivePageId(added.pageId);
    session.setActivePageId("first-page");
    session.setActiveLayerId(layer.layerId);
    session.rememberViewport("first-page", { zoom: 3, position: { x: 5, y: 6 }, mode: "manual" });
    selection.replace([object.id]);
    selection.clear();

    expect(session.activeLayerId).toBe(layer.layerId);
    expect(session.viewportMemory("first-page")?.zoom).toBe(3);
    expect(project.contentStateId).toBe(saved);
    expect(project.isDirty).toBe(false);
    history.destroy();
  });

  it("keeps a saved project clean when a command is refused or fails", () => {
    const project = createProject();
    const history = createHistory(project);
    const saved = checkpoint(project);

    expect(history.executePageRename("first-page", project.documentSession.activePage.name)).toBe(
      null,
    );
    expect(history.executeReorderPage("first-page", 0)).toBe(null);
    expect(() => history.executeRemovePage("first-page")).toThrowError();
    expect(() => history.executeDuplicatePage("missing-page")).toThrowError();

    expect(project.contentStateId).toBe(saved);
    expect(project.isDirty).toBe(false);
    expect(history.controller.getHistoryState().undoDepth).toBe(0);
    history.destroy();
  });

  it("gives two projects independent identities and checkpoints", () => {
    const first = createProject();
    const second = createProject();
    const firstHistory = createHistory(first);
    const secondHistory = createHistory(second);
    checkpoint(first);
    firstHistory.executePageRename("first-page", "Edited first");

    expect(first.isDirty).toBe(true);
    expect(second.isDirty).toBe(false);
    expect(second.hasConfirmedCheckpoint).toBe(false);
    expect(first.contentStateId).not.toBe(second.contentStateId);
    expect(first.baselineStateId).not.toBe(second.baselineStateId);

    secondHistory.executePageRename("first-page", "Edited second");
    expect(second.isDirty).toBe(true);
    expect(second.contentStateId).not.toBe(first.contentStateId);
    firstHistory.destroy();
    secondHistory.destroy();
  });

  it("keeps every identity out of the encoded project file", () => {
    const project = createProject();
    const history = createHistory(project);
    history.executePageRename("first-page", "Encoded");
    history.executeAddLayer("Encoded layer");
    const saved = checkpoint(project);
    history.executeAddPage();
    history.undo();

    const encoded = encodeFolioProject(project.captureSnapshot());
    const envelope = JSON.parse(encoded) as Record<string, unknown>;

    expect(envelope.formatVersion).toBe(1);
    expect(Object.keys(envelope).sort()).toEqual([
      "format",
      "formatVersion",
      "metadata",
      "sketchbook",
    ]);
    for (const identity of [saved, project.contentStateId, project.baselineStateId]) {
      expect(encoded).not.toContain(identity);
    }
    expect(encoded).not.toMatch(/content-\d+-\d+/);
    expect(encoded).toBe(encodeFolioProject(project.capturePersistenceSnapshot().project));
    history.destroy();
  });

  it.each(CONTINUOUS_GESTURES)(
    "leaves a saved project clean when a continuous %s gesture is cancelled",
    (name) => {
      const project = createProject();
      const history = createHistory(project);
      const gesture = createContinuousGestures(project, history)[name];
      const saved = checkpoint(project);

      expect(gesture.begin()).toBe(true);
      gesture.preview(0);
      gesture.preview(1);
      expect(project.isDirty).toBe(true);

      expect(gesture.cancel()).toBe(true);
      expect(project.contentStateId).toBe(saved);
      expect(project.isDirty).toBe(false);
      expect(history.controller.getHistoryState().undoDepth).toBe(1);
      history.destroy();
    },
  );

  it.each(CONTINUOUS_GESTURES)(
    "returns to the checkpoint after undoing a committed continuous %s gesture",
    (name) => {
      const project = createProject();
      const history = createHistory(project);
      const gesture = createContinuousGestures(project, history)[name];
      const saved = checkpoint(project);
      const depth = history.controller.getHistoryState().undoDepth;

      expect(gesture.begin()).toBe(true);
      gesture.preview(0);
      gesture.preview(1);
      expect(gesture.commit()).not.toBeNull();

      expect(history.controller.getHistoryState().undoDepth).toBe(depth + 1);
      expect(project.isDirty).toBe(true);

      history.undo();
      expect(project.contentStateId).toBe(saved);
      expect(project.isDirty).toBe(false);
      history.redo();
      expect(project.isDirty).toBe(true);
      history.destroy();
    },
  );

  it("captures artwork and its identity together and rejects a forged checkpoint", () => {
    const project = createProject();
    const history = createHistory(project);
    const capture = project.capturePersistenceSnapshot();
    history.executePageRename("first-page", "After capture");

    expect(capture.project.sketchbook).not.toBe(project.documentSession.getDocument());
    expect(capture.stateId).not.toBe(project.contentStateId);
    expect(Object.isFrozen(capture)).toBe(true);
    expect(() => project.confirmDurableCheckpoint("" as never)).toThrowError(TypeError);

    project.confirmDurableCheckpoint(capture.stateId);
    expect(project.isDirty).toBe(true);
    history.undo();
    expect(project.isDirty).toBe(false);
    history.destroy();
  });
});
