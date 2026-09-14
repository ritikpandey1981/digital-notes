import {
  createDefaultLayer,
  InkObject,
  isVectorObject,
  ObjectCollection,
  ObjectFactory,
  PageDocument,
  type PageObject,
} from "@folio/document";
import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { ContinuousSelectionStyleEdit } from "../ContinuousSelectionStyleEdit";
import { createEffectiveObjectState } from "../EffectiveObjectState";
import { EditorSelectionSet } from "../EditorSelectionSet";
import { createEditorHistoryCoordinator } from "../history/editor-history-coordinator";
import { InkDocumentSession } from "../InkDocumentSession";
import { applyInkStyle, inkStyleChanges, inkStyleValues } from "../InkStyleEdit";
import {
  marqueeActivated,
  marqueeRectFromPoints,
  marqueeSelectedObjects,
} from "../MarqueeSelection";
import { resolveSelectionEditingStyle, selectionUnionBounds } from "../SelectionEditingSnapshot";

const TIMESTAMP = "2026-08-26T09:00:00.000Z";
const factory = new ObjectFactory({ now: () => TIMESTAMP });

function rectangle(id: string, x: number, options: { locked?: boolean } = {}): PageObject {
  return factory.createRectangleObject({
    id,
    geometry: { x, y: 0, width: 20, height: 20 },
    style: { strokeColor: "#111111", strokeWidth: 2 },
    ...(options.locked === undefined ? {} : { locked: options.locked }),
  });
}

function inkObject(id: string, x = 0): InkObject {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    style: { color: "#2563eb", width: 4, opacity: 0.8 },
  });
  for (let step = 0; step < 4; step += 1) {
    builder.addPoint({
      x: x + step * 5,
      y: step * 5,
      timestamp: step,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  }
  return factory.createInkObject({ id, stroke: builder.finalize() });
}

function pageOf(
  objects: readonly PageObject[],
  layerState: { locked?: boolean } = {},
): PageDocument {
  const layer = createDefaultLayer()
    .withPatch(layerState)
    .withObjectIds(objects.map((object) => object.id));
  return new PageDocument({ layers: [layer], objects: new ObjectCollection(objects) });
}

describe("multi-selection model", () => {
  it("adds and removes members while preserving order", () => {
    const selection = new EditorSelectionSet();
    selection.replace(["a", "b"]);
    expect(selection.toggle("c")).toEqual(["a", "b", "c"]);
    expect(selection.toggle("b")).toEqual(["a", "c"]);
    expect(selection.size).toBe(2);
  });

  it("promotes a re-added object to primary", () => {
    const selection = new EditorSelectionSet();
    selection.replace(["a", "b", "c"]);
    selection.toggle("a");
    expect(selection.toggle("a")).toEqual(["b", "c", "a"]);
    expect(selection.ids.at(-1)).toBe("a");
  });

  it("ignores blank ids and deduplicates additions", () => {
    const selection = new EditorSelectionSet();
    selection.replace(["a"]);
    expect(selection.toggle("  ")).toEqual(["a"]);
    expect(selection.add(["a", "b", "b"])).toEqual(["a", "b"]);
  });

  it("returns selected objects in canonical document order", () => {
    const collection = new ObjectCollection([
      rectangle("a", 0),
      rectangle("b", 40),
      rectangle("c", 80),
    ]);
    const selection = new EditorSelectionSet();
    selection.replace(["c", "a"]);
    expect(selection.selectedObjects(collection).map(({ id }) => id)).toEqual(["a", "c"]);
  });

  it("drops removed objects when reconciling", () => {
    const selection = new EditorSelectionSet();
    selection.replace(["a", "b"]);
    selection.reconcile(new ObjectCollection([rectangle("a", 0)]));
    expect(selection.ids).toEqual(["a"]);
  });
});

describe("marquee selection", () => {
  const objects = [rectangle("a", 0), rectangle("b", 40), rectangle("c", 200)];

  it("normalizes rectangles drawn in any direction", () => {
    expect(marqueeRectFromPoints({ x: 40, y: 30 }, { x: 10, y: 5 })).toEqual({
      x: 10,
      y: 5,
      width: 30,
      height: 25,
    });
  });

  it("requires a minimum drag before activating", () => {
    expect(marqueeActivated({ x: 0, y: 0 }, { x: 2, y: 0 })).toBe(false);
    expect(marqueeActivated({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it("selects intersecting objects in canonical order", () => {
    const rect = marqueeRectFromPoints({ x: -5, y: -5 }, { x: 50, y: 50 });
    expect(marqueeSelectedObjects(objects, rect, () => true).map(({ id }) => id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns nothing for a zero-area region", () => {
    const rect = marqueeRectFromPoints({ x: 10, y: 10 }, { x: 10, y: 10 });
    expect(marqueeSelectedObjects(objects, rect, () => true)).toEqual([]);
  });

  it("respects the injected eligibility predicate", () => {
    const page = pageOf(objects, { locked: true });
    const effective = createEffectiveObjectState(() => page);
    const rect = marqueeRectFromPoints({ x: -5, y: -5 }, { x: 300, y: 50 });
    // Locked layers stay selectable read-only.
    expect(marqueeSelectedObjects(objects, rect, effective.pointerSelectable)).toHaveLength(3);

    const hidden = pageOf(objects).updateLayer("layer-1", { visible: false });
    const hiddenState = createEffectiveObjectState(() => hidden);
    expect(marqueeSelectedObjects(objects, rect, hiddenState.pointerSelectable)).toEqual([]);
  });

  it("excludes individually locked objects from pointer selection", () => {
    const locked = rectangle("locked", 0, { locked: true });
    const page = pageOf([locked]);
    const effective = createEffectiveObjectState(() => page);
    expect(effective.selectable(locked)).toBe(true);
    expect(effective.pointerSelectable(locked)).toBe(false);
  });
});

describe("selection editing snapshot", () => {
  it("reports a single kind and the primary object's values", () => {
    const style = resolveSelectionEditingStyle([rectangle("a", 0), rectangle("b", 40)]);
    expect(style).toMatchObject({ kind: "rectangle", strokeColor: "#111111", strokeWidth: 2 });
  });

  it("reports mixed selections and reads Ink from its resolved brush", () => {
    const ink = inkObject("ink");
    const mixed = resolveSelectionEditingStyle([rectangle("a", 0), ink]);
    expect(mixed?.kind).toBe("mixed");
    expect(mixed?.strokeColor).toBe(ink.stroke.brush.color);
    expect(resolveSelectionEditingStyle([ink])?.kind).toBe("ink");
    expect(resolveSelectionEditingStyle([])).toBeNull();
  });

  it("unions bounds across a mixed selection", () => {
    const first = rectangle("a", 0);
    const second = rectangle("b", 100);
    const bounds = selectionUnionBounds([first, second]);
    expect(bounds?.x).toBe(first.bounds.x);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBe(second.bounds.x + second.bounds.width);
    expect(selectionUnionBounds([])).toBeNull();
  });
});

describe("selected Ink appearance", () => {
  it("reads committed values from the resolved brush snapshot", () => {
    const ink = inkObject("ink");
    expect(inkStyleValues(ink)).toEqual({
      color: ink.stroke.brush.color,
      width: ink.stroke.brush.size,
      opacity: ink.stroke.brush.opacity,
    });
    expect(inkStyleChanges(ink, { color: ink.stroke.brush.color })).toBe(false);
    expect(inkStyleChanges(ink, { color: "#dc2626" })).toBe(true);
  });

  it("replaces appearance while preserving identity and process data", () => {
    const ink = inkObject("ink");
    const next = applyInkStyle(
      ink,
      { color: "#dc2626", width: 9, opacity: 0.4 },
      factory,
      TIMESTAMP,
    );

    expect(next.id).toBe(ink.id);
    expect(next.createdAt).toBe(ink.createdAt);
    expect(next.zIndex).toBe(ink.zIndex);
    expect(next.transform).toBe(ink.transform);
    // Process data is carried over by reference: recoloring never disturbs it.
    // Stroke re-freezes its arrays, so process data is preserved by value.
    expect(next.stroke.points).toEqual(ink.stroke.points);
    expect(next.stroke.sourceSamples).toEqual(ink.stroke.sourceSamples);
    expect(next.stroke.timestamp).toBe(ink.stroke.timestamp);
    expect(next.stroke.brush.dynamics).toEqual(ink.stroke.brush.dynamics);
    expect(next.stroke.brush.renderer).toEqual(ink.stroke.brush.renderer);
    expect(inkStyleValues(next)).toEqual({ color: "#dc2626", width: 9, opacity: 0.4 });
    expect(inkStyleValues(ink).color).toBe(ink.stroke.brush.color);
  });

  it("rejects invalid width and opacity", () => {
    const ink = inkObject("ink");
    expect(() => applyInkStyle(ink, { width: 0 }, factory, TIMESTAMP)).toThrow(RangeError);
    expect(() => applyInkStyle(ink, { opacity: 2 }, factory, TIMESTAMP)).toThrow(RangeError);
  });
});

describe("continuous selection style editing", () => {
  function harness(objects: readonly PageObject[]) {
    const session = new InkDocumentSession();
    session.replacePageDocument(pageOf(objects));
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const effective = createEffectiveObjectState(() => session.page);
    const edit = new ContinuousSelectionStyleEdit({
      documentSession: session,
      commit: (edits) => coordinator.executeSelectionStyleUpdate(edits),
      onPreviewDocumentChange: () => undefined,
      isEditable: effective.editable,
    });
    return { session, coordinator, edit };
  }

  it("collapses many previews over a mixed selection into one History action", () => {
    const objects = [rectangle("rect", 0), inkObject("ink", 100)];
    const { session, coordinator, edit } = harness(objects);
    const depth = () => coordinator.controller.getHistoryState().undoDepth;

    expect(edit.begin(["rect", "ink"])).toBe(true);
    for (let step = 1; step <= 20; step += 1) edit.update({ width: step });
    edit.update({ color: "#16a34a" });
    expect(depth()).toBe(0);

    expect(edit.commit()).not.toBeNull();
    expect(depth()).toBe(1);

    const rect = session.collection.lookup("rect");
    const ink = session.collection.lookup("ink");
    expect(isVectorObject(rect) ? rect.style.strokeColor.hex : null).toBe("#16a34a");
    expect(ink instanceof InkObject ? inkStyleValues(ink).color : null).toBe("#16a34a");

    coordinator.undo();
    expect(depth()).toBe(0);
    const restoredInk = session.collection.lookup("ink");
    expect(restoredInk instanceof InkObject ? inkStyleValues(restoredInk).color : null).toBe(
      "#2563eb",
    );
  });

  it("restores exact originals and records nothing when cancelled", () => {
    const objects = [rectangle("rect", 0), inkObject("ink", 100)];
    const { session, coordinator, edit } = harness(objects);
    const before = session.collection.objects;

    edit.begin(["rect", "ink"]);
    edit.update({ color: "#dc2626", opacity: 0.2 });
    expect(session.collection.objects).not.toEqual(before);

    expect(edit.cancel()).toBe(true);
    expect(session.collection.objects.map(({ id }) => id)).toEqual(["rect", "ink"]);
    expect(session.collection.lookup("rect")).toBe(before[0]);
    expect(session.collection.lookup("ink")).toBe(before[1]);
    expect(coordinator.controller.getHistoryState().undoDepth).toBe(0);
  });

  it("commits nothing when the net appearance is unchanged", () => {
    const { edit } = harness([rectangle("rect", 0)]);
    edit.begin(["rect"]);
    edit.update({ color: "#dc2626" });
    edit.update({ color: "#111111" });
    expect(edit.commit()).toBeNull();
  });

  it("refuses to begin on a locked layer", () => {
    const session = new InkDocumentSession();
    session.replacePageDocument(pageOf([rectangle("rect", 0)], { locked: true }));
    const effective = createEffectiveObjectState(() => session.page);
    const edit = new ContinuousSelectionStyleEdit({
      documentSession: session,
      commit: () => null,
      onPreviewDocumentChange: () => undefined,
      isEditable: effective.editable,
    });
    expect(edit.begin(["rect"])).toBe(false);
  });
});

describe("selection layer operations", () => {
  it("moves an entire selection into one layer as a single History action", () => {
    const session = new InkDocumentSession();
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const first = session.createRectangleObject(
      { x: 0, y: 0, width: 10, height: 10 },
      { strokeColor: "#111111", strokeWidth: 1 },
    );
    coordinator.executeObjectCreation(first);
    const second = session.createRectangleObject(
      { x: 20, y: 0, width: 10, height: 10 },
      { strokeColor: "#111111", strokeWidth: 1 },
    );
    coordinator.executeObjectCreation(second);
    const { layerId } = coordinator.executeAddLayer();
    const before = session.collection.objects.map(({ id }) => id);
    const depth = coordinator.controller.getHistoryState().undoDepth;

    const state = coordinator.executeMoveObjectsToLayer([first.id, second.id], layerId);

    expect(state).not.toBeNull();
    expect(coordinator.controller.getHistoryState().undoDepth).toBe(depth + 1);
    expect(session.page.layerIdForObject(first.id)).toBe(layerId);
    expect(session.page.layerIdForObject(second.id)).toBe(layerId);
    expect(session.page.layer("layer-1")?.objectIds).toEqual([]);

    coordinator.undo();
    expect(session.collection.objects.map(({ id }) => id)).toEqual(before);
    expect(session.page.layerIdForObject(first.id)).toBe("layer-1");
    expect(session.page.layers.flatMap((layer) => layer.objectIds)).toEqual(
      session.collection.objects.map(({ id }) => id),
    );
  });

  it("ignores a move that would not change membership", () => {
    const session = new InkDocumentSession();
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const object = session.createRectangleObject(
      { x: 0, y: 0, width: 10, height: 10 },
      { strokeColor: "#111111", strokeWidth: 1 },
    );
    coordinator.executeObjectCreation(object);
    expect(coordinator.executeMoveObjectsToLayer([object.id], "layer-1")).toBeNull();
    expect(coordinator.executeMoveObjectsToLayer([], "layer-1")).toBeNull();
  });
});

describe("Phase 20 performance", () => {
  it("marquees 1,000 objects and group-transforms 100 within one gesture budget", () => {
    const objects = Array.from({ length: 1_000 }, (_, index) =>
      rectangle(`object-${index}`, index * 30),
    );
    const page = pageOf(objects);
    const effective = createEffectiveObjectState(() => page);
    const rect = marqueeRectFromPoints({ x: -10, y: -10 }, { x: 30_010, y: 60 });

    const marqueeStart = performance.now();
    const covered = marqueeSelectedObjects(objects.slice(), rect, effective.pointerSelectable);
    const marqueeMilliseconds = performance.now() - marqueeStart;
    expect(covered).toHaveLength(1_000);

    const session = new InkDocumentSession();
    session.replacePageDocument(pageOf(objects.slice(0, 100)));
    const coordinator = createEditorHistoryCoordinator({
      documentSession: session,
      now: () => TIMESTAMP,
      onDocumentChange: () => undefined,
    });
    const results = session.collection.objects.map((object) => ({
      kind: "translation" as const,
      objectId: object.id,
      sessionId: "group-move",
      sessionTimestamp: 1,
      translation: { translationX: 12, translationY: 8 },
      initialObjectTranslation: {
        x: object.transform.translation.x,
        y: object.transform.translation.y,
      },
      finalObjectTranslation: {
        x: object.transform.translation.x + 12,
        y: object.transform.translation.y + 8,
      },
    }));
    const transformStart = performance.now();
    coordinator.executeManipulations(results as never, {
      id: "group-move",
      description: "Move 100 selected objects",
    });
    const transformMilliseconds = performance.now() - transformStart;

    expect(coordinator.controller.getHistoryState().undoDepth).toBe(1);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
      expect(marqueeMilliseconds).toBeLessThan(50);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1")
      expect(transformMilliseconds).toBeLessThan(600);
    console.info("Phase 20 selection performance (ms)", {
      marqueeMilliseconds,
      transformMilliseconds,
    });
  });
});
