import { pageOf } from "./layer-test-support";
import { InkObject, PageDocument, ObjectFactory, Transform } from "@folio/document";
import {
  HistoryError,
  createEditorHistoryManager,
  createHistoryController,
  isHistoryError,
} from "@folio/history";
import type { HistoryDocumentSession, HistoryNotification, IHistoryState } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createMoveCommand } from "../history/move-command";
import type { MoveCommandInput } from "../history/move-command";

const OBJECT_TIMESTAMP = "2026-07-28T01:00:00.000Z";
const FIRST_COMMAND_TIMESTAMP = "2026-07-28T01:01:00.000Z";
const SECOND_COMMAND_TIMESTAMP = "2026-07-28T01:02:00.000Z";

interface CollectionOptions {
  readonly id?: string;
  readonly modifiedAt?: string;
  readonly translation?: Readonly<{ x: number; y: number }>;
  readonly rotation?: number;
  readonly scale?: number;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly includeSecondObject?: boolean;
}

describe("MoveCommand", () => {
  it("owns stable immutable metadata without retaining exposed mutable state", () => {
    const initialTranslation = { x: 0, y: 0 };
    const finalTranslation = { x: 12, y: -8 };
    const command = createMoveCommand({
      ...moveInput(),
      initialTranslation,
      finalTranslation,
    });

    initialTranslation.x = 500;
    finalTranslation.y = 500;

    expect(command).toMatchObject({
      id: "move-object-1",
      timestamp: FIRST_COMMAND_TIMESTAMP,
      description: "Move object object-1",
    });
    expect(Object.isFrozen(command)).toBe(true);
    expect(Reflect.ownKeys(command).sort()).toEqual(["description", "id", "timestamp"]);
    expect(command.execute(createCollection()).lookup("object-1")?.transform.translation).toEqual({
      x: 12,
      y: -8,
    });
  });

  it("creates a distinct immutable successor with the same object and stroke identity", () => {
    const initial = createCollection({ includeSecondObject: true });
    const source = expectInkObject(initial, "object-1");
    const untouched = initial.lookup("object-2");
    const command = createMoveCommand(moveInput());

    const successor = command.execute(initial);
    const moved = expectInkObject(successor, "object-1");

    expect(successor).not.toBe(initial);
    expect(moved).not.toBe(source);
    expect(moved.id).toBe(source.id);
    expect(moved.stroke).toBe(source.stroke);
    expect(moved.transform.translation).toEqual({ x: 12, y: -8 });
    expect(moved.modifiedAt).toBe(FIRST_COMMAND_TIMESTAMP);
    expect(successor.lookup("object-2")).toBe(untouched);
    expect(source.transform.translation).toEqual({ x: 0, y: 0 });
    expect(source.modifiedAt).toBe(OBJECT_TIMESTAMP);
    expect(
      [successor, moved, moved.transform, moved.transform.translation].every(Object.isFrozen),
    ).toBe(true);
  });

  it("undoes to a new logical predecessor and redoes to a new logical successor", () => {
    const initial = createCollection();
    const source = expectInkObject(initial, "object-1");
    const command = createMoveCommand(moveInput());
    const executed = command.execute(initial);

    const undone = command.undo(executed);
    const restored = expectInkObject(undone, "object-1");
    const redone = command.redo(undone);
    const reapplied = expectInkObject(redone, "object-1");

    expect(new Set([initial, executed, undone, redone]).size).toBe(4);
    expect(restored).not.toBe(source);
    expect(restored.transform.translation).toEqual(source.transform.translation);
    expect(restored.modifiedAt).toBe(source.modifiedAt);
    expect(restored.stroke).toBe(source.stroke);
    expect(reapplied.transform.translation).toEqual({ x: 12, y: -8 });
    expect(reapplied.modifiedAt).toBe(FIRST_COMMAND_TIMESTAMP);
    expect(reapplied.stroke).toBe(source.stroke);
  });

  it("preserves rotation and scale while replacing only translation", () => {
    const initial = createCollection({ rotation: 0.75, scale: 2 });
    const command = createMoveCommand(moveInput());
    const executed = command.execute(initial);
    const undone = command.undo(executed);

    expect(expectInkObject(executed, "object-1").transform).toMatchObject({
      translation: { x: 12, y: -8 },
      rotation: 0.75,
      scale: 2,
    });
    expect(expectInkObject(undone, "object-1").transform).toMatchObject({
      translation: { x: 0, y: 0 },
      rotation: 0.75,
      scale: 2,
    });
  });

  it("replays translations that a delta round trip cannot reproduce exactly", () => {
    // The values from the real defect. `before + (after - before) + (before -
    // after)` settles 2.84e-14 away from `before`, so a delta-based undo used
    // to leave the object where the redo's exact precondition would reject it.
    const before = { x: 11.269891968152166, y: -5.740710880621634 };
    const after = { x: 325.51586998080063, y: -64.98668376748736 };
    expect(after.x - before.x + before.x + (before.x - after.x)).not.toBe(before.x);

    const initial = createCollection({ translation: before });
    const command = createMoveCommand({
      ...moveInput(),
      initialTranslation: before,
      finalTranslation: after,
    });

    const executed = command.execute(initial);
    expect(expectInkObject(executed, "object-1").transform.translation).toStrictEqual(after);
    const undone = command.undo(executed);
    expect(expectInkObject(undone, "object-1").transform.translation).toStrictEqual(before);
    const redone = command.redo(undone);
    expect(expectInkObject(redone, "object-1").transform.translation).toStrictEqual(after);
  });

  it("stays bit-exact across repeated undo and redo cycles", () => {
    const before = { x: 11.269891968152166, y: -5.740710880621634 };
    const after = { x: 325.51586998080063, y: -64.98668376748736 };
    const fixture = createCollectionSession(createCollection({ translation: before }));
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(
      createMoveCommand({ ...moveInput(), initialTranslation: before, finalTranslation: after }),
    );

    // Nothing accumulates: every cycle lands on the recorded value itself, so
    // the tenth redo is the same number as the first.
    for (let cycle = 0; cycle < 5; cycle += 1) {
      expect(expectInkObject(fixture.current, "object-1").transform.translation).toStrictEqual(
        after,
      );
      manager.undo();
      expect(expectInkObject(fixture.current, "object-1").transform.translation).toStrictEqual(
        before,
      );
      manager.redo();
    }
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toStrictEqual(after);
  });

  it("redoes a committed transaction of drifting moves, as a group transform does", () => {
    // The shape of the real failure: one grouped gesture commits a companion
    // reposition move per object, and the transaction replays them in order.
    // A single ULP of drift in any child used to abort the whole redo.
    const before = { x: 11.269891968152166, y: -5.740710880621634 };
    const after = { x: 325.51586998080063, y: -64.98668376748736 };
    const secondBefore = { x: 141.01847203631496, y: 79.25922939914011 };
    const secondAfter = { x: -188.98149754903892, y: 154.25919078184614 };
    const fixture = createCollectionSession(
      pageOf([
        createInkObject({ translation: before }),
        createInkObject({ id: "object-2", translation: secondBefore }),
      ]),
    );
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction({
      id: "group-rotation-session",
      timestamp: SECOND_COMMAND_TIMESTAMP,
      description: "Rotate 2 selected objects",
    });
    manager.executeCommand(
      createMoveCommand({ ...moveInput(), initialTranslation: before, finalTranslation: after }),
    );
    manager.executeCommand(
      createMoveCommand({
        ...moveInput(),
        objectId: "object-2",
        id: "move-object-2",
        initialTranslation: secondBefore,
        finalTranslation: secondAfter,
      }),
    );
    expect(manager.commitTransaction()).toMatchObject({ undoDepth: 1, redoDepth: 0 });

    expect(manager.undo()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toStrictEqual(
      before,
    );
    expect(expectInkObject(fixture.current, "object-2").transform.translation).toStrictEqual(
      secondBefore,
    );
    expect(manager.redo()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toStrictEqual(after);
    expect(expectInkObject(fixture.current, "object-2").transform.translation).toStrictEqual(
      secondAfter,
    );
  });

  it("executes, undoes, and redoes through the generic History manager", () => {
    const fixture = createCollectionSession(createCollection());
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = createMoveCommand(moveInput());

    expect(manager.executeCommand(command)).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toEqual({
      x: 12,
      y: -8,
    });
    expect(manager.undo()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toEqual({
      x: 0,
      y: 0,
    });
    expect(manager.redo()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toEqual({
      x: 12,
      y: -8,
    });
    expect(fixture.replacements).toHaveLength(3);
  });

  it("supports sequential MoveCommands inside one snapshot-free transaction", () => {
    const fixture = createCollectionSession(createCollection());
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.beginTransaction({
      id: "move-transaction",
      timestamp: SECOND_COMMAND_TIMESTAMP,
      description: "Move object twice",
    });
    manager.executeCommand(createMoveCommand(moveInput()));
    manager.executeCommand(
      createMoveCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: FIRST_COMMAND_TIMESTAMP,
        initialTranslation: { x: 12, y: -8 },
        finalTranslation: { x: 20, y: 5 },
        id: "move-object-2",
        timestamp: SECOND_COMMAND_TIMESTAMP,
        description: "Move object object-1 again",
      }),
    );

    expect(manager.commitTransaction()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(expectInkObject(fixture.current, "object-1").transform.translation).toEqual({
      x: 20,
      y: 5,
    });
    manager.undo();
    const undone = expectInkObject(fixture.current, "object-1");
    expect(undone.transform.translation).toEqual({ x: 0, y: 0 });
    expect(undone.modifiedAt).toBe(OBJECT_TIMESTAMP);
    manager.redo();
    const redone = expectInkObject(fixture.current, "object-1");
    expect(redone.transform.translation).toEqual({ x: 20, y: 5 });
    expect(redone.modifiedAt).toBe(SECOND_COMMAND_TIMESTAMP);
  });

  it("publishes immutable controller notifications with stable command identity", () => {
    const fixture = createCollectionSession(createCollection());
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((notification) => notifications.push(notification));
    const command = createMoveCommand(moveInput());

    controller.executeCommand(command);
    controller.undo();
    controller.redo();

    expect(notifications.map(({ operation }) => operation)).toEqual(["execute", "undo", "redo"]);
    expect(notifications.every(({ command: metadata }) => metadata?.id === command.id)).toBe(true);
    expect(
      notifications.every(
        (notification) => Object.isFrozen(notification) && Object.isFrozen(notification.state),
      ),
    ).toBe(true);
  });

  it("reports command validation failures through History without changing state", () => {
    const fixture = createCollectionSession(createCollection({ locked: true }));
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const controller = createHistoryController({ manager });
    const notifications: HistoryNotification[] = [];
    controller.subscribe((notification) => notifications.push(notification));
    const before = controller.getHistoryState();

    const error = captureHistoryError(() =>
      controller.executeCommand(createMoveCommand(moveInput())),
    );

    expect(error.code).toBe("COMMAND_EXECUTION_FAILED");
    expect((error.cause as { readonly code?: unknown }).code).toBe("MOVE_OBJECT_LOCKED");
    expect(controller.getHistoryState()).toEqual(before);
    expect(fixture.replacements).toEqual([]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      operation: "execute",
      outcome: "failed",
      command: { id: "move-object-1" },
    });
  });

  it.each([
    ["blank object id", { objectId: " " }],
    ["blank command id", { id: " " }],
    ["blank description", { description: " " }],
    ["invalid object timestamp", { expectedObjectModifiedAt: "invalid" }],
    ["invalid command timestamp", { timestamp: "invalid" }],
    ["command before object", { timestamp: "2026-07-28T00:59:00.000Z" }],
    ["invalid initial vector", { initialTranslation: { x: Number.NaN, y: 0 } }],
    ["invalid final vector", { finalTranslation: { x: 0, y: Number.POSITIVE_INFINITY } }],
    ["unchanged translation", { finalTranslation: { x: 0, y: 0 } }],
  ])("rejects %s", (_case, override) => {
    expect(() => createMoveCommand({ ...moveInput(), ...override })).toThrowError(
      expect.objectContaining({ code: "INVALID_MOVE_COMMAND" }),
    );
  });

  it("generates valid default metadata", () => {
    const command = createMoveCommand({
      objectId: "object-1",
      expectedObjectModifiedAt: OBJECT_TIMESTAMP,
      initialTranslation: { x: 0, y: 0 },
      finalTranslation: { x: 1, y: 1 },
    });

    expect(command.id).toMatch(/^(?:[0-9a-f-]{36}|move-)/u);
    expect(Number.isFinite(Date.parse(command.timestamp))).toBe(true);
    expect(command.description).toBe("Move object object-1");
  });

  it("rejects a missing object", () => {
    expectMoveFailure(
      () => createMoveCommand(moveInput()).execute(pageOf()),
      "MOVE_OBJECT_NOT_FOUND",
    );
  });

  it.each([
    ["hidden", createCollection({ visible: false }), "MOVE_OBJECT_HIDDEN"],
    ["locked", createCollection({ locked: true }), "MOVE_OBJECT_LOCKED"],
  ])("rejects a %s object", (_case, collection, code) => {
    expectMoveFailure(() => createMoveCommand(moveInput()).execute(collection), code);
  });

  it("rejects a structurally valid non-InkObject implementation", () => {
    const collection = pageOf([createPlainInkObject()]);

    expectMoveFailure(
      () => createMoveCommand(moveInput()).execute(collection),
      "MOVE_OBJECT_UNSUPPORTED",
    );
  });

  it("rejects stale object revisions", () => {
    const collection = createCollection({ modifiedAt: "2026-07-28T01:00:30.000Z" });

    expectMoveFailure(
      () => createMoveCommand(moveInput()).execute(collection),
      "MOVE_OBJECT_STALE",
    );
  });

  it("rejects wrong execute, undo, and redo translation states", () => {
    const command = createMoveCommand(moveInput());
    const wrongExecute = createCollection({ translation: { x: 1, y: 0 } });
    const wrongUndo = createCollection({
      modifiedAt: FIRST_COMMAND_TIMESTAMP,
      translation: { x: 11, y: -8 },
    });
    const wrongRedo = createCollection({ translation: { x: 12, y: -8 } });

    expectMoveFailure(() => command.execute(wrongExecute), "MOVE_OBJECT_STATE_MISMATCH");
    expectMoveFailure(() => command.undo(wrongUndo), "MOVE_OBJECT_STATE_MISMATCH");
    expectMoveFailure(() => command.redo(wrongRedo), "MOVE_OBJECT_STATE_MISMATCH");
  });
});

function moveInput(): MoveCommandInput {
  return {
    objectId: "object-1",
    expectedObjectModifiedAt: OBJECT_TIMESTAMP,
    initialTranslation: { x: 0, y: 0 },
    finalTranslation: { x: 12, y: -8 },
    id: "move-object-1",
    timestamp: FIRST_COMMAND_TIMESTAMP,
    description: "Move object object-1",
  };
}

function createCollection(options: CollectionOptions = {}): PageDocument {
  const first = createInkObject(options);
  if (!options.includeSecondObject) return pageOf([first]);
  return pageOf([first, createInkObject({ id: "object-2", modifiedAt: OBJECT_TIMESTAMP })]);
}

function createInkObject(options: CollectionOptions = {}): InkObject {
  const id = options.id ?? "object-1";
  return new ObjectFactory().createInkObject({
    id,
    stroke: createStroke(`stroke-${id}`),
    createdAt: OBJECT_TIMESTAMP,
    modifiedAt: options.modifiedAt ?? OBJECT_TIMESTAMP,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    zIndex: id === "object-2" ? 1 : 0,
    transform: new Transform({
      translation: options.translation ?? { x: 0, y: 0 },
      rotation: options.rotation ?? 0,
      scale: options.scale ?? 1,
    }),
  });
}

function createStroke(id: string) {
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

function createPlainInkObject() {
  const stroke = createStroke("plain-stroke");
  return Object.freeze({
    id: "object-1",
    type: "ink" as const,
    version: 1 as const,
    createdAt: OBJECT_TIMESTAMP,
    modifiedAt: OBJECT_TIMESTAMP,
    visible: true,
    locked: false,
    metadata: Object.freeze({}),
    zIndex: 0,
    transform: Transform.identity(),
    stroke,
    renderingHints: Object.freeze({}),
    bounds: stroke.inflatedBounds,
  });
}

function expectInkObject(collection: PageDocument, objectId: string): InkObject {
  const object = collection.lookup(objectId);
  expect(object).toBeInstanceOf(InkObject);
  return object as InkObject;
}

function createCollectionSession(initial: PageDocument): {
  readonly session: HistoryDocumentSession<PageDocument>;
  readonly current: PageDocument;
  readonly replacements: readonly PageDocument[];
} {
  let current = initial;
  const replacements: PageDocument[] = [];
  return {
    session: Object.freeze({
      getDocument: () => current,
      replaceDocument: (document: PageDocument) => {
        current = document;
        replacements.push(document);
      },
    }),
    get current() {
      return current;
    },
    get replacements() {
      return replacements;
    },
  };
}

function expectMoveFailure(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: "MoveCommandError", code });
    return;
  }
  throw new Error(`Expected MoveCommand failure ${code}.`);
}

function captureHistoryError(action: () => IHistoryState): HistoryError {
  try {
    action();
  } catch (error) {
    expect(isHistoryError(error)).toBe(true);
    return error as HistoryError;
  }
  throw new Error("Expected a HistoryError.");
}
