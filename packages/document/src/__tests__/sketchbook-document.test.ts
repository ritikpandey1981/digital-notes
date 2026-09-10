import { describe, expect, it } from "vitest";
import { InkObject } from "../ink-object";
import { LayerMembershipError } from "../errors";
import { createDefaultLayer, Layer } from "../layer";
import { ObjectCollection } from "../object-collection";
import { ObjectFactory } from "../object-factory";
import { PageDocument } from "../page-document";
import {
  createPageGeometry,
  DEFAULT_PAGE_GEOMETRY,
  MAXIMUM_PAGE_EXTENT,
  MINIMUM_PAGE_EXTENT,
  matchPagePreset,
  orientPageGeometry,
  PAGE_PRESETS,
  pageOrientation,
  pagePreset,
} from "../page-geometry";
import { createPagePaper, DEFAULT_PAPER_COLOR, paperTypeDefinition } from "../page-paper";
import { createPageLike, duplicatePage, Page, SketchbookDocument } from "../sketchbook-document";
import type { PageObject } from "../types";
import { createStroke } from "./fixtures";

const factory = new ObjectFactory({ now: () => "2026-08-26T10:00:00.000Z" });

function rectangle(id: string, x = 10): PageObject {
  return factory.createRectangleObject({
    id,
    geometry: { x, y: 10, width: 20, height: 20 },
    style: { strokeColor: "#111111", strokeWidth: 2 },
  });
}

function contentOf(groups: readonly (readonly PageObject[])[]): PageDocument {
  const layers = groups.map(
    (objects, index) =>
      new Layer({
        id: `layer-${index + 1}`,
        name: `Layer ${index + 1}`,
        objectIds: objects.map((object) => object.id),
      }),
  );
  return new PageDocument({ layers, objects: new ObjectCollection(groups.flat()) });
}

function identityFactory(prefix: string) {
  let ordinal = 0;
  return {
    createPageId: () => `${prefix}-page-${(ordinal += 1)}`,
    createLayerId: () => `${prefix}-layer-${(ordinal += 1)}`,
    createObjectId: () => `${prefix}-object-${(ordinal += 1)}`,
  };
}

describe("page geometry", () => {
  it("derives orientation from extent alone", () => {
    expect(pageOrientation({ width: 794, height: 1123 })).toBe("portrait");
    expect(pageOrientation({ width: 1123, height: 794 })).toBe("landscape");
    expect(pageOrientation({ width: 900, height: 900 })).toBe("square");
  });

  it("swaps extent when reorienting and leaves squares untouched", () => {
    expect(orientPageGeometry({ width: 794, height: 1123 }, "landscape")).toEqual({
      width: 1123,
      height: 794,
    });
    expect(orientPageGeometry({ width: 1123, height: 794 }, "portrait")).toEqual({
      width: 794,
      height: 1123,
    });
    expect(orientPageGeometry({ width: 900, height: 900 }, "landscape")).toEqual({
      width: 900,
      height: 900,
    });
  });

  it("rejects non-finite, zero, negative, and out-of-range extents", () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, MINIMUM_PAGE_EXTENT - 1]) {
      expect(() => createPageGeometry({ width: bad, height: 500 })).toThrow(LayerMembershipError);
      expect(() => createPageGeometry({ width: 500, height: bad })).toThrow(LayerMembershipError);
    }
    expect(() => createPageGeometry({ width: MAXIMUM_PAGE_EXTENT + 1, height: 500 })).toThrow();
    expect(createPageGeometry({ width: 500, height: 500 })).toEqual({ width: 500, height: 500 });
  });

  it("exposes the required presets and resolves them from geometry", () => {
    expect(PAGE_PRESETS.map((preset) => preset.id)).toEqual([
      "a4",
      "a5",
      "letter",
      "square",
      "screen",
    ]);
    expect(matchPagePreset(DEFAULT_PAGE_GEOMETRY)).toBe("a4");
    expect(matchPagePreset({ width: 1123, height: 794 })).toBe("a4");
    expect(matchPagePreset({ width: 900, height: 900 })).toBe("square");
    expect(matchPagePreset({ width: 1234, height: 567 })).toBe("custom");
    expect(pagePreset("a5")?.geometry).toEqual({ width: 559, height: 794 });
    expect(pagePreset("custom")).toBeUndefined();
  });
});

describe("page paper", () => {
  it("defaults to blank warm-white paper without spacing", () => {
    const paper = createPagePaper();
    expect(paper).toEqual({ type: "blank", color: DEFAULT_PAPER_COLOR });
  });

  it("applies each patterned type's default spacing", () => {
    for (const type of ["ruled", "grid", "dotted", "isometric"] as const) {
      expect(createPagePaper({ type }).spacing).toBe(paperTypeDefinition(type).defaultSpacing);
    }
  });

  it("normalizes color and rejects invalid spacing or type", () => {
    expect(createPagePaper({ color: "#FFFFFF" }).color).toBe("#ffffff");
    expect(() => createPagePaper({ type: "grid", spacing: 0 })).toThrow(LayerMembershipError);
    expect(() => createPagePaper({ type: "grid", spacing: 10_000 })).toThrow(LayerMembershipError);
    expect(() => createPagePaper({ type: "unknown" as never })).toThrow(LayerMembershipError);
  });
});

describe("Page", () => {
  it("defaults to A4 landscape blank paper with one empty layer", () => {
    const page = new Page({ id: "page-1" });
    expect(page.geometry).toEqual(DEFAULT_PAGE_GEOMETRY);
    expect(page.orientation).toBe("landscape");
    expect(page.paper.type).toBe("blank");
    expect(page.content.layerCount).toBe(1);
    expect(page.objectCount).toBe(0);
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("resizing changes the boundary and never the artwork", () => {
    const object = rectangle("a", 700);
    const page = new Page({ id: "page-1", content: contentOf([[object]]) });
    const resized = page.withGeometry({ width: 400, height: 400 });

    expect(resized.geometry).toEqual({ width: 400, height: 400 });
    // Artwork identity, geometry, and layer order are untouched by a resize.
    expect(resized.content).toBe(page.content);
    expect(resized.content.lookup("a")).toBe(object);
    expect(resized.hasArtworkOutsideBounds()).toBe(true);
    expect(page.hasArtworkOutsideBounds()).toBe(false);
  });

  it("returns the same page when a change is a no-op", () => {
    const page = new Page({ id: "page-1" });
    expect(page.withGeometry(DEFAULT_PAGE_GEOMETRY)).toBe(page);
    expect(page.withPaper({ type: "blank" })).toBe(page);
    expect(page.withName("")).toBe(page);
    expect(page.withContent(page.content)).toBe(page);
  });

  it("rejects invalid identity", () => {
    expect(() => new Page({ id: "  " })).toThrow(LayerMembershipError);
  });
});

describe("SketchbookDocument", () => {
  function sketchbook(count: number): SketchbookDocument {
    return new SketchbookDocument({
      pages: Array.from({ length: count }, (_, index) => new Page({ id: `page-${index + 1}` })),
    });
  }

  it("requires at least one page and rejects duplicate identity", () => {
    expect(() => new SketchbookDocument({ pages: [] })).toThrow(/at least one page/u);
    expect(
      () => new SketchbookDocument({ pages: [new Page({ id: "a" }), new Page({ id: "a" })] }),
    ).toThrow(/more than once/u);
  });

  it("orders pages by array position, first page first", () => {
    const document = sketchbook(3);
    expect(document.pages.map((page) => page.id)).toEqual(["page-1", "page-2", "page-3"]);
    expect(document.pageIndex("page-2")).toBe(1);
    expect(document.firstPage.id).toBe("page-1");
  });

  it("inserts, removes, and reorders pages", () => {
    const document = sketchbook(3);
    const inserted = document.insertPage(new Page({ id: "new" }), 1);
    expect(inserted.pages.map((page) => page.id)).toEqual(["page-1", "new", "page-2", "page-3"]);

    const removed = document.removePage("page-2");
    expect(removed.pages.map((page) => page.id)).toEqual(["page-1", "page-3"]);

    const reordered = document.reorderPages("page-3", 0);
    expect(reordered.pages.map((page) => page.id)).toEqual(["page-3", "page-1", "page-2"]);
    expect(document.reorderPages("page-1", 0)).toBe(document);
    expect(() => document.reorderPages("page-1", 9)).toThrow(/outside the sketchbook/u);
    expect(() => document.insertPage(new Page({ id: "page-1" }), 0)).toThrow(/already exists/u);
  });

  it("never removes the final remaining page", () => {
    expect(() => sketchbook(1).removePage("page-1")).toThrow(/final remaining page/u);
  });

  it("chooses the next page as the deletion neighbor, then the previous", () => {
    const document = sketchbook(3);
    expect(document.neighborPageId("page-1")).toBe("page-2");
    expect(document.neighborPageId("page-2")).toBe("page-3");
    expect(document.neighborPageId("page-3")).toBe("page-2");
  });

  it("falls back to the first page when the active page is missing", () => {
    const document = sketchbook(2);
    expect(document.resolveActivePageId("page-2")).toBe("page-2");
    expect(document.resolveActivePageId("removed")).toBe("page-1");
    expect(document.resolveActivePageId(null)).toBe("page-1");
  });

  it("keeps artwork completely independent between pages", () => {
    const first = new Page({ id: "page-1", content: contentOf([[rectangle("a")]]) });
    const second = new Page({ id: "page-2", content: contentOf([[rectangle("b", 60)]]) });
    const document = new SketchbookDocument({ pages: [first, second] });

    const edited = document.replacePage(first.withGeometry({ width: 500, height: 500 }));
    expect(edited.requirePage("page-2")).toBe(second);
    expect(edited.requirePage("page-1").content).toBe(first.content);
    expect(document.requirePage("page-1").geometry).toEqual(DEFAULT_PAGE_GEOMETRY);
  });
});

describe("page duplication", () => {
  it("clones appearance exactly while regenerating every identity", () => {
    const source = new Page({
      id: "source",
      name: "Studies",
      geometry: { width: 1123, height: 794 },
      paper: createPagePaper({ type: "grid", color: "#fbf3e0", spacing: 30 }),
      content: contentOf([[rectangle("a"), rectangle("b", 40)], [rectangle("c", 80)]]),
    });
    const hidden = source.withContent(
      source.content.updateLayer("layer-2", { visible: false, opacity: 0.4 }),
    );
    const copy = duplicatePage(hidden, identityFactory("dup"));

    expect(copy.id).not.toBe(hidden.id);
    expect(copy.name).toBe("Studies");
    expect(copy.geometry).toEqual(hidden.geometry);
    expect(copy.paper).toEqual(hidden.paper);
    expect(copy.content.layerCount).toBe(2);
    expect(copy.content.size).toBe(3);

    // Layer presentation and canonical ordering survive; identity does not.
    expect(copy.content.layers[1]?.visible).toBe(false);
    expect(copy.content.layers[1]?.opacity).toBe(0.4);
    expect(copy.content.layers.map((layer) => layer.id)).not.toEqual(
      hidden.content.layers.map((layer) => layer.id),
    );
    const sourceIds = hidden.content.objects.objects.map((object) => object.id);
    const copyIds = copy.content.objects.objects.map((object) => object.id);
    expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false);
    expect(copy.content.layers.flatMap((layer) => layer.objectIds)).toEqual(copyIds);
    expect(copy.content.objects.objects.map((object) => [object.type, object.bounds.x])).toEqual(
      hidden.content.objects.objects.map((object) => [object.type, object.bounds.x]),
    );
  });

  it("preserves finalized Ink process and resolved brush data while replacing object identity", () => {
    const ink = factory.createInkObject({ id: "ink", stroke: createStroke("source-stroke") });
    const source = new Page({ id: "source", content: contentOf([[ink]]) });
    const copy = duplicatePage(source, identityFactory("dup"));
    const duplicatedInk = copy.content.objects.objects[0];

    expect(duplicatedInk).toBeInstanceOf(InkObject);
    if (!(duplicatedInk instanceof InkObject)) {
      throw new Error("Expected duplicated artwork to remain Ink.");
    }
    expect(duplicatedInk.id).not.toBe(ink.id);
    expect(duplicatedInk.stroke).toBe(ink.stroke);
    expect(duplicatedInk.stroke.brush).toBe(ink.stroke.brush);
    expect(duplicatedInk.stroke.sourceSamples).toBe(ink.stroke.sourceSamples);
  });

  it.each(["grid", "ruled"] as const)(
    "creates an empty blank page from %s paper while inheriting geometry only",
    (paperType) => {
      const source = new Page({
        id: "source",
        geometry: { width: 900, height: 900 },
        paper: createPagePaper({ type: paperType, color: "#fbf3e0" }),
        content: contentOf([[rectangle("a")]]),
      });
      const created = createPageLike(source, identityFactory("new"));

      expect(created.id).not.toBe(source.id);
      expect(created.geometry).toEqual(source.geometry);
      expect(created.paper).toEqual({ type: "blank", color: DEFAULT_PAPER_COLOR });
      expect(created.objectCount).toBe(0);
      expect(created.content.layerCount).toBe(1);
      expect(created.content.bottomLayer.name).toBe(createDefaultLayer().name);
    },
  );
});
