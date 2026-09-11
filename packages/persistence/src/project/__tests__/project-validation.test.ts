import { Page, SketchbookDocument } from "@folio/document";
import { describe, expect, it } from "vitest";
import {
  FolioProjectCodecError,
  decodeFolioProject,
  encodeFolioProject,
  type FolioProjectCodecErrorCode,
  type FolioProjectSnapshot,
} from "@folio/persistence/project";
import { createRepresentativeProject } from "./project-fixture";

type MutableRecord = Record<string, unknown>;

describe("Folio project validation", () => {
  it.each(["{", '{"format":"folio-project"'])("rejects invalid or truncated JSON", (input) => {
    expectFailure(input, "INVALID_PROJECT", "$");
  });

  it("rejects a non-object root", () => {
    expectFailure("[]", "INVALID_PROJECT", "$");
  });

  it("rejects missing and wrong format discriminators", () => {
    const missing = projectDocument();
    delete missing.format;
    expectFailure(missing, "INVALID_PROJECT", "$.format");

    const wrong = projectDocument();
    wrong.format = "not-folio";
    expectFailure(wrong, "INVALID_PROJECT", "$.format");
  });

  it("rejects missing, non-integer, and unsupported format versions distinctly", () => {
    const missing = projectDocument();
    delete missing.formatVersion;
    expectFailure(missing, "INVALID_PROJECT", "$.formatVersion");

    const stringVersion = projectDocument();
    stringVersion.formatVersion = "1";
    expectFailure(stringVersion, "INVALID_PROJECT", "$.formatVersion");

    const newer = projectDocument();
    newer.formatVersion = 2;
    expectFailure(newer, "UNSUPPORTED_VERSION", "$.formatVersion");
  });

  it("rejects unknown fields consistently throughout known v1 records", () => {
    const root = projectDocument();
    root.future = true;
    expectFailure(root, "INVALID_PROJECT", "$.future");

    const objectDocument = projectDocument();
    firstObject(objectDocument).futureRenderer = "unknown";
    expectFailure(
      objectDocument,
      "INVALID_OBJECT",
      "$.sketchbook.pages[0].content.objects[0].futureRenderer",
    );
  });

  it("rejects missing or invalid project metadata", () => {
    const missing = projectDocument();
    delete missing.metadata;
    expectFailure(missing, "INVALID_METADATA", "$.metadata");

    const invalidId = projectDocument();
    metadata(invalidId).documentId = "  ";
    expectFailure(invalidId, "INVALID_METADATA", "$.metadata.documentId");

    const invalidTitle = projectDocument();
    metadata(invalidTitle).title = "";
    expectFailure(invalidTitle, "INVALID_METADATA", "$.metadata.title");

    const invalidTimestamp = projectDocument();
    metadata(invalidTimestamp).createdAt = "September someday";
    expectFailure(invalidTimestamp, "INVALID_METADATA", "$.metadata.createdAt");
  });

  it("rejects missing pages, an empty page array, and duplicate page IDs", () => {
    const missing = projectDocument();
    delete sketchbook(missing).pages;
    expectFailure(missing, "INVALID_PAGE", "$.sketchbook.pages");

    const empty = projectDocument();
    sketchbook(empty).pages = [];
    expectFailure(empty, "INVALID_PAGE", "$.sketchbook.pages");

    const duplicate = projectDocument();
    const pages = pageDocuments(duplicate);
    pages[1]!.id = pages[0]!.id;
    expectFailure(duplicate, "INVALID_PAGE", "$.sketchbook.pages[1].id");
  });

  it("rejects invalid page geometry and paper without coercion", () => {
    const geometry = projectDocument();
    pageGeometry(geometry).width = 0;
    expectFailure(geometry, "INVALID_PAGE", "$.sketchbook.pages[0].geometry");

    const paperType = projectDocument();
    pagePaper(paperType).type = "music";
    expectFailure(paperType, "INVALID_PAGE", "$.sketchbook.pages[0].paper.type");

    const paperSpacing = projectDocument();
    pagePaper(paperSpacing).spacing = 0;
    expectFailure(paperSpacing, "INVALID_PAGE", "$.sketchbook.pages[0].paper");
  });

  it("rejects duplicate Layer IDs and invalid Layer opacity", () => {
    const duplicate = projectDocument();
    const layers = firstLayers(duplicate);
    layers[1]!.id = layers[0]!.id;
    expectFailure(duplicate, "INVALID_LAYER", "$.sketchbook.pages[0].content.layers[1].id");

    const opacity = projectDocument();
    firstLayers(opacity)[0]!.opacity = 1.5;
    expectFailure(opacity, "INVALID_LAYER", "$.sketchbook.pages[0].content.layers[0].opacity");
  });

  it("rejects missing, duplicate, multiple, reordered, and orphaned membership", () => {
    const missing = projectDocument();
    objectIds(firstLayers(missing)[0]!).splice(0, 1, "missing-object");
    expectFailure(missing, "INVALID_LAYER", "$.sketchbook.pages[0].content.layers[0].objectIds[0]");

    const duplicateWithinLayer = projectDocument();
    const duplicateIds = objectIds(firstLayers(duplicateWithinLayer)[0]!);
    duplicateIds.push(duplicateIds[0]!);
    expectFailure(duplicateWithinLayer, "INVALID_LAYER", "$.sketchbook.pages[0].content.layers[0]");

    const multiple = projectDocument();
    const multipleLayers = firstLayers(multiple);
    objectIds(multipleLayers[1]!).push(objectIds(multipleLayers[0]!)[0]!);
    expectFailure(
      multiple,
      "INVALID_LAYER",
      "$.sketchbook.pages[0].content.layers[1].objectIds[1]",
    );

    const reordered = projectDocument();
    objectIds(firstLayers(reordered)[0]!).reverse();
    expectFailure(
      reordered,
      "INVALID_LAYER",
      "$.sketchbook.pages[0].content.layers[0].objectIds[0]",
    );

    const orphaned = projectDocument();
    objectIds(firstLayers(orphaned)[2]!).splice(0, 1);
    expectFailure(orphaned, "INVALID_LAYER", "$.sketchbook.pages[0].content.objects[3]");
  });

  it("rejects duplicate object IDs and unknown object types", () => {
    const duplicate = projectDocument();
    const objects = firstObjects(duplicate);
    const duplicateObject = structuredClone(objects[0]!);
    objects.push(duplicateObject);
    objectIds(firstLayers(duplicate)[2]!).push(asRecord(duplicateObject).id as string);
    expectFailure(duplicate, "INVALID_OBJECT", "$.sketchbook.pages[0].content.objects[4].id");

    const unknown = projectDocument();
    firstObject(unknown).type = "text";
    expectFailure(unknown, "INVALID_OBJECT", "$.sketchbook.pages[0].content.objects[0].type");
  });

  it("rejects invalid transforms and object chronology", () => {
    const transform = projectDocument();
    asRecord(firstObject(transform).transform).scale = 0;
    expectFailure(
      transform,
      "INVALID_OBJECT",
      "$.sketchbook.pages[0].content.objects[0].transform.scale",
    );

    const chronology = projectDocument();
    firstObject(chronology).modifiedAt = "2026-01-01T00:00:00.000Z";
    expectFailure(
      chronology,
      "INVALID_OBJECT",
      "$.sketchbook.pages[0].content.objects[0].modifiedAt",
    );
  });

  it("rejects invalid Ink source samples, processed points, and brush dynamics", () => {
    const sample = projectDocument();
    firstSourceSample(sample).pressure = 2;
    expectFailure(
      sample,
      "INVALID_INK",
      "$.sketchbook.pages[0].content.objects[0].payload.stroke.sourceSamples[0].pressure",
    );

    const point = projectDocument();
    firstProcessedPoint(point).x = null;
    expectFailure(
      point,
      "INVALID_INK",
      "$.sketchbook.pages[0].content.objects[0].payload.stroke.points[0].x",
    );

    const brush = projectDocument();
    const dynamics = asRecord(strokeDocument(brush).brush);
    const pressureSize = asRecord(asRecord(dynamics.dynamics).pressureSize);
    asRecord(pressureSize.curve).kind = "script";
    expectFailure(
      brush,
      "INVALID_INK",
      "$.sketchbook.pages[0].content.objects[0].payload.stroke.brush.dynamics.pressureSize.curve.kind",
    );
  });

  it("rejects prototype-sensitive arbitrary metadata", () => {
    const document = projectDocument();
    firstObject(document).metadata = JSON.parse('{"__proto__":{"polluted":true}}') as MutableRecord;

    expectFailure(
      document,
      "INVALID_OBJECT",
      "$.sketchbook.pages[0].content.objects[0].metadata.__proto__",
    );
    expect((Object.prototype as MutableRecord).polluted).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite live values before JSON serialization",
    (invalidWidth) => {
      const original = createRepresentativeProject();
      const originalPage = original.sketchbook.firstPage;
      const invalidPage = Object.assign(Object.create(Page.prototype) as Page, originalPage, {
        geometry: Object.freeze({ width: invalidWidth, height: originalPage.geometry.height }),
      });
      Object.freeze(invalidPage);
      const project: FolioProjectSnapshot = {
        metadata: original.metadata,
        sketchbook: new SketchbookDocument({
          pages: [invalidPage, ...original.sketchbook.pages.slice(1)],
        }),
      };

      expect(() => encodeFolioProject(project)).toThrowError(
        expect.objectContaining({
          code: "INVALID_PAGE",
          path: "$.sketchbook.pages[0].geometry.width",
        }),
      );
    },
  );

  it("rejects explicit v1 resource-limit violations", () => {
    const document = projectDocument();
    metadata(document).title = "x".repeat(1_025);

    expectFailure(document, "RESOURCE_LIMIT", "$.metadata.title");
  });
});

function projectDocument(): MutableRecord {
  return JSON.parse(encodeFolioProject(createRepresentativeProject())) as MutableRecord;
}

function expectFailure(
  input: string | MutableRecord,
  code: FolioProjectCodecErrorCode,
  path: string,
): void {
  try {
    decodeFolioProject(typeof input === "string" ? input : JSON.stringify(input));
    throw new Error("Expected project decoding to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(FolioProjectCodecError);
    expect(error).toMatchObject({ code, path });
  }
}

function asRecord(value: unknown): MutableRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected test fixture record.");
  }
  return value as MutableRecord;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected test fixture array.");
  return value;
}

function metadata(document: MutableRecord): MutableRecord {
  return asRecord(document.metadata);
}

function sketchbook(document: MutableRecord): MutableRecord {
  return asRecord(document.sketchbook);
}

function pageDocuments(document: MutableRecord): MutableRecord[] {
  return asArray(sketchbook(document).pages).map(asRecord);
}

function firstPage(document: MutableRecord): MutableRecord {
  return pageDocuments(document)[0]!;
}

function pageGeometry(document: MutableRecord): MutableRecord {
  return asRecord(firstPage(document).geometry);
}

function pagePaper(document: MutableRecord): MutableRecord {
  return asRecord(firstPage(document).paper);
}

function firstContent(document: MutableRecord): MutableRecord {
  return asRecord(firstPage(document).content);
}

function firstLayers(document: MutableRecord): MutableRecord[] {
  return asArray(firstContent(document).layers).map(asRecord);
}

function firstObjects(document: MutableRecord): unknown[] {
  return asArray(firstContent(document).objects);
}

function firstObject(document: MutableRecord): MutableRecord {
  return asRecord(firstObjects(document)[0]);
}

function objectIds(layer: MutableRecord): unknown[] {
  return asArray(layer.objectIds);
}

function strokeDocument(document: MutableRecord): MutableRecord {
  return asRecord(asRecord(firstObject(document).payload).stroke);
}

function firstSourceSample(document: MutableRecord): MutableRecord {
  return asRecord(asArray(strokeDocument(document).sourceSamples)[0]);
}

function firstProcessedPoint(document: MutableRecord): MutableRecord {
  return asRecord(asArray(strokeDocument(document).points)[0]);
}
