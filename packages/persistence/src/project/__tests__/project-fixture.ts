import {
  Layer,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  Transform,
  createPagePaper,
  type PageObject,
} from "@folio/document";
import {
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  type Stroke,
  type StrokePointInput,
} from "@folio/ink";
import type { FolioProjectSnapshot } from "../project-types";

export const PROJECT_CREATED_AT = "2026-09-11T08:15:30.000Z";
const OBJECT_CREATED_AT = "2026-09-11T08:20:00.000Z";
const OBJECT_MODIFIED_AT = "2026-09-11T08:21:45.000Z";

export function createRepresentativeProject(): FolioProjectSnapshot {
  const factory = new ObjectFactory();
  const modernStroke = createModernStroke();
  const legacyStroke = createLegacyStroke();
  const firstObjects: readonly PageObject[] = [
    factory.createInkObject({
      id: "object-ink-modern",
      stroke: modernStroke,
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_MODIFIED_AT,
      metadata: { source: "stylus", labels: ["study", "重点"] },
      transform: new Transform({
        translation: { x: 14.125, y: -6.75 },
        rotation: Math.PI / 9,
        scale: 1.375,
      }),
      renderingHints: { quality: "final", cache: { preferred: false } },
    }),
    factory.createLineObject({
      id: "object-line",
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_MODIFIED_AT,
      geometry: { start: { x: 70.5, y: 80.25 }, end: { x: 310.75, y: 190.125 } },
      style: {
        strokeColor: { hex: "#2563eb", opacity: 0.85 },
        strokeWidth: 3.25,
        lineStyle: "dashed",
      },
      transform: new Transform({
        translation: { x: 5.5, y: 12.25 },
        rotation: -0.3125,
        scale: 0.875,
      }),
      metadata: { role: "guide-line" },
    }),
    factory.createRectangleObject({
      id: "object-rectangle",
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_MODIFIED_AT,
      geometry: { x: 330.25, y: 140.75, width: 180.5, height: 120.25 },
      style: {
        strokeColor: "#7c3aed",
        strokeWidth: 5.5,
        fillColor: { hex: "#ede9fe", opacity: 0.65 },
        shadow: {
          color: {
            hex: "#111827",
            rgb: { red: 17, green: 24, blue: 39 },
            opacity: 0.25,
          },
          offsetX: 4.25,
          offsetY: 6.5,
          blur: 8.75,
        },
        blendMode: "multiply",
      },
      visible: false,
      transform: new Transform({ translation: { x: -20.125, y: 9.625 }, scale: 1.125 }),
      metadata: { tags: ["shape", "layout"] },
    }),
    factory.createEllipseObject({
      id: "object-ellipse",
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_MODIFIED_AT,
      geometry: { center: { x: 640.5, y: 330.25 }, radiusX: 90.75, radiusY: 55.125 },
      style: {
        strokeColor: "#dc2626",
        strokeWidth: 2.75,
        fillColor: { hex: "#fee2e2", opacity: 0.5 },
        lineStyle: "dotted",
      },
      locked: true,
      transform: new Transform({ rotation: 0.4375, scale: 1.2 }),
      metadata: { annotation: "focus" },
    }),
  ];
  const firstPage = new Page({
    id: "page-concepts",
    name: "Concept studies — 研究",
    geometry: { width: 1400.5, height: 900.25 },
    paper: createPagePaper({ type: "grid", color: "#fbf3e0", spacing: 28.5 }),
    content: pageContent(
      [
        new Layer({
          id: "layer-gesture",
          name: "Gesture",
          opacity: 0.82,
          objectIds: ["object-ink-modern", "object-line"],
        }),
        new Layer({
          id: "layer-construction",
          name: "Construction",
          visible: false,
          objectIds: ["object-rectangle"],
        }),
        new Layer({
          id: "layer-notes",
          name: "Notes",
          locked: true,
          opacity: 0.55,
          objectIds: ["object-ellipse"],
        }),
      ],
      firstObjects,
    ),
  });

  const secondObjects: readonly PageObject[] = [
    factory.createInkObject({
      id: "object-ink-legacy",
      stroke: legacyStroke,
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_CREATED_AT,
      metadata: { source: "legacy-style-bridge" },
      renderingHints: { preview: "centerline" },
    }),
    factory.createLineObject({
      id: "object-line-secondary",
      createdAt: OBJECT_CREATED_AT,
      modifiedAt: OBJECT_CREATED_AT,
      geometry: { start: { x: 15, y: 30 }, end: { x: 180, y: 240 } },
      style: { strokeColor: "#059669", strokeWidth: 1.5 },
      metadata: {},
    }),
  ];
  const secondPage = new Page({
    id: "page-observations",
    name: "Observations",
    geometry: { width: 794, height: 1123 },
    paper: createPagePaper({ type: "isometric", color: "#ececed", spacing: 36 }),
    content: pageContent(
      [
        new Layer({
          id: "layer-observation-ink",
          name: "Ink",
          objectIds: ["object-ink-legacy"],
        }),
        new Layer({
          id: "layer-observation-guides",
          name: "Guides",
          opacity: 0.4,
          objectIds: ["object-line-secondary"],
        }),
      ],
      secondObjects,
    ),
  });

  return Object.freeze({
    metadata: Object.freeze({
      documentId: "folio-project-acceptance-001",
      title: "Architecture & Gesture — अभ्यास",
      createdAt: PROJECT_CREATED_AT,
    }),
    sketchbook: new SketchbookDocument({ pages: [firstPage, secondPage] }),
  });
}

export function createModernStroke(): Stroke {
  const brush = createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "acceptance-pressure-pen",
    presetVersion: 7,
    family: "pen",
    color: "#0f172a",
    size: 9.25,
    opacity: 0.72,
    smoothing: { mode: "average", amount: 0.65 },
    dynamics: {
      pressureSize: {
        enabled: true,
        minimumFactor: 0.2,
        maximumFactor: 1.8,
        curve: { kind: "power", exponent: 2.25 },
      },
      pressureOpacity: {
        enabled: true,
        minimumFactor: 0.3,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    },
    renderer: { version: 1, kind: "outline" },
  });
  const builder = new StrokeBuilder({
    id: "stroke-modern-pressure",
    timestamp: 1_000.125,
    style: {
      color: brush.color,
      width: brush.size,
      opacity: brush.opacity,
      pressureEnabled: true,
      brushTextureId: "texture-graphite-v1",
    },
    brush,
    smoother: new StrokeSmoother({ mode: "average", windowSize: 3, strength: 0.65 }),
  });
  const samples: readonly StrokePointInput[] = [
    sample(20, 30, 1_000, 0.2, 11, -7, 20, 0.45, 1.2),
    sample(20, 30, 1_020, 0.45, 18, -9, 44, 0.52, 1.35),
    sample(44.5, 52.25, 1_040, 0.78, 25, -14, 91, 0.61, 1.58),
    sample(44.5, 52.25, 1_075, 0.92, 30, -16, 130, 0.68, 1.82),
  ];
  samples.forEach((point, index) =>
    builder.addPoint(point, index === samples.length - 1 ? { phase: "terminal" } : {}),
  );
  return builder.finalize();
}

export function createLegacyStroke(): Stroke {
  const builder = new StrokeBuilder({
    id: "stroke-legacy-linear",
    timestamp: 2_000,
    style: { color: "#92400e", width: 3.5, opacity: 0.6, pressureEnabled: true },
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  builder.addPoint(sample(25, 40, 2_000, 0.15, 3, -2, 10));
  builder.addPoint(sample(120, 180, 2_060, 0.85, 9, -6, 70));
  return builder.finalize();
}

function pageContent(layers: readonly Layer[], objects: readonly PageObject[]): PageDocument {
  return new PageDocument({ layers, objects: new ObjectCollection(objects) });
}

function sample(
  x: number,
  y: number,
  timestamp: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  twist: number,
  altitudeAngle?: number,
  azimuthAngle?: number,
): StrokePointInput {
  return {
    x,
    y,
    timestamp,
    pressure,
    tiltX,
    tiltY,
    twist,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    ...(altitudeAngle === undefined ? {} : { altitudeAngle }),
    ...(azimuthAngle === undefined ? {} : { azimuthAngle }),
  };
}
