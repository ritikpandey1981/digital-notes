import type { LayersSnapshot } from "@folio/editor";
import { describe, expect, it } from "vitest";
import {
  canDeleteLayer,
  describeDeletedLayer,
  LAYER_PANEL_WIDTH,
  LAYER_ROW_HEIGHT,
  layerRows,
  moveTargetIndex,
  nextFocusIndex,
  normalizeLayerName,
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
