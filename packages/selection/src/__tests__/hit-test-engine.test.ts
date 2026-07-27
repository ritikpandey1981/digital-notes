import { ObjectFactory } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { createHitTestEngine } from "../index";
import { createInkFixture, createObjectSource, pagePoint } from "./fixtures";

describe("HitTestEngine", () => {
  it("returns an immutable result containing the original object reference", () => {
    const object = createInkFixture();
    const engine = createHitTestEngine({ objectSource: createObjectSource([object]) });
    const result = engine.hitTest(pagePoint(50, 10));
    expect(result).toMatchObject({
      objectId: object.id,
      objectType: "ink",
      hitDistance: 0,
      hitConfidence: 1,
      hitPosition: { x: 50, y: 10, coordinateSpace: "page" },
    });
    expect(result?.objectReference).toBe(object);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.hitPosition)).toBe(true);
  });

  it("uses rendered stroke geometry plus configurable page-space tolerance", () => {
    const object = createInkFixture({ width: 4 });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([object]),
      configuration: { tolerance: 6 },
    });
    expect(engine.hitTest(pagePoint(50, 17))?.hitDistance).toBeCloseTo(5);
    expect(engine.hitTest(pagePoint(50, 19))).toBeNull();
  });

  it("includes the exact tolerance boundary and rejects points just beyond it", () => {
    const object = createInkFixture({ width: 4 });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([object]),
      configuration: { tolerance: 6 },
    });

    expect(engine.hitTest(pagePoint(50, 18))?.hitDistance).toBeCloseTo(6);
    expect(engine.hitTest(pagePoint(50, 18.001))).toBeNull();
  });

  it("supports single-point strokes without raster or canvas access", () => {
    const object = createInkFixture({ points: [{ x: 20, y: 30 }], width: 4 });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([object]),
      configuration: { tolerance: 3 },
    });
    expect(engine.hitTest(pagePoint(24, 30))?.objectId).toBe(object.id);
    expect(engine.hitTest(pagePoint(26, 30))).toBeNull();
  });

  it("rejects invisible and geometrically distant objects", () => {
    const hidden = createInkFixture({ id: "hidden", visible: false });
    const visible = createInkFixture({ id: "visible", points: [{ x: 500, y: 500 }] });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([hidden, visible]),
    });
    expect(engine.hitTest(pagePoint(20, 10))).toBeNull();
  });

  it("selects the highest z-order hit independently of input order", () => {
    const back = createInkFixture({ id: "back", zIndex: 1 });
    const front = createInkFixture({ id: "front", zIndex: 9 });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([front, back]),
    });
    expect(engine.hitTest(pagePoint(50, 10))?.objectId).toBe("front");
  });

  it("returns nearby hits top-most first and preserves locked objects as queryable", () => {
    const back = createInkFixture({ id: "back", zIndex: 1 });
    const front = createInkFixture({ id: "front", zIndex: 2, locked: true });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([back, front]),
    });
    const nearby = engine.queryNearby(pagePoint(50, 10));
    expect(nearby.map(({ objectId }) => objectId)).toEqual(["front", "back"]);
    expect(Object.isFrozen(nearby)).toBe(true);
  });

  it("returns empty outcomes for invalid coordinates, radii, and empty documents", () => {
    const engine = createHitTestEngine({ objectSource: createObjectSource([]) });
    expect(engine.hitTest(pagePoint(1, 1))).toBeNull();
    expect(engine.hitTest(pagePoint(Number.NaN, 1))).toBeNull();
    expect(engine.queryNearby(pagePoint(1, 1), -1)).toEqual([]);
    expect(() =>
      createHitTestEngine({
        objectSource: createObjectSource([]),
        configuration: { tolerance: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(RangeError);
  });

  it("remains deterministic for equal inputs", () => {
    const object = createInkFixture();
    const engine = createHitTestEngine({ objectSource: createObjectSource([object]) });
    const first = engine.hitTest(pagePoint(50, 12));
    const second = engine.hitTest(pagePoint(50, 12));
    expect(second).toEqual(first);
    expect(second?.objectReference).toBe(first?.objectReference);
  });

  it("evaluates geometry in the immutable object's translated coordinate frame", () => {
    const factory = new ObjectFactory({ now: () => "2026-07-27T10:00:01.000Z" });
    const original = createInkFixture();
    const translated = factory.translateObject(original, { x: 80, y: 45 });
    const engine = createHitTestEngine({ objectSource: createObjectSource([translated]) });

    expect(engine.hitTest(pagePoint(130, 55))?.objectReference).toBe(translated);
    expect(engine.hitTest(pagePoint(50, 10))).toBeNull();
  });

  it("supports large linear object sets without copying document objects", () => {
    const builder = new StrokeBuilder({
      id: "shared-stroke",
      timestamp: 0,
      smoother: new StrokeSmoother({ mode: "none" }),
    });
    builder.addPoint({
      x: 10,
      y: 10,
      timestamp: 0,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
    });
    const stroke = builder.finalize();
    const factory = new ObjectFactory({ now: () => "2026-07-27T10:00:00.000Z" });
    const objects = Array.from({ length: 5_000 }, (_, index) =>
      factory.createInkObject({ id: `object-${index}`, stroke, zIndex: index }),
    );
    const engine = createHitTestEngine({ objectSource: createObjectSource(objects) });
    expect(engine.hitTest(pagePoint(10, 10))?.objectId).toBe("object-4999");
    expect(objects[4_999]?.stroke).toBe(stroke);
  });
});
