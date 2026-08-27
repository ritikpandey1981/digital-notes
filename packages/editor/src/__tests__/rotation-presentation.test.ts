import { createManipulationManager, type ManipulationState } from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";
import { describe, expect, it } from "vitest";
import {
  formatRotationAngleLabel,
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

  it("formats the live rotation chip in the canonical range", () => {
    // M-014: the chip reads the same angle whichever way the user dragged to
    // reach it, so a full turn back reports 0° rather than -360°.
    expect(formatRotationAngleLabel(0)).toBe("0°");
    expect(formatRotationAngleLabel(ROTATION_SNAP_INCREMENT_RADIANS)).toBe("15°");
    expect(formatRotationAngleLabel(Math.PI / 4)).toBe("45°");
    expect(formatRotationAngleLabel(Math.PI)).toBe("180°");
    expect(formatRotationAngleLabel(-Math.PI / 2)).toBe("270°");
    expect(formatRotationAngleLabel(-Math.PI * 2)).toBe("0°");
  });

  it("reports whole degrees for every snap increment", () => {
    const labels = Array.from({ length: 24 }, (_, step) =>
      formatRotationAngleLabel(ROTATION_SNAP_INCREMENT_RADIANS * step),
    );

    expect(labels[0]).toBe("0°");
    expect(labels[6]).toBe("90°");
    expect(labels[12]).toBe("180°");
    expect(labels.every((label) => /^\d{1,3}°$/u.test(label))).toBe(true);
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
