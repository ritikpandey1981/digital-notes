import { InkObject, SketchbookDocument } from "@folio/document";
import { beforeEach, describe, expect, it } from "vitest";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const TIMESTAMP = "2026-08-26T09:00:00.000Z";

function createSession(): InkDocumentSession {
  let objects = 0;
  let pages = 0;
  let layers = 0;
  return new InkDocumentSession({
    createId: () => `object-${(objects += 1)}`,
    createPageId: () => `page-${(pages += 2)}`,
    createLayerId: () => `layer-${(layers += 2)}`,
    now: () => TIMESTAMP,
  });
}

function createCoordinator(session: InkDocumentSession) {
  let tick = 0;
  return createEditorHistoryCoordinator({
    documentSession: session,
    now: () => new Date(Date.parse(TIMESTAMP) + (tick += 1)).toISOString(),
    onDocumentChange: () => undefined,
  });
}

function rectangleOn(
  session: InkDocumentSession,
  coordinator: ReturnType<typeof createCoordinator>,
) {
  const object = session.createRectangleObject(
    { x: 10, y: 10, width: 40, height: 40 },
    { strokeColor: "#111111", strokeWidth: 2 },
  );
  coordinator.executeObjectCreation(object);
  return object;
}

describe("Phase 21 page History", () => {
  let session: InkDocumentSession;
  let coordinator: ReturnType<typeof createCoordinator>;
  const depth = () => coordinator.controller.getHistoryState().undoDepth;

  beforeEach(() => {
    session = createSession();
    coordinator = createCoordinator(session);
  });

  it("starts as one A4 portrait page with one layer", () => {
    expect(session.sketchbook).toBeInstanceOf(SketchbookDocument);
    expect(session.sketchbook.pageCount).toBe(1);
    expect(session.geometry).toEqual({ width: 794, height: 1123 });
    expect(session.activePage.orientation).toBe("portrait");
    expect(session.paper.type).toBe("blank");
    expect(session.page.layerCount).toBe(1);
  });

  it("records exactly one History entry per page structural action", () => {
    const before = depth();
    coordinator.executePageGeometry(session.activePageId, { width: 559, height: 794 });
    expect(depth()).toBe(before + 1);
    coordinator.executePagePaper(session.activePageId, { type: "grid" });
    expect(depth()).toBe(before + 2);
    coordinator.executePagePaper(session.activePageId, { color: "#ffffff" });
    expect(depth()).toBe(before + 3);
    const added = coordinator.executeAddPage();
    expect(depth()).toBe(before + 4);
    coordinator.executeDuplicatePage(added.pageId);
    expect(depth()).toBe(before + 5);
    coordinator.executeReorderPage(added.pageId, 0);
    expect(depth()).toBe(before + 6);
    coordinator.executeRemovePage(added.pageId);
    expect(depth()).toBe(before + 7);
  });

  it("records zero History for active page and per-page active layer switching", () => {
    const { pageId } = coordinator.executeAddPage();
    const before = depth();

    expect(session.setActivePageId(pageId)).toBe(true);
    expect(session.setActivePageId(pageId)).toBe(false);
    expect(session.setActivePageId("missing")).toBe(false);
    const { layerId } = coordinator.executeAddLayer();
    const afterLayerAdd = depth();
    expect(session.setActiveLayerId(layerId)).toBe(true);
    session.setActivePageId(session.sketchbook.firstPage.id);
    session.setActivePageId(pageId);

    expect(depth()).toBe(afterLayerAdd);
    expect(afterLayerAdd).toBe(before + 1);
  });

  it("remembers each page's active layer independently", () => {
    const first = session.activePageId;
    const { layerId: firstSecondLayer } = coordinator.executeAddLayer();
    session.setActiveLayerId(firstSecondLayer);

    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(second);
    expect(session.activeLayerId).toBe(session.page.bottomLayer.id);

    session.setActivePageId(first);
    expect(session.activeLayerId).toBe(firstSecondLayer);
  });

  it("resizes the page without touching artwork or layer order", () => {
    const object = rectangleOn(session, coordinator);
    const beforeObjects = session.collection.objects;

    coordinator.executePageGeometry(session.activePageId, { width: 400, height: 400 });

    expect(session.geometry).toEqual({ width: 400, height: 400 });
    expect(session.collection.objects).toEqual(beforeObjects);
    expect(session.collection.lookup(object.id)).toBe(object);

    coordinator.undo();
    expect(session.geometry).toEqual({ width: 794, height: 1123 });
    expect(session.collection.lookup(object.id)).toBe(object);
  });

  it("keeps page artwork completely isolated and routes undo to the right page", () => {
    const first = session.activePageId;
    const firstObject = rectangleOn(session, coordinator);

    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(second);
    expect(session.collection.size).toBe(0);
    const secondObject = rectangleOn(session, coordinator);
    expect(session.collection.size).toBe(1);

    // Undo while page 2 is active must not disturb page 1.
    coordinator.undo();
    expect(session.collection.size).toBe(0);
    expect(session.sketchbook.requirePage(first).content.lookup(firstObject.id)).toBe(firstObject);

    // Undo again removes page 2 entirely; the surviving page is untouched.
    coordinator.undo();
    expect(session.sketchbook.pageCount).toBe(1);
    expect(session.sketchbook.requirePage(first).content.lookup(firstObject.id)).toBe(firstObject);

    coordinator.redo();
    expect(session.sketchbook.pageCount).toBe(2);
    coordinator.redo();
    expect(session.sketchbook.requirePage(second).content.lookup(secondObject.id)).toBeDefined();
  });

  it("undoes page creation performed while another page was active", () => {
    const first = session.activePageId;
    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(second);
    const secondObject = rectangleOn(session, coordinator);

    session.setActivePageId(first);
    // The command captured page 2, so undo reaches page 2 even from page 1.
    coordinator.undo();
    expect(session.sketchbook.requirePage(second).content.lookup(secondObject.id)).toBeUndefined();
    expect(session.activePageId).toBe(first);
  });

  it("duplicates a populated page with independent identity and exact appearance", () => {
    const source = session.activePageId;
    rectangleOn(session, coordinator);
    coordinator.executePagePaper(source, { type: "dotted" });
    coordinator.executePageGeometry(source, { width: 900, height: 900 });
    const { layerId } = coordinator.executeAddLayer();
    coordinator.executeLayerPatch(layerId, { opacity: 0.5, visible: false });
    const before = depth();

    const { pageId: copyId } = coordinator.executeDuplicatePage(source);

    expect(depth()).toBe(before + 1);
    const original = session.sketchbook.requirePage(source);
    const copy = session.sketchbook.requirePage(copyId);
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([source, copyId]);
    expect(copy.geometry).toEqual(original.geometry);
    expect(copy.paper).toEqual(original.paper);
    expect(copy.content.layerCount).toBe(original.content.layerCount);
    expect(copy.content.size).toBe(original.content.size);
    expect(copy.content.layers[1]?.opacity).toBe(0.5);
    expect(copy.content.layers[1]?.visible).toBe(false);

    const originalIds = original.content.objects.objects.map((object) => object.id);
    const copyIds = copy.content.objects.objects.map((object) => object.id);
    expect(copyIds.some((id) => originalIds.includes(id))).toBe(false);

    // Editing the duplicate must never reach the source.
    session.setActivePageId(copyId);
    rectangleOn(session, coordinator);
    expect(session.sketchbook.requirePage(copyId).content.size).toBe(2);
    expect(session.sketchbook.requirePage(source).content.size).toBe(1);

    coordinator.undo();
    coordinator.undo();
    expect(session.sketchbook.pageCount).toBe(1);
    coordinator.redo();
    expect(session.sketchbook.requirePage(copyId).content.size).toBe(1);
  });

  it("deletes a middle page, falls back to the next page, and restores it exactly", () => {
    const first = session.activePageId;
    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(second);
    const secondObject = rectangleOn(session, coordinator);
    coordinator.executePagePaper(second, { type: "ruled" });
    const { pageId: third } = coordinator.executeAddPage();
    const orderBefore = session.sketchbook.pages.map((page) => page.id);
    expect(orderBefore).toEqual([first, second, third]);
    const before = depth();

    session.setActivePageId(second);
    const removal = coordinator.executeRemovePage(second);

    expect(removal.nextActivePageId).toBe(third);
    expect(removal.objectCount).toBe(1);
    expect(depth()).toBe(before + 1);
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([first, third]);
    expect(session.sketchbook.requirePage(first).content.size).toBe(0);

    coordinator.undo();
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual(orderBefore);
    const restored = session.sketchbook.requirePage(second);
    expect(restored.content.lookup(secondObject.id)).toBeDefined();
    expect(restored.paper.type).toBe("ruled");

    coordinator.redo();
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([first, third]);
  });

  it("never deletes the final remaining page", () => {
    expect(() => coordinator.executeRemovePage(session.activePageId)).toThrow(
      /final remaining page/u,
    );
  });

  it("reorders pages by identity with exact undo and redo", () => {
    const a = session.activePageId;
    const { pageId: b } = coordinator.executeAddPage();
    session.setActivePageId(b);
    const { pageId: c } = coordinator.executeAddPage();
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([a, b, c]);
    session.setActivePageId(b);

    coordinator.executeReorderPage(b, 2);
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([a, c, b]);
    // Active page follows identity, never index.
    expect(session.activePageId).toBe(b);

    coordinator.undo();
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([a, b, c]);
    expect(session.activePageId).toBe(b);

    coordinator.redo();
    expect(session.sketchbook.pages.map((page) => page.id)).toEqual([a, c, b]);
    expect(coordinator.executeReorderPage(b, 2)).toBeNull();
  });

  it("ignores page changes that would not alter state", () => {
    expect(
      coordinator.executePageGeometry(session.activePageId, { width: 794, height: 1123 }),
    ).toBeNull();
    expect(coordinator.executePagePaper(session.activePageId, { type: "blank" })).toBeNull();
    expect(coordinator.executePageRename(session.activePageId, "")).toBeNull();
  });

  it("renames a page through History", () => {
    const pageId = session.activePageId;
    coordinator.executePageRename(pageId, "  Studies  ");
    expect(session.sketchbook.requirePage(pageId).name).toBe("Studies");
    coordinator.undo();
    expect(session.sketchbook.requirePage(pageId).name).toBe("");
  });

  it("routes new ink into the active page's active layer", () => {
    const { pageId } = coordinator.executeAddPage();
    session.setActivePageId(pageId);
    const object = session.createRectangleObject(
      { x: 5, y: 5, width: 10, height: 10 },
      { strokeColor: "#111111", strokeWidth: 1 },
    );
    coordinator.executeObjectCreation(object);

    expect(session.page.layerIdForObject(object.id)).toBe(session.activeLayerId);
    expect(session.sketchbook.firstPage.content.size).toBe(0);
    expect(
      session.collection.objects.every((current) => current instanceof InkObject === false),
    ).toBe(true);
  });
});

describe("Phase 21 page performance", () => {
  it("switches between 20 pages and duplicates a populated page quickly", () => {
    const session = createSession();
    const coordinator = createCoordinator(session);
    const pageIds = [session.activePageId];
    for (let index = 0; index < 19; index += 1) {
      const { pageId } = coordinator.executeAddPage();
      pageIds.push(pageId);
      session.setActivePageId(pageId);
    }
    expect(session.sketchbook.pageCount).toBe(20);

    session.setActivePageId(pageIds[0]!);
    for (let index = 0; index < 1_000; index += 1) {
      coordinator.executeObjectCreation(
        session.createRectangleObject(
          { x: (index % 30) * 20 + 5, y: Math.floor(index / 30) * 20 + 5, width: 12, height: 12 },
          { strokeColor: "#111111", strokeWidth: 1 },
        ),
      );
    }
    expect(session.collection.size).toBe(1_000);

    const switchStart = performance.now();
    for (const pageId of pageIds) session.setActivePageId(pageId);
    const switchMilliseconds = performance.now() - switchStart;

    session.setActivePageId(pageIds[0]!);
    const duplicateStart = performance.now();
    coordinator.executeDuplicatePage(pageIds[0]!);
    const duplicateMilliseconds = performance.now() - duplicateStart;

    expect(switchMilliseconds).toBeLessThan(60);
    expect(duplicateMilliseconds).toBeLessThan(3_000);
    console.info("Phase 21 page performance (ms)", {
      switchMilliseconds,
      duplicateMilliseconds,
      pages: 20,
      objectsOnFirstPage: 1_000,
    });
  }, 60_000);
});
