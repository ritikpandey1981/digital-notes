import { describe, expect, it, vi } from "vitest";
import { ContinuousPaperColorEdit } from "../ContinuousPaperColorEdit";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const TIMESTAMP = "2026-09-03T00:00:00.000Z";

function harness() {
  let pageOrdinal = 1;
  const session = new InkDocumentSession({
    createPageId: () => `page-${(pageOrdinal += 1)}`,
  });
  let tick = 0;
  const coordinator = createEditorHistoryCoordinator({
    documentSession: session,
    now: () => new Date(Date.parse(TIMESTAMP) + (tick += 1)).toISOString(),
    onDocumentChange: () => undefined,
  });
  const preview = vi.fn();
  const edit = new ContinuousPaperColorEdit({
    documentSession: session,
    commit: (pageId, finalColor) =>
      coordinator.executePagePaper(pageId, { color: finalColor }, "Change paper color"),
    onPreviewDocumentChange: preview,
  });
  return {
    session,
    coordinator,
    edit,
    preview,
    depth: () => coordinator.controller.getHistoryState().undoDepth,
  };
}

describe("ContinuousPaperColorEdit", () => {
  it("collapses many previews into exactly one undoable History operation", () => {
    const { session, coordinator, edit, preview, depth } = harness();
    const pageId = session.activePageId;
    const original = session.paper.color;

    expect(edit.begin(pageId)).toBe(true);
    expect(edit.active).toBe(true);
    expect(edit.update("#fef3c7")).toBe(true);
    expect(edit.update("#dbeafe")).toBe(true);
    expect(edit.update("#dbeafe")).toBe(false);
    expect(session.paper.color).toBe("#dbeafe");
    expect(depth(), "previews stay outside History").toBe(0);

    expect(edit.commit()).not.toBeNull();
    expect(edit.active).toBe(false);
    expect(session.paper.color).toBe("#dbeafe");
    expect(depth()).toBe(1);
    expect(edit.commit(), "a second resolver cannot double-commit").toBeNull();
    expect(depth()).toBe(1);
    expect(preview).toHaveBeenCalledTimes(3);

    coordinator.undo();
    expect(session.paper.color).toBe(original);
    coordinator.redo();
    expect(session.paper.color).toBe("#dbeafe");
  });

  it("cancels exactly once, restores the original, and supports a subsequent edit", () => {
    const { session, edit, depth } = harness();
    const pageId = session.activePageId;
    const original = session.paper.color;

    edit.begin(pageId);
    edit.update("#fee2e2");
    expect(edit.cancel()).toBe(true);
    expect(edit.cancel(), "a second resolver cannot double-cancel").toBe(false);
    expect(session.paper.color).toBe(original);
    expect(depth()).toBe(0);

    expect(edit.begin(pageId)).toBe(true);
    expect(edit.update("#dcfce7")).toBe(true);
    expect(edit.commit()).not.toBeNull();
    expect(session.paper.color).toBe("#dcfce7");
    expect(depth()).toBe(1);
  });

  it("restores the edited page by identity after session navigation", () => {
    const { session, coordinator, edit, depth } = harness();
    const first = session.activePageId;
    const original = session.paper.color;
    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(first);
    const depthBefore = depth();

    edit.begin(first);
    edit.update("#ede9fe");
    session.setActivePageId(second);
    expect(edit.cancel()).toBe(true);

    expect(session.activePageId).toBe(second);
    expect(session.sketchbook.requirePage(first).paper.color).toBe(original);
    expect(depth()).toBe(depthBefore);
  });

  it("cancels the prior transaction before beginning another page", () => {
    const { session, coordinator, edit, depth } = harness();
    const first = session.activePageId;
    const firstOriginal = session.paper.color;
    const { pageId: second } = coordinator.executeAddPage();

    edit.begin(first);
    edit.update("#fce7f3");
    expect(edit.begin(second)).toBe(true);
    expect(session.sketchbook.requirePage(first).paper.color).toBe(firstOriginal);
    expect(edit.activePageId).toBe(second);
    expect(depth()).toBe(1);
  });
});
