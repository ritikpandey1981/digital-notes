import { describe, expect, it } from "vitest";
import { InkError } from "../errors";
import {
  pencilMaterialResources,
  registeredMaterialResources,
  releaseMaterialResources,
  resolveMaterialResource,
  type MaterialResource,
} from "../internal/pencil-material";

/**
 * What a built-in material resource is allowed to be.
 *
 * Three things are settled here and nowhere else: a resource is **generated**,
 * so a build carries it rather than shipping an asset beside it; it is
 * **shared**, so a thousand marks on a page hold one copy of the sheet between
 * them; and it is **named by a strategy version**, so a saved stroke resolves
 * the fields it was actually made with without the format gaining a field.
 */

describe("built-in material resources", () => {
  it("registers exactly the resources this build contains", () => {
    expect(registeredMaterialResources()).toEqual([
      "folio.graphite.hb-tip.v1",
      "folio.paper.graphite-tooth.v1",
    ]);
  });

  it("resolves a known resource to a square grayscale field", () => {
    const nib = resolveMaterialResource("folio.graphite.hb-tip.v1");
    const paper = resolveMaterialResource("folio.paper.graphite-tooth.v1");
    expect(nib.size).toBe(128);
    expect(nib.samples).toBeInstanceOf(Uint8Array);
    expect(nib.samples.length).toBe(128 * 128);
    expect(paper.size).toBe(256);
    expect(paper.samples.length).toBe(256 * 256);
  });

  it("refuses an unknown resource rather than substituting a nearby one", () => {
    // Substituting would mean saved artwork quietly came back looking like
    // something else, which is worse than not opening.
    let thrown: unknown;
    try {
      resolveMaterialResource("folio.graphite.hb-tip.v2");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InkError);
    expect((thrown as InkError).code).toBe("UNKNOWN_MATERIAL_RESOURCE");
    expect((thrown as InkError).details.id).toBe("folio.graphite.hb-tip.v2");
  });

  it("shares one decoded copy rather than one per caller", () => {
    const first = resolveMaterialResource("folio.paper.graphite-tooth.v1");
    const others: MaterialResource[] = [];
    for (let index = 0; index < 500; index += 1) {
      others.push(resolveMaterialResource("folio.paper.graphite-tooth.v1"));
    }
    for (const other of others) {
      expect(other).toBe(first);
      expect(other.samples).toBe(first.samples);
    }
  });

  it("hands every stroke the same nib and sheet objects", () => {
    // A per-stroke copy of the sheet alone would be 64 KiB for every mark on
    // the page, which is the failure this sharing exists to prevent.
    const a = pencilMaterialResources(1);
    const b = pencilMaterialResources(1);
    expect(a.nib.samples).toBe(b.nib.samples);
    expect(a.paper.samples).toBe(b.paper.samples);
    expect(a.nib.samples).toBe(resolveMaterialResource("folio.graphite.hb-tip.v1").samples);
  });

  it("binds resources to the strategy version and nothing else", () => {
    expect(pencilMaterialResources(1).nib.id).toBe("folio.graphite.hb-tip.v1");
    expect(pencilMaterialResources(1).paper.id).toBe("folio.paper.graphite-tooth.v1");
    // A Pencil wanting different fields is a new strategy version, which is the
    // only mechanism by which the binding may ever move.
    expect(() => pencilMaterialResources(2)).toThrow(InkError);
  });

  it("names resources by identity, never by location", () => {
    for (const id of registeredMaterialResources()) {
      expect(id).not.toMatch(/[\\/]/);
      expect(id).not.toMatch(/^[a-zA-Z]:/);
      expect(id).not.toMatch(/^[a-z]+:\/\//);
      const resource = resolveMaterialResource(id);
      // No path, url, src or href ever becomes part of a resource.
      expect(Object.keys(resource).sort()).toEqual(["id", "samples", "size"]);
    }
  });

  it.each(["folio.graphite.hb-tip.v1", "folio.paper.graphite-tooth.v1"] as const)(
    "generates the same bytes every time: %s",
    (id) => {
      // That a resource is generated at all is only safe because generating it
      // twice gives the same field. *Which* field is pinned in
      // [`pencil-visual-freeze.test.ts`](pencil-visual-freeze.test.ts), with
      // the rest of the approved appearance, so there is one place a Pencil
      // digest can be edited rather than two.
      const first = resolveMaterialResource(id).samples.slice();
      releaseMaterialResources();
      const second = resolveMaterialResource(id).samples;
      expect([...second]).toEqual([...first]);
    },
  );
});
