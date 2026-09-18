import {
  Stroke,
  StrokeBuilder,
  StrokeSmoother,
  createBrushPreset,
  resolveBrushPreset,
} from "@folio/ink";
import { describe, expect, it } from "vitest";
import { CURRENT_NOTEBOOK_FORMAT_VERSION } from "../../constants";
import { decodeStroke, encodeStroke } from "../ink-codec";
import { createResourceBudget, type ProjectResourceBudget } from "../project-validation";

/**
 * What a saved Pencil stroke may contain, now that Pencil has a material.
 *
 * The hybrid material generates a great deal: dabs, an index, field tiles,
 * deposited alpha. **None of it is durable.** Durable authority stays exactly
 * what it was -- the source samples, the resolved snapshot, and the strategy
 * identity inside it -- and the resources the material is made of are named by
 * that strategy version rather than by a field in the file.
 *
 * That is why this phase needs no format change, and this suite is where that
 * claim is checked rather than asserted.
 */

const PENCIL_PRESET = createBrushPreset({
  id: "hb-graphite",
  version: 1,
  name: "HB Pencil",
  family: "pencil",
  defaults: {
    color: "#343434",
    size: 12,
    opacity: 0.78,
    smoothing: { mode: "average", amount: 0.2 },
  },
  dynamics: {
    pressureSize: {
      enabled: true,
      minimumFactor: 0.65,
      maximumFactor: 1.25,
      curve: { kind: "linear", exponent: 1 },
    },
    pressureOpacity: {
      enabled: true,
      minimumFactor: 0.45,
      maximumFactor: 1,
      curve: { kind: "power", exponent: 0.75 },
    },
  },
  renderer: { version: 1, kind: "pencil" },
});

function budget(): ProjectResourceBudget {
  return createResourceBudget();
}

function pencilStroke(): Stroke {
  const builder = new StrokeBuilder({
    id: "stroke-hb-graphite",
    timestamp: 0,
    brush: resolveBrushPreset(PENCIL_PRESET),
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < 48; index += 1) {
    builder.addPoint({
      x: 60 + index * 3,
      y: 100 + Math.sin(index / 6) * 20,
      timestamp: index * 8,
      pressure: 0.2 + (0.7 * index) / 47,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  }
  return builder.finalize();
}

describe("Pencil material persistence", () => {
  it("saves nothing the material generated", () => {
    const encoded = encodeStroke(pencilStroke(), "$.stroke", budget());
    const serialized = JSON.stringify(encoded);
    for (const forbidden of [
      "alpha",
      "tile",
      "dab",
      "material",
      "nib",
      "paper",
      "grain",
      "resource",
      "cache",
      "canvas",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the strategy identity as the only durable name of its resources", () => {
    const encoded = encodeStroke(pencilStroke(), "$.stroke", budget());
    expect(encoded.brush.renderer).toEqual({ version: 1, kind: "pencil" });
    // No resource id, no texture id, no path: the format gained nothing.
    expect(Object.keys(encoded.brush).sort()).toEqual([
      "color",
      "dynamics",
      "family",
      "opacity",
      "presetId",
      "presetVersion",
      "renderer",
      "schemaVersion",
      "size",
      "smoothing",
    ]);
    expect(encoded.style.brushTextureId).toBeUndefined();
  });

  it("round-trips everything a rebuild of the material needs", () => {
    const original = pencilStroke();
    const restored = decodeStroke(
      JSON.parse(JSON.stringify(encodeStroke(original, "$.stroke", budget()))),
      "$.stroke",
      budget(),
    );
    expect(restored.id).toBe(original.id);
    expect(restored.brush).toEqual(original.brush);
    expect(restored.points.map((point) => [point.x, point.y, point.pressure])).toEqual(
      original.points.map((point) => [point.x, point.y, point.pressure]),
    );
    expect(restored.sourceSamples.length).toBe(original.sourceSamples.length);
  });

  it("needs no format change to carry a hybrid material", () => {
    // The material foundation added resources, tiles, an index and a runtime
    // cache. It added nothing to the file, which is what keeps this number
    // where it is.
    expect(CURRENT_NOTEBOOK_FORMAT_VERSION).toBe(1);
    expect(encodeStroke(pencilStroke(), "$.stroke", budget()).brush.schemaVersion).toBe(1);
  });

  it("puts no material on the Stroke either", () => {
    // A Stroke that could reach a tile would put pixels into undo, into a
    // save, and into every copy of the artwork that exists.
    const stroke = pencilStroke();
    const reachable = new Set<string>();
    for (const key of Object.keys(stroke)) reachable.add(key.toLowerCase());
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(stroke) as object)) {
      reachable.add(key.toLowerCase());
    }
    for (const forbidden of ["tile", "material", "alpha", "dab", "nib", "grain", "cache"]) {
      expect([...reachable].some((key) => key.includes(forbidden))).toBe(false);
    }
  });
});
