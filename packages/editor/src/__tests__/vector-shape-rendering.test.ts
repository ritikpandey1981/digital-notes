import { ObjectFactory, Transform } from "@folio/document";
import { createResolvedBrushSnapshot, StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type { RenderInput } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { getStrokeRenderCacheSnapshot } from "../../../ink/src/internal/brush-render-strategy";
import {
  createPageObjectRenderHook,
  createVectorObjectRenderHook,
  createVectorShapeVisual,
} from "../VectorShapeRendering";

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
  } as unknown as CanvasRenderingContext2D;
}

const factory = new ObjectFactory({
  now: () => "2026-07-30T12:00:00.000Z",
  createId: (() => {
    let index = 0;
    return () => `vector-${++index}`;
  })(),
});

describe("vector shape rendering adapters", () => {
  it("draws the three vector geometries with native Canvas paths", () => {
    const objects = [
      factory.createLineObject({
        geometry: { start: { x: 10, y: 20 }, end: { x: 90, y: 70 } },
      }),
      factory.createRectangleObject({ geometry: { x: 20, y: 30, width: 80, height: 50 } }),
      factory.createEllipseObject({
        geometry: { center: { x: 80, y: 90 }, radiusX: 30, radiusY: 20 },
      }),
    ] as const;
    const drawingContext = context();

    for (const object of objects) createVectorShapeVisual(object).draw(drawingContext);

    expect(drawingContext.moveTo).toHaveBeenCalledWith(10, 20);
    expect(drawingContext.lineTo).toHaveBeenCalledWith(90, 70);
    expect(drawingContext.rect).toHaveBeenCalledWith(20, 30, 80, 50);
    expect(drawingContext.ellipse).toHaveBeenCalledWith(80, 90, 30, 20, 0, 0, Math.PI * 2);
    expect(drawingContext.stroke).toHaveBeenCalledTimes(3);
  });

  it("compensates preview stroke width for the existing uniform transform", () => {
    const rectangle = factory.createRectangleObject({
      geometry: { x: 0, y: 0, width: 100, height: 60 },
      style: { strokeWidth: 8 },
    });
    const drawingContext = context();

    createVectorShapeVisual(rectangle, 4).draw(drawingContext);

    expect(drawingContext.lineWidth).toBe(2);
  });

  it("renders finalized objects through the base renderer overlay-hook coordinate path", () => {
    const rectangle = factory.createRectangleObject({
      geometry: { x: 10, y: 20, width: 30, height: 40 },
    });
    const drawingContext = context();
    const hook = createVectorObjectRenderHook(() => [rectangle]);
    const input = {
      page: { rect: { x: 100, y: 200, width: 794, height: 1123 }, background: { kind: "plain" } },
    } as RenderInput;

    hook(drawingContext, input);

    expect(drawingContext.translate).toHaveBeenCalledWith(100, 200);
    expect(drawingContext.rect).toHaveBeenCalledWith(10, 20, 30, 40);
  });

  it("renders ink and vectors strictly in their unified document order", () => {
    const firstInk = factory.createInkObject({
      id: "first-ink",
      stroke: createStroke("first", "#ef4444"),
    });
    const rectangle = factory.createRectangleObject({
      id: "middle-rectangle",
      geometry: { x: 10, y: 20, width: 30, height: 40 },
      style: { strokeColor: "#2563eb" },
    });
    const finalInk = factory.createInkObject({
      id: "final-ink",
      stroke: createStroke("final", "#16a34a"),
    });
    const drawingContext = context();
    const renderOrder: string[] = [];
    vi.mocked(drawingContext.stroke).mockImplementation(() => {
      renderOrder.push(String(drawingContext.strokeStyle));
    });
    const renderedObjectOrders: string[][] = [];
    const hook = createPageObjectRenderHook(
      () => [firstInk, rectangle, finalInk],
      (objectIds) => renderedObjectOrders.push([...objectIds]),
    );
    const input = {
      page: { rect: { x: 100, y: 200, width: 794, height: 1123 }, background: { kind: "plain" } },
    } as RenderInput;

    hook(drawingContext, input);

    expect(renderOrder).toEqual(["#ef4444", "#2563eb", "#16a34a"]);
    expect(renderedObjectOrders).toEqual([["first-ink", "middle-rectangle", "final-ink"]]);
  });

  it("bounds compositor stroke visuals across repeated object-scale changes", () => {
    const stroke = createOutlineStroke("bounded-outline");
    let object = factory.createInkObject({
      id: "scaled-ink",
      stroke,
      transform: new Transform({ scale: 1 }),
    });
    const drawingContext = context();
    const hook = createPageObjectRenderHook(() => [object]);
    const input = {
      page: { rect: { x: 0, y: 0, width: 794, height: 1123 }, background: { kind: "plain" } },
    } as RenderInput;

    for (let scale = 1; scale <= 9; scale += 1) {
      object = factory.createInkObject({
        id: "scaled-ink",
        stroke,
        transform: new Transform({ scale }),
      });
      hook(drawingContext, input);
    }
    expect(getStrokeRenderCacheSnapshot(stroke)).toEqual({
      pathBuildCount: 1,
      outlineBuildCount: 9,
      outlineScaleCount: 8,
    });

    object = factory.createInkObject({
      id: "scaled-ink",
      stroke,
      transform: new Transform({ scale: 1 }),
    });
    hook(drawingContext, input);
    expect(getStrokeRenderCacheSnapshot(stroke).outlineBuildCount).toBe(10);
  });

  it("redraws 100, 500, and 1,000-stroke documents without rebuilding committed geometry", () => {
    const input = {
      page: { rect: { x: 0, y: 0, width: 794, height: 1123 }, background: { kind: "plain" } },
    } as RenderInput;
    const observations: Record<
      number,
      Readonly<{ firstDrawMilliseconds: number; cachedRedrawMilliseconds: number }>
    > = {};

    for (const objectCount of [100, 500, 1_000]) {
      const objects = Array.from({ length: objectCount }, (_, index) =>
        factory.createInkObject({
          id: `document-${objectCount}-${index}`,
          stroke: createOutlineStroke(`document-stroke-${objectCount}-${index}`),
        }),
      );
      const drawingContext = context();
      const hook = createPageObjectRenderHook(() => objects);
      const firstStartedAt = performance.now();
      hook(drawingContext, input);
      const firstDrawMilliseconds = performance.now() - firstStartedAt;
      const cachedStartedAt = performance.now();
      hook(drawingContext, {
        ...input,
        page: { ...input.page, rect: { ...input.page.rect, x: 25, y: 40 } },
      });
      const cachedRedrawMilliseconds = performance.now() - cachedStartedAt;
      observations[objectCount] = Object.freeze({
        firstDrawMilliseconds,
        cachedRedrawMilliseconds,
      });

      for (const object of objects) {
        expect(getStrokeRenderCacheSnapshot(object.stroke)).toEqual({
          pathBuildCount: 1,
          outlineBuildCount: 1,
          outlineScaleCount: 1,
        });
      }
    }

    console.info("Phase 17D full-document compositor observations (ms)", observations);
  }, 30_000);
});

function createStroke(id: string, color: string) {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    style: { color, width: 4, opacity: 1, pressureEnabled: false },
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const [x, y, timestamp] of [
    [0, 0, 0],
    [50, 50, 10],
    [100, 0, 20],
  ] as const) {
    builder.addPoint({
      x,
      y,
      timestamp,
      pressure: 0.5,
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

function createOutlineStroke(id: string) {
  const brush = createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "phase-17d-outline",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: 8,
    opacity: 1,
    smoothing: { mode: "average", amount: 0.2 },
    dynamics: {
      pressureSize: {
        enabled: true,
        minimumFactor: 0.35,
        maximumFactor: 1.65,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    },
    renderer: { version: 1, kind: "outline" },
  });
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < 20; index += 1) {
    builder.addPoint({
      x: index * 5,
      y: Math.sin(index / 3) * 12,
      timestamp: index * 4,
      pressure: 0.2 + (index % 7) / 10,
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
