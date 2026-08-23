import { InkObject, ObjectCollection, ObjectFactory } from "@folio/document";
import { createEditorHistoryManager } from "@folio/history";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createAddStrokeCommand } from "../history/add-stroke-command";
import { createMoveCommand } from "../history/move-command";

const CREATED_AT = "2026-07-28T08:00:00.000Z";
const MOVED_AT = "2026-07-28T08:00:01.000Z";

describe("AddStrokeCommand", () => {
  it("creates exactly one History entry and restores the same immutable stroke on redo", () => {
    const fixture = createFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    const command = createAddStrokeCommand({ object: fixture.object, insertionIndex: 0 });

    manager.executeCommand(command);
    expect(fixture.session.current.lookup(fixture.object.id)).toBe(fixture.object);
    expect(manager.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });

    manager.undo();
    expect(fixture.session.current.size).toBe(0);
    manager.redo();
    expect(fixture.session.current.lookup(fixture.object.id)).toBe(fixture.object);
    expect((fixture.session.current.lookup(fixture.object.id) as InkObject).stroke.brush).toBe(
      fixture.object.stroke.brush,
    );
    expect(manager.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    expect(Object.isFrozen(command)).toBe(true);
  });

  it("supports mixed draw and transform histories without retaining document snapshots", () => {
    const fixture = createFixture();
    const manager = createEditorHistoryManager({ documentSession: fixture.session });
    manager.executeCommand(createAddStrokeCommand({ object: fixture.object, insertionIndex: 0 }));
    manager.executeCommand(
      createMoveCommand({
        objectId: fixture.object.id,
        expectedObjectModifiedAt: CREATED_AT,
        initialTranslation: { x: 0, y: 0 },
        finalTranslation: { x: 20, y: 15 },
        id: "move-drawn-stroke",
        timestamp: MOVED_AT,
      }),
    );

    expect(ink(fixture.session.current).transform.translation).toEqual({ x: 20, y: 15 });
    manager.undo();
    expect(ink(fixture.session.current).transform.translation).toEqual({ x: 0, y: 0 });
    manager.undo();
    expect(fixture.session.current.size).toBe(0);
    manager.redo();
    manager.redo();
    expect(ink(fixture.session.current).transform.translation).toEqual({ x: 20, y: 15 });
  });

  it("rejects duplicate insertion and invalid construction state consistently", () => {
    const fixture = createFixture();
    const command = createAddStrokeCommand({ object: fixture.object, insertionIndex: 0 });
    expect(() => command.execute(new ObjectCollection([fixture.object]))).toThrowError(
      /already exists/u,
    );
    expect(() =>
      createAddStrokeCommand({ object: fixture.object, insertionIndex: 1 }),
    ).toThrowError(/correctly ordered/u);
  });
});

function createFixture() {
  const object = new ObjectFactory({
    createId: () => "drawn-object",
    now: () => CREATED_AT,
  }).createInkObject({ stroke: createStroke() });
  const session = {
    current: ObjectCollection.empty(),
    getDocument() {
      return this.current;
    },
    replaceDocument(document: ObjectCollection) {
      this.current = document;
    },
  };
  return { object, session };
}

function createStroke() {
  const builder = new StrokeBuilder({
    id: "drawn-stroke",
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

function ink(collection: ObjectCollection): InkObject {
  const object = collection.lookup("drawn-object");
  if (!(object instanceof InkObject)) throw new Error("Expected the drawn InkObject.");
  return object;
}
