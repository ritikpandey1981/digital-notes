import { DEFAULT_PAPER_COLOR, InkObject, SketchbookDocument } from "@folio/document";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEditorHistoryCoordinator,
  resolveHistoryPageContext,
} from "../history/editor-history-coordinator";
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

function createCoordinator(session: InkDocumentSession, historyLimit?: number) {
  let tick = 0;
  return createEditorHistoryCoordinator({
    documentSession: session,
    now: () => new Date(Date.parse(TIMESTAMP) + (tick += 1)).toISOString(),
    onDocumentChange: () => undefined,
    ...(historyLimit === undefined ? {} : { historyLimit }),
  });
}

function createPageAwareCoordinator(session: InkDocumentSession, historyLimit?: number) {
  let tick = 0;
  const coordinator = createEditorHistoryCoordinator({
    documentSession: session,
    now: () => new Date(Date.parse(TIMESTAMP) + (tick += 1)).toISOString(),
    onDocumentChange: () => undefined,
    onHistoryChange: (notification) => {
      if (
        notification.outcome !== "succeeded" ||
        (notification.operation !== "undo" && notification.operation !== "redo")
      ) {
        return;
      }
      const target = resolveHistoryPageContext(
        coordinator.pageContextForCommand(notification.command.id),
        session.sketchbook,
      );
      if (target !== null) session.setActivePageId(target);
    },
    ...(historyLimit === undefined ? {} : { historyLimit }),
  });
  return coordinator;
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

  it("starts as one A4 landscape page with one layer", () => {
    expect(session.sketchbook).toBeInstanceOf(SketchbookDocument);
    expect(session.sketchbook.pageCount).toBe(1);
    expect(session.geometry).toEqual({ width: 1123, height: 794 });
    expect(session.activePage.orientation).toBe("landscape");
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

  it("restores immutable paper presentation through exact Undo and Redo", () => {
    const pageId = session.activePageId;
    const original = session.activePage;
    coordinator.executePagePaper(pageId, { type: "grid", color: "#fbf3e0" });
    const changed = session.activePage;

    expect(changed).not.toBe(original);
    expect(changed.paper).toMatchObject({ type: "grid", color: "#fbf3e0" });
    coordinator.undo();
    expect(session.activePage).not.toBe(changed);
    expect(session.paper).toEqual({ type: "blank", color: DEFAULT_PAPER_COLOR });
    const restored = session.activePage;
    coordinator.redo();
    expect(session.activePage).not.toBe(restored);
    expect(session.paper).toMatchObject({ type: "grid", color: "#fbf3e0" });
  });

  it.each(["grid", "ruled"] as const)(
    "adds a blank default-color page from %s while preserving geometry and duplicate semantics",
    (paperType) => {
      const sourceId = session.activePageId;
      coordinator.executePageGeometry(sourceId, { width: 900, height: 700 });
      coordinator.executePagePaper(sourceId, { type: paperType, color: "#fbf3e0" });
      rectangleOn(session, coordinator);
      const beforeAdd = depth();

      const { pageId: addedId } = coordinator.executeAddPage();
      const added = session.sketchbook.requirePage(addedId);
      expect(depth()).toBe(beforeAdd + 1);
      expect(added.geometry).toEqual({ width: 900, height: 700 });
      expect(added.paper).toEqual({ type: "blank", color: DEFAULT_PAPER_COLOR });
      expect(added.content.layerCount).toBe(1);
      expect(added.content.bottomLayer.name).toBe("Layer 1");
      expect(added.objectCount).toBe(0);

      const { pageId: copyId } = coordinator.executeDuplicatePage(sourceId);
      const source = session.sketchbook.requirePage(sourceId);
      const copy = session.sketchbook.requirePage(copyId);
      expect(copy.geometry).toEqual(source.geometry);
      expect(copy.paper).toEqual(source.paper);
      expect(copy.content.layerCount).toBe(source.content.layerCount);
      expect(copy.objectCount).toBe(source.objectCount);
    },
  );

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
    expect(session.geometry).toEqual({ width: 1123, height: 794 });
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
      coordinator.executePageGeometry(session.activePageId, { width: 1123, height: 794 }),
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

  it("associates every page command family with its affected page", () => {
    const first = session.activePageId;
    const commandPage = (): string | null => {
      const id = coordinator.controller.getHistoryState().lastCommand?.id;
      return id === undefined ? null : coordinator.pageForCommand(id);
    };

    coordinator.executePagePaper(first, { type: "grid" });
    expect(commandPage(), "paper").toBe(first);
    coordinator.executePageGeometry(first, { width: 900, height: 700 });
    expect(commandPage(), "geometry").toBe(first);
    coordinator.executePageRename(first, "First");
    expect(commandPage(), "rename").toBe(first);

    const { pageId: added } = coordinator.executeAddPage();
    expect(commandPage(), "add").toBe(added);
    expect(
      coordinator.pageContextForCommand(coordinator.controller.getHistoryState().lastCommand!.id),
    ).toMatchObject({ pageId: added, fallbackPageId: first });
    const { pageId: duplicate } = coordinator.executeDuplicatePage(first);
    expect(commandPage(), "duplicate").toBe(duplicate);
    expect(
      coordinator.pageContextForCommand(coordinator.controller.getHistoryState().lastCommand!.id),
    ).toMatchObject({ pageId: duplicate, fallbackPageId: first });
    coordinator.executeReorderPage(duplicate, 0);
    expect(commandPage(), "reorder").toBe(duplicate);
    coordinator.executeRemovePage(duplicate);
    expect(commandPage(), "remove").toBe(duplicate);
    expect(
      coordinator.pageContextForCommand(coordinator.controller.getHistoryState().lastCommand!.id),
    ).toMatchObject({ pageId: duplicate, fallbackPageId: first });

    session.setActivePageId(added);
    rectangleOn(session, coordinator);
    expect(commandPage(), "artwork").toBe(added);
  });

  it.each([
    {
      family: "paper",
      execute: (active: ReturnType<typeof createEditorHistoryCoordinator>, pageId: string) =>
        active.executePagePaper(pageId, { type: "grid" }),
      read: (active: InkDocumentSession, pageId: string) =>
        active.sketchbook.requirePage(pageId).paper.type,
      before: "blank",
      after: "grid",
    },
    {
      family: "geometry",
      execute: (active: ReturnType<typeof createEditorHistoryCoordinator>, pageId: string) =>
        active.executePageGeometry(pageId, { width: 900, height: 700 }),
      read: (active: InkDocumentSession, pageId: string) =>
        active.sketchbook.requirePage(pageId).geometry.width,
      before: 1123,
      after: 900,
    },
    {
      family: "rename",
      execute: (active: ReturnType<typeof createEditorHistoryCoordinator>, pageId: string) =>
        active.executePageRename(pageId, "Studies"),
      read: (active: InkDocumentSession, pageId: string) =>
        active.sketchbook.requirePage(pageId).name,
      before: "",
      after: "Studies",
    },
  ])(
    "restores cross-page context for $family Undo and Redo",
    ({ execute, read, before, after }) => {
      const activeSession = createSession();
      const activeCoordinator = createPageAwareCoordinator(activeSession);
      const first = activeSession.activePageId;
      const { pageId: second } = activeCoordinator.executeAddPage();
      activeSession.setActivePageId(first);
      execute(activeCoordinator, first);
      const depthAfterCommand = activeCoordinator.controller.getHistoryState().undoDepth;
      activeSession.setActivePageId(second);

      activeCoordinator.undo();
      expect(read(activeSession, first)).toBe(before);
      expect(activeSession.activePageId).toBe(first);
      expect(activeCoordinator.controller.getHistoryState().undoDepth).toBe(depthAfterCommand - 1);

      activeCoordinator.redo();
      expect(read(activeSession, first)).toBe(after);
      expect(activeSession.activePageId).toBe(first);
      expect(activeCoordinator.controller.getHistoryState().undoDepth).toBe(depthAfterCommand);
    },
  );

  it("restores cross-page context for artwork without changing its command path", () => {
    const activeSession = createSession();
    const activeCoordinator = createPageAwareCoordinator(activeSession);
    const first = activeSession.activePageId;
    const { pageId: second } = activeCoordinator.executeAddPage();
    activeSession.setActivePageId(first);
    const object = rectangleOn(activeSession, activeCoordinator);
    activeSession.setActivePageId(second);

    activeCoordinator.undo();
    expect(activeSession.sketchbook.requirePage(first).content.lookup(object.id)).toBeUndefined();
    expect(activeSession.activePageId).toBe(first);
    activeCoordinator.redo();
    expect(activeSession.sketchbook.requirePage(first).content.lookup(object.id)).toBeDefined();
    expect(activeSession.activePageId).toBe(first);
  });

  it("uses source and created-page contexts for Add and Duplicate", () => {
    const addSession = createSession();
    const addCoordinator = createPageAwareCoordinator(addSession);
    const addSource = addSession.activePageId;
    const { pageId: added } = addCoordinator.executeAddPage();
    addSession.setActivePageId(addSource);
    addCoordinator.undo();
    expect(addSession.sketchbook.page(added)).toBeUndefined();
    expect(addSession.activePageId).toBe(addSource);
    addCoordinator.redo();
    expect(addSession.sketchbook.page(added)).toBeDefined();
    expect(addSession.activePageId).toBe(added);

    const duplicateSession = createSession();
    const duplicateCoordinator = createPageAwareCoordinator(duplicateSession);
    const source = duplicateSession.activePageId;
    const { pageId: elsewhere } = duplicateCoordinator.executeAddPage();
    duplicateSession.setActivePageId(source);
    const { pageId: duplicate } = duplicateCoordinator.executeDuplicatePage(source);
    duplicateSession.setActivePageId(elsewhere);
    duplicateCoordinator.undo();
    expect(duplicateSession.sketchbook.page(duplicate)).toBeUndefined();
    expect(duplicateSession.activePageId).toBe(source);
    duplicateCoordinator.redo();
    expect(duplicateSession.sketchbook.page(duplicate)).toBeDefined();
    expect(duplicateSession.activePageId).toBe(duplicate);
  });

  it("restores the moved page context for Reorder", () => {
    const activeSession = createSession();
    const activeCoordinator = createPageAwareCoordinator(activeSession);
    const first = activeSession.activePageId;
    const { pageId: second } = activeCoordinator.executeAddPage();
    activeSession.setActivePageId(second);
    const { pageId: third } = activeCoordinator.executeAddPage();
    activeCoordinator.executeReorderPage(second, 2);
    activeSession.setActivePageId(first);

    activeCoordinator.undo();
    expect(activeSession.sketchbook.pages.map(({ id }) => id)).toEqual([first, second, third]);
    expect(activeSession.activePageId).toBe(second);
    activeCoordinator.redo();
    expect(activeSession.sketchbook.pages.map(({ id }) => id)).toEqual([first, third, second]);
    expect(activeSession.activePageId).toBe(second);
  });

  it("activates a restored removed page and its surviving neighbor on Redo", () => {
    const activeSession = createSession();
    const activeCoordinator = createPageAwareCoordinator(activeSession);
    const first = activeSession.activePageId;
    const { pageId: removed } = activeCoordinator.executeAddPage();
    activeSession.setActivePageId(removed);
    const { pageId: next } = activeCoordinator.executeAddPage();
    activeCoordinator.executeRemovePage(removed);
    activeSession.setActivePageId(first);

    activeCoordinator.undo();
    expect(activeSession.sketchbook.page(removed)).toBeDefined();
    expect(activeSession.activePageId).toBe(removed);
    activeCoordinator.redo();
    expect(activeSession.sketchbook.page(removed)).toBeUndefined();
    expect(activeSession.activePageId).toBe(next);
  });

  it("prunes page metadata on redo invalidation, capacity eviction, clear, and destroy", () => {
    coordinator.destroy();
    coordinator = createPageAwareCoordinator(session, 2);
    const first = session.activePageId;
    const { pageId: second } = coordinator.executeAddPage();
    session.setActivePageId(first);

    coordinator.executePageRename(first, "A");
    const commandA = coordinator.controller.getHistoryState().lastCommand!.id;
    coordinator.executePageRename(first, "B");
    const commandB = coordinator.controller.getHistoryState().lastCommand!.id;
    coordinator.undo();
    coordinator.executePageRename(first, "C");
    const commandC = coordinator.controller.getHistoryState().lastCommand!.id;

    expect(coordinator.pageForCommand(commandB), "discarded redo branch").toBeNull();
    coordinator.executePageRename(first, "D");
    const commandD = coordinator.controller.getHistoryState().lastCommand!.id;
    expect(coordinator.pageForCommand(commandA), "capacity-evicted command").toBeNull();
    expect(coordinator.pageForCommand(commandC)).toBe(first);
    expect(coordinator.pageForCommand(commandD)).toBe(first);

    session.setActivePageId(second);
    coordinator.undo();
    expect(session.activePageId, "retained metadata still restores context after eviction").toBe(
      first,
    );
    coordinator.redo();
    expect(session.activePageId).toBe(first);

    coordinator.controller.clearHistory();
    expect(coordinator.pageForCommand(commandC), "cleared command").toBeNull();
    expect(coordinator.pageForCommand(commandD), "cleared command").toBeNull();

    coordinator.executePageRename(first, "E");
    const commandE = coordinator.controller.getHistoryState().lastCommand!.id;
    coordinator.destroy();
    expect(coordinator.pageForCommand(commandE), "destroyed coordinator").toBeNull();
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

    expect(session.sketchbook.pageCount).toBe(21);
    expect(session.sketchbook.pages.filter((page) => page.objectCount === 1_000)).toHaveLength(2);

    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") expect(switchMilliseconds).toBeLessThan(60);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
      expect(duplicateMilliseconds).toBeLessThan(3_000);
    console.info("Phase 21 page performance (ms)", {
      switchMilliseconds,
      duplicateMilliseconds,
      pages: 20,
      objectsOnFirstPage: 1_000,
    });
  }, 60_000);
});
