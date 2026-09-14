import {
  EllipseObject,
  InkObject,
  Layer,
  LineObject,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  RectangleObject,
  SketchbookDocument,
  deserializeVectorObject,
  serializeVectorObject,
  type PageObject,
} from "@folio/document";
import { evaluatePressureResponse } from "@folio/ink";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FOLIO_PROJECT_VERSION,
  FolioProjectCodecError,
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
  type FolioProjectSnapshot,
} from "@folio/persistence/project";
import {
  PROJECT_CREATED_AT,
  createModernStroke,
  createRepresentativeProject,
} from "./project-fixture";

describe("Folio project codec", () => {
  it("exposes the narrow browser-safe project API", async () => {
    const api = await import("@folio/persistence/project");

    expect(Object.keys(api).sort()).toEqual([
      "CURRENT_FOLIO_PROJECT_VERSION",
      "FolioProjectCodecError",
      "createEmptyFolioProject",
      "decodeFolioProject",
      "encodeFolioProject",
    ]);
    expect(CURRENT_FOLIO_PROJECT_VERSION).toBe(1);
    expect(FolioProjectCodecError).toBeTypeOf("function");
  });

  it("encodes the explicit v1 envelope without session or backing-store state", () => {
    const encoded = encodeFolioProject(createRepresentativeProject());
    const document = JSON.parse(encoded) as Record<string, unknown>;

    expect(Object.keys(document).sort()).toEqual([
      "format",
      "formatVersion",
      "metadata",
      "sketchbook",
    ]);
    expect(document).toMatchObject({
      format: "folio-project",
      formatVersion: 1,
      metadata: {
        documentId: "folio-project-acceptance-001",
        title: "Architecture & Gesture — अभ्यास",
        createdAt: PROJECT_CREATED_AT,
      },
    });
    const forbidden = [
      "activePage",
      "activeLayer",
      "viewport",
      "selection",
      "clipboard",
      "activeTool",
      "filePath",
      "dirty",
      "history",
      "autosave",
      "recovery",
    ];
    for (const field of forbidden) expect(encoded).not.toContain(`"${field}"`);
    expect((document.metadata as Record<string, unknown>).modifiedAt).toBeUndefined();
  });

  it("round-trips representative project semantics and deterministic bytes", () => {
    const original = createRepresentativeProject();
    const encoded = encodeFolioProject(original);
    const decoded = decodeFolioProject(encoded);

    expect(encodeFolioProject(original)).toBe(encoded);
    expect(encodeFolioProject(decoded)).toBe(encoded);
    expect(decoded.metadata).toEqual(original.metadata);
    expect(decoded.sketchbook.pages.map((page) => page.id)).toEqual([
      "page-concepts",
      "page-observations",
    ]);
    expect(decoded.sketchbook.pages.map((page) => page.name)).toEqual(
      original.sketchbook.pages.map((page) => page.name),
    );
    expect(decoded.sketchbook.pages.map((page) => page.geometry)).toEqual(
      original.sketchbook.pages.map((page) => page.geometry),
    );
    expect(decoded.sketchbook.pages.map((page) => page.paper)).toEqual(
      original.sketchbook.pages.map((page) => page.paper),
    );

    for (const [pageIndex, originalPage] of original.sketchbook.pages.entries()) {
      const decodedPage = decoded.sketchbook.pages[pageIndex]!;
      expect(decodedPage.content.layers).toEqual(originalPage.content.layers);
      expect(decodedPage.content.layers.flatMap((layer) => layer.objectIds)).toEqual(
        decodedPage.content.objects.objects.map((object) => object.id),
      );
      expect(decodedPage.content.objects.objects.map((object) => object.id)).toEqual(
        originalPage.content.objects.objects.map((object) => object.id),
      );
      expect(decodedPage.content.objects.objects.map((object) => object.type)).toEqual(
        originalPage.content.objects.objects.map((object) => object.type),
      );
      expect(decodedPage.content.objects.objects.map((object) => object.transform)).toEqual(
        originalPage.content.objects.objects.map((object) => object.transform),
      );
      expect(decodedPage.content.objects.objects.map((object) => object.bounds)).toEqual(
        originalPage.content.objects.objects.map((object) => object.bounds),
      );
    }
  });

  it("reconstructs real live immutable classes", () => {
    const decoded = decodeFolioProject(encodeFolioProject(createRepresentativeProject()));
    const [ink, line, rectangle, ellipse] = decoded.sketchbook.firstPage.content.objects.objects;

    expect(decoded.sketchbook).toBeInstanceOf(SketchbookDocument);
    expect(decoded.sketchbook.pages.every((page) => page instanceof Page)).toBe(true);
    expect(decoded.sketchbook.pages.every((page) => page.content instanceof PageDocument)).toBe(
      true,
    );
    expect(
      decoded.sketchbook.pages.every((page) => page.content.objects instanceof ObjectCollection),
    ).toBe(true);
    expect(decoded.sketchbook.pages.flatMap((page) => page.content.layers)).toSatisfy(
      (layers: readonly Layer[]) => layers.every((layer) => layer instanceof Layer),
    );
    expect(ink).toBeInstanceOf(InkObject);
    expect(line).toBeInstanceOf(LineObject);
    expect(rectangle).toBeInstanceOf(RectangleObject);
    expect(ellipse).toBeInstanceOf(EllipseObject);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.metadata)).toBe(true);
    expect(Object.isFrozen(decoded.sketchbook)).toBe(true);
    expect(Object.isFrozen(decoded.sketchbook.pages)).toBe(true);
    for (const page of decoded.sketchbook.pages) {
      expect(Object.isFrozen(page)).toBe(true);
      expect(Object.isFrozen(page.geometry)).toBe(true);
      expect(Object.isFrozen(page.paper)).toBe(true);
      expect(Object.isFrozen(page.content)).toBe(true);
      expect(Object.isFrozen(page.content.layers)).toBe(true);
      expect(Object.isFrozen(page.content.objects)).toBe(true);
      for (const object of page.content.objects) expect(Object.isFrozen(object)).toBe(true);
    }
    expect(ink).toBeInstanceOf(InkObject);
    if (!(ink instanceof InkObject)) throw new Error("Expected representative InkObject.");
    expect(Object.isFrozen(ink.stroke)).toBe(true);
    expect(Object.isFrozen(ink.stroke.points)).toBe(true);
    expect(Object.isFrozen(ink.stroke.sourceSamples)).toBe(true);
    expect(Object.isFrozen(ink.stroke.brush.dynamics.pressureSize.curve)).toBe(true);
  });

  it("preserves exact source, processed, style, brush, metric, and statistics state", () => {
    const original = createRepresentativeProject();
    const decoded = decodeFolioProject(encodeFolioProject(original));
    const originalInk = requireInk(original, "object-ink-modern");
    const decodedInk = requireInk(decoded, "object-ink-modern");

    expect(decodedInk.stroke.id).toBe(originalInk.stroke.id);
    expect(decodedInk.stroke.timestamp).toBe(originalInk.stroke.timestamp);
    expect(decodedInk.stroke.sourceSamples).toEqual(originalInk.stroke.sourceSamples);
    expect(decodedInk.stroke.points).toEqual(originalInk.stroke.points);
    expect(decodedInk.stroke.style).toEqual(originalInk.stroke.style);
    expect(decodedInk.stroke.brush).toEqual(originalInk.stroke.brush);
    expect(decodedInk.stroke.metrics).toEqual(originalInk.stroke.metrics);
    expect(decodedInk.stroke.statistics).toEqual(originalInk.stroke.statistics);
    expect(decodedInk.metadata).toEqual(originalInk.metadata);
    expect(decodedInk.renderingHints).toEqual(originalInk.renderingHints);
    expect(decodedInk.transform).toEqual(originalInk.transform);
    expect(decodedInk.stroke.sourceSamples).toHaveLength(4);
    expect(decodedInk.stroke.points).toHaveLength(2);
    expect(decodedInk.stroke.sourceSamples[1]).toMatchObject({
      x: 20,
      y: 30,
      pressure: 0.45,
      tiltX: 18,
      tiltY: -9,
      twist: 44,
      altitudeAngle: 0.52,
      azimuthAngle: 1.35,
    });
    expect(decodedInk.stroke.sourceSamples.at(-1)?.timestamp).toBe(1_075);
  });

  it("preserves power-size and linear-opacity pressure responses", () => {
    const original = requireInk(createRepresentativeProject(), "object-ink-modern").stroke;
    const decoded = requireInk(
      decodeFolioProject(encodeFolioProject(createRepresentativeProject())),
      "object-ink-modern",
    ).stroke;
    const pressures = [0, 0.25, 0.5, 0.75, 1];

    expect(decoded.brush.dynamics.pressureSize.curve).toEqual({
      kind: "power",
      exponent: 2.25,
    });
    expect(decoded.brush.dynamics.pressureOpacity.curve).toEqual({
      kind: "linear",
      exponent: 1,
    });
    expect(pressures.map((pressure) => decoded.widthAtPressure(pressure))).toEqual(
      pressures.map((pressure) => original.widthAtPressure(pressure)),
    );
    expect(pressures.map((pressure) => opacityAtPressure(decoded, pressure))).toEqual(
      pressures.map((pressure) => opacityAtPressure(original, pressure)),
    );
  });

  it("persists the actual deterministic legacy brush snapshot instead of re-inferring it", () => {
    const original = requireInk(createRepresentativeProject(), "object-ink-legacy").stroke;
    const decoded = requireInk(
      decodeFolioProject(encodeFolioProject(createRepresentativeProject())),
      "object-ink-legacy",
    ).stroke;
    const pressures = [0, 0.25, 0.5, 0.75, 1];

    expect(original.brush.presetId).toBe("legacy-stroke-style");
    expect(decoded.brush).toEqual(original.brush);
    expect(decoded.brush.dynamics.pressureSize.curve).toEqual({ kind: "linear", exponent: 1 });
    expect(pressures.map((pressure) => decoded.widthAtPressure(pressure))).toEqual(
      pressures.map((pressure) => original.widthAtPressure(pressure)),
    );
  });

  it("keeps each existing vector serializer round trip intact inside the project boundary", () => {
    const project = createRepresentativeProject();
    const vectors = allObjects(project).filter(
      (object): object is LineObject | RectangleObject | EllipseObject =>
        object instanceof LineObject ||
        object instanceof RectangleObject ||
        object instanceof EllipseObject,
    );

    expect(vectors.map((vector) => vector.type)).toEqual(["line", "rectangle", "ellipse", "line"]);
    for (const vector of vectors) {
      const serialized = serializeVectorObject(vector);
      expect(serializeVectorObject(deserializeVectorObject(serialized))).toEqual(serialized);
    }
    const decoded = decodeFolioProject(encodeFolioProject(project));
    expect(
      allObjects(decoded)
        .filter((object) => object.type !== "ink")
        .map((object) => object.type),
    ).toEqual(vectors.map((vector) => vector.type));
  });

  it("creates a validated empty project without installing editor state", () => {
    const project = createEmptyFolioProject({
      documentId: "new-project-id",
      createdAt: "2026-09-11T12:00:00.000Z",
      pageId: "new-page-id",
    });

    expect(project.metadata).toEqual({
      documentId: "new-project-id",
      title: "Untitled Sketch",
      createdAt: "2026-09-11T12:00:00.000Z",
    });
    expect(project.sketchbook.firstPage.id).toBe("new-page-id");
    expect(project.sketchbook.firstPage.content.bottomLayer.id).toBe("layer-1");
    expect(project.sketchbook.firstPage.content.size).toBe(0);
    expect(decodeFolioProject(encodeFolioProject(project)).metadata).toEqual(project.metadata);
  });

  it("handles a moderate multi-page project with hundreds of objects", () => {
    const project = createModerateProject();
    const started = performance.now();
    const decoded = decodeFolioProject(encodeFolioProject(project));
    const elapsed = performance.now() - started;

    expect(decoded.sketchbook.pageCount).toBe(4);
    expect(allObjects(decoded)).toHaveLength(324);
    expect(decoded.sketchbook.pages.every((page) => page.content.layerCount === 4)).toBe(true);
    if (process.env.FOLIO_PERFORMANCE_BASELINE === "1") expect(elapsed).toBeLessThan(5_000);
  });
});

function opacityAtPressure(stroke: InkObject["stroke"], pressure: number): number {
  return (
    stroke.brush.opacity * evaluatePressureResponse(stroke.brush.dynamics.pressureOpacity, pressure)
  );
}

function requireInk(project: FolioProjectSnapshot, objectId: string): InkObject {
  const object = allObjects(project).find((candidate) => candidate.id === objectId);
  if (!(object instanceof InkObject)) throw new Error(`Expected InkObject '${objectId}'.`);
  return object;
}

function allObjects(project: FolioProjectSnapshot): readonly PageObject[] {
  return project.sketchbook.pages.flatMap((page) => page.content.objects.objects);
}

function createModerateProject(): FolioProjectSnapshot {
  const factory = new ObjectFactory();
  const stroke = createModernStroke();
  const pages = Array.from({ length: 4 }, (_, pageIndex) => {
    const pagePrefix = `volume-${pageIndex}`;
    const objects: PageObject[] = [
      factory.createInkObject({
        id: `${pagePrefix}-ink`,
        stroke,
        createdAt: PROJECT_CREATED_AT,
        modifiedAt: PROJECT_CREATED_AT,
      }),
    ];
    for (let objectIndex = 0; objectIndex < 80; objectIndex += 1) {
      objects.push(
        factory.createRectangleObject({
          id: `${pagePrefix}-rectangle-${objectIndex}`,
          createdAt: PROJECT_CREATED_AT,
          modifiedAt: PROJECT_CREATED_AT,
          geometry: {
            x: (objectIndex % 10) * 50,
            y: Math.floor(objectIndex / 10) * 50,
            width: 25,
            height: 25,
          },
          style: { strokeColor: "#334155", strokeWidth: 1.5 },
        }),
      );
    }
    const layerSizes = [21, 20, 20, 20];
    let cursor = 0;
    const layers = layerSizes.map((size, layerIndex) => {
      const objectIds = objects.slice(cursor, cursor + size).map((object) => object.id);
      cursor += size;
      return new Layer({
        id: `${pagePrefix}-layer-${layerIndex}`,
        name: `Layer ${layerIndex + 1}`,
        opacity: 1 - layerIndex * 0.1,
        objectIds,
      });
    });
    return new Page({
      id: `${pagePrefix}-page`,
      name: `Volume page ${pageIndex + 1}`,
      content: new PageDocument({ layers, objects: new ObjectCollection(objects) }),
    });
  });
  return Object.freeze({
    metadata: Object.freeze({
      documentId: "moderate-volume-project",
      title: "Moderate volume",
      createdAt: PROJECT_CREATED_AT,
    }),
    sketchbook: new SketchbookDocument({ pages }),
  });
}
