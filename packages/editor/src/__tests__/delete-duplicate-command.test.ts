import { pageOf, TEST_LAYER_ID } from "./layer-test-support";
import { InkObject, PageDocument, ObjectFactory, Transform } from "@folio/document";
import { createEditorHistoryManager, createHistoryController } from "@folio/history";
import type { HistoryDocumentSession, HistoryNotification } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createDeleteCommand } from "../history/delete-command";
import { createDuplicateCommand } from "../history/duplicate-command";
import { createMoveCommand } from "../history/move-command";
import { createRotateCommand } from "../history/rotate-command";
import { createScaleCommand } from "../history/scale-command";

const T0 = "2026-07-28T10:00:00.000Z";
const T1 = "2026-07-28T10:01:00.000Z";
const T2 = "2026-07-28T10:02:00.000Z";
const T3 = "2026-07-28T10:03:00.000Z";

describe("DeleteCommand", () => {
  it("executes, undoes, and redoes with exact object identity and ordering", () => {
    const initial = collection("a", "b", "c");
    const deleted = ink(initial, "b");
    const command = createDeleteCommand({
      deletedObject: deleted,
      originalInsertionIndex: 1,
      layerId: TEST_LAYER_ID,
      id: "delete-b",
      timestamp: T1,
    });

    const executed = command.execute(initial);
    const undone = command.undo(executed);
    const redone = command.redo(undone);

    expect(ids(initial)).toEqual(["a", "b", "c"]);
    expect(ids(executed)).toEqual(["a", "c"]);
    expect(ids(undone)).toEqual(["a", "b", "c"]);
    expect(ids(redone)).toEqual(["a", "c"]);
    expect(undone.lookup("b")).toBe(deleted);
    expect(Object.isFrozen(command)).toBe(true);
    expect(new Set([initial, executed, undone, redone]).size).toBe(4);
  });

  it.each([
    ["missing", pageOf(), "DELETE_OBJECT_NOT_FOUND"],
    ["hidden", collectionWith({ visible: false }), "DELETE_OBJECT_HIDDEN"],
    ["locked", collectionWith({ locked: true }), "DELETE_OBJECT_LOCKED"],
    ["stale", collectionWith({ modifiedAt: T1 }), "DELETE_OBJECT_STALE"],
  ])("rejects a %s target without changing the document", (_case, document, code) => {
    const source = object("object-1");
    const command = createDeleteCommand({
      deletedObject: source,
      originalInsertionIndex: 0,
      layerId: TEST_LAYER_ID,
      timestamp: T2,
    });
    expect(() => command.execute(document)).toThrowError(expect.objectContaining({ code }));
    expect(ids(document)).toEqual(document.size === 0 ? [] : ["object-1"]);
  });
});

describe("DuplicateCommand", () => {
  it("clones once and reuses the same identity, lifecycle, stroke, and insertion index", () => {
    const initial = collection("a", "b");
    const source = ink(initial, "a");
    const command = createDuplicateCommand({
      sourceObject: source,
      insertionIndex: 1,
      layerId: TEST_LAYER_ID,
      duplicateObjectId: "a-copy",
      id: "duplicate-a",
      timestamp: T1,
    });

    const executed = command.execute(initial);
    const duplicate = ink(executed, "a-copy");
    const undone = command.undo(executed);
    const redone = command.redo(undone);

    expect(ids(executed)).toEqual(["a", "a-copy", "b"]);
    expect(ids(undone)).toEqual(["a", "b"]);
    expect(ids(redone)).toEqual(["a", "a-copy", "b"]);
    expect(command.duplicateObjectId).toBe("a-copy");
    expect(ink(redone, "a-copy")).toBe(duplicate);
    expect(duplicate.stroke).toBe(source.stroke);
    expect(duplicate).toMatchObject({
      id: "a-copy",
      createdAt: T1,
      modifiedAt: T1,
      zIndex: 1,
    });
    expect(Object.isFrozen(command)).toBe(true);
  });

  it("rejects duplicate identity conflicts and stale, hidden, or locked sources", () => {
    const source = object("object-1");
    expect(() =>
      createDuplicateCommand({
        sourceObject: source,
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: source.id,
        timestamp: T1,
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_OBJECT_STATE_MISMATCH" }));

    for (const [document, code] of [
      [collectionWith({ modifiedAt: T1 }), "DUPLICATE_OBJECT_STALE"],
      [collectionWith({ visible: false }), "DUPLICATE_OBJECT_HIDDEN"],
      [collectionWith({ locked: true }), "DUPLICATE_OBJECT_LOCKED"],
    ] as const) {
      const command = createDuplicateCommand({
        sourceObject: source,
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: "copy",
        timestamp: T2,
      });
      expect(() => command.execute(document)).toThrowError(expect.objectContaining({ code }));
    }
  });
});

describe("object lifecycle History integration", () => {
  it.each(["move", "rotate", "scale"] as const)(
    "supports mixed %s then delete histories",
    (kind) => {
      const fixture = session(collection("a", "b"));
      const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
      executeTransform(manager, fixture.current, kind);
      const transformed = ink(fixture.current, "a");
      manager.executeCommand(
        createDeleteCommand({
          deletedObject: transformed,
          originalInsertionIndex: 0,
          layerId: TEST_LAYER_ID,
          id: `delete-after-${kind}`,
          timestamp: T2,
        }),
      );
      expect(ids(fixture.current)).toEqual(["b"]);
      manager.undo();
      expect(ids(fixture.current)).toEqual(["a", "b"]);
      expect(ink(fixture.current, "a").modifiedAt).toBe(T1);
      manager.undo();
      expect(ink(fixture.current, "a").transform).toEqual(Transform.identity());
      manager.redo();
      manager.redo();
      expect(ids(fixture.current)).toEqual(["b"]);
    },
  );

  it.each(["move", "rotate", "scale"] as const)(
    "supports mixed %s then duplicate histories",
    (kind) => {
      const fixture = session(collection("a", "b"));
      const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
      executeTransform(manager, fixture.current, kind);
      const transformed = ink(fixture.current, "a");
      manager.executeCommand(
        createDuplicateCommand({
          sourceObject: transformed,
          insertionIndex: 1,
          layerId: TEST_LAYER_ID,
          duplicateObjectId: `${kind}-copy`,
          id: `duplicate-after-${kind}`,
          timestamp: T2,
        }),
      );
      expect(ids(fixture.current)).toEqual(["a", `${kind}-copy`, "b"]);
      expect(ink(fixture.current, `${kind}-copy`).transform).toEqual(transformed.transform);
      manager.undo();
      manager.undo();
      expect(ids(fixture.current)).toEqual(["a", "b"]);
      expect(ink(fixture.current, "a").transform).toEqual(Transform.identity());
      manager.redo();
      manager.redo();
      expect(ids(fixture.current)).toEqual(["a", `${kind}-copy`, "b"]);
    },
  );

  it("supports delete then duplicate and duplicate then delete without order drift", () => {
    const first = session(collection("a", "b"));
    const firstManager = createEditorHistoryManager({ documentSession: first.documentSession });
    firstManager.executeCommand(
      createDeleteCommand({
        deletedObject: ink(first.current, "a"),
        originalInsertionIndex: 0,
        layerId: TEST_LAYER_ID,
        timestamp: T1,
      }),
    );
    firstManager.executeCommand(
      createDuplicateCommand({
        sourceObject: ink(first.current, "b"),
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: "b-copy",
        timestamp: T2,
      }),
    );
    expect(ids(first.current)).toEqual(["b", "b-copy"]);
    firstManager.undo();
    firstManager.undo();
    expect(ids(first.current)).toEqual(["a", "b"]);

    const second = session(collection("a", "b"));
    const secondManager = createEditorHistoryManager({ documentSession: second.documentSession });
    const duplicate = createDuplicateCommand({
      sourceObject: ink(second.current, "a"),
      insertionIndex: 1,
      layerId: TEST_LAYER_ID,
      duplicateObjectId: "a-copy",
      timestamp: T1,
    });
    secondManager.executeCommand(duplicate);
    secondManager.executeCommand(
      createDeleteCommand({
        deletedObject: ink(second.current, duplicate.duplicateObjectId),
        originalInsertionIndex: 1,
        layerId: TEST_LAYER_ID,
        timestamp: T2,
      }),
    );
    expect(ids(second.current)).toEqual(["a", "b"]);
    secondManager.undo();
    expect(ids(second.current)).toEqual(["a", "a-copy", "b"]);
    secondManager.undo();
    expect(ids(second.current)).toEqual(["a", "b"]);
  });

  it("groups lifecycle commands atomically and preserves notification ordering", () => {
    const fixture = session(collection("a", "b"));
    const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((notification) => notifications.push(notification));
    controller.beginTransaction({ id: "lifecycle", timestamp: T3, description: "Lifecycle" });
    controller.executeCommand(
      createDeleteCommand({
        deletedObject: ink(fixture.current, "a"),
        originalInsertionIndex: 0,
        layerId: TEST_LAYER_ID,
        timestamp: T1,
      }),
    );
    controller.executeCommand(
      createDuplicateCommand({
        sourceObject: ink(fixture.current, "b"),
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: "b-copy",
        timestamp: T2,
      }),
    );
    expect(controller.commitTransaction()).toMatchObject({ undoDepth: 1 });
    expect(ids(fixture.current)).toEqual(["b", "b-copy"]);
    controller.undo();
    expect(ids(fixture.current)).toEqual(["a", "b"]);
    controller.redo();
    expect(ids(fixture.current)).toEqual(["b", "b-copy"]);
    expect(notifications.map(({ operation }) => operation)).toEqual([
      "execute",
      "execute",
      "undo",
      "redo",
    ]);
    controller.destroy();
  });

  it("invalidates redo after a new lifecycle command and supports repeated reversal", () => {
    const fixture = session(collection("a", "b"));
    const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
    manager.executeCommand(
      createDuplicateCommand({
        sourceObject: ink(fixture.current, "a"),
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: "a-copy",
        timestamp: T1,
      }),
    );
    manager.undo();
    expect(manager.canRedo()).toBe(true);
    manager.executeCommand(
      createDeleteCommand({
        deletedObject: ink(fixture.current, "b"),
        originalInsertionIndex: 1,
        layerId: TEST_LAYER_ID,
        timestamp: T2,
      }),
    );
    expect(manager.canRedo()).toBe(false);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      manager.undo();
      expect(ids(fixture.current)).toEqual(["a", "b"]);
      manager.redo();
      expect(ids(fixture.current)).toEqual(["a"]);
    }
  });

  it.each(["move", "rotate", "scale"] as const)(
    "undoes duplication after an undone %s of the duplicate",
    (kind) => {
      const fixture = session(collection("a", "b"));
      const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
      const duplicate = createDuplicateCommand({
        sourceObject: ink(fixture.current, "a"),
        insertionIndex: 1,
        layerId: TEST_LAYER_ID,
        duplicateObjectId: "a-copy",
        timestamp: T1,
      });
      manager.executeCommand(duplicate);
      executeTransform(manager, fixture.current, kind, duplicate.duplicateObjectId, T2);

      manager.undo();
      expect(ids(fixture.current)).toEqual(["a", "a-copy", "b"]);
      manager.undo();
      expect(ids(fixture.current)).toEqual(["a", "b"]);

      manager.redo();
      manager.redo();
      expect(ids(fixture.current)).toEqual(["a", "a-copy", "b"]);
    },
  );

  it("groups duplication and a subsequent duplicate transform atomically", () => {
    const fixture = session(collection("a", "b"));
    const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
    const controller = createHistoryController({ manager });
    const duplicate = createDuplicateCommand({
      sourceObject: ink(fixture.current, "a"),
      insertionIndex: 1,
      layerId: TEST_LAYER_ID,
      duplicateObjectId: "a-copy",
      timestamp: T1,
    });

    controller.beginTransaction({ id: "duplicate-move", timestamp: T3 });
    controller.executeCommand(duplicate);
    executeTransform(controller, fixture.current, "move", duplicate.duplicateObjectId, T2);
    expect(controller.commitTransaction()).toMatchObject({ undoDepth: 1 });
    expect(ink(fixture.current, duplicate.duplicateObjectId).transform.translation).toEqual({
      x: 12,
      y: 8,
    });

    controller.undo();
    expect(ids(fixture.current)).toEqual(["a", "b"]);
    controller.redo();
    expect(ids(fixture.current)).toEqual(["a", "a-copy", "b"]);
    expect(ink(fixture.current, duplicate.duplicateObjectId).transform.translation).toEqual({
      x: 12,
      y: 8,
    });
    controller.destroy();
  });
});

function executeTransform(
  manager: Pick<ReturnType<typeof createEditorHistoryManager<PageDocument>>, "executeCommand">,
  document: PageDocument,
  kind: "move" | "rotate" | "scale",
  objectId = "a",
  timestamp = T1,
): void {
  const source = ink(document, objectId);
  if (kind === "move") {
    manager.executeCommand(
      createMoveCommand({
        objectId: source.id,
        expectedObjectModifiedAt: source.modifiedAt,
        initialTranslation: source.transform.translation,
        finalTranslation: { x: 12, y: 8 },
        timestamp,
      }),
    );
  } else if (kind === "rotate") {
    manager.executeCommand(
      createRotateCommand({
        objectId: source.id,
        expectedObjectModifiedAt: source.modifiedAt,
        initialRotation: source.transform.rotation,
        finalRotation: Math.PI / 4,
        timestamp,
      }),
    );
  } else {
    manager.executeCommand(
      createScaleCommand({
        objectId: source.id,
        expectedObjectModifiedAt: source.modifiedAt,
        initialScale: source.transform.scale,
        finalScale: 2,
        timestamp,
      }),
    );
  }
}

function collection(...objectIds: string[]): PageDocument {
  return pageOf(objectIds.map((id, index) => object(id, { zIndex: index })));
}

function collectionWith(options: Parameters<typeof object>[1]): PageDocument {
  return pageOf([object("object-1", options)]);
}

function object(
  id: string,
  options: Partial<{
    zIndex: number;
    modifiedAt: string;
    visible: boolean;
    locked: boolean;
  }> = {},
): InkObject {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint({
    x: 10,
    y: 20,
    timestamp: 0,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  });
  return new ObjectFactory().createInkObject({
    id,
    stroke: builder.finalize(),
    createdAt: T0,
    modifiedAt: options.modifiedAt ?? T0,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    zIndex: options.zIndex ?? 0,
  });
}

function ids(document: PageDocument): string[] {
  return document.objects.objects.map(({ id }) => id);
}

function ink(document: PageDocument, id: string): InkObject {
  const value = document.lookup(id);
  expect(value).toBeInstanceOf(InkObject);
  return value as InkObject;
}

function session(initial: PageDocument): {
  current: PageDocument;
  readonly documentSession: HistoryDocumentSession<PageDocument>;
} {
  const fixture = {
    current: initial,
    documentSession: undefined as unknown as HistoryDocumentSession<PageDocument>,
  };
  fixture.documentSession = {
    getDocument: () => fixture.current,
    replaceDocument: (document) => {
      fixture.current = document;
    },
  };
  return fixture;
}
