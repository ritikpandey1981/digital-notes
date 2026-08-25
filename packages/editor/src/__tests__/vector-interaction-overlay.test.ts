import { ObjectFactory, Transform } from "@folio/document";
import { Viewport, type AnimationFrameAdapter } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { VectorInteractionOverlayRenderer } from "../VectorInteractionOverlayRenderer";

function context(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
  } as unknown as CanvasRenderingContext2D;
}

function harness() {
  let frame: FrameRequestCallback | null = null;
  const animationFrameAdapter: AnimationFrameAdapter = {
    request: (callback) => {
      frame = callback;
      return 1;
    },
    cancel: vi.fn(),
  };
  const drawingContext = context();
  const canvas = { dataset: {} } as unknown as HTMLCanvasElement;
  const renderer = new VectorInteractionOverlayRenderer({
    context: drawingContext,
    canvas,
    viewport: new Viewport({
      size: { width: 800, height: 600 },
      pageRect: { x: 0, y: 0, width: 794, height: 1123 },
    }),
    animationFrameAdapter,
  });
  return {
    renderer,
    context: drawingContext,
    canvas,
    flush: () => {
      const callback = frame;
      frame = null;
      callback?.(0);
    },
  };
}

const factory = new ObjectFactory({ now: () => "2026-07-31T08:00:00.000Z" });

describe("VectorInteractionOverlayRenderer", () => {
  it("keeps selected line color visible while drawing endpoint and midpoint handles", () => {
    const test = harness();
    const line = factory.createLineObject({
      id: "selected-line",
      geometry: { start: { x: 20, y: 30 }, end: { x: 180, y: 90 } },
    });

    test.renderer.setSelection(line);
    test.flush();

    expect(test.context.lineTo).not.toHaveBeenCalled();
    expect(test.context.arc).toHaveBeenCalledTimes(3);
    expect(test.context.strokeStyle).toBe("#7183ce");
    expect(test.context.lineWidth).toBe(1.25);
    expect(test.canvas.dataset.vectorSelectionStyle).toBe("line-handles");
    expect(test.canvas.dataset.vectorSelectionPresentation).toBe("soft");
    test.renderer.destroy();
  });

  it("draws an oriented local frame and handles for a selected rectangle", () => {
    const test = harness();
    const rectangle = factory.createRectangleObject({
      id: "selected-rectangle",
      geometry: { x: 20, y: 30, width: 100, height: 60 },
    });

    test.renderer.setSelection(rectangle);
    test.flush();

    expect(test.context.fillRect).toHaveBeenCalledTimes(4);
    expect(test.context.strokeRect).toHaveBeenCalledTimes(4);
    expect(test.context.arc).toHaveBeenCalledTimes(1);
    expect(test.context.stroke).toHaveBeenCalledTimes(3);
    expect(test.canvas.dataset.vectorSelectionStyle).toBe("outline-emphasis");
    test.renderer.destroy();
  });

  it("rotates the complete selection frame during an immutable manipulation preview", () => {
    const test = harness();
    const rectangle = factory.createRectangleObject({
      id: "rotating-rectangle",
      geometry: { x: 20, y: 30, width: 100, height: 60 },
    });
    const previewTransform = new Transform({ rotation: Math.PI / 4 });

    test.renderer.setSelection(rectangle);
    test.renderer.setSelectionPreviewTransform(previewTransform);
    test.flush();

    expect(test.canvas.dataset.vectorSelectionRotation).toBe(String(Math.PI / 4));
    expect(test.context.moveTo).toHaveBeenCalled();
    expect(test.context.lineTo).toHaveBeenCalledTimes(4);
    expect(rectangle.transform.rotation).toBe(0);
    test.renderer.destroy();
  });

  it("renders demand-driven hover emphasis without changing document objects", () => {
    const test = harness();
    const rectangle = factory.createRectangleObject({
      id: "hovered-rectangle",
      geometry: { x: 20, y: 30, width: 100, height: 60 },
    });

    test.renderer.setHover(rectangle);
    test.flush();

    expect(test.context.rect).toHaveBeenCalledWith(20, 30, 100, 60);
    expect(test.context.stroke).toHaveBeenCalled();
    expect(test.context.strokeStyle).toBe("rgba(113, 131, 206, 0.42)");
    expect(test.canvas.dataset.vectorHoverState).toBe("hovered");
    expect(Object.isFrozen(rectangle)).toBe(true);
    test.renderer.destroy();
  });

  it("presents only the active line endpoint during an immutable drag preview", () => {
    const test = harness();
    const line = factory.createLineObject({
      id: "endpoint-line",
      geometry: { start: { x: 20, y: 30 }, end: { x: 180, y: 90 } },
    });
    const previewTransform = new Transform({
      translation: { x: 12, y: 6 },
      rotation: Math.PI / 8,
      scale: 1.4,
    });

    test.renderer.setSelection(line);
    test.renderer.setLineHandleHover("end");
    test.renderer.setLineEndpointPreview({
      object: line,
      transform: previewTransform,
      activeEndpoint: "end",
    });
    test.flush();

    expect(test.canvas.dataset.lineHandleHover).toBe("end");
    expect(test.canvas.dataset.lineEndpointPreview).toBe("true");
    expect(test.canvas.dataset.activeLineEndpoint).toBe("end");
    expect(test.context.translate).toHaveBeenCalledWith(12, 6);
    expect(test.context.arc).toHaveBeenCalledTimes(3);
    expect(line.transform).not.toBe(previewTransform);
    test.renderer.destroy();
  });
});
