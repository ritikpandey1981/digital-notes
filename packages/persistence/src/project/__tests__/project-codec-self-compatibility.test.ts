import { describe, expect, it } from "vitest";
import {
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  createDefaultLayer,
} from "@folio/document";
import type { JsonObject } from "@folio/domain";
import { decodeFolioProject, encodeFolioProject } from "../project-codec";
import { PROJECT_LIMITS } from "../project-validation";
import type { FolioProjectSnapshot } from "../project-types";
import { createRepresentativeProject } from "./project-fixture";

/** Metadata nested exactly `levels` deep below its own root object. */
function nested(levels: number): JsonObject {
  let value: JsonObject = { leaf: "end" };
  for (let level = 0; level < levels; level += 1) value = { inner: value };
  return value;
}

function projectWithMetadata(metadata: JsonObject): FolioProjectSnapshot {
  const factory = new ObjectFactory();
  const object = factory.createLineObject({
    id: "object-line",
    createdAt: "2026-09-11T08:15:30.000Z",
    modifiedAt: "2026-09-11T08:15:30.000Z",
    geometry: { start: { x: 10, y: 10 }, end: { x: 90, y: 90 } },
    style: { strokeColor: { hex: "#111827", opacity: 1 }, strokeWidth: 2 },
    metadata,
  });
  const layer = createDefaultLayer("layer-1");
  return Object.freeze({
    metadata: Object.freeze({
      documentId: "deep",
      title: "Deeply nested study",
      createdAt: "2026-09-11T08:15:30.000Z",
    }),
    sketchbook: new SketchbookDocument({
      pages: [
        new Page({
          id: "page-1",
          content: new PageDocument({
            layers: [layer.withObjectIds([object.id])],
            objects: new ObjectCollection([object]),
          }),
        }),
      ],
    }),
  });
}

/** The deepest metadata this project shape can carry and still be re-read. */
function deepestAcceptedMetadataDepth(): number {
  for (let depth = PROJECT_LIMITS.jsonDepth; depth > 0; depth -= 1) {
    try {
      decodeFolioProject(encodeFolioProject(projectWithMetadata(nested(depth))));
      return depth;
    } catch {
      continue;
    }
  }
  return 0;
}

describe("the project codec accepts what it produces", () => {
  it("never encodes a project it will refuse to read back", () => {
    const accepted = deepestAcceptedMetadataDepth();
    expect(accepted, "no metadata depth survives a round trip").toBeGreaterThan(0);

    // One level past what a round trip accepts must be refused by the encoder
    // too, rather than written into a file nothing can open.
    const tooDeep = projectWithMetadata(nested(accepted + 1));
    let encoded: string | null = null;
    try {
      encoded = encodeFolioProject(tooDeep);
    } catch {
      encoded = null;
    }
    if (encoded !== null) {
      expect(
        () => decodeFolioProject(encoded),
        "the encoder produced an unreadable file",
      ).not.toThrow();
    }
  });

  it("reads back everything it accepts, right up to the boundary", () => {
    const accepted = deepestAcceptedMetadataDepth();
    for (const depth of [1, accepted - 1, accepted]) {
      const encoded = encodeFolioProject(projectWithMetadata(nested(depth)));
      expect(() => decodeFolioProject(encoded), `depth ${depth} failed to decode`).not.toThrow();
    }
  });

  it("stays deterministic across a full round trip", () => {
    const encoded = encodeFolioProject(createRepresentativeProject());
    const decoded = decodeFolioProject(encoded);
    expect(encodeFolioProject(decoded)).toBe(encoded);
  });
});
