import { ObjectFactory } from "@folio/document";
import { StrokeBuilder } from "@folio/ink";
import { describe, expect, it } from "vitest";
import { firstErasableInkCandidate } from "../EraserEligibility";

describe("whole-stroke eraser eligibility", () => {
  it("skips overlapping vector candidates and reaches the topmost eligible ink", () => {
    const factory = new ObjectFactory({ now: () => "2026-08-22T08:00:00.000Z" });
    const ink = createInk(factory, "ink", 3);
    const line = factory.createLineObject({
      id: "line",
      zIndex: 4,
      geometry: { start: { x: 0, y: 10 }, end: { x: 100, y: 10 } },
    });
    const rectangle = factory.createRectangleObject({
      id: "rectangle",
      zIndex: 5,
      geometry: { x: 0, y: 0, width: 100, height: 50 },
    });
    const ellipse = factory.createEllipseObject({
      id: "ellipse",
      zIndex: 6,
      geometry: { center: { x: 50, y: 25 }, radiusX: 50, radiusY: 25 },
    });

    expect(firstErasableInkCandidate([ellipse, rectangle, line, ink], new Set())).toBe(ink);
    expect(firstErasableInkCandidate([ellipse, rectangle, line], new Set())).toBeNull();
  });

  it("rejects hidden, locked, and already-erased ink candidates", () => {
    const factory = new ObjectFactory({ now: () => "2026-08-22T08:00:00.000Z" });
    const hidden = createInk(factory, "hidden", 3, { visible: false });
    const locked = createInk(factory, "locked", 2, { locked: true });
    const eligible = createInk(factory, "eligible", 1);

    expect(
      firstErasableInkCandidate([hidden, locked, eligible], new Set([eligible.id])),
    ).toBeNull();
    expect(firstErasableInkCandidate([hidden, locked, eligible], new Set())).toBe(eligible);
  });
});

function createInk(
  factory: ObjectFactory,
  id: string,
  zIndex: number,
  lifecycle: { readonly visible?: boolean; readonly locked?: boolean } = {},
) {
  const stroke = new StrokeBuilder({
    id: `${id}-stroke`,
    style: { color: "#111111", width: 2, opacity: 1 },
  });
  stroke.addPoint({
    x: 10,
    y: 10,
    timestamp: 1,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  });
  return factory.createInkObject({ id, zIndex, stroke: stroke.finalize(), ...lifecycle });
}
