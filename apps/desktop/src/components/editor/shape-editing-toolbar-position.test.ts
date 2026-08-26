import type { ShapeEditingSnapshot } from "@folio/editor";
import { describe, expect, it } from "vitest";
import { resolveShapeEditingToolbarPlacement } from "./shape-editing-toolbar-position";

const TOOLBAR_SIZE = Object.freeze({ width: 326, height: 48 });

describe("shape editing toolbar placement", () => {
  it("places a normal selection above its interaction controls", () => {
    const snapshot = shapeSnapshot({ x: 300, y: 300, width: 200, height: 120 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("above");
    expect(placement.top + placement.height).toBe(244);
    expectRotationHandleClear(placement, snapshot);
  });

  it("keeps a tall narrow selection's rotation handle and stem clear", () => {
    const snapshot = shapeSnapshot({ x: 480, y: 140, width: 40, height: 500 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("above");
    expectRotationHandleClear(placement, snapshot);
  });

  it("places the toolbar below when the selection is near the top edge", () => {
    const snapshot = shapeSnapshot({ x: 400, y: 24, width: 120, height: 180 });

    expect(resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE)).toMatchObject({
      side: "below",
      top: 232,
    });
  });

  it("uses the safe above placement near the bottom edge", () => {
    const snapshot = shapeSnapshot({ x: 380, y: 670, width: 160, height: 90 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("above");
    expect(placement.top + placement.height).toBeLessThan(snapshot.viewportBounds.y - 44);
  });

  it.each([
    ["25%", { x: 420, y: 340, width: 25, height: 30 }],
    ["50%", { x: 400, y: 300, width: 50, height: 60 }],
    ["200%", { x: 100, y: 160, width: 600, height: 360 }],
    ["400%", { x: 200, y: 180, width: 500, height: 300 }],
  ] as const)("uses screen-space clearance at %s zoom presentation", (_label, bounds) => {
    const snapshot = shapeSnapshot(bounds);
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("above");
    expectRotationHandleClear(placement, snapshot);
  });

  it("uses a safe below placement for panned bounds crossing the top edge", () => {
    const snapshot = shapeSnapshot({ x: -80, y: 30, width: 200, height: 140 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("below");
    expect(placement.left).toBeGreaterThanOrEqual(12);
  });

  it("repositions deterministically when a selected object moves", () => {
    const before = resolveShapeEditingToolbarPlacement(
      shapeSnapshot({ x: 300, y: 300, width: 160, height: 120 }),
      TOOLBAR_SIZE,
    );
    const after = resolveShapeEditingToolbarPlacement(
      shapeSnapshot({ x: 300, y: 25, width: 160, height: 120 }),
      TOOLBAR_SIZE,
    );

    expect(before.side).toBe("above");
    expect(after.side).toBe("below");
    expect(after.top).not.toBe(before.top);
  });

  it("uses a side placement when scaling consumes both vertical placement regions", () => {
    const snapshot = shapeSnapshot({ x: 450, y: 20, width: 60, height: 760 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("left");
    expect(placement.left + placement.width).toBeLessThan(450 - 16);
  });

  it("keeps line endpoints and midpoint away from the toolbar", () => {
    const snapshot = shapeSnapshot(
      { x: 360, y: 25, width: 240, height: 300 },
      { objectType: "line" },
    );
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    expect(placement.side).toBe("below");
    for (const point of [
      { x: 360, y: 25 },
      { x: 600, y: 325 },
      { x: 480, y: 175 },
    ]) {
      expect(pointInside(placement, point, 22)).toBe(false);
    }
  });

  it("keeps a rotated frame's corners, stem, and rotation handle clear", () => {
    const selectionFrame = Object.freeze({
      centerX: 500,
      centerY: 360,
      width: 240,
      height: 80,
      rotation: Math.PI / 4,
    });
    const snapshot = shapeSnapshot({ x: 380, y: 240, width: 240, height: 240 }, { selectionFrame });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE);

    for (const point of orientedControlPoints(selectionFrame)) {
      expect(pointInside(placement, point, 12)).toBe(false);
    }
  });

  it("treats the Quick Color Rail strip as an occupied collision zone", () => {
    const snapshot = shapeSnapshot({ x: 780, y: 330, width: 120, height: 100 });
    const placement = resolveShapeEditingToolbarPlacement(snapshot, TOOLBAR_SIZE, [
      { x: 924, y: 0, width: 76, height: 800 },
    ]);

    expect(placement.left + placement.width).toBeLessThanOrEqual(912);
  });
});

function shapeSnapshot(
  viewportBounds: ShapeEditingSnapshot["viewportBounds"],
  overrides: Partial<ShapeEditingSnapshot> = {},
): ShapeEditingSnapshot {
  return Object.freeze({
    objectId: "shape-1",
    objectType: "ellipse" as const,
    selectedObjectIds: Object.freeze(["shape-1"]),
    readOnly: false,
    layerId: "layer-1",
    strokeColor: "#111111",
    strokeWidth: 12,
    opacity: 1,
    viewportBounds: Object.freeze({ ...viewportBounds }),
    viewportSize: Object.freeze({ width: 1_000, height: 800 }),
    ...overrides,
  });
}

function expectRotationHandleClear(
  placement: ReturnType<typeof resolveShapeEditingToolbarPlacement>,
  snapshot: ShapeEditingSnapshot,
): void {
  const rotationHandle = {
    x: snapshot.viewportBounds.x + snapshot.viewportBounds.width / 2,
    y: snapshot.viewportBounds.y - 32,
  };
  expect(pointInside(placement, rotationHandle, 24)).toBe(false);
}

function pointInside(
  placement: ReturnType<typeof resolveShapeEditingToolbarPlacement>,
  point: Readonly<{ x: number; y: number }>,
  radius: number,
): boolean {
  return !(
    placement.left + placement.width <= point.x - radius ||
    placement.left >= point.x + radius ||
    placement.top + placement.height <= point.y - radius ||
    placement.top >= point.y + radius
  );
}

function orientedControlPoints(frame: NonNullable<ShapeEditingSnapshot["selectionFrame"]>) {
  const halfWidth = frame.width / 2 + 4;
  const halfHeight = frame.height / 2 + 4;
  const rotate = (x: number, y: number) => ({
    x: frame.centerX + x * Math.cos(frame.rotation) - y * Math.sin(frame.rotation),
    y: frame.centerY + x * Math.sin(frame.rotation) + y * Math.cos(frame.rotation),
  });
  return [
    rotate(-halfWidth, -halfHeight),
    rotate(halfWidth, -halfHeight),
    rotate(halfWidth, halfHeight),
    rotate(-halfWidth, halfHeight),
    rotate(0, -halfHeight),
    rotate(0, -halfHeight - 28),
  ];
}
