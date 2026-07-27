import { describe, expect, it } from "vitest";
import { deserializeNotebook } from "../deserializer";
import { stableStringify } from "../json";
import { serializeNotebook } from "../serializer";
import type { NotebookDocumentSet } from "../types";
import { buildNotebook, documentsFor, roundTripInMemory } from "./helpers";

describe("notebook serialization", () => {
  it("serializes one metadata document and separate section and page documents", () => {
    const serialized = serializeNotebook(buildNotebook());

    expect(serialized.files.map(({ kind }) => kind)).toEqual([
      "metadata",
      "section",
      "page",
      "page",
      "section",
      "page",
      "page",
    ]);
    expect(serialized.files.map(({ relativePath }) => relativePath)).toEqual([
      "metadata.json",
      "sections/item-section-1.json",
      "pages/item-page-1-1.json",
      "pages/item-page-1-2.json",
      "sections/item-section-2.json",
      "pages/item-page-2-1.json",
      "pages/item-page-2-2.json",
    ]);
  });

  it("produces byte-for-byte deterministic JSON with sorted object keys", () => {
    const first = serializeNotebook(buildNotebook());
    const second = serializeNotebook(buildNotebook());

    expect(second).toEqual(first);
    expect(stableStringify({ z: 1, nested: { z: 2, a: 1 }, a: 2 })).toBe(
      '{\n  "a": 2,\n  "nested": {\n    "a": 1,\n    "z": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it("reconstructs immutable domain models through the domain factories", () => {
    const notebook = buildNotebook();
    const loaded = roundTripInMemory(notebook);

    expect(loaded).toEqual(notebook);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.sections[0])).toBe(true);
    expect(Object.isFrozen(loaded.sections[0]?.pages[0])).toBe(true);
  });

  it("preserves unknown compatible fields across load and save", () => {
    const documents = documentsFor(buildNotebook());
    const sectionIds = documents.metadata.sectionIds;
    if (!Array.isArray(sectionIds)) throw new Error("Expected section ids.");
    const sectionId = String(sectionIds[0]);
    const section = documents.sections[sectionId];
    const pageIds = section?.pageIds;
    if (!Array.isArray(pageIds)) throw new Error("Expected page ids.");
    const pageId = String(pageIds[0]);
    const page = documents.pages[pageId];
    if (
      !section ||
      !page ||
      !Array.isArray(page.objects) ||
      !Array.isArray(documents.metadata.assets)
    ) {
      throw new Error("Expected fixture documents.");
    }
    const object = page.objects[0];
    const asset = documents.metadata.assets[0];
    if (
      !object ||
      typeof object !== "object" ||
      Array.isArray(object) ||
      !asset ||
      typeof asset !== "object" ||
      Array.isArray(asset)
    ) {
      throw new Error("Expected object and asset fixture documents.");
    }

    const extended: NotebookDocumentSet = {
      metadata: {
        ...documents.metadata,
        assets: [{ ...asset, futureAsset: { renderer: "future" } }],
        futureMetadata: { enabled: true },
      },
      sections: { ...documents.sections, [sectionId]: { ...section, futureSection: "kept" } },
      pages: {
        ...documents.pages,
        [pageId]: {
          ...page,
          futurePage: 12,
          objects: [{ ...object, futureObject: ["kept"] }],
        },
      },
    };

    const loaded = deserializeNotebook(extended);
    const saved = serializeNotebook(loaded.notebook, loaded.compatibility);
    const reloadedDocuments: Record<string, ReturnType<typeof JSON.parse>> = Object.fromEntries(
      saved.files.map((file) => [file.relativePath, JSON.parse(file.content)]),
    );

    expect(reloadedDocuments["metadata.json"].futureMetadata).toEqual({ enabled: true });
    expect(reloadedDocuments[`sections/item-${sectionId}.json`].futureSection).toBe("kept");
    expect(reloadedDocuments[`pages/item-${pageId}.json`].futurePage).toBe(12);
    expect(reloadedDocuments[`pages/item-${pageId}.json`].objects[0].futureObject).toEqual([
      "kept",
    ]);
    expect(reloadedDocuments["metadata.json"].assets[0].futureAsset).toEqual({
      renderer: "future",
    });
  });

  it("round-trips Unicode without escaping or data loss", () => {
    const notebook = buildNotebook({ unicode: true });
    const serialized = serializeNotebook(notebook);

    expect(serialized.files[0]?.content).toContain("研究 📚 — Café");
    expect(roundTripInMemory(notebook)).toEqual(notebook);
  });
});
