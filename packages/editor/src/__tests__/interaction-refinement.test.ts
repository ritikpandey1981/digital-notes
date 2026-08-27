import { ObjectCollection, ObjectFactory, Transform } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type { PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import {
  createEditorSelectionHitTestEngine,
  queryEditorSelectionCandidates,
} from "../EditorSelectionHitTestEngine";
import {
  resolveSelectionManipulationHit,
  resolveSelectionManipulationTarget,
  resolveOrientedSelectionFrame,
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

  it("returns every selectable overlap in deterministic order and excludes locked objects", () => {
    const bottom = createObject("bottom", 0);
    const top = createObject("top", 1);
    const locked = new ObjectFactory({ now: () => "2026-07-28T08:00:00.000Z" }).createInkObject({
      id: "locked",
      zIndex: 2,
      locked: true,
      stroke: createStroke("locked"),
    });
    const collection = new ObjectCollection([bottom, top, locked]);
    const engine = createEditorSelectionHitTestEngine({
      getObjects: () => collection.objects,
      getObject: (objectId) => collection.lookup(objectId),
    });

    expect(
      queryEditorSelectionCandidates(engine, pagePoint(50, 20)).map(({ objectId }) => objectId),
    ).toEqual([top.id, bottom.id]);
    expect(engine.hitTest(pagePoint(50, 20))?.objectId).toBe(top.id);
  });

  it("selects unfilled rectangle and ellipse interiors through the editor policy", () => {
    const factory = new ObjectFactory({ now: () => "2026-07-31T08:00:00.000Z" });
    const rectangle = factory.createRectangleObject({
      id: "rectangle-interior",
      geometry: { x: 20, y: 30, width: 120, height: 80 },
    });
    const ellipse = factory.createEllipseObject({
      id: "ellipse-interior",
      geometry: { center: { x: 250, y: 100 }, radiusX: 60, radiusY: 40 },
    });
    const collection = new ObjectCollection([rectangle, ellipse]);
    const engine = createEditorSelectionHitTestEngine({
      getObjects: () => collection.objects,
      getObject: (objectId) => collection.lookup(objectId),
    });

    expect(engine.hitTest(pagePoint(80, 70))?.objectId).toBe(rectangle.id);
    expect(engine.hitTest(pagePoint(250, 100))?.objectId).toBe(ellipse.id);
  });

  it("keeps the editor hit target screen-stable at practical zoom extremes", () => {
    const object = createObject("zoom-target", 0);
    const collection = new ObjectCollection([object]);
    let zoom = 0.25;
    const engine = createEditorSelectionHitTestEngine(
      {
        getObjects: () => collection.objects,
        getObject: (objectId) => collection.lookup(objectId),
      },
      () => zoom,
    );

    expect(engine.hitTest(pagePoint(107, 50))?.objectId).toBe(object.id);
    zoom = 4;
    expect(engine.hitTest(pagePoint(107, 50))).toBeNull();
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
      /^url\("data:image\/svg\+xml,.+"\) 16 16, crosshair$/u,
    );
    expect(selectionManipulationCursorCss("grab")).toBe("grab");
    expect(selectionManipulationCursorCss("grabbing")).toBe("grabbing");
  });

  it("rotates frame handles and hit testing with a single vector object's local bounds", () => {
    const localBounds = Object.freeze({ x: 10, y: 20, width: 100, height: 40 });
    const transform = new Transform({
      translation: { x: 30, y: 15 },
      rotation: Math.PI / 4,
      scale: 1.5,
    });
    const frame = resolveOrientedSelectionFrame(localBounds, transform, 2);
    const transformedBounds = transform.transformBounds(localBounds);

    expect(frame.rotation).toBe(Math.PI / 4);
    expect(
      Math.hypot(
        frame.corners[0]!.x - frame.corners[1]!.x,
        frame.corners[0]!.y - frame.corners[1]!.y,
      ),
    ).toBeCloseTo(154);
    expect(
      resolveSelectionManipulationHit({
        bounds: transformedBounds,
        localBounds,
        transform,
        position: pagePoint(frame.corners[0]!.x, frame.corners[0]!.y),
        zoom: 2,
      })?.kind,
    ).toBe("scale");
    expect(
      resolveSelectionManipulationHit({
        bounds: transformedBounds,
        localBounds,
        transform,
        position: pagePoint(frame.rotationHandle.x, frame.rotationHandle.y),
        zoom: 2,
      })?.kind,
    ).toBe("rotation");
    expect(
      resolveSelectionManipulationHit({
        bounds: transformedBounds,
        localBounds,
        transform,
        position: pagePoint(frame.center.x, frame.center.y),
        zoom: 2,
      })?.kind,
    ).toBe("translation");
  });

  it.each([0, 30, 45, 60, 90, 180, 270])(
    "keeps every oriented corner hittable at %s degrees with matching resize cursors",
    (degrees) => {
      const localBounds = Object.freeze({ x: 20, y: 40, width: 180, height: 24 });
      const pivot = Object.freeze({ x: 80, y: 52 });
      const transform = new Transform({
        translation: { x: 35, y: -10 },
        rotation: (degrees * Math.PI) / 180,
        scale: 1.25,
      });
      const frame = resolveOrientedSelectionFrame(localBounds, transform, 1.5, pivot);

      for (const corner of frame.corners) {
        const hit = resolveSelectionManipulationHit({
          bounds: transform.transformBounds(localBounds),
          localBounds,
          transform,
          pivot,
          position: pagePoint(corner.x, corner.y),
          zoom: 1.5,
        });
        expect(hit?.kind).toBe("scale");
        expect(hit?.cursor).toMatch(/^(?:ew|ns|nwse|nesw)-resize$/u);
      }
    },
  );

  it("uses the explicit Ink pivot for oriented body and handle hit testing", () => {
    const localBounds = Object.freeze({ x: 10, y: 90, width: 220, height: 18 });
    const pivot = Object.freeze({ x: 60, y: 40 });
    const transform = new Transform({ rotation: Math.PI / 3, scale: 1.4 });
    const frame = resolveOrientedSelectionFrame(localBounds, transform, 2, pivot);

    expect(
      resolveSelectionManipulationHit({
        bounds: transform.transformBounds(localBounds),
        localBounds,
        transform,
        pivot,
        position: pagePoint(frame.corners[2]!.x, frame.corners[2]!.y),
        zoom: 2,
      })?.kind,
    ).toBe("scale");
    expect(
      resolveSelectionManipulationHit({
        bounds: transform.transformBounds(localBounds),
        localBounds,
        transform,
        pivot,
        position: pagePoint(frame.center.x, frame.center.y),
        zoom: 2,
      })?.kind,
    ).toBe("translation");
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
