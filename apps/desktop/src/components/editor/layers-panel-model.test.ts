import type { LayersSnapshot } from "@folio/editor";
import { describe, expect, it } from "vitest";
import {
  canDeleteLayer,
  describeDeletedLayer,
  LAYER_PANEL_WIDTH,
  LAYER_ROW_HEIGHT,
  LAYER_AUTO_SCROLL_STEP,
  layerRows,
  mirrorLayerIndex,
  moveTargetIndex,
  nextFocusIndex,
  normalizeLayerName,
  resolveLayerAutoScroll,
  resolveLayerDragMove,
  resolveLayerDropIndex,
} from "./layers-panel-model";

function snapshot(names: readonly string[], activeIndex = 0): LayersSnapshot {
  return Object.freeze({
    layers: Object.freeze(
      names.map((name, index) =>
        Object.freeze({
          id: `layer-${index + 1}`,
          name,
          visible: true,
          locked: false,
          opacity: 1,
          objectCount: index,
        }),
      ),
    ),
    activeLayerId: `layer-${activeIndex + 1}`,
  });
}

describe("layers panel model", () => {
  it("keeps the audited panel dimensions", () => {
    expect(LAYER_PANEL_WIDTH).toBe(248);
    expect(LAYER_ROW_HEIGHT).toBe(36);
  });

  it("presents the top layer first while preserving storage indexes", () => {
    const rows = layerRows(snapshot(["Layer 1", "Layer 2", "Layer 3"]));
    expect(rows.map((row) => row.name)).toEqual(["Layer 3", "Layer 2", "Layer 1"]);
    expect(rows.map((row) => row.storageIndex)).toEqual([2, 1, 0]);
  });

  it("marks exactly one active row", () => {
    const rows = layerRows(snapshot(["Layer 1", "Layer 2"], 1));
    expect(rows.filter((row) => row.active).map((row) => row.id)).toEqual(["layer-2"]);
  });

  it("disables movement at the display ends", () => {
    const rows = layerRows(snapshot(["Layer 1", "Layer 2", "Layer 3"]));
    expect(rows[0]?.canMoveUp).toBe(false);
    expect(rows[0]?.canMoveDown).toBe(true);
    expect(rows[2]?.canMoveUp).toBe(true);
    expect(rows[2]?.canMoveDown).toBe(false);
  });

  it("resolves display moves into canonical storage indexes", () => {
    expect(moveTargetIndex({ storageIndex: 0 }, "up", 3)).toBe(1);
    expect(moveTargetIndex({ storageIndex: 2 }, "down", 3)).toBe(1);
    expect(moveTargetIndex({ storageIndex: 2 }, "up", 3)).toBeNull();
    expect(moveTargetIndex({ storageIndex: 0 }, "down", 3)).toBeNull();
  });

  it("never allows deleting the final layer", () => {
    expect(canDeleteLayer(1)).toBe(false);
    expect(canDeleteLayer(2)).toBe(true);
  });

  it("clamps keyboard focus movement", () => {
    expect(nextFocusIndex(0, "up", 3)).toBe(0);
    expect(nextFocusIndex(0, "down", 3)).toBe(1);
    expect(nextFocusIndex(2, "down", 3)).toBe(2);
    expect(nextFocusIndex(0, "down", 0)).toBe(0);
  });

  it("describes deletions with an accurate object count", () => {
    expect(describeDeletedLayer("Layer 2", 0)).toBe("Layer 2 deleted");
    expect(describeDeletedLayer("Layer 2", 1)).toBe("Layer 2 deleted with 1 object");
    expect(describeDeletedLayer("Layer 2", 4)).toBe("Layer 2 deleted with 4 objects");
  });

  it("discards empty or unchanged rename drafts", () => {
    expect(normalizeLayerName("  ", "Layer 1")).toBeNull();
    expect(normalizeLayerName("Layer 1", "Layer 1")).toBeNull();
    expect(normalizeLayerName("  Sketch  ", "Layer 1")).toBe("Sketch");
  });
});

describe("layer drag reordering", () => {
  /**
   * M-009. Storage is bottom-to-top and the panel is top-to-bottom, so every
   * one of these cases exists to catch a silently inverted list.
   */
  it("maps the canonical worked example", () => {
    // model [A bottom, B, C top] renders as C, B, A.
    const rows = layerRows(snapshot(["A", "B", "C"]));
    expect(rows.map((row) => row.name)).toEqual(["C", "B", "A"]);

    // Dragging C (display 0) into the gap between B and A (display 2).
    const move = resolveLayerDragMove(0, 2, 3);
    expect(move).toEqual({ targetStorageIndex: 1, targetDisplayIndex: 1, changed: true });

    // Applying splice semantics to storage gives [A, C, B].
    const storage = ["A", "B", "C"];
    const [moved] = storage.splice(2, 1);
    storage.splice(move.targetStorageIndex, 0, moved!);
    expect(storage).toEqual(["A", "C", "B"]);
  });

  it("moves the top row to the bottom and back", () => {
    expect(resolveLayerDragMove(0, 4, 4)).toEqual({
      targetStorageIndex: 0,
      targetDisplayIndex: 3,
      changed: true,
    });
    expect(resolveLayerDragMove(3, 0, 4)).toEqual({
      targetStorageIndex: 3,
      targetDisplayIndex: 0,
      changed: true,
    });
  });

  it("treats an adjacent swap as one step in either direction", () => {
    expect(resolveLayerDragMove(1, 3, 4)).toMatchObject({
      targetDisplayIndex: 2,
      changed: true,
    });
    expect(resolveLayerDragMove(2, 1, 4)).toMatchObject({
      targetDisplayIndex: 1,
      changed: true,
    });
  });

  it.each([
    ["dropped into its own gap", 2, 2],
    ["dropped into the gap just below itself", 2, 3],
    ["first row dropped above itself", 0, 0],
    ["last row dropped below itself", 3, 4],
  ] as const)("reports no change when %s", (_label, from, insert) => {
    expect(resolveLayerDragMove(from, insert, 4).changed).toBe(false);
  });

  it("clamps indexes rather than producing an out-of-range target", () => {
    expect(resolveLayerDragMove(-5, 99, 3).targetStorageIndex).toBe(0);
    expect(resolveLayerDragMove(99, -5, 3).targetStorageIndex).toBe(2);
    expect(resolveLayerDragMove(Number.NaN, 1, 3).targetStorageIndex).toBe(2);
  });

  it("mirrors a display index onto storage and back", () => {
    expect([0, 1, 2].map((index) => mirrorLayerIndex(index, 3))).toEqual([2, 1, 0]);
    expect(mirrorLayerIndex(mirrorLayerIndex(1, 5), 5)).toBe(1);
  });

  it("agrees with the keyboard move for a one-row drag", () => {
    // Alt+Up on the middle display row and dragging it up one gap have to
    // reach the same storage index, or the two routes fight each other.
    const rows = layerRows(snapshot(["A", "B", "C"]));
    const middle = rows[1]!;
    expect(moveTargetIndex(middle, "up", 3)).toBe(resolveLayerDragMove(1, 0, 3).targetStorageIndex);
    expect(moveTargetIndex(middle, "down", 3)).toBe(
      resolveLayerDragMove(1, 3, 3).targetStorageIndex,
    );
  });
});

describe("layer drop targeting", () => {
  const rows = [
    { top: 0, height: 36 },
    { top: 36, height: 36 },
    { top: 72, height: 80 },
    { top: 152, height: 36 },
  ];

  it.each([
    [-20, 0],
    [10, 0],
    [30, 1],
    [50, 1],
    [100, 2],
    [140, 3],
    [180, 4],
    [999, 4],
  ])("resolves pointer y %s to gap %s", (pointerY, expected) => {
    expect(resolveLayerDropIndex(pointerY, rows)).toBe(expected);
  });

  it("resolves an empty list to its only gap", () => {
    expect(resolveLayerDropIndex(50, [])).toBe(0);
  });
});

describe("layer drag auto-scroll", () => {
  const list = { top: 100, height: 300 };

  it("stays still in the middle of the list", () => {
    expect(resolveLayerAutoScroll(250, list)).toBe(0);
  });

  it("scrolls up near the top edge and down near the bottom", () => {
    expect(resolveLayerAutoScroll(105, list)).toBeLessThan(0);
    expect(resolveLayerAutoScroll(395, list)).toBeGreaterThan(0);
  });

  it("accelerates toward the very edge", () => {
    expect(Math.abs(resolveLayerAutoScroll(101, list))).toBeGreaterThan(
      Math.abs(resolveLayerAutoScroll(120, list)),
    );
    expect(Math.abs(resolveLayerAutoScroll(101, list))).toBeLessThanOrEqual(LAYER_AUTO_SCROLL_STEP);
  });

  it("does nothing for a list with no height", () => {
    expect(resolveLayerAutoScroll(50, { top: 0, height: 0 })).toBe(0);
  });
});
