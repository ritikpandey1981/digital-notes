import { describe, expect, it } from "vitest";
import {
  candidatesAroundRect,
  collectZones,
  hardZone,
  inflateRect,
  insetRect,
  intersectionArea,
  resolveOccupiedAwarePlacement,
  softZone,
  unionRects,
  workspaceFallbackCandidates,
  type OccupiedZone,
  type WorkspaceRect,
} from "./editor-occupied-zones";

const WORKSPACE: WorkspaceRect = { left: 0, top: 0, width: 1000, height: 700 };
const SURFACE = { width: 200, height: 300 };

function candidate(left: number, top: number, reason: string) {
  return { left, top, reason };
}

describe("editor occupied zones", () => {
  it("classifies zones and drops absent surfaces", () => {
    const zones = collectZones([
      hardZone("tool-dock", { left: 0, top: 0, width: 48, height: 300 }),
      hardZone("layers-panel", undefined),
      softZone("selected-artwork", { left: 400, top: 200, width: 200, height: 200 }),
      softZone("nothing", undefined),
    ]);

    expect(zones.map(({ id, kind }) => [id, kind])).toEqual([
      ["tool-dock", "hard"],
      ["selected-artwork", "soft"],
    ]);
    expect(Object.isFrozen(zones)).toBe(true);
  });

  it("takes the first candidate that clears both zone classes", () => {
    const zones = collectZones([
      hardZone("tool-dock", { left: 0, top: 0, width: 120, height: 700 }),
      softZone("selected-artwork", { left: 300, top: 0, width: 200, height: 700 }),
    ]);
    const placement = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: WORKSPACE,
      zones,
      candidates: [
        candidate(0, 0, "over-hard"),
        candidate(320, 0, "over-soft"),
        candidate(600, 0, "clear"),
        candidate(700, 0, "also-clear"),
      ],
    });

    expect(placement.reason).toBe("clear");
    expect(placement.hardOverlap).toBe(0);
    expect(placement.softOverlap).toBe(0);
  });

  it("gives up soft zones before hard zones when nothing is clean", () => {
    const zones = collectZones([
      hardZone("layers-panel", { left: 0, top: 0, width: 1000, height: 380 }),
      softZone("selected-artwork", { left: 0, top: 400, width: 1000, height: 300 }),
    ]);
    const placement = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: WORKSPACE,
      zones,
      candidates: [candidate(0, 0, "over-hard"), candidate(0, 400, "over-soft")],
    });

    expect(placement.reason).toBe("over-soft");
    expect(placement.hardOverlap).toBe(0);
    expect(placement.softOverlap).toBeGreaterThan(0);
  });

  it("keeps hard zones reachable rather than merely uncovered", () => {
    const zones = collectZones([hardZone("rail", { left: 400, top: 0, width: 40, height: 700 })]);
    const flush = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: WORKSPACE,
      zones,
      hardGap: 8,
      candidates: [candidate(200, 0, "flush-against-rail"), candidate(600, 0, "clear")],
    });

    // 200 + 200 === 400 touches the rail exactly; the gap rejects it anyway.
    expect(flush.reason).toBe("clear");
  });

  it("breaks ties toward the launch anchor, then candidate order", () => {
    const nearAnchor = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: WORKSPACE,
      zones: collectZones([hardZone("everything", WORKSPACE)]),
      anchor: { left: 780, top: 380, width: 20, height: 20 },
      candidates: [candidate(0, 0, "far"), candidate(700, 300, "near")],
    });

    expect(nearAnchor.reason).toBe("near");

    const noAnchor = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: WORKSPACE,
      zones: collectZones([hardZone("everything", WORKSPACE)]),
      candidates: [candidate(0, 0, "first"), candidate(700, 300, "second")],
    });

    expect(noAnchor.reason).toBe("first");
  });

  it("clamps every placement inside the usable workspace", () => {
    const placement = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: { left: 50, top: 40, width: 400, height: 300 },
      zones: [],
      candidates: [candidate(-500, -500, "far-outside")],
    });

    expect(placement).toMatchObject({ left: 50, top: 40 });
    expect(placement.clampDistance).toBeGreaterThan(0);
  });

  it("shrinks a surface larger than the minimum window instead of overflowing", () => {
    const bounds = { left: 0, top: 0, width: 120, height: 90 };
    const placement = resolveOccupiedAwarePlacement({
      surface: { width: 400, height: 400 },
      bounds,
      zones: [],
      candidates: [candidate(300, 300, "anywhere")],
    });

    expect(placement.left).toBe(bounds.left);
    expect(placement.top).toBe(bounds.top);
  });

  it("returns a deterministic result for identical input", () => {
    const request = {
      surface: SURFACE,
      bounds: WORKSPACE,
      zones: collectZones([softZone("artwork", { left: 100, top: 100, width: 400, height: 400 })]),
      candidates: [candidate(80, 80, "a"), candidate(600, 80, "b")],
    };

    expect(resolveOccupiedAwarePlacement(request)).toEqual(resolveOccupiedAwarePlacement(request));
  });

  it("falls back to the workspace origin when no candidate is offered", () => {
    const placement = resolveOccupiedAwarePlacement({
      surface: SURFACE,
      bounds: { left: 12, top: 24, width: 400, height: 400 },
      zones: [],
      candidates: [],
    });

    expect(placement).toMatchObject({ left: 12, top: 24, reason: "empty" });
  });

  it("orders candidates around a rectangle and across the workspace", () => {
    expect(
      candidatesAroundRect(
        { left: 100, top: 100, width: 50, height: 50 },
        SURFACE,
        10,
        "artwork",
      ).map(({ reason }) => reason),
    ).toEqual(["artwork-right", "artwork-left", "artwork-below", "artwork-above"]);
    expect(workspaceFallbackCandidates(WORKSPACE, SURFACE).map(({ reason }) => reason)).toEqual([
      "fallback-top-right",
      "fallback-top-left",
      "fallback-bottom-right",
      "fallback-bottom-left",
      "fallback-right",
      "fallback-left",
      "fallback-top",
      "fallback-bottom",
    ]);
  });

  it("computes the rectangle helpers the placement model depends on", () => {
    expect(
      unionRects(
        { left: 0, top: 0, width: 10, height: 10 },
        {
          left: 20,
          top: 5,
          width: 10,
          height: 10,
        },
      ),
    ).toEqual({ left: 0, top: 0, width: 30, height: 15 });
    expect(insetRect({ left: 0, top: 0, width: 10, height: 10 }, 20)).toEqual({
      left: 20,
      top: 20,
      width: 0,
      height: 0,
    });
    expect(inflateRect({ left: 5, top: 5, width: 10, height: 10 }, 5)).toEqual({
      left: 0,
      top: 0,
      width: 20,
      height: 20,
    });
    expect(
      intersectionArea(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 5, top: 5, width: 10, height: 10 },
      ),
    ).toBe(25);
    expect(
      intersectionArea(
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 10, top: 0, width: 10, height: 10 },
      ),
    ).toBe(0);
  });

  it("keeps an expanded contextual surface at its real measured size", () => {
    // A selection toolbar with an open Width section is taller than its 48px
    // bar; treating only the bar as occupied is what let pickers land on the
    // open slider.
    const collapsed: WorkspaceRect = { left: 400, top: 300, width: 326, height: 48 };
    const expansion: WorkspaceRect = { left: 447, top: 356, width: 232, height: 96 };
    const expanded = unionRects(collapsed, expansion);
    const zones: readonly OccupiedZone[] = collectZones([hardZone("selection-toolbar", expanded)]);

    expect(expanded).toEqual({ left: 400, top: 300, width: 326, height: 152 });
    const placement = resolveOccupiedAwarePlacement({
      surface: { width: 200, height: 60 },
      bounds: WORKSPACE,
      zones,
      candidates: [candidate(450, 380, "over-expansion"), candidate(50, 50, "clear")],
    });

    expect(placement.reason).toBe("clear");
  });
});
