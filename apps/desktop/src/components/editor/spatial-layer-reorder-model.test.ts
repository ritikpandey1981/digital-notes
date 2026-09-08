import { describe, expect, it } from "vitest";
import { resolveLayerDragMove } from "./layers-panel-model";
import {
  canReorderLayers,
  clampReorderExposure,
  isNoOpReorder,
  REORDER_EDGE,
  reorderExposureExhausted,
  resolveReorderEdgeZone,
  resolveReorderSlots,
  resolveSpatialDropIndex,
  sheetAnchorY,
  sheetDropBands,
} from "./spatial-layer-reorder-model";
import {
  computeSpatialLayerStackLayout,
  type SpatialStackLayout,
} from "./spatial-layer-stack-model";

const PORTRAIT = Object.freeze({ pageWidth: 794, pageHeight: 1123 });
const WORKSPACE = Object.freeze({ workspaceWidth: 1200, workspaceHeight: 820 });

function layout(layerCount: number): SpatialStackLayout {
  return computeSpatialLayerStackLayout({ ...PORTRAIT, ...WORKSPACE, layerCount });
}

describe("reorder eligibility", () => {
  it("needs somewhere to move to", () => {
    expect(canReorderLayers(1)).toBe(false);
    expect(canReorderLayers(0)).toBe(false);
    expect(canReorderLayers(2)).toBe(true);
    expect(canReorderLayers(10)).toBe(true);
  });
});

describe("display order mirrors canonical storage exactly once", () => {
  // Display runs top-first; storage runs bottom-to-top. Getting this wrong in
  // the stack would silently invert every move, so it is asserted directly
  // against the mapping the list already uses.
  it("maps the top display row to the highest storage index", () => {
    for (const count of [2, 3, 5, 10]) {
      expect(resolveLayerDragMove(1, 0, count).targetStorageIndex).toBe(count - 1);
      expect(resolveLayerDragMove(0, count, count).targetStorageIndex).toBe(0);
    }
  });

  it("moves one position up and down without drift", () => {
    // Five sheets, display 2 is the middle one, storage index 2.
    expect(resolveLayerDragMove(2, 2, 5)).toMatchObject({
      targetDisplayIndex: 2,
      targetStorageIndex: 2,
      changed: false,
    });
    // Dropping into the gap above itself is the same position.
    expect(resolveLayerDragMove(2, 1, 5)).toMatchObject({
      targetDisplayIndex: 1,
      targetStorageIndex: 3,
      changed: true,
    });
    expect(resolveLayerDragMove(2, 4, 5)).toMatchObject({
      targetDisplayIndex: 3,
      targetStorageIndex: 1,
      changed: true,
    });
  });

  it("clamps at the top and bottom rather than producing an invalid index", () => {
    for (const count of [2, 3, 5, 10]) {
      for (const insert of [-50, -1, count, count + 50]) {
        const move = resolveLayerDragMove(1, insert, count);
        expect(move.targetStorageIndex).toBeGreaterThanOrEqual(0);
        expect(move.targetStorageIndex).toBeLessThanOrEqual(count - 1);
        expect(Number.isSafeInteger(move.targetStorageIndex)).toBe(true);
      }
    }
  });
});

describe("no-op detection", () => {
  it("recognises a drop back into the same position", () => {
    expect(isNoOpReorder(5, 2, 2)).toBe(true);
    expect(isNoOpReorder(5, 2, 3)).toBe(true); // the gap just below itself
    expect(isNoOpReorder(5, 2, 1)).toBe(false);
    expect(isNoOpReorder(5, 2, 4)).toBe(false);
  });

  it("treats a document with nothing to reorder as a no-op", () => {
    expect(isNoOpReorder(1, 0, 0)).toBe(true);
    expect(isNoOpReorder(1, 0, 1)).toBe(true);
  });

  it("agrees with the canonical move resolver", () => {
    for (const count of [2, 3, 5, 10]) {
      for (let from = 0; from < count; from += 1) {
        for (let insert = 0; insert <= count; insert += 1) {
          expect(isNoOpReorder(count, from, insert)).toBe(
            !resolveLayerDragMove(from, insert, count).changed,
          );
        }
      }
    }
  });
});

describe("transient slot arrangement", () => {
  it("leaves every sheet where it was for a no-op drag", () => {
    expect(resolveReorderSlots(5, 2, 2)).toEqual([0, 1, 2, 3, 4]);
  });

  it("opens a space above the dragged sheet and closes the one it left", () => {
    // Sheet at display 2 heading for the gap above display 1.
    expect(resolveReorderSlots(5, 2, 1)).toEqual([0, 2, 1, 3, 4]);
  });

  it("opens a space below", () => {
    expect(resolveReorderSlots(5, 2, 4)).toEqual([0, 1, 3, 2, 4]);
  });

  it("carries a sheet across several positions in one arrangement", () => {
    expect(resolveReorderSlots(5, 0, 5)).toEqual([4, 0, 1, 2, 3]);
    expect(resolveReorderSlots(5, 4, 0)).toEqual([1, 2, 3, 4, 0]);
  });

  it("always produces a complete permutation, whatever the inputs", () => {
    for (const count of [1, 2, 3, 5, 10]) {
      for (let from = 0; from < count; from += 1) {
        for (const insert of [-9, 0, 1, count - 1, count, count + 9]) {
          const slots = resolveReorderSlots(count, from, insert);
          expect(slots).toHaveLength(count);
          expect([...slots].sort((a, b) => a - b)).toEqual(
            Array.from({ length: count }, (_unused, index) => index),
          );
        }
      }
    }
  });

  it("survives hostile input without producing a hole", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MAX_SAFE_INTEGER, 2.7]) {
      const slots = resolveReorderSlots(4, bad, bad);
      expect(slots).toHaveLength(4);
      expect([...slots].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    }
  });

  it("handles the degenerate counts", () => {
    expect(resolveReorderSlots(0, 0, 0)).toEqual([]);
    expect(resolveReorderSlots(1, 0, 0)).toEqual([0]);
    expect(resolveReorderSlots(1, 0, 1)).toEqual([0]);
  });
});

describe("pointer to insertion gap", () => {
  const stack = layout(5);
  const planes = stack.layers;
  const anchors = planes.map((plane) => sheetAnchorY(stack, plane, stack.tiltDegrees, 0));

  it("orders sheet anchors top-first down the arrangement", () => {
    for (let index = 1; index < anchors.length; index += 1) {
      expect(anchors[index]!).toBeGreaterThan(anchors[index - 1]!);
    }
  });

  it("bands each sheet by one gap, ending at its projected edge", () => {
    const bands = sheetDropBands(stack, planes, stack.tiltDegrees, 0);
    expect(bands).toHaveLength(planes.length);
    for (const [index, band] of bands.entries()) {
      expect(band.height).toBeCloseTo(stack.gap, 5);
      expect(band.top + band.height).toBeCloseTo(anchors[index]!, 5);
    }
  });

  it("returns the gap above a sheet when the pointer is above its midpoint", () => {
    for (const [index, anchor] of anchors.entries()) {
      const midpoint = anchor - stack.gap / 2;
      expect(resolveSpatialDropIndex(midpoint - 1, stack, planes, stack.tiltDegrees, 0)).toBe(
        index,
      );
    }
  });

  it("returns the trailing gap below the bottom sheet", () => {
    const belowEverything = anchors[anchors.length - 1]! + stack.gap;
    expect(resolveSpatialDropIndex(belowEverything, stack, planes, stack.tiltDegrees, 0)).toBe(
      planes.length,
    );
  });

  it("follows the live offset rather than assuming the stack is at rest", () => {
    const offset = stack.gap * 2;
    const shifted = anchors[2]! - offset - stack.gap / 2 - 1;
    expect(resolveSpatialDropIndex(shifted, stack, planes, stack.tiltDegrees, offset)).toBe(2);
  });

  it("stays in range for hostile pointer coordinates", () => {
    for (const pointerY of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1e9,
      1e9,
    ]) {
      const index = resolveSpatialDropIndex(pointerY, stack, planes, stack.tiltDegrees, 0);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(planes.length);
    }
  });

  it("answers for every supported layer count", () => {
    for (const count of [1, 2, 3, 5, 10]) {
      const current = layout(count);
      const index = resolveSpatialDropIndex(0, current, current.layers, current.tiltDegrees, 0);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(count);
    }
  });
});

describe("cancelling returns the canonical arrangement", () => {
  it("is the identity permutation whenever no drag is in flight", () => {
    // The component renders settled slots by index when `drag` is null; this is
    // the value it falls back to, asserted so a cancel cannot leave a sheet
    // parked in a transient slot.
    for (const count of [1, 2, 3, 5, 10]) {
      const settled = Array.from({ length: count }, (_unused, index) => index);
      expect(resolveReorderSlots(count, 0, 0)).toEqual(settled);
    }
  });
});

describe("edge zones", () => {
  const TOP = 100;
  const BOTTOM = 900;

  it("finds no edge in the middle of the band", () => {
    expect(resolveReorderEdgeZone(500, TOP, BOTTOM)).toBeNull();
    expect(resolveReorderEdgeZone(TOP + 200, TOP, BOTTOM)).toBeNull();
    expect(resolveReorderEdgeZone(BOTTOM - 200, TOP, BOTTOM)).toBeNull();
  });

  it("finds the upper and lower zones", () => {
    expect(resolveReorderEdgeZone(TOP + 1, TOP, BOTTOM)).toBe("up");
    expect(resolveReorderEdgeZone(TOP - 50, TOP, BOTTOM)).toBe("up");
    expect(resolveReorderEdgeZone(BOTTOM - 1, TOP, BOTTOM)).toBe("down");
    expect(resolveReorderEdgeZone(BOTTOM + 50, TOP, BOTTOM)).toBe("down");
  });

  it("includes its own boundary, so a hold exactly on the line counts", () => {
    const zone = REORDER_EDGE.zoneSize;
    expect(resolveReorderEdgeZone(TOP + zone, TOP, BOTTOM)).toBe("up");
    expect(resolveReorderEdgeZone(TOP + zone + 1, TOP, BOTTOM)).toBeNull();
    expect(resolveReorderEdgeZone(BOTTOM - zone, TOP, BOTTOM)).toBe("down");
    expect(resolveReorderEdgeZone(BOTTOM - zone - 1, TOP, BOTTOM)).toBeNull();
  });

  it("keeps neutral space at a minimum workspace", () => {
    // A short band cannot be all edge: the zones shrink to a third each, which
    // leaves a middle the pointer can rest in without navigating.
    const shortTop = 0;
    const shortBottom = 150;
    expect(resolveReorderEdgeZone(75, shortTop, shortBottom)).toBeNull();
    expect(resolveReorderEdgeZone(5, shortTop, shortBottom)).toBe("up");
    expect(resolveReorderEdgeZone(145, shortTop, shortBottom)).toBe("down");
  });

  it("scales to a large workspace without swallowing it", () => {
    expect(resolveReorderEdgeZone(1000, 0, 2000)).toBeNull();
    expect(resolveReorderEdgeZone(10, 0, 2000)).toBe("up");
    expect(resolveReorderEdgeZone(1990, 0, 2000)).toBe("down");
  });

  it("refuses hostile or degenerate input rather than inventing an edge", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolveReorderEdgeZone(bad, TOP, BOTTOM)).toBeNull();
      expect(resolveReorderEdgeZone(500, bad, BOTTOM)).toBeNull();
      expect(resolveReorderEdgeZone(500, TOP, bad)).toBeNull();
    }
    expect(resolveReorderEdgeZone(500, 900, 100)).toBeNull();
    expect(resolveReorderEdgeZone(500, 100, 100)).toBeNull();
    expect(resolveReorderEdgeZone(500, TOP, BOTTOM, 0)).toBeNull();
  });
});

describe("transient exposure", () => {
  it("advances one layer at a time in both directions", () => {
    expect(clampReorderExposure(1, 2, 5)).toBe(1);
    expect(clampReorderExposure(-1, 2, 5)).toBe(-1);
    expect(clampReorderExposure(2, 2, 5)).toBe(2);
  });

  it("reaches every layer from any starting sheet", () => {
    const count = 10;
    for (let focused = 0; focused < count; focused += 1) {
      // The extremes of exposure put the focus position on the first and last
      // sheet, so every canonical destination is reachable from anywhere.
      expect(clampReorderExposure(-999, focused, count)).toBe(focused === 0 ? 0 : -focused);
      expect(clampReorderExposure(999, focused, count)).toBe(count - 1 - focused);
    }
  });

  it("clamps at the top and bottom of the arrangement", () => {
    expect(clampReorderExposure(-5, 0, 5)).toBe(0);
    expect(clampReorderExposure(5, 4, 5)).toBe(0);
    expect(clampReorderExposure(99, 2, 5)).toBe(2);
    expect(clampReorderExposure(-99, 2, 5)).toBe(-2);
  });

  it("reports when another step would do nothing, so the timer can stop", () => {
    expect(reorderExposureExhausted(0, "up", 0, 5)).toBe(true);
    expect(reorderExposureExhausted(0, "down", 4, 5)).toBe(true);
    expect(reorderExposureExhausted(0, "down", 0, 5)).toBe(false);
    expect(reorderExposureExhausted(0, "up", 4, 5)).toBe(false);
    // Having already travelled to the end, the next step is exhausted too.
    expect(reorderExposureExhausted(4, "down", 0, 5)).toBe(true);
    expect(reorderExposureExhausted(3, "down", 0, 5)).toBe(false);
  });

  it("survives hostile input", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -Number.MAX_SAFE_INTEGER, 1.7]) {
      const value = clampReorderExposure(bad, 2, 5);
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThanOrEqual(2);
    }
    expect(clampReorderExposure(1, 0, 0)).toBe(0);
    expect(clampReorderExposure(1, 0, 1)).toBe(0);
  });

  it("never lets exposure name a position outside the arrangement", () => {
    for (const count of [1, 2, 3, 5, 10]) {
      for (let focused = 0; focused < count; focused += 1) {
        for (const steps of [-99, -1, 0, 1, 99]) {
          const exposed = focused + clampReorderExposure(steps, focused, count);
          expect(exposed).toBeGreaterThanOrEqual(0);
          expect(exposed).toBeLessThanOrEqual(count - 1);
        }
      }
    }
  });
});
