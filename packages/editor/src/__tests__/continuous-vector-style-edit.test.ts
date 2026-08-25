import {
  ObjectCollection,
  ObjectFactory,
  isVectorObject,
  type EditableStyleInput,
} from "@folio/document";
import { describe, expect, it } from "vitest";
import { ContinuousVectorStyleEdit } from "../ContinuousVectorStyleEdit";
import { InkDocumentSession } from "../InkDocumentSession";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";

const INITIAL_REVISION = "2026-08-25T08:00:00.000Z";
const FINAL_REVISION = "2026-08-25T08:00:00.001Z";

describe("ContinuousVectorStyleEdit", () => {
  it.each([
    {
      property: "width",
      previews: [{ strokeWidth: 4 }, { strokeWidth: 8 }, { strokeWidth: 12 }],
      expected: { strokeWidth: 12 },
    },
    {
      property: "opacity",
      previews: [
        { strokeColor: { hex: "#111111", opacity: 0.8 } },
        { strokeColor: { hex: "#111111", opacity: 0.5 } },
        { strokeColor: { hex: "#111111", opacity: 0.3 } },
      ],
      expected: { strokeColor: { hex: "#111111", opacity: 0.3 } },
    },
    {
      property: "color",
      previews: [
        { strokeColor: "#dc2626" },
        { strokeColor: "#16a34a" },
        { strokeColor: "#2563eb" },
      ],
      expected: { strokeColor: { hex: "#2563eb", opacity: 1 } },
    },
  ])("commits many $property previews as one exact undo/redo entry", ({ previews, expected }) => {
    const harness = createHarness();
    expect(harness.edit.begin(harness.original)).toBe(true);

    for (const preview of previews) {
      expect(harness.edit.update(preview)).toBe(true);
      expect(harness.coordinator.controller.getHistoryState().undoDepth).toBe(0);
      expect(Object.isFrozen(harness.session.collection.lookup(harness.original.id))).toBe(true);
    }

    expect(harness.edit.commit()).not.toBeNull();
    expect(harness.coordinator.controller.getHistoryState().undoDepth).toBe(1);
    expect(vectorStyle(harness)).toMatchObject(expected);

    harness.coordinator.undo();
    expect(vectorStyle(harness)).toStrictEqual(harness.original.style);
    expect(harness.coordinator.controller.getHistoryState()).toMatchObject({
      undoDepth: 0,
      redoDepth: 1,
    });

    harness.coordinator.redo();
    expect(vectorStyle(harness)).toMatchObject(expected);
    expect(harness.coordinator.controller.getHistoryState()).toMatchObject({
      undoDepth: 1,
      redoDepth: 0,
    });
  });

  it("restores the exact original style and creates no History entry when cancelled", () => {
    const harness = createHarness();
    harness.edit.begin(harness.original);
    harness.edit.update({ strokeWidth: 18 });
    harness.edit.update({ strokeColor: "#9333ea" });

    expect(harness.edit.cancel()).toBe(true);
    expect(vectorStyle(harness)).toStrictEqual(harness.original.style);
    expect(harness.coordinator.controller.getHistoryState()).toMatchObject({
      undoDepth: 0,
      redoDepth: 0,
      executionCounter: 0,
    });
  });
});

function createHarness() {
  const original = new ObjectFactory({ now: () => INITIAL_REVISION }).createRectangleObject({
    id: "continuous-style-rectangle",
    geometry: { x: 20, y: 30, width: 120, height: 80 },
  });
  const session = new InkDocumentSession();
  session.replaceDocument(new ObjectCollection([original]));
  const coordinator = createEditorHistoryCoordinator({
    documentSession: session,
    now: () => FINAL_REVISION,
    onDocumentChange: () => undefined,
  });
  const edit = new ContinuousVectorStyleEdit({
    documentSession: session,
    commit: (object, style) => coordinator.executeVectorStyleUpdate(object, style),
    onPreviewDocumentChange: () => undefined,
  });
  return { original, session, coordinator, edit };
}

function vectorStyle(harness: ReturnType<typeof createHarness>) {
  const object = harness.session.collection.lookup(harness.original.id);
  if (!isVectorObject(object)) throw new Error("Expected the vector edit target.");
  return object.style satisfies EditableStyleInput;
}
