import { InkObject, Layer, PageDocument, SketchbookDocument } from "@folio/document";
import { Stroke, type StrokePoint } from "@folio/ink";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContinuousLayerOpacityEdit } from "../ContinuousLayerOpacityEdit";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";

const TIMESTAMP = "2026-08-26T09:00:00.000Z";

function point(x: number, y: number, index: number): StrokePoint {
  return Object.freeze({
    x,
    y,
    timestamp: index,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen" as const,
    button: -1,
    buttons: 1,
    delta: Object.freeze({ x: 0, y: 0 }),
    velocity: 0,
    acceleration: 0,
  });
}

function stroke(id: string): Stroke {
  const points = [point(0, 0, 0), point(10, 10, 1)];
  const bounds = Object.freeze({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    center: Object.freeze({ x: 5, y: 5 }),
  });
  return new Stroke({
    id,
    timestamp: 0,
    points,
    style: {
      color: "#111111",
      width: 2,
      opacity: 1,
      pressureEnabled: false,
      lineCap: "round",
      lineJoin: "round",
    },
    metrics: {
      bounds,
      inflatedBounds: bounds,
      dirtyRect: Object.freeze({ x: 0, y: 0, width: 10, height: 10 }),
      center: Object.freeze({ x: 5, y: 5 }),
      length: 14,
      duration: 1,
    },
    statistics: {
      pointCount: 2,
      averagePressure: 0.5,
      minimumPressure: 0.5,
      maximumPressure: 0.5,
      averageVelocity: 0,
      minimumVelocity: 0,
      maximumVelocity: 0,
      averageAcceleration: 0,
      maximumAcceleration: 0,
    },
  });
}

function createSession(): InkDocumentSession {
  let counter = 0;
  return new InkDocumentSession({
    createId: () => `object-${(counter += 1)}`,
    now: () => TIMESTAMP,
  });
}

function createCoordinator(session: InkDocumentSession) {
  return createEditorHistoryCoordinator({
    documentSession: session,
    now: () => TIMESTAMP,
    onDocumentChange: () => undefined,
  });
}

function ids(session: InkDocumentSession): readonly string[] {
  return session.collection.objects.map((object) => object.id);
}

function membershipMatchesOrder(session: InkDocumentSession): boolean {
  const page = session.page;
  const membership = page.layers.flatMap((layer) => layer.objectIds);
  const canonical = page.objects.objects.map((object) => object.id);
  return (
    membership.length === canonical.length &&
    membership.every((objectId, index) => canonical[index] === objectId)
  );
}

describe("Phase 19 layer routing and History", () => {
  let session: InkDocumentSession;
  let coordinator: ReturnType<typeof createCoordinator>;

  beforeEach(() => {
    session = createSession();
    coordinator = createCoordinator(session);
  });

  it("starts with exactly one default active layer", () => {
    expect(session.page.layerCount).toBe(1);
    expect(session.page.bottomLayer.name).toBe("Layer 1");
    expect(session.activeLayerId).toBe("layer-1");
  });

  it("creates zero History when the active layer changes", () => {
    const { layerId } = coordinator.executeAddLayer();
    const depthAfterAdd = coordinator.controller.getHistoryState().undoDepth;

    expect(session.setActiveLayerId(layerId)).toBe(true);
    expect(session.setActiveLayerId(layerId)).toBe(false);
    expect(session.setActiveLayerId("missing")).toBe(false);
    expect(session.setActiveLayerId("layer-1")).toBe(true);

    expect(coordinator.controller.getHistoryState().undoDepth).toBe(depthAfterAdd);
  });

  it("inserts a new layer directly above the active layer", () => {
    const second = coordinator.executeAddLayer();
    session.setActiveLayerId("layer-1");
    const third = coordinator.executeAddLayer();

    expect(session.page.layers.map((layer) => layer.id)).toEqual([
      "layer-1",
      third.layerId,
      second.layerId,
    ]);
  });

  it("routes new ink into the active layer and keeps membership canonical", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    coordinator.executeStroke(session.createStrokeObject(stroke("b")));

    expect(session.page.layer("layer-1")?.objectIds).toHaveLength(1);
    expect(session.page.layer(layerId)?.objectIds).toHaveLength(1);
    expect(membershipMatchesOrder(session)).toBe(true);
  });

  it("routes new vector objects into the active layer", () => {
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    const rectangle = session.createRectangleObject(
      { x: 0, y: 0, width: 10, height: 10 },
      { strokeColor: "#111111", strokeWidth: 1 },
    );
    coordinator.executeObjectCreation(rectangle);

    expect(session.page.layer(layerId)?.objectIds).toEqual([rectangle.id]);
    expect(session.page.layer("layer-1")?.objectIds).toEqual([]);
  });

  it("routes paste into the active layer", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    const pasted = session.createRectangleObject(
      { x: 4, y: 4, width: 6, height: 6 },
      { strokeColor: "#222222", strokeWidth: 1 },
    );
    coordinator.executePaste([pasted]);

    expect(session.page.layer(layerId)?.objectIds).toEqual([pasted.id]);
    expect(membershipMatchesOrder(session)).toBe(true);
  });

  it("restores exact object, layer, and order when a delete is undone", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    coordinator.executeStroke(session.createStrokeObject(stroke("b")));
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    coordinator.executeStroke(session.createStrokeObject(stroke("c")));
    const before = ids(session);
    const target = session.collection.objects[0];
    expect(target).toBeDefined();

    coordinator.executeManipulation({
      kind: "delete",
      objectId: target!.id,
      sessionId: "delete-session",
    } as never);
    expect(ids(session)).not.toContain(target!.id);

    coordinator.undo();

    expect(ids(session)).toEqual(before);
    expect(session.page.layerIdForObject(target!.id)).toBe("layer-1");
    expect(session.page.layer("layer-1")?.indexOf(target!.id)).toBe(0);
    expect(membershipMatchesOrder(session)).toBe(true);
  });

  it("reorders layers through History and restores exact order on undo", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    coordinator.executeStroke(session.createStrokeObject(stroke("b")));
    const before = ids(session);

    coordinator.executeReorderLayer(layerId, 0);
    expect(ids(session)).toEqual([...before].reverse());

    coordinator.undo();
    expect(ids(session)).toEqual(before);

    coordinator.redo();
    expect(ids(session)).toEqual([...before].reverse());
    expect(membershipMatchesOrder(session)).toBe(true);
  });

  it("returns null when a layer reorder would not move the layer", () => {
    expect(coordinator.executeReorderLayer("layer-1", 0)).toBeNull();
  });

  it("deletes a non-empty layer as one command and restores it exactly", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    const { layerId } = coordinator.executeAddLayer();
    session.setActiveLayerId(layerId);
    coordinator.executeStroke(session.createStrokeObject(stroke("b")));
    coordinator.executeStroke(session.createStrokeObject(stroke("c")));
    const before = ids(session);
    const depthBefore = coordinator.controller.getHistoryState().undoDepth;

    const { removedObjectCount } = coordinator.executeRemoveLayer(layerId);

    expect(removedObjectCount).toBe(2);
    expect(session.page.layerCount).toBe(1);
    expect(session.collection.size).toBe(1);
    expect(coordinator.controller.getHistoryState().undoDepth).toBe(depthBefore + 1);

    coordinator.undo();

    expect(session.page.layerCount).toBe(2);
    expect(ids(session)).toEqual(before);
    expect(session.page.layer(layerId)?.objectIds).toHaveLength(2);
    expect(membershipMatchesOrder(session)).toBe(true);
  });

  it("never deletes the final remaining layer", () => {
    expect(() => coordinator.executeRemoveLayer("layer-1")).toThrow(/final remaining Layer/u);
  });

  it("records visibility, lock, and rename as one command each", () => {
    const depth = () => coordinator.controller.getHistoryState().undoDepth;
    const before = depth();

    coordinator.executeLayerPatch("layer-1", { visible: false });
    coordinator.executeLayerPatch("layer-1", { locked: true });
    coordinator.executeLayerPatch("layer-1", { name: "Sketch" });

    expect(depth()).toBe(before + 3);
    expect(session.page.layer("layer-1")?.visible).toBe(false);
    expect(session.page.layer("layer-1")?.locked).toBe(true);
    expect(session.page.layer("layer-1")?.name).toBe("Sketch");

    coordinator.undo();
    expect(session.page.layer("layer-1")?.name).toBe("Layer 1");
    coordinator.undo();
    expect(session.page.layer("layer-1")?.locked).toBe(false);
    coordinator.undo();
    expect(session.page.layer("layer-1")?.visible).toBe(true);
  });

  it("ignores a layer patch that changes nothing", () => {
    expect(coordinator.executeLayerPatch("layer-1", { visible: true })).toBeNull();
    expect(coordinator.executeLayerPatch("missing", { visible: false })).toBeNull();
  });

  it("moves one object between layers through History without UI", () => {
    coordinator.executeStroke(session.createStrokeObject(stroke("a")));
    const { layerId } = coordinator.executeAddLayer();
    const objectId = session.collection.objects[0]?.id;
    expect(objectId).toBeDefined();
    const before = ids(session);

    coordinator.executeMoveObjectToLayer(objectId!, layerId);
    expect(session.page.layerIdForObject(objectId!)).toBe(layerId);

    coordinator.undo();
    expect(session.page.layerIdForObject(objectId!)).toBe("layer-1");
    expect(ids(session)).toEqual(before);
    expect(coordinator.executeMoveObjectToLayer("missing", layerId)).toBeNull();
  });
});

describe("ContinuousLayerOpacityEdit", () => {
  it("collapses many previews into exactly one History command", () => {
    const session = createSession();
    const coordinator = createCoordinator(session);
    const preview = vi.fn();
    const edit = new ContinuousLayerOpacityEdit({
      documentSession: session,
      commit: (layerId, initialOpacity, finalOpacity) =>
        coordinator.executeLayerPatch(layerId, { opacity: finalOpacity }, "Layer opacity") ??
        coordinator.controller.getHistoryState(),
      onPreviewDocumentChange: preview,
    });
    const before = coordinator.controller.getHistoryState().undoDepth;

    expect(edit.begin("layer-1")).toBe(true);
    for (let step = 1; step <= 30; step += 1) edit.update(1 - step / 40);
    expect(preview).toHaveBeenCalledTimes(30);
    expect(coordinator.controller.getHistoryState().undoDepth).toBe(before);

    edit.commit();

    expect(coordinator.controller.getHistoryState().undoDepth).toBe(before + 1);
    expect(session.page.layer("layer-1")?.opacity).toBeCloseTo(0.25, 5);

    coordinator.undo();
    expect(session.page.layer("layer-1")?.opacity).toBe(1);
  });

  it("restores the original opacity and records nothing when cancelled", () => {
    const session = createSession();
    const coordinator = createCoordinator(session);
    const edit = new ContinuousLayerOpacityEdit({
      documentSession: session,
      commit: () => {
        throw new Error("Cancelled edits must not commit.");
      },
      onPreviewDocumentChange: () => undefined,
    });
    const before = coordinator.controller.getHistoryState().undoDepth;

    edit.begin("layer-1");
    edit.update(0.2);
    expect(session.page.layer("layer-1")?.opacity).toBe(0.2);

    expect(edit.cancel()).toBe(true);

    expect(session.page.layer("layer-1")?.opacity).toBe(1);
    expect(coordinator.controller.getHistoryState().undoDepth).toBe(before);
    expect(edit.active).toBe(false);
  });

  it("commits nothing when the final opacity equals the original", () => {
    const session = createSession();
    const edit = new ContinuousLayerOpacityEdit({
      documentSession: session,
      commit: () => {
        throw new Error("Unchanged opacity must not commit.");
      },
      onPreviewDocumentChange: () => undefined,
    });

    edit.begin("layer-1");
    edit.update(0.4);
    edit.update(1);

    expect(edit.commit()).toBeNull();
    expect(session.page.layer("layer-1")?.opacity).toBe(1);
  });

  it("refuses to begin on an unknown layer", () => {
    const session = createSession();
    const edit = new ContinuousLayerOpacityEdit({
      documentSession: session,
      commit: () => {
        throw new Error("Unreachable");
      },
      onPreviewDocumentChange: () => undefined,
    });
    expect(edit.begin("missing")).toBe(false);
    expect(edit.update(0.5)).toBe(false);
  });
});

describe("PageDocument History document boundary", () => {
  it("keeps layer structure inside the immutable History document", () => {
    const session = createSession();
    const document = session.getDocument();
    expect(document).toBeInstanceOf(SketchbookDocument);
    expect(document.firstPage.content).toBeInstanceOf(PageDocument);
    expect(document.firstPage.content.layers[0]).toBeInstanceOf(Layer);
    expect(session.collection.objects).toEqual([]);
    expect(
      session.page.layers.every((layer) =>
        layer.objectIds.every((objectId) => session.page.lookup(objectId) instanceof InkObject),
      ),
    ).toBe(true);
  });
});
