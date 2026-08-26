import { pageOf } from "./layer-test-support";
import { ObjectFactory, isVectorObject, serializeVectorObject } from "@folio/document";
import { describe, expect, it } from "vitest";
import { createUpdateVectorStyleCommand } from "../history/update-vector-style-command";

const initialRevision = "2026-07-31T08:00:00.000Z";
const finalRevision = "2026-07-31T08:00:00.001Z";

describe("UpdateVectorStyleCommand", () => {
  it("updates, undoes, and redoes immutable serialized vector appearance", () => {
    const object = new ObjectFactory({ now: () => initialRevision }).createRectangleObject({
      id: "styled-rectangle",
      geometry: { x: 20, y: 30, width: 120, height: 80 },
    });
    const document = pageOf([object]);
    const command = createUpdateVectorStyleCommand({
      objectId: object.id,
      expectedObjectModifiedAt: object.modifiedAt,
      initialStyle: object.style,
      finalStyle: {
        strokeColor: { hex: "#2563eb", opacity: 0.5 },
        strokeWidth: 8,
      },
      timestamp: finalRevision,
    });

    const updated = command.execute(document);
    const updatedObject = updated.lookup(object.id);
    expect(isVectorObject(updatedObject)).toBe(true);
    if (!isVectorObject(updatedObject)) throw new Error("Expected vector replacement.");
    expect(updatedObject.style).toMatchObject({
      strokeColor: { hex: "#2563eb", opacity: 0.5 },
      strokeWidth: 8,
    });
    expect(serializeVectorObject(updatedObject).payload.style).toEqual(updatedObject.style);
    expect(command.undo(updated).lookup(object.id)).toStrictEqual(object);
    expect(command.redo(document).lookup(object.id)).toStrictEqual(updatedObject);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it("rejects stale, locked, and no-op updates", () => {
    const factory = new ObjectFactory({ now: () => initialRevision });
    const object = factory.createLineObject({
      id: "style-target",
      geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    });
    expect(() =>
      createUpdateVectorStyleCommand({
        objectId: object.id,
        expectedObjectModifiedAt: object.modifiedAt,
        initialStyle: object.style,
        finalStyle: object.style,
        timestamp: finalRevision,
      }),
    ).toThrow(/visible style change/u);

    const command = createUpdateVectorStyleCommand({
      objectId: object.id,
      expectedObjectModifiedAt: object.modifiedAt,
      initialStyle: object.style,
      finalStyle: { strokeColor: "#dc2626", strokeWidth: 2 },
      timestamp: finalRevision,
    });
    const locked = factory.createLineObject({
      id: object.id,
      createdAt: object.createdAt,
      modifiedAt: object.modifiedAt,
      locked: true,
      geometry: object.geometry,
      style: object.style,
    });
    expect(() => command.execute(pageOf([locked]))).toThrow(/cannot be styled/u);
  });
});
