import { describe, expect, it } from "vitest";
import {
  controlsInteractive,
  resolveDisclosureShift,
  resolveDisclosureSide,
  resolveSpatialControls,
  sheetShowsControls,
  SPATIAL_CONTROL_METRICS,
  SPATIAL_CONTROL_ROW_WIDTH,
} from "./spatial-layer-controls-model";

const LAYER = Object.freeze({
  name: "Underdrawing",
  visible: true,
  locked: false,
  opacity: 1,
  layerCount: 3,
  opacityOpen: false,
});

describe("focused sheet ownership", () => {
  it("gives controls to the active layer and to nothing else", () => {
    expect(sheetShowsControls("layer-2", "layer-2")).toBe(true);
    expect(sheetShowsControls("layer-1", "layer-2")).toBe(false);
    expect(sheetShowsControls("layer-3", "layer-2")).toBe(false);
  });

  it("shows no controls when the active layer is not one of the sheets", () => {
    // A stale active id must leave every sheet quiet rather than promoting a
    // neighbour: the accent and the cluster have to agree.
    for (const id of ["layer-1", "layer-2", "layer-3"]) {
      expect(sheetShowsControls(id, "layer-removed")).toBe(false);
    }
  });
});

describe("interaction during the choreography", () => {
  it("accepts presses only once the stack has settled open", () => {
    expect(controlsInteractive("open")).toBe(true);
    expect(controlsInteractive("opening")).toBe(false);
    expect(controlsInteractive("closing")).toBe(false);
    expect(controlsInteractive("closed")).toBe(false);
  });
});

describe("control state", () => {
  it("names visibility by what pressing it will do", () => {
    expect(resolveSpatialControls(LAYER).visibility).toEqual({
      label: "Hide Underdrawing",
      pressed: true,
      disabled: false,
    });
    expect(resolveSpatialControls({ ...LAYER, visible: false }).visibility).toEqual({
      label: "Show Underdrawing",
      pressed: false,
      disabled: false,
    });
  });

  it("names lock by what pressing it will do", () => {
    expect(resolveSpatialControls(LAYER).lock).toEqual({
      label: "Lock Underdrawing",
      pressed: false,
      disabled: false,
    });
    expect(resolveSpatialControls({ ...LAYER, locked: true }).lock).toEqual({
      label: "Unlock Underdrawing",
      pressed: true,
      disabled: false,
    });
  });

  it("uses the layer's real name, never its position", () => {
    const controls = resolveSpatialControls({ ...LAYER, name: "Layer 4" });
    expect(controls.rename.label).toBe("Rename Layer 4");
    expect(controls.delete.label).toBe("Delete Layer 4");
    const renamed = resolveSpatialControls(LAYER);
    expect(renamed.rename.label).toBe("Rename Underdrawing");
    expect(renamed.delete.label).toBe("Delete Underdrawing");
  });

  it("announces the opacity percentage in the control's own name", () => {
    expect(resolveSpatialControls({ ...LAYER, opacity: 0.75 }).opacity.label).toBe(
      "Underdrawing opacity, 75 percent",
    );
    expect(resolveSpatialControls({ ...LAYER, opacity: 0 }).opacity.label).toBe(
      "Underdrawing opacity, 0 percent",
    );
    expect(resolveSpatialControls({ ...LAYER, opacity: 1 }).opacity.label).toBe(
      "Underdrawing opacity, 100 percent",
    );
  });

  it("reports the disclosure as pressed while it is open", () => {
    expect(resolveSpatialControls(LAYER).opacity.pressed).toBe(false);
    expect(resolveSpatialControls({ ...LAYER, opacityOpen: true }).opacity.pressed).toBe(true);
  });

  it("contains a broken opacity rather than announcing NaN", () => {
    expect(resolveSpatialControls({ ...LAYER, opacity: Number.NaN }).opacity.label).toContain(
      "0 percent",
    );
    expect(resolveSpatialControls({ ...LAYER, opacity: 4 }).opacity.label).toContain("100 percent");
  });

  it("disables delete for the final remaining layer, and only then", () => {
    expect(resolveSpatialControls({ ...LAYER, layerCount: 1 }).delete.disabled).toBe(true);
    expect(resolveSpatialControls({ ...LAYER, layerCount: 2 }).delete.disabled).toBe(false);
    expect(resolveSpatialControls({ ...LAYER, layerCount: 9 }).delete.disabled).toBe(false);
  });

  it("never disables the controls a hidden or locked layer needs to recover", () => {
    const stuck = resolveSpatialControls({ ...LAYER, visible: false, locked: true });
    expect(stuck.visibility.disabled).toBe(false);
    expect(stuck.lock.disabled).toBe(false);
    expect(stuck.rename.disabled).toBe(false);
    expect(stuck.opacity.disabled).toBe(false);
  });
});

describe("disclosure placement", () => {
  const width = SPATIAL_CONTROL_METRICS.disclosureWidth;
  const inset = SPATIAL_CONTROL_METRICS.edgeInset;

  it("leaves the disclosure where it is when it already fits", () => {
    expect(resolveDisclosureShift(400, 1200)).toBe(0);
    expect(resolveDisclosureShift(1200 - inset - width, 1200)).toBe(0);
  });

  it("slides it back just far enough to stay inside the workspace", () => {
    const anchor = 1000;
    const shift = resolveDisclosureShift(anchor, 1100);
    expect(shift).toBeLessThan(0);
    expect(anchor + shift + width).toBeCloseTo(1100 - inset, 5);
  });

  it("never pushes it off the left edge, however narrow the workspace", () => {
    for (const boundsWidth of [120, 240, 360, 480]) {
      for (const anchor of [40, 90, 160, 300]) {
        const shift = resolveDisclosureShift(anchor, boundsWidth);
        expect(anchor + shift).toBeGreaterThanOrEqual(Math.min(anchor, inset) - 1e-9);
      }
    }
  });

  it("keeps the control row narrower than the reserved label column", () => {
    // The sheets are sized against a fixed label column, and that sizing is
    // frozen. The cluster has to fit the space that already exists rather than
    // the arrangement moving to accommodate it.
    expect(SPATIAL_CONTROL_ROW_WIDTH).toBe(120);
    expect(SPATIAL_CONTROL_ROW_WIDTH).toBeLessThan(132);
  });
});

describe("disclosure side", () => {
  const height = SPATIAL_CONTROL_METRICS.disclosureHeight;
  const gap = SPATIAL_CONTROL_METRICS.disclosureGap;
  const inset = SPATIAL_CONTROL_METRICS.edgeInset;

  it("opens above at the focus shelf, where there is no room below", () => {
    // The frozen shelf holds the focused sheet at 0.90 of the workspace, so
    // this is the case that actually ships.
    const boundsHeight = 800;
    expect(resolveDisclosureSide(boundsHeight * 0.9, boundsHeight)).toBe("above");
  });

  it("opens below when the anchor leaves room for it", () => {
    expect(resolveDisclosureSide(100, 800)).toBe("below");
    expect(resolveDisclosureSide(800 - inset - height - gap, 800)).toBe("below");
  });

  it("stays beside its control when neither side fits", () => {
    // A workspace too short for the panel either way keeps it adjacent to the
    // button that opened it rather than floating off the top.
    expect(resolveDisclosureSide(60, 100)).toBe("below");
  });

  it("never chooses a side that would clip the panel when one fits", () => {
    const boundsHeight = 700;
    for (let anchor = 0; anchor <= boundsHeight; anchor += 25) {
      const side = resolveDisclosureSide(anchor, boundsHeight);
      const fitsBelow = boundsHeight - inset - anchor >= height + gap;
      const fitsAbove = anchor - height - gap >= inset;
      if (fitsBelow) expect(side).toBe("below");
      else if (fitsAbove) expect(side).toBe("above");
    }
  });
});
