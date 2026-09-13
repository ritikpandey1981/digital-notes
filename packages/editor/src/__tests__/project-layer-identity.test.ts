import { describe, expect, it } from "vitest";
import { createEmptyFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { decodeFolioProject } from "@folio/persistence/project";
import { InkDocumentSession } from "../InkDocumentSession";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import type { SketchbookDocument } from "@folio/document";

function layerIds(document: SketchbookDocument): string[] {
  return document.pages.flatMap((page) => page.content.layers.map((layer) => layer.id));
}

function setup() {
  const project = createEmptyFolioProject({ documentId: "A", title: "Study A", pageId: "page-A" });
  const documentSession = new InkDocumentSession({ initialDocument: project.sketchbook });
  const editor = createEditorHistoryCoordinator({
    documentSession,
    onDocumentChange: () => undefined,
  });
  return {
    documentSession,
    editor,
    project: () => ({ metadata: project.metadata, sketchbook: documentSession.getDocument() }),
    ids: () => layerIds(documentSession.getDocument()),
  };
}

describe("layer identity across a whole project", () => {
  it("keeps every layer distinct when two pages each gain layers", () => {
    const s = setup();
    try {
      // One page, one layer, then a second layer on it.
      s.editor.executeAddLayer();
      const second = s.editor.executeAddPage();
      s.documentSession.setActivePageId(second.pageId);
      // The same ordinary action on the second page.
      s.editor.executeAddLayer();
      s.editor.executeAddLayer();

      const ids = s.ids();
      expect(ids).toHaveLength(5);
      // A layer identifies one layer in one project, not one layer on one page.
      expect(new Set(ids).size, `duplicate layer ids: ${ids.join(", ")}`).toBe(ids.length);
    } finally {
      s.editor.destroy();
    }
  });

  it("stays encodable and decodable after ordinary multi-page layer work", () => {
    const s = setup();
    try {
      s.editor.executeAddLayer();
      const second = s.editor.executeAddPage();
      s.documentSession.setActivePageId(second.pageId);
      s.editor.executeAddLayer();

      // The editor must never be able to build a project its own codec rejects.
      const encoded = encodeFolioProject(s.project());
      const decoded = decodeFolioProject(encoded);
      expect(layerIds(decoded.sketchbook)).toEqual(s.ids());
      // A round trip preserves identity exactly; nothing is regenerated.
      expect(encodeFolioProject(decoded)).toBe(encoded);
    } finally {
      s.editor.destroy();
    }
  });

  it("keeps identities unique and stable across undo and redo", () => {
    const s = setup();
    try {
      const second = s.editor.executeAddPage();
      s.documentSession.setActivePageId(second.pageId);
      const added = s.editor.executeAddLayer();
      const afterAdd = s.ids();

      s.editor.undo();
      expect(s.ids()).not.toContain(added.layerId);
      s.editor.redo();
      expect(s.ids()).toEqual(afterAdd);
      expect(new Set(s.ids()).size).toBe(s.ids().length);

      // And adding again after an undo cannot reuse a discarded identity in a
      // way that collides with anything still present.
      s.editor.undo();
      const replacement = s.editor.executeAddLayer();
      expect(new Set(s.ids()).size).toBe(s.ids().length);
      expect(encodeFolioProject(s.project())).toContain(replacement.layerId);
    } finally {
      s.editor.destroy();
    }
  });

  it("keeps duplicated pages distinct from their source", () => {
    const s = setup();
    try {
      s.editor.executeAddLayer();
      const copy = s.editor.executeDuplicatePage(s.documentSession.activePageId);
      expect(copy.pageId).not.toBe("page-A");

      const ids = s.ids();
      expect(new Set(ids).size).toBe(ids.length);
      expect(() => decodeFolioProject(encodeFolioProject(s.project()))).not.toThrow();
    } finally {
      s.editor.destroy();
    }
  });
});
