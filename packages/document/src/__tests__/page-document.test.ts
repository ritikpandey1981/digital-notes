import { describe, expect, it } from "vitest";
import { LayerMembershipError } from "../errors";
import { createDefaultLayer, Layer } from "../layer";
import { ObjectCollection } from "../object-collection";
import { ObjectFactory } from "../object-factory";
import { PageDocument } from "../page-document";
import type { PageObject } from "../types";

const factory = new ObjectFactory();

function rectangle(id: string, x = 0): PageObject {
  return factory.createRectangleObject({
    id,
    geometry: { x, y: 0, width: 10, height: 10 },
    style: { strokeColor: "#111111", strokeWidth: 1 },
  });
}

function pageWith(layerSpecs: readonly (readonly string[])[]): PageDocument {
  const layers = layerSpecs.map(
    (objectIds, index) =>
      new Layer({ id: `layer-${index + 1}`, name: `Layer ${index + 1}`, objectIds }),
  );
  const objects = layerSpecs.flat().map((id, index) => rectangle(id, index * 20));
  return new PageDocument({ layers, objects: new ObjectCollection(objects) });
}

function ids(document: PageDocument): readonly string[] {
  return document.objects.objects.map((object) => object.id);
}

describe("Layer", () => {
  it("defaults to a visible, unlocked, fully opaque, empty layer", () => {
    const layer = createDefaultLayer();
    expect(layer.name).toBe("Layer 1");
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(layer.opacity).toBe(1);
    expect(layer.size).toBe(0);
    expect(Object.isFrozen(layer)).toBe(true);
  });

  it("rejects invalid identity, name, opacity, and duplicate membership", () => {
    expect(() => new Layer({ id: "  ", name: "A" })).toThrow(LayerMembershipError);
    expect(() => new Layer({ id: "a", name: "  " })).toThrow(LayerMembershipError);
    expect(() => new Layer({ id: "a", name: "A", opacity: 1.5 })).toThrow(LayerMembershipError);
    expect(() => new Layer({ id: "a", name: "A", opacity: Number.NaN })).toThrow(
      LayerMembershipError,
    );
    expect(() => new Layer({ id: "a", name: "A", objectIds: ["x", "x"] })).toThrow(
      LayerMembershipError,
    );
  });

  it("returns the same instance when a patch changes nothing", () => {
    const layer = createDefaultLayer();
    expect(layer.withPatch({ visible: true, locked: false, opacity: 1 })).toBe(layer);
    expect(layer.withPatch({ opacity: 0.5 })).not.toBe(layer);
  });

  it("inserts and removes membership without mutating the source", () => {
    const layer = new Layer({ id: "a", name: "A", objectIds: ["one", "two"] });
    expect(layer.withInsertedObject("mid", 1).objectIds).toEqual(["one", "mid", "two"]);
    expect(layer.withoutObject("one").objectIds).toEqual(["two"]);
    expect(layer.withoutObject("absent")).toBe(layer);
    expect(layer.objectIds).toEqual(["one", "two"]);
    expect(() => layer.withInsertedObject("bad", 9)).toThrow(LayerMembershipError);
  });
});

describe("PageDocument construction invariants", () => {
  it("creates an empty page owning exactly one default layer", () => {
    const document = PageDocument.empty();
    expect(document.layerCount).toBe(1);
    expect(document.bottomLayer.name).toBe("Layer 1");
    expect(document.size).toBe(0);
    expect(Object.isFrozen(document)).toBe(true);
  });

  it("requires at least one layer", () => {
    expect(() => new PageDocument({ layers: [], objects: ObjectCollection.empty() })).toThrow(
      LayerMembershipError,
    );
  });

  it("rejects duplicate layer ids", () => {
    const layers = [new Layer({ id: "same", name: "A" }), new Layer({ id: "same", name: "B" })];
    expect(() => new PageDocument({ layers, objects: ObjectCollection.empty() })).toThrow(
      /appears more than once/u,
    );
  });

  it("rejects one object claimed by two layers", () => {
    const layers = [
      new Layer({ id: "a", name: "A", objectIds: ["shared"] }),
      new Layer({ id: "b", name: "B", objectIds: ["shared"] }),
    ];
    const objects = new ObjectCollection([rectangle("shared")]);
    expect(() => new PageDocument({ layers, objects })).toThrow(/more than one Layer/u);
  });

  it("rejects orphaned canonical objects", () => {
    const layers = [new Layer({ id: "a", name: "A", objectIds: ["one"] })];
    const objects = new ObjectCollection([rectangle("one"), rectangle("orphan", 20)]);
    expect(() => new PageDocument({ layers, objects })).toThrow(/exactly one Layer/u);
  });

  it("rejects membership referencing an unknown object", () => {
    const layers = [new Layer({ id: "a", name: "A", objectIds: ["ghost"] })];
    expect(() => new PageDocument({ layers, objects: ObjectCollection.empty() })).toThrow(
      /does not match the canonical object order/u,
    );
  });

  it("rejects membership ordered differently from canonical order", () => {
    const layers = [new Layer({ id: "a", name: "A", objectIds: ["two", "one"] })];
    const objects = new ObjectCollection([rectangle("one"), rectangle("two", 20)]);
    expect(() => new PageDocument({ layers, objects })).toThrow(/canonical object order/u);
  });

  it("holds the flatten invariant for every valid page", () => {
    const document = pageWith([["a", "b"], [], ["c"]]);
    expect(document.layers.flatMap((layer) => layer.objectIds)).toEqual(ids(document));
    expect(ids(document)).toEqual(["a", "b", "c"]);
  });
});

describe("PageDocument queries", () => {
  it("derives layer ranges, membership, and append targets", () => {
    const document = pageWith([["a", "b"], ["c"]]);
    expect(document.layerRange("layer-1")).toEqual({ start: 0, end: 2 });
    expect(document.layerRange("layer-2")).toEqual({ start: 2, end: 3 });
    expect(document.layerIdForObject("c")).toBe("layer-2");
    expect(document.layerIdForObject("absent")).toBeUndefined();
    expect(document.appendIndexFor("layer-1")).toBe(2);
    expect(document.layerIndex("layer-2")).toBe(1);
  });

  it("falls back to the bottom layer when the active layer is missing", () => {
    const document = pageWith([["a"], ["b"]]);
    expect(document.resolveActiveLayerId("layer-2")).toBe("layer-2");
    expect(document.resolveActiveLayerId("removed")).toBe("layer-1");
    expect(document.resolveActiveLayerId(null)).toBe("layer-1");
    expect(document.resolveActiveLayerId(undefined)).toBe("layer-1");
  });

  it("reports unknown layers through a typed error", () => {
    const document = PageDocument.empty();
    expect(() => document.requireLayer("nope")).toThrow(LayerMembershipError);
    expect(() => document.layerRange("nope")).toThrow(/was not found/u);
  });
});

describe("PageDocument object operations", () => {
  it("appends new artwork to the top of the target layer", () => {
    const document = pageWith([["a"], ["b"]]).add(rectangle("c", 99), "layer-1");
    expect(ids(document)).toEqual(["a", "c", "b"]);
    expect(document.layer("layer-1")?.objectIds).toEqual(["a", "c"]);
    expect(document.objects.objects.map((object) => object.zIndex)).toEqual([0, 1, 2]);
  });

  it("rejects an insertion index outside the target layer", () => {
    const document = pageWith([["a"], ["b"]]);
    expect(() => document.insert(rectangle("c", 99), 3, "layer-1")).toThrow(
      /outside the target Layer/u,
    );
    expect(() => document.insert(rectangle("c", 99), 0, "layer-2")).toThrow(
      /outside the target Layer/u,
    );
  });

  it("removes an object from its owning layer and canonical order", () => {
    const document = pageWith([["a", "b"], ["c"]]).remove("b");
    expect(ids(document)).toEqual(["a", "c"]);
    expect(document.layer("layer-1")?.objectIds).toEqual(["a"]);
    expect(() => document.remove("ghost")).toThrow(/no owning Layer/u);
  });

  it("replaces an object in place without touching membership", () => {
    const document = pageWith([["a", "b"]]);
    const replaced = document.replace(
      factory.createRectangleObject({
        id: "a",
        geometry: { x: 5, y: 5, width: 4, height: 4 },
        style: { strokeColor: "#222222", strokeWidth: 2 },
      }),
    );
    expect(ids(replaced)).toEqual(["a", "b"]);
    expect(replaced.layers).toEqual(document.layers);
    expect(replaced.lookup("a")?.bounds.width).not.toBe(document.lookup("a")?.bounds.width);
  });

  it("returns the same page when a replacement changes nothing", () => {
    const document = pageWith([["a"]]);
    const current = document.lookup("a");
    expect(current).toBeDefined();
    expect(document.replace(current!)).toBe(document);
  });
});

describe("PageDocument layer operations", () => {
  it("inserts an empty layer without moving artwork", () => {
    const document = pageWith([["a"], ["b"]]).addLayer(new Layer({ id: "new", name: "New" }), 1);
    expect(document.layers.map((layer) => layer.id)).toEqual(["layer-1", "new", "layer-2"]);
    expect(ids(document)).toEqual(["a", "b"]);
    expect(() => document.addLayer(new Layer({ id: "x", name: "X" }), 9)).toThrow(
      /outside the page/u,
    );
    expect(() => document.addLayer(new Layer({ id: "y", name: "Y", objectIds: ["a"] }), 0)).toThrow(
      /must not already declare membership/u,
    );
  });

  it("removes a layer together with its artwork", () => {
    const document = pageWith([["a", "b"], ["c"]]).removeLayer("layer-1");
    expect(document.layerCount).toBe(1);
    expect(ids(document)).toEqual(["c"]);
    expect(document.objects.objects[0]?.zIndex).toBe(0);
  });

  it("never removes the final remaining layer", () => {
    expect(() => PageDocument.empty().removeLayer("layer-1")).toThrow(/final remaining Layer/u);
  });

  it("restores a removed layer with exact order and position", () => {
    const original = pageWith([["a", "b"], ["c"]]);
    const layer = original.requireLayer("layer-1");
    const artwork = layer.objectIds.map((id) => original.lookup(id)!);
    const restored = original.removeLayer("layer-1").restoreLayer(layer, 0, artwork);
    expect(restored.layers.map((current) => current.id)).toEqual(["layer-1", "layer-2"]);
    expect(ids(restored)).toEqual(["a", "b", "c"]);
    expect(restored.layer("layer-1")?.objectIds).toEqual(["a", "b"]);
  });

  it("rejects a restore whose artwork does not match membership", () => {
    const original = pageWith([["a", "b"], ["c"]]);
    const layer = original.requireLayer("layer-1");
    const reduced = original.removeLayer("layer-1");
    expect(() => reduced.restoreLayer(layer, 0, [original.lookup("a")!])).toThrow(
      /must match its declared membership/u,
    );
  });

  it("applies presentation patches without touching artwork", () => {
    const document = pageWith([["a"]]);
    const hidden = document.updateLayer("layer-1", { visible: false, opacity: 0.4 });
    expect(hidden.layer("layer-1")?.visible).toBe(false);
    expect(hidden.layer("layer-1")?.opacity).toBe(0.4);
    expect(hidden.objects).toBe(document.objects);
    expect(document.updateLayer("layer-1", { visible: true })).toBe(document);
  });

  it("reorders layers and rebuilds canonical order once", () => {
    const document = pageWith([["a", "b"], ["c"]]);
    const reordered = document.reorderLayers("layer-2", 0);
    expect(reordered.layers.map((layer) => layer.id)).toEqual(["layer-2", "layer-1"]);
    expect(ids(reordered)).toEqual(["c", "a", "b"]);
    expect(reordered.objects.objects.map((object) => object.zIndex)).toEqual([0, 1, 2]);
    expect(document.reorderLayers("layer-2", 1)).toBe(document);
    expect(() => document.reorderLayers("layer-1", 5)).toThrow(/outside the page/u);
  });

  it("preserves object identity for objects whose canonical index is unchanged", () => {
    const document = pageWith([["a", "b"], ["c"]]);
    const bottom = document.lookup("a");
    const reordered = document.reorderLayers("layer-1", 0);
    expect(reordered).toBe(document);
    const moved = document.reorderLayers("layer-2", 0);
    expect(moved.lookup("a")).not.toBe(bottom);
    expect(moved.lookup("a")?.id).toBe("a");
  });

  it("moves one object between layers, preserving canonical flattening", () => {
    const document = pageWith([["a", "b"], ["c"]]);
    const moved = document.moveObjectToLayer("a", "layer-2");
    expect(moved.layer("layer-1")?.objectIds).toEqual(["b"]);
    expect(moved.layer("layer-2")?.objectIds).toEqual(["c", "a"]);
    expect(ids(moved)).toEqual(["b", "c", "a"]);
    expect(moved.layers.flatMap((layer) => layer.objectIds)).toEqual(ids(moved));
  });

  it("reorders within one layer through moveObjectToLayer", () => {
    const document = pageWith([["a", "b", "c"]]);
    const moved = document.moveObjectToLayer("c", "layer-1", 0);
    expect(ids(moved)).toEqual(["c", "a", "b"]);
    expect(document.moveObjectToLayer("c", "layer-1", 2)).toBe(document);
    expect(() => document.moveObjectToLayer("ghost", "layer-1")).toThrow(/no owning Layer/u);
  });
});

describe("PageDocument scale", () => {
  it("reorders a 1,000-object layer set within one frame budget", () => {
    const objectIds = Array.from({ length: 1_000 }, (_, index) => `object-${index}`);
    const layers = [
      new Layer({ id: "layer-1", name: "Layer 1", objectIds: objectIds.slice(0, 500) }),
      new Layer({ id: "layer-2", name: "Layer 2", objectIds: objectIds.slice(500) }),
    ];
    const objects = new ObjectCollection(objectIds.map((id, index) => rectangle(id, index)));
    const document = new PageDocument({ layers, objects });

    const startedAt = performance.now();
    const reordered = document.reorderLayers("layer-2", 0);
    const durationMilliseconds = performance.now() - startedAt;

    expect(reordered.size).toBe(1_000);
    expect(ids(reordered)[0]).toBe("object-500");
    expect(reordered.layers.flatMap((layer) => layer.objectIds)).toEqual(ids(reordered));
    expect(durationMilliseconds).toBeLessThan(120);
    console.info("Phase 19 layer reorder (1,000 objects, ms)", { durationMilliseconds });
  });
});
