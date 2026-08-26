import { pageOf } from "./layer-test-support";
import { InkObject, PageDocument, ObjectFactory, Transform } from "@folio/document";
import { createEditorHistoryManager } from "@folio/history";
import type { HistoryDocumentSession } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createMoveCommand } from "../history/move-command";
import { createRotateCommand } from "../history/rotate-command";
import { createScaleCommand } from "../history/scale-command";

const INITIAL_TIMESTAMP = "2026-07-28T02:00:00.000Z";
const ROTATE_TIMESTAMP = "2026-07-28T02:01:00.000Z";
const SCALE_TIMESTAMP = "2026-07-28T02:02:00.000Z";
const MOVE_TIMESTAMP = "2026-07-28T02:03:00.000Z";

describe("RotateCommand", () => {
  it("executes, undoes, and redoes immutable center-pivot rotation", () => {
    const initial = createCollection();
    const source = object(initial);
    const command = createRotateCommand({
      objectId: source.id,
      expectedObjectModifiedAt: INITIAL_TIMESTAMP,
      initialRotation: 0,
      finalRotation: Math.PI / 2,
      id: "rotate-object-1",
      timestamp: ROTATE_TIMESTAMP,
      description: "Rotate object object-1",
    });

    const executed = command.execute(initial);
    const undone = command.undo(executed);
    const redone = command.redo(undone);

    expect(object(executed).transform).toMatchObject({
      translation: { x: 0, y: 0 },
      rotation: Math.PI / 2,
      scale: 1,
    });
    expect(object(undone).transform.rotation).toBe(0);
    expect(object(redone).transform.rotation).toBe(Math.PI / 2);
    expect(object(executed).stroke).toBe(source.stroke);
    expect(object(executed).stroke.brush).toBe(source.stroke.brush);
    expect(new Set([initial, executed, undone, redone]).size).toBe(4);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Reflect.ownKeys(command).sort()).toEqual(["description", "id", "timestamp"]);
  });
});

describe("ScaleCommand", () => {
  it("executes, undoes, and redoes immutable uniform scale", () => {
    const initial = createCollection({ translation: { x: 5, y: -3 }, rotation: 0.25 });
    const source = object(initial);
    const command = createScaleCommand({
      objectId: source.id,
      expectedObjectModifiedAt: INITIAL_TIMESTAMP,
      initialScale: 1,
      finalScale: 2.5,
      id: "scale-object-1",
      timestamp: SCALE_TIMESTAMP,
      description: "Scale object object-1",
    });

    const executed = command.execute(initial);
    const undone = command.undo(executed);
    const redone = command.redo(undone);

    expect(object(executed).transform).toMatchObject({
      translation: { x: 5, y: -3 },
      rotation: 0.25,
      scale: 2.5,
    });
    expect(object(undone).transform.scale).toBe(1);
    expect(object(redone).transform.scale).toBe(2.5);
    expect(object(executed).stroke).toBe(source.stroke);
    expect(object(executed).stroke.brush).toBe(source.stroke.brush);
    expect(Object.isFrozen(command)).toBe(true);
  });
});

describe("transform command integration", () => {
  it("preserves independent transform axes across mixed rotation, movement, and scale history", () => {
    const fixture = session(createCollection());
    const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
    manager.executeCommand(
      createRotateCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: INITIAL_TIMESTAMP,
        initialRotation: 0,
        finalRotation: Math.PI / 4,
        id: "rotate",
        timestamp: ROTATE_TIMESTAMP,
      }),
    );
    manager.executeCommand(
      createMoveCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: ROTATE_TIMESTAMP,
        initialTranslation: { x: 0, y: 0 },
        finalTranslation: { x: 20, y: 10 },
        id: "move",
        timestamp: SCALE_TIMESTAMP,
      }),
    );
    manager.executeCommand(
      createScaleCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: SCALE_TIMESTAMP,
        initialScale: 1,
        finalScale: 2,
        id: "scale",
        timestamp: MOVE_TIMESTAMP,
      }),
    );

    expect(object(fixture.current).transform).toMatchObject({
      translation: { x: 20, y: 10 },
      rotation: Math.PI / 4,
      scale: 2,
    });
    manager.undo();
    manager.undo();
    manager.undo();
    expect(object(fixture.current).transform).toEqual(Transform.identity());
    manager.redo();
    manager.redo();
    manager.redo();
    expect(object(fixture.current).transform).toMatchObject({
      translation: { x: 20, y: 10 },
      rotation: Math.PI / 4,
      scale: 2,
    });
  });

  it("groups rotate and scale atomically and invalidates redo after a new command", () => {
    const fixture = session(createCollection());
    const manager = createEditorHistoryManager({ documentSession: fixture.documentSession });
    manager.beginTransaction({
      id: "transform-transaction",
      timestamp: SCALE_TIMESTAMP,
      description: "Transform object",
    });
    manager.executeCommand(
      createRotateCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: INITIAL_TIMESTAMP,
        initialRotation: 0,
        finalRotation: 0.5,
        id: "rotate",
        timestamp: ROTATE_TIMESTAMP,
      }),
    );
    manager.executeCommand(
      createScaleCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: ROTATE_TIMESTAMP,
        initialScale: 1,
        finalScale: 1.5,
        id: "scale",
        timestamp: SCALE_TIMESTAMP,
      }),
    );
    expect(manager.commitTransaction()).toMatchObject({ undoDepth: 1 });
    manager.undo();
    expect(object(fixture.current).transform).toEqual(Transform.identity());
    expect(manager.canRedo()).toBe(true);
    manager.executeCommand(
      createRotateCommand({
        objectId: "object-1",
        expectedObjectModifiedAt: INITIAL_TIMESTAMP,
        initialRotation: 0,
        finalRotation: -0.25,
        id: "replacement-rotate",
        timestamp: MOVE_TIMESTAMP,
      }),
    );
    expect(manager.canRedo()).toBe(false);
  });

  it.each([
    [
      "rotation",
      () => createRotateCommand(rotateInput({ objectId: " " })),
      "INVALID_ROTATION_COMMAND",
    ],
    [
      "rotation",
      () => createRotateCommand(rotateInput({ finalRotation: Infinity })),
      "INVALID_ROTATION_COMMAND",
    ],
    ["scale", () => createScaleCommand(scaleInput({ finalScale: 0 })), "INVALID_SCALE_COMMAND"],
    ["scale", () => createScaleCommand(scaleInput({ finalScale: 1 })), "INVALID_SCALE_COMMAND"],
  ])("rejects invalid %s command construction", (_kind, create, code) => {
    expect(create).toThrowError(expect.objectContaining({ code }));
  });

  it.each([
    ["missing", pageOf(), "ROTATION_OBJECT_NOT_FOUND"],
    ["hidden", createCollection({ visible: false }), "ROTATION_OBJECT_HIDDEN"],
    ["locked", createCollection({ locked: true }), "ROTATION_OBJECT_LOCKED"],
    [
      "stale",
      createCollection({ modifiedAt: "2026-07-28T02:00:30.000Z" }),
      "ROTATION_OBJECT_STALE",
    ],
  ])("rejects a %s rotation target", (_case, document, code) => {
    expect(() => createRotateCommand(rotateInput()).execute(document)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    ["missing", pageOf(), "SCALE_OBJECT_NOT_FOUND"],
    ["hidden", createCollection({ visible: false }), "SCALE_OBJECT_HIDDEN"],
    ["locked", createCollection({ locked: true }), "SCALE_OBJECT_LOCKED"],
    ["stale", createCollection({ modifiedAt: "2026-07-28T02:00:30.000Z" }), "SCALE_OBJECT_STALE"],
  ])("rejects a %s scale target", (_case, document, code) => {
    expect(() => createScaleCommand(scaleInput()).execute(document)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("rejects execute, undo, and redo when transform state does not match", () => {
    const rotate = createRotateCommand(rotateInput());
    const scale = createScaleCommand(scaleInput());
    expect(() => rotate.execute(createCollection({ rotation: 0.1 }))).toThrowError(
      expect.objectContaining({ code: "ROTATION_OBJECT_STATE_MISMATCH" }),
    );
    expect(() =>
      rotate.undo(createCollection({ modifiedAt: ROTATE_TIMESTAMP, rotation: 0.2 })),
    ).toThrowError(expect.objectContaining({ code: "ROTATION_OBJECT_STATE_MISMATCH" }));
    expect(() => scale.execute(createCollection({ scale: 1.1 }))).toThrowError(
      expect.objectContaining({ code: "SCALE_OBJECT_STATE_MISMATCH" }),
    );
    expect(() =>
      scale.redo(createCollection({ modifiedAt: INITIAL_TIMESTAMP, scale: 2 })),
    ).toThrowError(expect.objectContaining({ code: "SCALE_OBJECT_STATE_MISMATCH" }));
  });
});

function rotateInput(overrides: Partial<Parameters<typeof createRotateCommand>[0]> = {}) {
  return {
    objectId: "object-1",
    expectedObjectModifiedAt: INITIAL_TIMESTAMP,
    initialRotation: 0,
    finalRotation: Math.PI / 2,
    id: "rotate-object-1",
    timestamp: ROTATE_TIMESTAMP,
    ...overrides,
  };
}

function scaleInput(overrides: Partial<Parameters<typeof createScaleCommand>[0]> = {}) {
  return {
    objectId: "object-1",
    expectedObjectModifiedAt: INITIAL_TIMESTAMP,
    initialScale: 1,
    finalScale: 2,
    id: "scale-object-1",
    timestamp: SCALE_TIMESTAMP,
    ...overrides,
  };
}

function createCollection(
  options: Partial<{
    modifiedAt: string;
    visible: boolean;
    locked: boolean;
    translation: Readonly<{ x: number; y: number }>;
    rotation: number;
    scale: number;
  }> = {},
): PageDocument {
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
  const ink = new ObjectFactory().createInkObject({
    id: "object-1",
    stroke: builder.finalize(),
    createdAt: INITIAL_TIMESTAMP,
    modifiedAt: options.modifiedAt ?? INITIAL_TIMESTAMP,
    visible: options.visible ?? true,
    locked: options.locked ?? false,
    transform: new Transform({
      translation: options.translation ?? { x: 0, y: 0 },
      rotation: options.rotation ?? 0,
      scale: options.scale ?? 1,
    }),
  });
  return pageOf([ink]);
}

function object(collection: PageDocument): InkObject {
  const value = collection.lookup("object-1");
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
