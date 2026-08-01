import { ObjectCollection, ObjectFactory, isVectorObject } from "@folio/document";
import {
  createDeleteManipulationResult,
  createDuplicateManipulationResult,
} from "@folio/manipulation";
import { describe, expect, it } from "vitest";
import { EditorClipboard } from "../EditorClipboard";
import { InkDocumentSession } from "../InkDocumentSession";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { createMoveCommand } from "../history/move-command";
import { createRotateCommand } from "../history/rotate-command";
import { createScaleCommand } from "../history/scale-command";

const firstRevision = "2026-07-30T12:00:00.000Z";
const nextRevision = "2026-07-30T12:00:00.001Z";

function rectangle() {
  return new ObjectFactory({
    createId: () => "rectangle-1",
    now: () => firstRevision,
  }).createRectangleObject({
    geometry: { x: 20, y: 30, width: 120, height: 80 },
  });
}

describe("vector History integration", () => {
  it("executes immutable move, rotate, and scale command lifecycles", () => {
    const source = rectangle();
    const initial = new ObjectCollection([source]);
    const move = createMoveCommand({
      objectId: source.id,
      expectedObjectModifiedAt: firstRevision,
      initialTranslation: { x: 0, y: 0 },
      finalTranslation: { x: 15, y: 10 },
      timestamp: nextRevision,
    });
    const moved = move.execute(initial);
    const movedObject = moved.lookup(source.id);
    expect(isVectorObject(movedObject)).toBe(true);
    expect(movedObject?.transform.translation).toEqual({ x: 15, y: 10 });
    expect(move.undo(moved).lookup(source.id)).toStrictEqual(source);
    expect(move.redo(initial).lookup(source.id)?.transform.translation).toEqual({ x: 15, y: 10 });

    const rotate = createRotateCommand({
      objectId: source.id,
      expectedObjectModifiedAt: firstRevision,
      initialRotation: 0,
      finalRotation: Math.PI / 2,
      timestamp: nextRevision,
    });
    const scale = createScaleCommand({
      objectId: source.id,
      expectedObjectModifiedAt: firstRevision,
      initialScale: 1,
      finalScale: 2,
      timestamp: nextRevision,
    });
    expect(rotate.execute(initial).lookup(source.id)?.transform.rotation).toBe(Math.PI / 2);
    expect(scale.execute(initial).lookup(source.id)?.transform.scale).toBe(2);
  });

  it("creates, undoes, redoes, deletes, duplicates, copies, and pastes through existing seams", () => {
    const session = new InkDocumentSession({
      createId: (() => {
        let id = 0;
        return () => `vector-${++id}`;
      })(),
      now: () => firstRevision,
    });
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => nextRevision,
      onDocumentChange: () => undefined,
    });
    const source = session.createEllipseObject(
      { center: { x: 80, y: 90 }, radiusX: 30, radiusY: 20 },
      { strokeWidth: 3 },
    );

    coordinator.executeObjectCreation(source);
    expect(session.collection.lookup(source.id)).toBe(source);
    coordinator.undo();
    expect(session.collection.has(source.id)).toBe(false);
    coordinator.redo();
    expect(session.collection.lookup(source.id)).toBe(source);

    coordinator.executeVectorStyleUpdate(source, {
      strokeColor: { hex: "#2563eb", opacity: 0.5 },
      strokeWidth: 6,
    });
    const styled = session.collection.lookup(source.id);
    expect(isVectorObject(styled) && styled.style.strokeWidth).toBe(6);
    coordinator.undo();
    expect(session.collection.lookup(source.id)).toStrictEqual(source);
    coordinator.redo();
    expect(
      isVectorObject(session.collection.lookup(source.id)) &&
        session.collection.lookup(source.id)?.modifiedAt,
    ).toBe(nextRevision);

    coordinator.executeManipulation(createDuplicateManipulationResult({ objectId: source.id }));
    expect(session.collection.size).toBe(2);
    const duplicate = session.collection.objects[1];
    expect(isVectorObject(duplicate)).toBe(true);
    if (duplicate === undefined) throw new Error("Expected duplicate.");
    coordinator.executeManipulation(createDeleteManipulationResult({ objectId: duplicate.id }));
    expect(session.collection.size).toBe(1);

    const clipboard = new EditorClipboard({
      createId: () => "pasted-vector",
      now: () => nextRevision,
    });
    expect(clipboard.copy([source])).toBe(true);
    const paste = clipboard.preparePaste(session.collection);
    expect(paste?.objects[0]?.type).toBe("ellipse");
    expect(paste?.objects[0]?.transform.translation).toEqual({ x: 20, y: 20 });
    coordinator.destroy();
  });
});
