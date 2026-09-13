import { ObjectFactory } from "@folio/document";
import { describe, expect, it } from "vitest";
import { createVectorObjectRenderHook, createPageObjectRenderHook } from "../VectorShapeRendering";

/**
 * Stroke alpha and fill alpha are separate durable values.
 *
 * `EditableStyle` carries no object-level opacity at all: `strokeColor` and
 * `fillColor` are each an `EditableColor` with its own `opacity`, each
 * validated on its own and each round-tripped by the project codec on its own.
 * The object-level multiplier is the Layer's, applied a level up. So a
 * half-transparent outline around a solid fill is a thing this model can say,
 * and the renderer has to be able to draw it.
 */

/** A context that answers what alpha each paint actually happened at. */
function recordingContext() {
  const paints: { readonly kind: "fill" | "stroke"; readonly alpha: number }[] = [];
  const stack: number[] = [];
  const surface = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "butt",
    lineJoin: "miter",
    save() {
      stack.push(surface.globalAlpha);
    },
    restore() {
      const previous = stack.pop();
      if (previous !== undefined) surface.globalAlpha = previous;
    },
    beginPath() {},
    rect() {},
    clip() {},
    translate() {},
    rotate() {},
    scale() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    ellipse() {},
    arc() {},
    fill() {
      paints.push({ kind: "fill", alpha: surface.globalAlpha });
    },
    stroke() {
      paints.push({ kind: "stroke", alpha: surface.globalAlpha });
    },
  };
  return {
    context: surface as unknown as CanvasRenderingContext2D,
    paints,
    alphaOf: (kind: "fill" | "stroke") => paints.find((paint) => paint.kind === kind)?.alpha,
    /** Nothing may leak out of a draw: the caller's alpha is the caller's. */
    settledAlpha: () => surface.globalAlpha,
  };
}

const factory = new ObjectFactory({
  now: () => "2026-09-13T12:00:00.000Z",
  createId: (() => {
    let index = 0;
    return () => `vector-${++index}`;
  })(),
});

const PAGE = {
  page: { rect: { x: 0, y: 0, width: 800, height: 600 } },
} as unknown as Parameters<ReturnType<typeof createVectorObjectRenderHook>>[1];

function filledRectangle(strokeOpacity: number, fillOpacity: number) {
  return factory.createRectangleObject({
    geometry: { x: 10, y: 10, width: 100, height: 80 },
    style: {
      strokeColor: { hex: "#7c3aed", opacity: strokeOpacity },
      strokeWidth: 4,
      fillColor: { hex: "#ede9fe", opacity: fillOpacity },
    },
  });
}

describe("a vector's two alphas do not attenuate each other", () => {
  it("fills at the fill's own opacity, whatever the outline's is", () => {
    const painted = recordingContext();
    createVectorObjectRenderHook(() => [filledRectangle(0.5, 1)])(painted.context, PAGE);

    expect(painted.alphaOf("fill"), "the outline's alpha was applied to the fill").toBe(1);
    expect(painted.alphaOf("stroke")).toBe(0.5);
  });

  it("strokes at the outline's own opacity, whatever the fill's is", () => {
    const painted = recordingContext();
    createVectorObjectRenderHook(() => [filledRectangle(1, 0.25)])(painted.context, PAGE);

    expect(painted.alphaOf("fill")).toBe(0.25);
    expect(painted.alphaOf("stroke"), "the fill's alpha leaked into the outline").toBe(1);
  });

  it("keeps both when both are partial", () => {
    const painted = recordingContext();
    createVectorObjectRenderHook(() => [filledRectangle(0.4, 0.8)])(painted.context, PAGE);

    expect(painted.alphaOf("fill")).toBeCloseTo(0.8, 10);
    expect(painted.alphaOf("stroke")).toBeCloseTo(0.4, 10);
    // The product is what the two being multiplied together would have given.
    expect(painted.alphaOf("fill")).not.toBeCloseTo(0.32, 10);
  });

  it("fills before it strokes, so the outline sits on top", () => {
    const painted = recordingContext();
    createVectorObjectRenderHook(() => [filledRectangle(0.5, 0.5)])(painted.context, PAGE);

    expect(painted.paints.map((paint) => paint.kind)).toEqual(["fill", "stroke"]);
  });

  it("leaves an unfilled shape's outline exactly as opaque as it says", () => {
    const painted = recordingContext();
    const line = factory.createLineObject({
      geometry: { start: { x: 0, y: 0 }, end: { x: 50, y: 50 } },
      style: { strokeColor: { hex: "#111111", opacity: 0.3 }, strokeWidth: 2 },
    });
    createVectorObjectRenderHook(() => [line])(painted.context, PAGE);

    expect(painted.paints).toEqual([{ kind: "stroke", alpha: 0.3 }]);
  });

  it("still lets the Layer dim the whole object", () => {
    // Layer opacity is the object-level multiplier, and it applies to both
    // channels because it is a property of the layer, not of either colour.
    const painted = recordingContext();
    const rectangle = filledRectangle(0.5, 0.8);
    createPageObjectRenderHook(() => [rectangle], undefined, {
      renderable: () => true,
      layerOpacity: () => 0.5,
    })(painted.context, PAGE);

    expect(painted.alphaOf("fill")).toBeCloseTo(0.5 * 0.8, 10);
    expect(painted.alphaOf("stroke")).toBeCloseTo(0.5 * 0.5, 10);
  });

  it("hands the context back at the alpha it was given", () => {
    const painted = recordingContext();
    painted.context.globalAlpha = 0.75;
    createVectorObjectRenderHook(() => [filledRectangle(0.5, 0.25)])(painted.context, PAGE);

    expect(painted.settledAlpha()).toBe(0.75);
    expect(painted.alphaOf("fill")).toBeCloseTo(0.75 * 0.25, 10);
    expect(painted.alphaOf("stroke")).toBeCloseTo(0.75 * 0.5, 10);
  });
});
