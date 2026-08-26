import { InkObject } from "@folio/document";
import type { HistoryNotification, IHistoryController } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import {
  createDeleteManipulationResult,
  createDuplicateManipulationResult,
  createManipulationController,
  createManipulationManager,
  type RotationManipulationResult,
  type ScaleManipulationResult,
  type TranslationManipulationResult,
} from "@folio/manipulation";
import { createSelectionManager, type PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import { EditorClipboard } from "../EditorClipboard";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const OBJECT_TIMESTAMP = "2026-07-28T08:00:00.000Z";
const FIRST_MOVE_TIMESTAMP = "2026-07-28T08:01:00.000Z";
const SECOND_MOVE_TIMESTAMP = "2026-07-28T08:02:00.000Z";

describe("EditorHistoryCoordinator", () => {
  it("adapts a translation manipulation result into one immutable History successor", () => {
    const session = createDocumentSession();
    const initial = session.page;
    const source = expectInkObject(session);
    const synchronizedDocuments: (typeof initial)[] = [];
    const notifications: HistoryNotification[] = [];
    const order: string[] = [];
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: (document, notification) => {
        synchronizedDocuments.push(document);
        order.push(`synchronize:${notification.operation}`);
      },
      onHistoryChange: (notification) => {
        notifications.push(notification);
        order.push(`notify:${notification.operation}`);
      },
    });

    const state = coordinator.executeManipulation(
      createTranslationResult("session-1", { x: 0, y: 0 }, { x: 12, y: -8 }),
    );
    const moved = expectInkObject(session);

    expect(state).toMatchObject({ canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 });
    expect(session.collection).not.toBe(initial);
    expect(moved).not.toBe(source);
    expect(moved.id).toBe(source.id);
    expect(moved.stroke).toBe(source.stroke);
    expect(moved.transform.translation).toEqual({ x: 12, y: -8 });
    expect(source.transform.translation).toEqual({ x: 0, y: 0 });
    expect(synchronizedDocuments).toEqual([session.page]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "execute",
      outcome: "succeeded",
      command: { id: "move-session-1" },
    });
    expect(Object.isFrozen(notifications[0])).toBe(true);
    expect(order).toEqual(["synchronize:execute", "notify:execute"]);
    coordinator.destroy();
  });

  it("routes undo and redo through History and resynchronizes identity and bounds", () => {
    const session = createDocumentSession();
    const source = expectInkObject(session);
    const synchronized: Array<{
      readonly document: typeof session.page;
      readonly id: string;
      readonly boundsX: number;
      readonly boundsY: number;
    }> = [];
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: (document) => {
        const object = expectInkObject(session);
        synchronized.push({
          document,
          id: object.id,
          boundsX: object.bounds.x,
          boundsY: object.bounds.y,
        });
      },
    });

    coordinator.executeManipulation(
      createTranslationResult("session-1", { x: 0, y: 0 }, { x: 20, y: 15 }),
    );
    const executed = session.collection;
    coordinator.undo();
    const undone = session.collection;
    coordinator.redo();
    const redone = session.collection;

    expect(new Set([executed, undone, redone]).size).toBe(3);
    expect(synchronized.map(({ id }) => id)).toEqual([source.id, source.id, source.id]);
    expect(synchronized.map(({ boundsX }) => boundsX)).toEqual([
      source.bounds.x + 20,
      source.bounds.x,
      source.bounds.x + 20,
    ]);
    expect(synchronized.map(({ boundsY }) => boundsY)).toEqual([
      source.bounds.y + 15,
      source.bounds.y,
      source.bounds.y + 15,
    ]);
    expect(expectInkObject(session).transform.translation).toEqual({ x: 20, y: 15 });
    expect(coordinator.controller.getHistoryState()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoDepth: 1,
      redoDepth: 0,
      executionCounter: 3,
    });
    coordinator.destroy();
  });

  it("adapts rotation and scale results into independent undoable History commands", () => {
    const timestamps = [FIRST_MOVE_TIMESTAMP, SECOND_MOVE_TIMESTAMP];
    const session = createDocumentSession();
    const notifications: HistoryNotification[] = [];
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => timestamps.shift() ?? SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
      onHistoryChange: (notification) => notifications.push(notification),
    });

    coordinator.executeManipulation(createRotationResult("rotate-1", 0, Math.PI / 2));
    coordinator.executeManipulation(createScaleResult("scale-1", 1, 2));
    expect(expectInkObject(session).transform).toMatchObject({
      rotation: Math.PI / 2,
      scale: 2,
    });
    expect(coordinator.controller.getHistoryState()).toMatchObject({ undoDepth: 2, redoDepth: 0 });
    expect(notifications.map(({ command }) => command?.id)).toEqual([
      "rotate-rotate-1",
      "scale-scale-1",
    ]);

    coordinator.undo();
    expect(expectInkObject(session).transform).toMatchObject({ rotation: Math.PI / 2, scale: 1 });
    coordinator.undo();
    expect(expectInkObject(session).transform).toMatchObject({ rotation: 0, scale: 1 });
    coordinator.redo();
    coordinator.redo();
    expect(expectInkObject(session).transform).toMatchObject({
      rotation: Math.PI / 2,
      scale: 2,
    });
    coordinator.destroy();
  });

  it("adapts duplicate and delete results without exposing lifecycle logic to History", () => {
    const timestamps = [FIRST_MOVE_TIMESTAMP, SECOND_MOVE_TIMESTAMP];
    const session = createDocumentSession();
    const source = expectInkObject(session);
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => timestamps.shift() ?? SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });

    coordinator.executeManipulation(
      createDuplicateManipulationResult({
        objectId: source.id,
        sessionId: "duplicate-1",
        sessionTimestamp: 1,
      }),
    );
    const duplicate = session.collection.objects.find(({ id }) => id !== source.id);
    if (!(duplicate instanceof InkObject)) throw new Error("Expected an immutable duplicate.");
    expect(duplicate.stroke).toBe(source.stroke);
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id, duplicate.id]);

    coordinator.executeManipulation(
      createDeleteManipulationResult({
        objectId: duplicate.id,
        sessionId: "delete-1",
        sessionTimestamp: 2,
      }),
    );
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id]);
    coordinator.undo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id, duplicate.id]);
    coordinator.undo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id]);
    coordinator.redo();
    coordinator.redo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id]);
    expect(coordinator.controller.getHistoryState()).toMatchObject({ undoDepth: 2, redoDepth: 0 });
    coordinator.destroy();
  });

  it("routes each completed stroke through exactly one generic History command", () => {
    const session = new InkDocumentSession({
      createId: () => "object-1",
      now: () => OBJECT_TIMESTAMP,
    });
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      onDocumentChange: () => undefined,
    });
    const object = session.createStrokeObject(createStroke());

    expect(coordinator.executeStroke(object)).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(session.collection.lookup(object.id)).toBe(object);
    coordinator.undo();
    expect(session.collection.size).toBe(0);
    coordinator.redo();
    expect(session.collection.lookup(object.id)).toBe(object);
    coordinator.destroy();
  });

  it("restores 100 immutable brush snapshots through repeated Undo and Redo", () => {
    let objectIndex = 0;
    const session = new InkDocumentSession({
      createId: () => `stress-object-${++objectIndex}`,
      now: () => OBJECT_TIMESTAMP,
    });
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      onDocumentChange: () => undefined,
    });
    const objects = Array.from({ length: 100 }, (_, index) =>
      session.createStrokeObject(createStroke(`stress-stroke-${index}`)),
    );

    for (const object of objects) coordinator.executeStroke(object);
    expect(session.collection.size).toBe(100);
    expect(coordinator.controller.getHistoryState()).toMatchObject({
      undoDepth: 100,
      redoDepth: 0,
    });

    for (let index = 0; index < objects.length; index += 1) coordinator.undo();
    expect(session.collection.size).toBe(0);
    for (let index = 0; index < objects.length; index += 1) coordinator.redo();

    expect(session.collection.objects).toHaveLength(100);
    for (const original of objects) {
      const restored = session.collection.lookup(original.id);
      expect(restored).toBeInstanceOf(InkObject);
      expect((restored as InkObject).stroke).toBe(original.stroke);
      expect((restored as InkObject).stroke.brush).toBe(original.stroke.brush);
    }
    expect(coordinator.controller.getHistoryState()).toMatchObject({
      undoDepth: 100,
      redoDepth: 0,
      executionCounter: 300,
    });
    coordinator.destroy();
  });

  it("groups duplicate creation and its deterministic offset into one undo step", () => {
    const session = createDocumentSession();
    const source = expectInkObject(session);
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });

    const result = coordinator.executeDuplicateWithOffset(
      createDuplicateManipulationResult({
        objectId: source.id,
        sessionId: "duplicate-offset",
        sessionTimestamp: 1,
      }),
      { x: 10, y: 10 },
    );
    const duplicate = session.collection.lookup(result.duplicateObjectId);
    expect(duplicate).toBeInstanceOf(InkObject);
    expect(duplicate?.transform.translation).toEqual({ x: 10, y: 10 });
    expect(result.state).toMatchObject({ undoDepth: 1, redoDepth: 0 });

    coordinator.undo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual([source.id]);
    coordinator.redo();
    expect(session.collection.lookup(result.duplicateObjectId)?.transform.translation).toEqual({
      x: 10,
      y: 10,
    });
    expect(coordinator.controller.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    coordinator.destroy();
  });

  it("groups multi-object paste into one undoable transaction", () => {
    const session = createMultiObjectSession();
    const originals = session.collection.objects;
    let pastedIdentity = 0;
    const clipboard = new EditorClipboard({
      createId: () => `pasted-${++pastedIdentity}`,
      now: () => FIRST_MOVE_TIMESTAMP,
    });
    clipboard.copy(originals);
    const batch = clipboard.preparePaste(session.collection);
    if (batch === null) throw new Error("Expected a paste batch.");
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });

    const state = coordinator.executePaste(batch.objects);

    expect(state).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(session.collection.objects.map(({ id }) => id)).toEqual([
      "object-1",
      "object-2",
      "pasted-1",
      "pasted-2",
    ]);
    coordinator.undo();
    expect(session.collection.objects).toEqual(originals);
    coordinator.redo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual([
      "object-1",
      "object-2",
      "pasted-1",
      "pasted-2",
    ]);
    coordinator.destroy();
  });

  it("groups multi-object delete and duplicate operations into single History entries", () => {
    const session = createMultiObjectSession();
    const originalIds = session.collection.objects.map(({ id }) => id);
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });

    const duplicated = coordinator.executeDuplicatesWithOffset(
      originalIds.map((objectId, index) =>
        createDuplicateManipulationResult({
          objectId,
          sessionId: `duplicate-${index}`,
          sessionTimestamp: index,
        }),
      ),
      { x: 10, y: 10 },
    );
    expect(duplicated.state).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(duplicated.duplicateObjectIds).toHaveLength(2);
    expect(
      duplicated.duplicateObjectIds.map(
        (objectId) => session.collection.lookup(objectId)?.transform.translation,
      ),
    ).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ]);
    coordinator.undo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual(originalIds);
    coordinator.redo();
    expect(session.collection.size).toBe(4);

    const deleted = coordinator.executeDeletions(
      duplicated.duplicateObjectIds.map((objectId, index) =>
        createDeleteManipulationResult({
          objectId,
          sessionId: `delete-${index}`,
          sessionTimestamp: index,
        }),
      ),
    );
    expect(deleted).toMatchObject({ undoDepth: 2, redoDepth: 0 });
    expect(session.collection.objects.map(({ id }) => id)).toEqual(originalIds);
    coordinator.undo();
    expect(session.collection.size).toBe(4);
    coordinator.redo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual(originalIds);
    coordinator.destroy();
  });

  it("executes grouped transform results as one existing History transaction", () => {
    const session = createMultiObjectSession();
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });

    const state = coordinator.executeManipulations(
      [
        createTranslationResult("group-first", { x: 0, y: 0 }, { x: 20, y: 10 }),
        createTranslationResult("group-second", { x: 0, y: 0 }, { x: 20, y: 10 }, "object-2"),
      ],
      { id: "group-move", description: "Move two objects" },
    );

    expect(state).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(session.collection.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 20, y: 10 },
      { x: 20, y: 10 },
    ]);
    coordinator.undo();
    expect(session.collection.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    coordinator.redo();
    expect(session.collection.objects.map(({ transform }) => transform.translation)).toEqual([
      { x: 20, y: 10 },
      { x: 20, y: 10 },
    ]);
    coordinator.destroy();
  });

  it("rejects a stale manipulation through History and lets Manipulation cancel", () => {
    let objectTimestamp = OBJECT_TIMESTAMP;
    const session = createDocumentSession(() => objectTimestamp);
    const selected = expectInkObject(session);
    const selection = createSelectionManager({ now: () => 1 });
    selection.selectObject({ objectId: selected.id, objectType: selected.type });
    const notifications: HistoryNotification[] = [];
    const errors: Error[] = [];
    let synchronizationCount = 0;
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: () => {
        synchronizationCount += 1;
      },
      onHistoryChange: (notification) => notifications.push(notification),
    });
    const manipulation = createManipulationController({
      manager: createManipulationManager({
        configuration: { dragThreshold: 0 },
        createSessionId: () => "stale-session",
        now: () => 1,
      }),
      selectionSource: selection,
      objectSource: {
        getObject: (objectId) => session.collection.lookup(objectId),
      },
      onResult: (result) => {
        try {
          coordinator.executeManipulation(result);
          return true;
        } catch (cause) {
          errors.push(cause as Error);
          return false;
        }
      },
    });
    manipulation.beginManipulation(1, pagePoint(0, 0));
    manipulation.updateManipulation(1, pagePoint(10, 0));
    objectTimestamp = "2026-07-28T08:00:30.000Z";
    session.translateObject(selected.id, { x: 1, y: 0 });

    const result = manipulation.commitManipulation(1);

    expect(result).toBeNull();
    expect(manipulation.getManipulationState().phase).toBe("idle");
    expect(coordinator.controller.getHistoryState()).toMatchObject({
      canUndo: false,
      undoDepth: 0,
      historyVersion: 0,
    });
    expect(synchronizationCount).toBe(0);
    expect(errors[0]).toMatchObject({ code: "COMMAND_EXECUTION_FAILED" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ operation: "execute", outcome: "failed" });
    manipulation.destroy();
    coordinator.destroy();
  });

  it("keeps MoveCommand grouping atomic through the existing transaction controller", () => {
    const timestamps = [FIRST_MOVE_TIMESTAMP, SECOND_MOVE_TIMESTAMP];
    const session = createDocumentSession();
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => timestamps.shift() ?? SECOND_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const controller = coordinator.controller;
    controller.beginTransaction({
      id: "move-group",
      timestamp: SECOND_MOVE_TIMESTAMP,
      description: "Move twice",
    });
    coordinator.executeManipulation(
      createTranslationResult("session-1", { x: 0, y: 0 }, { x: 10, y: 5 }),
    );
    coordinator.executeManipulation(
      createTranslationResult("session-2", { x: 10, y: 5 }, { x: 20, y: 15 }),
    );

    expect(controller.commitTransaction()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(expectInkObject(session).transform.translation).toEqual({ x: 20, y: 15 });
    controller.undo();
    expect(expectInkObject(session).transform.translation).toEqual({ x: 0, y: 0 });
    controller.redo();
    expect(expectInkObject(session).transform.translation).toEqual({ x: 20, y: 15 });
    coordinator.destroy();
  });

  it("owns one isolated controller and releases it during idempotent cleanup", () => {
    const first = createDocumentSession();
    const second = createDocumentSession();
    const firstCoordinator = createEditorHistoryCoordinator({
      documentSession: first,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const secondCoordinator = createEditorHistoryCoordinator({
      documentSession: second,
      now: () => FIRST_MOVE_TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const firstController: IHistoryController<typeof first.page> = firstCoordinator.controller;

    firstCoordinator.executeManipulation(
      createTranslationResult("session-1", { x: 0, y: 0 }, { x: 5, y: 5 }),
    );

    expect(firstCoordinator.controller).not.toBe(secondCoordinator.controller);
    expect(firstCoordinator.controller.canUndo()).toBe(true);
    expect(secondCoordinator.controller.canUndo()).toBe(false);
    firstCoordinator.destroy();
    firstCoordinator.destroy();
    expect(() => firstController.undo()).toThrowError(
      expect.objectContaining({ code: "HISTORY_CONTROLLER_DESTROYED" }),
    );
    secondCoordinator.destroy();
  });
});

function createDocumentSession(now: () => string = () => OBJECT_TIMESTAMP): InkDocumentSession {
  const session = new InkDocumentSession({ createId: () => "object-1", now });
  session.completeStroke(createStroke());
  return session;
}

function createMultiObjectSession(): InkDocumentSession {
  let identity = 0;
  const session = new InkDocumentSession({
    createId: () => `object-${++identity}`,
    now: () => OBJECT_TIMESTAMP,
  });
  session.completeStroke(createStroke("stroke-1"));
  session.completeStroke(createStroke("stroke-2"));
  return session;
}

function createTranslationResult(
  sessionId: string,
  initialObjectTranslation: Readonly<{ x: number; y: number }>,
  finalObjectTranslation: Readonly<{ x: number; y: number }>,
  objectId = "object-1",
): TranslationManipulationResult {
  const movementVector = Object.freeze({
    x: finalObjectTranslation.x - initialObjectTranslation.x,
    y: finalObjectTranslation.y - initialObjectTranslation.y,
  });
  return Object.freeze({
    kind: "translation",
    sessionId,
    objectId,
    translation: Object.freeze({
      translationX: movementVector.x,
      translationY: movementVector.y,
      totalDistance: Math.hypot(movementVector.x, movementVector.y),
      movementVector,
    }),
    initialObjectTranslation: Object.freeze({ ...initialObjectTranslation }),
    finalObjectTranslation: Object.freeze({ ...finalObjectTranslation }),
    sessionTimestamp: 1,
  });
}

function createRotationResult(
  sessionId: string,
  initialObjectRotation: number,
  finalObjectRotation: number,
): RotationManipulationResult {
  return Object.freeze({
    kind: "rotation",
    sessionId,
    objectId: "object-1",
    rotation: Object.freeze({
      deltaRadians: finalObjectRotation - initialObjectRotation,
    }),
    initialObjectRotation,
    finalObjectRotation,
    sessionTimestamp: 1,
  });
}

function createScaleResult(
  sessionId: string,
  initialObjectScale: number,
  finalObjectScale: number,
): ScaleManipulationResult {
  return Object.freeze({
    kind: "scale",
    sessionId,
    objectId: "object-1",
    scale: Object.freeze({ factor: finalObjectScale / initialObjectScale }),
    initialObjectScale,
    finalObjectScale,
    sessionTimestamp: 1,
  });
}

function createStroke(id = "stroke-1") {
  const builder = new StrokeBuilder({
    id,
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
  return builder.finalize();
}

function expectInkObject(session: InkDocumentSession): InkObject {
  const object = session.collection.lookup("object-1");
  expect(object).toBeInstanceOf(InkObject);
  return object as InkObject;
}

function pagePoint(x: number, y: number): PagePoint {
  return Object.freeze({ x, y, coordinateSpace: "page" });
}
