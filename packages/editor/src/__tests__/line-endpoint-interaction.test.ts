import { ObjectFactory, Transform } from "@folio/document";
import { describe, expect, it } from "vitest";
import {
  createLineEndpointManipulationResults,
  lineWorldGeometry,
  resolveLineHandleHit,
  transformLineEndpoint,
} from "../LineEndpointInteraction";

const factory = new ObjectFactory({ now: () => "2026-07-31T12:00:00.000Z" });

describe("line endpoint interaction", () => {
  it("resolves endpoints before the midpoint with screen-stable hit regions", () => {
    const line = createLine();

    expect(resolveLineHandleHit(line, point(0, 0), 1)).toEqual({
      handle: "start",
      cursor: "crosshair",
    });
    expect(resolveLineHandleHit(line, point(50, 0), 2)).toEqual({
      handle: "midpoint",
      cursor: "grab",
    });
    expect(resolveLineHandleHit(line, point(50, 20), 2)).toBeNull();
  });

  it("moves only the active endpoint and leaves the opposite endpoint anchored", () => {
    const line = createLine();
    const transform = transformLineEndpoint(line, "end", point(100, 100));
    expect(transform).not.toBeNull();
    const geometry = lineWorldGeometry(line, transform ?? undefined);

    expect(geometry.start.x).toBeCloseTo(0);
    expect(geometry.start.y).toBeCloseTo(0);
    expect(geometry.end.x).toBeCloseTo(100);
    expect(geometry.end.y).toBeCloseTo(100);
    expect(transform?.scale).toBeCloseTo(Math.SQRT2);
    expect(transform?.rotation).toBeCloseTo(Math.PI / 4);
  });

  it("preserves a transformed opposite endpoint while dragging the start", () => {
    const line = createLine(
      new Transform({ translation: { x: 20, y: 30 }, rotation: Math.PI / 6, scale: 1.5 }),
    );
    const before = lineWorldGeometry(line);
    const transform = transformLineEndpoint(line, "start", point(-20, 80));
    expect(transform).not.toBeNull();
    const after = lineWorldGeometry(line, transform ?? undefined);

    expect(after.end.x).toBeCloseTo(before.end.x);
    expect(after.end.y).toBeCloseTo(before.end.y);
    expect(after.start.x).toBeCloseTo(-20);
    expect(after.start.y).toBeCloseTo(80);
  });

  it("creates immutable existing manipulation results in safe execution order", () => {
    const initial = Transform.identity();
    const final = new Transform({
      translation: { x: 4, y: 8 },
      rotation: Math.PI / 3,
      scale: 1.8,
    });
    const results = createLineEndpointManipulationResults({
      objectId: "line",
      sessionId: "endpoint-session",
      sessionTimestamp: 42,
      initialTransform: initial,
      finalTransform: final,
    });

    expect(results.map(({ kind }) => kind)).toEqual(["rotation", "scale", "translation"]);
    expect(results.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(results)).toBe(true);
  });

  it("rejects collapsed endpoint transforms", () => {
    expect(transformLineEndpoint(createLine(), "end", point(0, 0))).toBeNull();
  });
});

function createLine(transform = Transform.identity()) {
  return factory.createLineObject({
    id: "line",
    geometry: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    transform,
  });
}

function point(x: number, y: number) {
  return Object.freeze({ x, y, coordinateSpace: "page" as const });
}
