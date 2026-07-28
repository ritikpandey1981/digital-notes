import { InkObject } from "@folio/document";
import type { HistoryNotification, IHistoryController } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import {
  createManipulationController,
  createManipulationManager,
  type ManipulationCommit,
} from "@folio/manipulation";
import { createSelectionManager, type PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const OBJECT_TIMESTAMP = "2026-07-28T08:00:00.000Z";
const FIRST_MOVE_TIMESTAMP = "2026-07-28T08:01:00.000Z";
const SECOND_MOVE_TIMESTAMP = "2026-07-28T08:02:00.000Z";

describe("EditorHistoryCoordinator", () => {
  it("adapts a ManipulationCommit into one immutable History successor", () => {
    const session = createDocumentSession();
    const initial = session.collection;
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

    const state = coordinator.commitMove(
      createCommit("session-1", { x: 0, y: 0 }, { x: 12, y: -8 }),
    );
    const moved = expectInkObject(session);

    expect(state).toMatchObject({ canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 });
    expect(session.collection).not.toBe(initial);
    expect(moved).not.toBe(source);
    expect(moved.id).toBe(source.id);
    expect(moved.stroke).toBe(source.stroke);
    expect(moved.transform.translation).toEqual({ x: 12, y: -8 });
    expect(source.transform.translation).toEqual({ x: 0, y: 0 });
    expect(synchronizedDocuments).toEqual([session.collection]);
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
      readonly document: typeof session.collection;
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

    coordinator.commitMove(createCommit("session-1", { x: 0, y: 0 }, { x: 20, y: 15 }));
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
      onCommit: (commit) => {
        try {
          coordinator.commitMove(commit);
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
    coordinator.commitMove(createCommit("session-1", { x: 0, y: 0 }, { x: 10, y: 5 }));
    coordinator.commitMove(createCommit("session-2", { x: 10, y: 5 }, { x: 20, y: 15 }));

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
    const firstController: IHistoryController<typeof first.collection> =
      firstCoordinator.controller;

    firstCoordinator.commitMove(createCommit("session-1", { x: 0, y: 0 }, { x: 5, y: 5 }));

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

function createCommit(
  sessionId: string,
  initialObjectTranslation: Readonly<{ x: number; y: number }>,
  finalObjectTranslation: Readonly<{ x: number; y: number }>,
): ManipulationCommit {
  const movementVector = Object.freeze({
    x: finalObjectTranslation.x - initialObjectTranslation.x,
    y: finalObjectTranslation.y - initialObjectTranslation.y,
  });
  return Object.freeze({
    sessionId,
    objectId: "object-1",
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

function createStroke() {
  const builder = new StrokeBuilder({
    id: "stroke-1",
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
