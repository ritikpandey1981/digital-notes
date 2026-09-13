import { ProjectSession } from "@folio/editor";
import { createEmptyFolioProject, decodeFolioProject } from "@folio/persistence/project";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContinuousPaperColorEdit } from "../../../../../packages/editor/src/ContinuousPaperColorEdit";
import { ContinuousLayerOpacityEdit } from "../../../../../packages/editor/src/ContinuousLayerOpacityEdit";
import { createEditorHistoryCoordinator } from "../../../../../packages/editor/src/history/editor-history-coordinator";
import type {
  ProjectSaveRequest,
  ProjectSaveResult,
} from "../../../electron/project-save-contract";
import { ProjectPersistenceCoordinator } from "../project-persistence-coordinator";

const BACKING = { id: "00000000-0000-4000-8000-000000000001", displayName: "a.folio" };
const PREVIEW_COLOR = "#ff0000";

afterEach(() => vi.restoreAllMocks());

function setup(options: { settleTimeoutMs?: number } = {}) {
  const project = new ProjectSession(
    createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" }),
  );
  const written: string[] = [];
  const save = vi.fn<(request: ProjectSaveRequest) => Promise<ProjectSaveResult>>(
    async (request) => {
      written.push(request.content);
      return { status: "saved", backing: BACKING };
    },
  );
  const persistence = new ProjectPersistenceCoordinator(
    project,
    { save },
    undefined,
    undefined,
    undefined,
    options.settleTimeoutMs,
  );
  const editor = createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    onDocumentChange: () => undefined,
  });
  const paper = new ContinuousPaperColorEdit({
    documentSession: project.documentSession,
    commit: (pageId, color) => editor.executePagePaper(pageId, { color }),
    onPreviewDocumentChange: () => undefined,
  });
  const opacity = new ContinuousLayerOpacityEdit({
    documentSession: project.documentSession,
    commit: (layerId, value) =>
      editor.executeLayerPatch(layerId, { opacity: value }) ?? editor.controller.getHistoryState(),
    onPreviewDocumentChange: () => undefined,
  });
  return {
    project,
    persistence,
    editor,
    paper,
    opacity,
    save,
    /** The paper colour the disk actually received. */
    savedPaperColor: () =>
      decodeFolioProject(written.at(-1) ?? "{}").sketchbook.firstPage.paper.color,
    savedObjectCount: () =>
      decodeFolioProject(written.at(-1) ?? "{}").sketchbook.firstPage.content.size,
    livePaperColor: () => project.documentSession.sketchbook.firstPage.paper.color,
    pageId: () => project.documentSession.activePageId,
    cleanup: () => editor.destroy(),
  };
}

describe("what a manual save is allowed to capture", () => {
  it("never writes a paper colour the user then abandons", async () => {
    const s = setup();
    try {
      const before = s.livePaperColor();
      s.paper.begin(s.pageId());
      s.paper.update(PREVIEW_COLOR);
      expect(s.livePaperColor(), "the preview really is on screen").toBe(PREVIEW_COLOR);

      const saving = s.persistence.saveAs();
      // The user lets go of the picker without keeping the colour.
      s.paper.cancel();
      expect(await saving).toMatchObject({ status: "saved" });

      expect(s.livePaperColor()).toBe(before);
      expect(s.savedPaperColor(), "the file must not hold an abandoned preview").toBe(before);
    } finally {
      s.cleanup();
    }
  });

  it("reports a save it could not take rather than writing a half-made change", async () => {
    // A gesture that never ends is not a reason to write what it is showing,
    // and not a reason to wait forever either.
    const s = setup({ settleTimeoutMs: 10 });
    try {
      s.paper.begin(s.pageId());
      s.paper.update(PREVIEW_COLOR);

      expect(await s.persistence.saveAs()).toMatchObject({
        status: "failed",
        error: { code: "BUSY" },
      });
      expect(s.save, "nothing was written at all").not.toHaveBeenCalled();
      expect(s.persistence.shellState.hasConfirmedCheckpoint).toBe(false);
      // The gesture is untouched: neither committed nor cancelled on its behalf.
      expect(s.paper.active).toBe(true);
      expect(s.livePaperColor()).toBe(PREVIEW_COLOR);
    } finally {
      s.paper.cancel();
      s.cleanup();
    }
  });

  it("takes the settled state when a waiting gesture is cancelled by the platform", async () => {
    const s = setup();
    try {
      const before = s.livePaperColor();
      s.paper.begin(s.pageId());
      s.paper.update(PREVIEW_COLOR);

      const saving = s.persistence.saveAs();
      // What a pointercancel does, and what unmounting the surface does.
      s.paper.cancel();
      await saving;

      expect(s.savedPaperColor()).toBe(before);
      expect(s.save).toHaveBeenCalledTimes(1);
    } finally {
      s.cleanup();
    }
  });

  it("writes the colour the user actually kept", async () => {
    const s = setup();
    try {
      s.paper.begin(s.pageId());
      s.paper.update(PREVIEW_COLOR);

      const saving = s.persistence.saveAs();
      s.paper.commit();
      expect(await saving).toMatchObject({ status: "saved" });

      expect(s.livePaperColor()).toBe(PREVIEW_COLOR);
      expect(s.savedPaperColor()).toBe(PREVIEW_COLOR);
    } finally {
      s.cleanup();
    }
  });

  it("never writes a layer opacity the user then abandons", async () => {
    const s = setup();
    try {
      const layerId = s.project.documentSession.page.layers[0]!.id;
      const before = s.project.documentSession.page.layers[0]!.opacity;
      s.opacity.begin(layerId);
      s.opacity.update(0.25);

      const saving = s.persistence.saveAs();
      s.opacity.cancel();
      await saving;

      const saved = decodeFolioProject(s.save.mock.calls.at(-1)![0].content);
      expect(saved.sketchbook.firstPage.content.layers[0]!.opacity).toBe(before);
    } finally {
      s.cleanup();
    }
  });

  it("never writes a change made inside a gesture the user then cancels", async () => {
    const s = setup();
    try {
      s.editor.executeAddLayer();
      const settled = s.project.documentSession.page.layers.length;

      // The shape an eraser gesture has: a transaction held open across pointer
      // events, whose intermediate states are on screen but not yet decided.
      s.editor.controller.beginTransaction({
        id: "erase-strokes-probe",
        timestamp: new Date().toISOString(),
        description: "Erase strokes",
      });
      s.editor.executeRemoveLayer(s.project.documentSession.page.layers[1]!.id);
      expect(s.project.documentSession.page.layers.length).toBe(settled - 1);

      const saving = s.persistence.saveAs();
      s.editor.controller.rollbackTransaction();
      await saving;

      expect(s.project.documentSession.page.layers.length).toBe(settled);
      expect(
        decodeFolioProject(s.save.mock.calls.at(-1)![0].content).sketchbook.firstPage.content.layers
          .length,
        "the file must not hold a rolled-back gesture",
      ).toBe(settled);
    } finally {
      s.cleanup();
    }
  });
});
