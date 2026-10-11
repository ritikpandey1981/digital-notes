import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRUSH_PRESET_IDS,
  DEFAULT_BRUSH_PRESETS,
  createBrushToolStateStore,
} from "../foundation/pen-presets";
import { createDrawingSlotStore } from "../foundation/drawing-slot-state";

/**
 * The Marker family's default, and the one catalogue entry on `marker@1`.
 *
 * `marker-broad` deliberately stays on its frozen legacy strategy: migrating a
 * whole family at once is how a phase that was meant to prove one strategy
 * quietly becomes the catalogue phase, and this is the gate that notices.
 */

const MARKER_FELT_ID = "marker-felt";
const MARKER_BROAD_ID = "marker-broad";

describe("the Marker preset", () => {
  it("is the only preset on the marker strategy, and is the family's default", () => {
    const onMarker = DEFAULT_BRUSH_PRESETS.filter((preset) => preset.renderer.kind === "marker");
    expect(onMarker.map(({ id }) => id)).toEqual([MARKER_FELT_ID]);
    expect(DEFAULT_BRUSH_PRESET_IDS.marker).toBe(MARKER_FELT_ID);

    for (const preset of DEFAULT_BRUSH_PRESETS) {
      if (preset.id === MARKER_FELT_ID) continue;
      expect(["centerline", "outline", "technical-pen", "pressure-pen", "pencil"]).toContain(
        preset.renderer.kind,
      );
    }
  });

  it("leaves the broad marker on the strategy it already had", () => {
    const broad = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === MARKER_BROAD_ID);
    expect(broad).toBeDefined();
    expect(broad?.renderer).toEqual({ version: 1, kind: "centerline" });
    expect(broad?.family).toBe("marker");
  });

  it("keeps the width, opacity and smoothing the preset already shipped", () => {
    // The strategy changed; the configuration did not. A migration that also
    // retuned the preset would make it impossible to say which of the two
    // changed what a person sees.
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === MARKER_FELT_ID);
    expect(preset).toBeDefined();
    if (preset === undefined) return;
    expect(preset.renderer).toEqual({ version: 1, kind: "marker" });
    expect(preset.family).toBe("marker");
    expect(preset.defaults.size).toBe(8);
    expect(preset.defaults.opacity).toBe(0.9);
    expect(preset.defaults.smoothing).toEqual({ mode: "average", amount: 0.22 });
  });

  it("resolves a snapshot that varies neither width nor opacity with pressure", () => {
    // A marker is not a brush pen. What varies is which way it was drawn, which
    // is the nib's doing and needs no durable field.
    const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === MARKER_FELT_ID);
    expect(preset?.dynamics.pressureSize.enabled).toBe(false);
    expect(preset?.dynamics.pressureOpacity.enabled).toBe(false);
  });

  it("carries slot width, opacity and smoothing overrides into the snapshot", () => {
    const slots = createDrawingSlotStore([
      { id: "marker", family: "marker", presetId: MARKER_FELT_ID, brushId: "marker-felt" },
    ]);
    slots.updateProperties("marker", {
      size: 24,
      opacity: 0.7,
      smoothing: { mode: "average", amount: 0.4 },
    });

    const resolved = slots.resolvedBrush("marker");
    expect(resolved.renderer.kind).toBe("marker");
    expect(resolved.size).toBe(24);
    expect(resolved.opacity).toBe(0.7);
    expect(resolved.smoothing).toEqual({ mode: "average", amount: 0.4 });
  });

  it("is reachable from the family store without disturbing the other presets", () => {
    const store = createBrushToolStateStore();
    expect(store.resolvedBrush("marker").renderer.kind).toBe("marker");

    store.selectPreset("marker", MARKER_BROAD_ID);
    expect(store.resolvedBrush("marker").renderer.kind).toBe("centerline");

    store.selectPreset("marker", MARKER_FELT_ID);
    expect(store.resolvedBrush("marker").renderer.kind).toBe("marker");
    expect(store.resolvedBrush("pen").renderer.kind).toBe("centerline");
    expect(store.resolvedBrush("pencil").renderer.kind).toBe("pencil");
    expect(store.resolvedBrush("highlighter").renderer.kind).toBe("centerline");
  });
});
