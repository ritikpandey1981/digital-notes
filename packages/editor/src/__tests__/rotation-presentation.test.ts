import { createManipulationManager, type ManipulationState } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import {
  normalizeRotationDegrees,
  ROTATION_SNAP_INCREMENT_RADIANS,
  snapRotationPointer,
} from "../RotationPresentation";

describe("rotation presentation", () => {
  it.each([
    [0, 0],
    [15, 15],
    [45, 45],
    [90, 90],
    [180, 180],
    [270, 270],
    [359, 359],
    [360, 0],
    [-1, 359],
  ])("normalizes %s degrees to %s°", (degrees, expected) => {
    expect(normalizeRotationDegrees((degrees * Math.PI) / 180)).toBe(expected);
  });

  it("maps a Shift-modified pointer to an absolute 15° rotation", () => {
    const manager = createManipulationManager({
      configuration: { dragThreshold: 0, minimumScale: 0.05, maximumScale: 20 },
      createSessionId: () => "rotation-snap",
      now: () => 1,
    });
    const preparing = manager.beginSession({
      kind: "rotation",
      objectId: "shape",
      pointerId: 1,
      position: point(100, 0),
      objectCenter: point(0, 0),
      initialObjectTranslation: { x: 0, y: 0 },
      initialObjectRotation: 0,
      initialObjectScale: 1,
    });
    const snappedPointer = snapRotationPointer(preparing, point(90, 30));
    const state = manager.updateSession(snappedPointer);

    expect(state.rotation.deltaRadians).toBeCloseTo(ROTATION_SNAP_INCREMENT_RADIANS);
    expect(normalizeRotationDegrees(state.finalObjectRotation ?? Number.NaN)).toBe(15);
  });

  it("leaves unrelated manipulation state unchanged", () => {
    const current = point(4, 5);
    expect(snapRotationPointer({ kind: "translation" } as ManipulationState, current)).toBe(
      current,
    );
  });
});

function point(x: number, y: number): PagePoint {
  return Object.freeze({ x, y, coordinateSpace: "page" });
}
