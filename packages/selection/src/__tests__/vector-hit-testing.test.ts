import { ObjectFactory, Transform } from "@folio/document";
import { describe, expect, it } from "vitest";
import { createHitTestEngine } from "../index";
import { createObjectSource, pagePoint } from "./fixtures";

const create = new ObjectFactory({
  now: () => "2026-07-30T12:00:00.000Z",
  createId: () => "vector-1",
});

describe("vector hit testing", () => {
  it("uses forgiving outline tolerance for thin lines", () => {
    const line = create.createLineObject({
      geometry: { start: { x: 20, y: 20 }, end: { x: 180, y: 20 } },
      style: { strokeWidth: 1 },
    });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([line]),
      configuration: { tolerance: 6 },
    });

    expect(engine.hitTest(pagePoint(100, 25))?.objectId).toBe(line.id);
    expect(engine.hitTest(pagePoint(100, 28))).toBeNull();
  });

  it("selects unfilled rectangles and ellipses by their visible outlines", () => {
    const factory = new ObjectFactory({
      now: () => "2026-07-30T12:00:00.000Z",
      createId: (() => {
        let index = 0;
        return () => `vector-${++index}`;
      })(),
    });
    const rectangle = factory.createRectangleObject({
      geometry: { x: 20, y: 20, width: 100, height: 60 },
      zIndex: 0,
    });
    const ellipse = factory.createEllipseObject({
      geometry: { center: { x: 220, y: 60 }, radiusX: 50, radiusY: 30 },
      zIndex: 1,
    });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([rectangle, ellipse]),
      configuration: { tolerance: 6 },
    });

    expect(engine.hitTest(pagePoint(21, 50))?.objectId).toBe(rectangle.id);
    expect(engine.hitTest(pagePoint(70, 50))).toBeNull();
    expect(engine.hitTest(pagePoint(270, 60))?.objectId).toBe(ellipse.id);
    expect(engine.hitTest(pagePoint(220, 60))).toBeNull();
  });

  it("inverts the shared PageObject transform before geometry testing", () => {
    const line = create.createLineObject({
      geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      transform: new Transform({ translation: { x: 30, y: 40 }, rotation: Math.PI / 2 }),
    });
    const engine = createHitTestEngine({
      objectSource: createObjectSource([line]),
      configuration: { tolerance: 4 },
    });

    expect(engine.hitTest(pagePoint(80, 40))?.objectId).toBe(line.id);
    expect(engine.hitTest(pagePoint(30, 40))).toBeNull();
  });
});
