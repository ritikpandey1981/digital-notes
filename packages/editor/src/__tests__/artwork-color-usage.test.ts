import { pageOf } from "./layer-test-support";
import { ObjectFactory, isVectorObject } from "@folio/document";
import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { committedArtworkColor, committedVectorRecolor } from "../artwork-color-usage";
import { ContinuousVectorStyleEdit } from "../ContinuousVectorStyleEdit";
import { createEditorColorSystem } from "../foundation/color-system";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const factory = new ObjectFactory({ now: () => "2026-08-25T10:00:00.000Z" });

describe("authoritative committed-artwork color usage", () => {
  it("reads a committed Stroke instead of a later active-tool preference", () => {
    const builder = new StrokeBuilder({
      id: "recent-stroke",
      style: { color: "#2563EB", width: 4, opacity: 0.5 },
    });
    builder.addPoint({
      x: 10,
      y: 20,
      timestamp: 1,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
    const object = factory.createInkObject({ stroke: builder.finalize() });
    const activeToolColor = "#16a34a";

    const colors = createEditorColorSystem();
    colors.remember(committedArtworkColor(object));

    expect(activeToolColor).toBe("#16a34a");
    expect(object.stroke.style.color).toBe("#2563EB");
    expect(colors.snapshot().recentColors).toEqual(["#2563eb"]);
  });

  it("records committed Line, Rectangle, and Ellipse colors in MRU order", () => {
    const objects = [
      factory.createLineObject({
        id: "recent-line",
        geometry: { start: { x: 0, y: 0 }, end: { x: 50, y: 50 } },
        style: { strokeColor: "#dc2626" },
      }),
      factory.createRectangleObject({
        id: "recent-rectangle",
        geometry: { x: 0, y: 0, width: 50, height: 50 },
        style: { strokeColor: "#2563eb" },
      }),
      factory.createEllipseObject({
        id: "recent-ellipse",
        geometry: { center: { x: 25, y: 25 }, radiusX: 25, radiusY: 25 },
        style: { strokeColor: "#16a34a" },
      }),
    ];
    const colors = createEditorColorSystem();
    for (const object of objects) colors.remember(committedArtworkColor(object));
    expect(colors.snapshot().recentColors).toEqual(["#16a34a", "#2563eb", "#dc2626"]);
  });

  it("adds only the final net color from a successful continuous vector recolor", () => {
    const harness = createContinuousRecentHarness();
    harness.edit.begin(harness.original);
    harness.edit.update({ strokeColor: "#dc2626" });
    harness.edit.update({ strokeColor: "#2563eb" });
    expect(harness.colors.snapshot().recentColors).toEqual([]);

    expect(harness.edit.commit()).not.toBeNull();
    expect(harness.colors.snapshot().recentColors).toEqual(["#2563eb"]);
    expect(harness.coordinator.controller.getHistoryState().undoDepth).toBe(1);

    harness.coordinator.undo();
    harness.coordinator.redo();
    expect(harness.colors.snapshot().recentColors).toEqual(["#2563eb"]);
  });

  it("does not add Recent for width-only, cancelled, or net-no-op vector edits", () => {
    const width = createContinuousRecentHarness();
    width.edit.begin(width.original);
    width.edit.update({ strokeWidth: 8 });
    width.edit.commit();
    expect(width.colors.snapshot().recentColors).toEqual([]);

    const cancelled = createContinuousRecentHarness();
    cancelled.edit.begin(cancelled.original);
    cancelled.edit.update({ strokeColor: "#dc2626" });
    cancelled.edit.cancel();
    expect(cancelled.colors.snapshot().recentColors).toEqual([]);
    expect(cancelled.coordinator.controller.getHistoryState().undoDepth).toBe(0);

    const netNoOp = createContinuousRecentHarness();
    netNoOp.edit.begin(netNoOp.original);
    netNoOp.edit.update({ strokeColor: "#dc2626" });
    netNoOp.edit.update({ strokeColor: "#111111" });
    expect(netNoOp.edit.commit()).toBeNull();
    expect(netNoOp.colors.snapshot().recentColors).toEqual([]);
  });
});

function createContinuousRecentHarness() {
  const original = factory.createRectangleObject({
    id: `continuous-recent-${continuousHarnessIndex++}`,
    geometry: { x: 20, y: 30, width: 120, height: 80 },
    style: { strokeColor: "#111111", strokeWidth: 2 },
  });
  const session = new InkDocumentSession();
  session.replaceDocument(pageOf([original]));
  const colors = createEditorColorSystem();
  const coordinator = createEditorHistoryCoordinator({
    documentSession: session,
    now: () => "2026-08-25T10:00:00.001Z",
    onDocumentChange: () => undefined,
  });
  const edit = new ContinuousVectorStyleEdit({
    documentSession: session,
    commit: (object, style) => {
      const state = coordinator.executeVectorStyleUpdate(object, style);
      const committed = session.collection.lookup(object.id);
      if (!isVectorObject(committed)) throw new Error("Expected committed vector object.");
      const color = committedVectorRecolor(object, committed);
      if (color !== null) colors.remember(color);
      return state;
    },
    onPreviewDocumentChange: () => undefined,
    isEditable: (object) => object.visible && !object.locked,
  });
  return { original, session, colors, coordinator, edit };
}

let continuousHarnessIndex = 0;
