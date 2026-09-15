import {
  Layer,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
} from "../../packages/document/src/index";
import {
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  type StrokePointInput,
} from "../../packages/ink/src/index";
import type { FolioProjectSnapshot } from "../../packages/persistence/src/project/index";

export const TIMESTAMP = "2026-09-13T00:00:00.000Z";
/**
 * Every measurable strategy shares size, opacity and smoothing, so a comparison
 * is like for like. Dynamics are not shared, because they are the work: each
 * kind carries exactly what the preset shipped on it carries, so what is being
 * measured is what an artist actually pays for.
 */
export type BaselineBrushKind =
  "centerline" | "outline" | "technical-pen" | "pressure-pen" | "pencil";

export function brush(kind: BaselineBrushKind) {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `baseline-${kind}`,
    presetVersion: 1,
    family: kind === "pencil" ? "pencil" : "pen",
    color: "#111111",
    size: 3,
    opacity: 1,
    smoothing: { mode: "average", amount: 0.25 },
    dynamics: {
      pressureSize: {
        enabled: kind === "outline" || kind === "pressure-pen" || kind === "pencil",
        minimumFactor: 0.35,
        maximumFactor: 1.65,
        curve: { kind: "linear", exponent: 1 },
      },
      // Pencil reads this response as coverage rather than as alpha, so it is
      // enabled for the same reason and measured under the same sawtooth.
      pressureOpacity:
        kind === "pressure-pen" || kind === "pencil"
          ? {
              enabled: true,
              minimumFactor: 0.7,
              maximumFactor: 1,
              curve: { kind: "power", exponent: 0.55 },
            }
          : {
              enabled: false,
              minimumFactor: 1,
              maximumFactor: 1,
              curve: { kind: "linear", exponent: 1 },
            },
    },
    renderer: { version: 1, kind },
  });
}

export function points(count: number, offset = 0): StrokePointInput[] {
  return Array.from({ length: count }, (_, index) => ({
    x: 40 + (offset % 12) * 45 + index * 0.35,
    y: 45 + (Math.floor(offset / 12) % 35) * 25 + Math.sin(index / 8) * 8,
    timestamp: index * 4,
    pressure: 0.3 + (index % 9) / 15,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  }));
}

export function builder(id: string, kind: BaselineBrushKind = "outline") {
  return new StrokeBuilder({
    id,
    timestamp: 0,
    brush: brush(kind),
    smoother: new StrokeSmoother({ mode: "none" }),
  });
}

/** Each stroke has independent geometry, 64 useful samples, and deterministic identity. */
export function fixture(
  count: number,
  layers = 1,
  pages = 1,
  kind: "ink" | "vector" | "mixed" = "ink",
): FolioProjectSnapshot {
  const factory = new ObjectFactory({ now: () => TIMESTAMP });
  const pageValues = Array.from({ length: pages }, (_, pageIndex) => {
    const objects = Array.from({ length: count }, (_, index) => {
      const id = `p${pageIndex}-o${index}`;
      if (kind === "vector" || (kind === "mixed" && index % 2))
        return factory.createRectangleObject({
          id,
          geometry: {
            x: 40 + (index % 12) * 45,
            y: 40 + (Math.floor(index / 12) % 35) * 25,
            width: 22,
            height: 16,
          },
          style: { strokeColor: "#111111", strokeWidth: 3 },
        });
      const stroke = builder(id);
      for (const point of points(64, index)) stroke.addPoint(point);
      return factory.createInkObject({ id, stroke: stroke.finalize() });
    });
    const layerValues = Array.from(
      { length: layers },
      (_, index) =>
        new Layer({
          id: `p${pageIndex}-l${index}`,
          name: `Layer ${index + 1}`,
          objectIds: objects
            .slice(Math.floor((index * count) / layers), Math.floor(((index + 1) * count) / layers))
            .map((object) => object.id),
        }),
    );
    return new Page({
      id: `p${pageIndex}`,
      content: new PageDocument({ layers: layerValues, objects: new ObjectCollection(objects) }),
    });
  });
  return {
    metadata: { documentId: "baseline", title: "Performance fixture", createdAt: TIMESTAMP },
    sketchbook: new SketchbookDocument({ pages: pageValues }),
  };
}
