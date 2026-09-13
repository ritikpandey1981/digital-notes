import { describe, expect, it } from "vitest";
import { ObjectFactory, isVectorObject } from "@folio/document";
import { pageOf } from "./layer-test-support";
import { ContinuousSelectionStyleEdit } from "../ContinuousSelectionStyleEdit";
import { InkDocumentSession } from "../InkDocumentSession";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";

/** Every durable style member a vector object can carry beyond stroke and fill. */
const DECORATED_STYLE = {
  strokeColor: { hex: "#2563eb", opacity: 0.85 },
  strokeWidth: 3.25,
  fillColor: { hex: "#fde68a", opacity: 0.5 },
  lineStyle: "dashed" as const,
  shadow: {
    color: { hex: "#0f172a", rgb: { red: 15, green: 23, blue: 42 }, opacity: 0.4 },
    offsetX: 2,
    offsetY: 3,
    blur: 6,
  },
  blendMode: "multiply" as const,
};

function createHarness() {
  const factory = new ObjectFactory();
  const rectangle = factory.createRectangleObject({
    id: "object-rectangle",
    createdAt: "2026-09-13T08:00:00.000Z",
    modifiedAt: "2026-09-13T08:00:00.000Z",
    geometry: { x: 10, y: 10, width: 80, height: 40 },
    style: DECORATED_STYLE,
  });
  const session = new InkDocumentSession();
  session.replacePageDocument(pageOf([rectangle]));
  const coordinator = createEditorHistoryCoordinator({
    documentSession: session,
    now: () => "2026-09-13T08:00:00.001Z",
    onDocumentChange: () => undefined,
  });
  const edit = new ContinuousSelectionStyleEdit({
    documentSession: session,
    commit: (edits) => coordinator.executeSelectionStyleUpdate(edits),
    onPreviewDocumentChange: () => undefined,
    isEditable: () => true,
  });
  const styleOf = (id: string) => {
    const object = session.collection.lookup(id);
    if (!isVectorObject(object)) throw new Error("expected a vector object");
    return object.style;
  };
  return {
    rectangle,
    session,
    coordinator,
    edit,
    styleOf,
    cleanup: () => coordinator.destroy(),
  };
}

describe("editing one style property leaves the rest alone", () => {
  it.each([
    { name: "colour", patch: { color: "#dc2626" } },
    { name: "width", patch: { width: 9 } },
    { name: "opacity", patch: { opacity: 0.25 } },
  ])("preserves every unrelated durable field while changing $name", ({ patch }) => {
    const h = createHarness();
    try {
      expect(h.edit.begin([h.rectangle.id])).toBe(true);
      expect(h.edit.update(patch)).toBe(true);

      // The preview already has to be right: it is what a save would capture.
      const preview = h.styleOf(h.rectangle.id);
      expect(preview.lineStyle, "lineStyle was dropped").toBe("dashed");
      expect(preview.shadow, "shadow was dropped").toEqual(h.rectangle.style.shadow);
      expect(preview.blendMode, "blendMode was dropped").toBe("multiply");
      expect(preview.fillColor?.hex).toBe("#fde68a");

      expect(h.edit.commit()).not.toBeNull();
      const committed = h.styleOf(h.rectangle.id);
      expect(committed.lineStyle).toBe("dashed");
      expect(committed.shadow).toEqual(h.rectangle.style.shadow);
      expect(committed.blendMode).toBe("multiply");
    } finally {
      h.cleanup();
    }
  });

  it("changes only what the patch names", () => {
    const h = createHarness();
    try {
      h.edit.begin([h.rectangle.id]);
      h.edit.update({ color: "#dc2626" });
      h.edit.commit();

      const style = h.styleOf(h.rectangle.id);
      expect(style.strokeColor.hex).toBe("#dc2626");
      // Stroke opacity and width were not part of the patch.
      expect(style.strokeColor.opacity).toBe(0.85);
      expect(style.strokeWidth).toBe(3.25);
      // Fill keeps its own independent alpha rather than inheriting the stroke's.
      expect(style.fillColor?.opacity).toBe(0.5);
    } finally {
      h.cleanup();
    }
  });

  it("keeps the decorated style through undo and redo", () => {
    const h = createHarness();
    try {
      h.edit.begin([h.rectangle.id]);
      h.edit.update({ width: 9 });
      h.edit.commit();

      h.coordinator.controller.undo();
      expect(h.styleOf(h.rectangle.id)).toEqual(
        expect.objectContaining({ strokeWidth: 3.25, lineStyle: "dashed", blendMode: "multiply" }),
      );
      h.coordinator.controller.redo();
      expect(h.styleOf(h.rectangle.id)).toEqual(
        expect.objectContaining({ strokeWidth: 9, lineStyle: "dashed", blendMode: "multiply" }),
      );
    } finally {
      h.cleanup();
    }
  });

  it("restores the decorated style when a preview is abandoned", () => {
    const h = createHarness();
    try {
      const before = h.styleOf(h.rectangle.id);
      h.edit.begin([h.rectangle.id]);
      h.edit.update({ color: "#dc2626" });
      h.edit.cancel();

      expect(h.styleOf(h.rectangle.id)).toEqual(before);
    } finally {
      h.cleanup();
    }
  });
});

describe("object collection is untouched by style edits", () => {
  it("keeps every other object exactly as it was", () => {
    const h = createHarness();
    try {
      h.edit.begin([h.rectangle.id]);
      h.edit.update({ color: "#dc2626" });
      h.edit.commit();

      expect(h.styleOf(h.rectangle.id).blendMode).toBe("multiply");
    } finally {
      h.cleanup();
    }
  });
});
