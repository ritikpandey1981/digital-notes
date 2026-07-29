import { ObjectCollection, ObjectFactory, Transform } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type { PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import { createEditorSelectionHitTestEngine } from "../EditorSelectionHitTestEngine";
import {
  resolveSelectionManipulationHit,
  resolveSelectionManipulationTarget,
  selectionManipulationCursorCss,
} from "../SelectionManipulationTarget";

describe("editor selection hit policy", () => {
  it("selects inside transformed object bounds even away from stroke geometry", () => {
    const object = createObject("bounds-target", 0);
    const collection = new ObjectCollection([object]);
    const engine = createEditorSelectionHitTestEngine({
      getObjects: () => collection.objects,
      getObject: (objectId) => collection.lookup(objectId),
    });

    const result = engine.hitTest(pagePoint(80, 10));

    expect(result).toMatchObject({ objectId: object.id, hitDistance: 0, hitConfidence: 1 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps bounds hits deterministic, top-most first, and ignores hidden objects", () => {
    const bottom = createObject("bottom", 0);
    const top = createObject("top", 1);
    const hidden = createObject("hidden", 2, false);
    const collection = new ObjectCollection([bottom, top, hidden]);
    const engine = createEditorSelectionHitTestEngine({
      getObjects: () => collection.objects,
      getObject: (objectId) => collection.lookup(objectId),
    });

    expect(engine.hitTest(pagePoint(50, 20))?.objectId).toBe(top.id);
    expect(engine.queryNearby(pagePoint(102, 50), 3).map(({ objectId }) => objectId)).toEqual([
      top.id,
      bottom.id,
    ]);
    expect(engine.queryNearby(pagePoint(110, 50), 2)).toEqual([]);
  });
});

describe("Select tool manipulation targeting", () => {
  const bounds = Object.freeze({ x: 10, y: 20, width: 100, height: 40 });

  it("routes object interiors to translation", () => {
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(60, 40), zoom: 2 }),
    ).toBe("translation");
  });

  it("routes corner handles to scale and the upper handle to rotation", () => {
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(8, 18), zoom: 2 }),
    ).toBe("scale");
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(60, 4), zoom: 2 }),
    ).toBe("rotation");
  });

  it("uses screen-stable handle hit regions and rejects unrelated page space", () => {
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(2, 12), zoom: 1 }),
    ).toBe("scale");
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(0, 100), zoom: 1 }),
    ).toBeNull();
  });

  it("uses a larger screen-space handle target without activating unrelated points", () => {
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(-5, 16), zoom: 1 }),
    ).toBe("scale");
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(-7, 16), zoom: 1 }),
    ).toBeNull();
    expect(
      resolveSelectionManipulationTarget({ bounds, position: pagePoint(2.5, 18), zoom: 2 }),
    ).toBe("scale");
  });

  it("maps every hover region to the platform cursor for its upcoming manipulation", () => {
    const cases = [
      { position: pagePoint(8, 18), kind: "scale", cursor: "nwse-resize" },
      { position: pagePoint(112, 18), kind: "scale", cursor: "nesw-resize" },
      { position: pagePoint(8, 62), kind: "scale", cursor: "nesw-resize" },
      { position: pagePoint(112, 62), kind: "scale", cursor: "nwse-resize" },
      { position: pagePoint(60, 4), kind: "rotation", cursor: "rotation" },
      { position: pagePoint(60, 40), kind: "translation", cursor: "grab" },
    ] as const;

    for (const expected of cases) {
      expect(
        resolveSelectionManipulationHit({ bounds, position: expected.position, zoom: 2 }),
      ).toEqual({ kind: expected.kind, cursor: expected.cursor });
    }
    expect(
      resolveSelectionManipulationHit({ bounds, position: pagePoint(0, 100), zoom: 2 }),
    ).toBeNull();
    expect(selectionManipulationCursorCss("rotation")).toMatch(
      /^url\("data:image\/svg\+xml,.+"\) 12 12, crosshair$/u,
    );
    expect(selectionManipulationCursorCss("grab")).toBe("grab");
    expect(selectionManipulationCursorCss("grabbing")).toBe("grabbing");
  });
});

function createObject(id: string, zIndex: number, visible = true) {
  return new ObjectFactory({ now: () => "2026-07-28T08:00:00.000Z" }).createInkObject({
    id,
    zIndex,
    visible,
    stroke: createStroke(id),
    transform: new Transform(),
  });
}

function createStroke(id: string) {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const [x, y, timestamp] of [
    [0, 0, 0],
    [100, 100, 10],
  ] as const) {
    builder.addPoint({
      x,
      y,
      timestamp,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  }
  return builder.finalize();
}

function pagePoint(x: number, y: number): PagePoint {
  return Object.freeze({ x, y, coordinateSpace: "page" });
}
