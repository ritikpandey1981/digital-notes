import {
  createDefaultLayer,
  createPagePaper,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  type Layer,
  type PageObject,
} from "@folio/document";
import { describe, expect, it } from "vitest";
import { renderPageLayerPreview, renderPageThumbnail } from "../VectorShapeRendering";

/**
 * Structural rendering tests over a recording Canvas2D.
 *
 * Node has no real canvas here and the repository carries no `canvas`
 * dependency, so this package's established convention is a recording context
 * rather than a pixel buffer. For this phase that is the stronger tool anyway:
 * comparing the ordered operation stream proves that stacking per-layer
 * previews reproduces the thumbnail's artwork exactly, with no anti-aliasing
 * tolerance to negotiate.
 */

interface RecordedOp {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly alpha: number;
  readonly strokeStyle: string;
  readonly fillStyle: string;
}

interface Recording {
  readonly context: CanvasRenderingContext2D;
  readonly ops: readonly RecordedOp[];
}

/** A Canvas2D faithful enough to matter: it keeps the state stack save/restore relies on. */
function recordingContext(): Recording {
  const ops: RecordedOp[] = [];
  const stack: { alpha: number; strokeStyle: string; fillStyle: string; lineWidth: number }[] = [];
  const state = { alpha: 1, strokeStyle: "", fillStyle: "", lineWidth: 1 };
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      ops.push({
        op,
        args,
        alpha: state.alpha,
        strokeStyle: state.strokeStyle,
        fillStyle: state.fillStyle,
      });
    };
  const context = {
    get globalAlpha(): number {
      return state.alpha;
    },
    set globalAlpha(value: number) {
      state.alpha = value;
    },
    get strokeStyle(): string {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get fillStyle(): string {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get lineWidth(): number {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    save(): void {
      stack.push({ ...state });
      record("save")();
    },
    restore(): void {
      const previous = stack.pop();
      if (previous !== undefined) Object.assign(state, previous);
      record("restore")();
    },
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    rect: record("rect"),
    clip: record("clip"),
    translate: record("translate"),
    rotate: record("rotate"),
    scale: record("scale"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    bezierCurveTo: record("bezierCurveTo"),
    quadraticCurveTo: record("quadraticCurveTo"),
    closePath: record("closePath"),
    ellipse: record("ellipse"),
    arc: record("arc"),
    stroke: record("stroke"),
    fill: record("fill"),
    lineCap: "butt",
    lineJoin: "miter",
  };
  return { context: context as unknown as CanvasRenderingContext2D, ops };
}

const factory = new ObjectFactory({
  now: () => "2026-09-05T12:00:00.000Z",
  createId: (() => {
    let index = 0;
    return () => `object-${++index}`;
  })(),
});

function rectangleAt(x: number, y: number, visible = true): PageObject {
  return factory.createRectangleObject({
    geometry: { x, y, width: 40, height: 30 },
    visible,
  });
}

function lineAt(x: number, y: number): PageObject {
  return factory.createLineObject({
    geometry: { start: { x, y }, end: { x: x + 50, y: y + 20 } },
  });
}

const BLANK_PAPER = createPagePaper({ type: "blank" });

/** Builds a page from ordered per-layer groups, bottom layer first. */
function pageWithLayers(
  groups: readonly (readonly PageObject[])[],
  options: Readonly<{
    geometry?: Readonly<{ width: number; height: number }>;
    paper?: Page["paper"];
    patch?: Readonly<Record<number, Parameters<Layer["withPatch"]>[0]>>;
  }> = {},
): Page {
  const layers = groups.map((objects, index) => {
    const layer = createDefaultLayer(`layer-${index + 1}`, `Layer ${index + 1}`).withObjectIds(
      objects.map((object) => object.id),
    );
    const patch = options.patch?.[index];
    return patch === undefined ? layer : layer.withPatch(patch);
  });
  return new Page({
    id: "page-1",
    content: new PageDocument({ layers, objects: new ObjectCollection(groups.flat()) }),
    geometry: options.geometry ?? { width: 1123, height: 794 },
    paper: options.paper ?? BLANK_PAPER,
  });
}

const SIZE = Object.freeze({ width: 200, height: 160 });

/**
 * Everything drawn after the page clip is established.
 *
 * The frame's own `rect` is a clip boundary, not artwork, so it is dropped
 * here rather than being filtered out by shape later.
 */
function artworkOps(ops: readonly RecordedOp[]): readonly RecordedOp[] {
  const clipIndex = ops.findIndex((entry) => entry.op === "clip");
  return clipIndex < 0 ? ops : ops.slice(clipIndex + 1);
}

/** Only the marks. Transform and clip scaffolding is asserted separately. */
function marks(ops: readonly RecordedOp[]): readonly RecordedOp[] {
  return artworkOps(ops).filter((entry) => entry.op === "stroke" || entry.op === "fill");
}

/** The geometry calls, which is how a drawn object identifies itself. */
function paths(ops: readonly RecordedOp[]): readonly string[] {
  return artworkOps(ops)
    .filter((entry) => ["rect", "moveTo", "lineTo", "ellipse", "arc"].includes(entry.op))
    .map((entry) => `${entry.op}(${entry.args.join(",")})`);
}

/** The four calls that establish the fitted page frame, before any artwork. */
function frameOps(ops: readonly RecordedOp[]): readonly string[] {
  return ops
    .filter((entry) => ["rect", "clip", "translate", "scale"].includes(entry.op))
    .slice(0, 4)
    .map((entry) => `${entry.op}(${entry.args.join(",")})`);
}

function renderLayer(page: Page, layerId: string): Recording {
  const recording = recordingContext();
  renderPageLayerPreview(recording.context, page, layerId, SIZE);
  return recording;
}

function renderThumbnail(page: Page): Recording {
  const recording = recordingContext();
  renderPageThumbnail(recording.context, page, SIZE, { pageLineColor: "#cccccc" });
  return recording;
}

describe("renderPageLayerPreview artwork selection", () => {
  it("draws only the requested layer's artwork", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)], [lineAt(300, 400)]]);
    expect(paths(renderLayer(page, "layer-1").ops)).toEqual(["rect(10,10,40,30)"]);
    expect(paths(renderLayer(page, "layer-2").ops)).toEqual(["moveTo(300,400)", "lineTo(350,420)"]);
  });

  it("preserves the layer's canonical object ordering", () => {
    const page = pageWithLayers([[rectangleAt(1, 1), lineAt(2, 2), rectangleAt(3, 3)]]);
    expect(paths(renderLayer(page, "layer-1").ops)).toEqual([
      "rect(1,1,40,30)",
      "moveTo(2,2)",
      "lineTo(52,22)",
      "rect(3,3,40,30)",
    ]);
  });

  it("renders nothing for a hidden layer, even when named explicitly", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)]], { patch: { 0: { visible: false } } });
    const recording = renderLayer(page, "layer-1");
    expect(marks(recording.ops)).toEqual([]);
    expect(paths(recording.ops)).toEqual([]);
  });

  it("omits an invisible object inside a visible layer", () => {
    const page = pageWithLayers([[rectangleAt(10, 10), rectangleAt(90, 90, false)]]);
    expect(paths(renderLayer(page, "layer-1").ops)).toEqual(["rect(10,10,40,30)"]);
  });

  it("renders a locked layer exactly like an unlocked one", () => {
    const objects = [rectangleAt(10, 10)];
    const unlocked = renderLayer(pageWithLayers([objects]), "layer-1").ops;
    const locked = renderLayer(
      pageWithLayers([objects], { patch: { 0: { locked: true } } }),
      "layer-1",
    ).ops;
    expect(locked).toEqual(unlocked);
  });

  it("multiplies layer opacity into globalAlpha, matching live compositing", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)]], { patch: { 0: { opacity: 0.4 } } });
    const drawn = marks(renderLayer(page, "layer-1").ops);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.alpha).toBeCloseTo(0.4, 10);
  });

  it("leaves an empty layer with nothing drawn at all", () => {
    const recording = renderLayer(pageWithLayers([[]]), "layer-1");
    expect(marks(recording.ops)).toEqual([]);
    expect(recording.ops.filter((entry) => entry.op === "fillRect")).toEqual([]);
  });
});

describe("renderPageLayerPreview transparency", () => {
  it("never paints the page paper colour", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)]], {
      paper: createPagePaper({ type: "grid", color: "#ff0000", spacing: 20 }),
    });
    const recording = renderLayer(page, "layer-1");
    expect(
      recording.ops.filter((entry) => entry.op === "fillRect"),
      "paper is Page state and must never reach a layer surface",
    ).toEqual([]);
    expect(recording.ops.every((entry) => entry.fillStyle !== "#ff0000")).toBe(true);
  });

  it("never paints the paper pattern", () => {
    const patterned = pageWithLayers([[]], {
      paper: createPagePaper({ type: "grid", spacing: 60 }),
    });
    const blank = pageWithLayers([[]], { paper: BLANK_PAPER });
    expect(
      renderLayer(patterned, "layer-1").ops,
      "a patterned page yields the same surface as a blank one",
    ).toEqual(renderLayer(blank, "layer-1").ops);
  });

  it("clears the whole target first so a reused surface keeps real alpha", () => {
    const recording = renderLayer(pageWithLayers([[]]), "layer-1");
    expect(recording.ops[0]).toMatchObject({ op: "clearRect", args: [0, 0, 200, 160] });
  });
});

describe("renderPageLayerPreview page frame", () => {
  it.each([
    { name: "portrait", geometry: { width: 794, height: 1123 } },
    { name: "landscape", geometry: { width: 1123, height: 794 } },
    { name: "square", geometry: { width: 900, height: 900 } },
    { name: "custom", geometry: { width: 640, height: 480 } },
  ])("fits a $name page into the preview box", ({ geometry }) => {
    const page = pageWithLayers([[rectangleAt(0, 0)]], { geometry });
    const scale = Math.min(SIZE.width / geometry.width, SIZE.height / geometry.height);
    const width = geometry.width * scale;
    const height = geometry.height * scale;
    const offsetX = (SIZE.width - width) / 2;
    const offsetY = (SIZE.height - height) / 2;

    expect(frameOps(renderLayer(page, "layer-1").ops)).toEqual([
      `rect(${offsetX},${offsetY},${width},${height})`,
      "clip()",
      `translate(${offsetX},${offsetY})`,
      `scale(${scale},${scale})`,
    ]);
  });

  it("gives every layer of one page the identical fitted frame", () => {
    const page = pageWithLayers([[rectangleAt(5, 5)], [], [lineAt(700, 600)]], {
      geometry: { width: 794, height: 1123 },
    });
    const frames = ["layer-1", "layer-2", "layer-3"].map((layerId) =>
      frameOps(renderLayer(page, layerId).ops),
    );
    expect(frames[1]).toEqual(frames[0]);
    expect(frames[2]).toEqual(frames[0]);
  });

  it("uses the same fitted frame the whole-page thumbnail uses", () => {
    const page = pageWithLayers([[rectangleAt(5, 5)]], {
      geometry: { width: 794, height: 1123 },
    });
    expect(frameOps(renderLayer(page, "layer-1").ops)).toEqual(frameOps(renderThumbnail(page).ops));
  });

  it("issues every mark inside the page clip", () => {
    const page = pageWithLayers([[rectangleAt(5000, 5000)]]);
    const ops = renderLayer(page, "layer-1").ops;
    const clipIndex = ops.findIndex((entry) => entry.op === "clip");
    const drawIndex = ops.findIndex((entry) => entry.op === "stroke" || entry.op === "fill");
    expect(clipIndex).toBeGreaterThanOrEqual(0);
    expect(drawIndex).toBeGreaterThan(clipIndex);
  });
});

describe("renderPageLayerPreview contract", () => {
  it("throws for an unknown layer id and draws nothing", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)]]);
    const recording = recordingContext();
    expect(() => renderPageLayerPreview(recording.context, page, "layer-404", SIZE)).toThrow(
      /layer-404/u,
    );
    expect(marks(recording.ops), "an unknown id never means every layer").toEqual([]);
  });

  it("mutates neither the page nor its document", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)], [lineAt(20, 20)]]);
    const layersBefore = page.content.layers;
    const objectsBefore = page.content.objects.objects;
    const orderBefore = objectsBefore.map((object) => object.id);

    renderLayer(page, "layer-1");
    renderLayer(page, "layer-2");
    renderThumbnail(page);

    expect(page.content.layers).toBe(layersBefore);
    expect(page.content.objects.objects).toBe(objectsBefore);
    expect(page.content.objects.objects.map((object) => object.id)).toEqual(orderBefore);
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("is deterministic for the same page and layer", () => {
    const page = pageWithLayers([[rectangleAt(10, 10), lineAt(60, 60)]]);
    expect(renderLayer(page, "layer-1").ops).toEqual(renderLayer(page, "layer-1").ops);
  });
});

describe("layer previews compose into the page thumbnail", () => {
  it("reproduces the thumbnail's artwork exactly when stacked bottom to top", () => {
    const page = pageWithLayers(
      [
        [rectangleAt(10, 10), lineAt(20, 30)],
        [rectangleAt(200, 150)],
        [lineAt(400, 300), rectangleAt(500, 400)],
      ],
      { patch: { 1: { opacity: 0.5 } } },
    );
    const composed = page.content.layers.flatMap((layer) => paths(renderLayer(page, layer.id).ops));
    expect(composed).toEqual(paths(renderThumbnail(page).ops));
    expect(composed).toEqual([
      "rect(10,10,40,30)",
      "moveTo(20,30)",
      "lineTo(70,50)",
      "rect(200,150,40,30)",
      "moveTo(400,300)",
      "lineTo(450,320)",
      "rect(500,400,40,30)",
    ]);
  });

  it("carries the same per-layer alpha the thumbnail applies", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)], [rectangleAt(60, 60)]], {
      patch: { 0: { opacity: 0.25 }, 1: { opacity: 0.75 } },
    });
    const previewAlphas = page.content.layers.flatMap((layer) =>
      marks(renderLayer(page, layer.id).ops).map((entry) => entry.alpha),
    );
    expect(previewAlphas).toEqual(marks(renderThumbnail(page).ops).map((entry) => entry.alpha));
  });

  it("skips a hidden layer identically in both paths", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)], [rectangleAt(60, 60)]], {
      patch: { 1: { visible: false } },
    });
    const composed = page.content.layers.flatMap((layer) => paths(renderLayer(page, layer.id).ops));
    expect(composed).toEqual(["rect(10,10,40,30)"]);
    expect(paths(renderThumbnail(page).ops)).toEqual(["rect(10,10,40,30)"]);
  });
});

describe("renderPageThumbnail regression", () => {
  it("still paints paper colour, pattern, and every visible layer in order", () => {
    const page = pageWithLayers([[rectangleAt(10, 10)], [lineAt(200, 200)]], {
      paper: createPagePaper({ type: "grid", color: "#fffdf8", spacing: 100 }),
    });
    const recording = renderThumbnail(page);

    const fills = recording.ops.filter((entry) => entry.op === "fillRect");
    expect(fills, "the paper fill still happens exactly once").toHaveLength(1);
    expect(fills[0]!.fillStyle).toBe("#fffdf8");
    expect(
      recording.ops.filter((entry) => entry.op === "stroke" && entry.strokeStyle === "#cccccc")
        .length,
      "the grid pattern still draws",
    ).toBeGreaterThan(0);
    expect(paths(recording.ops)).toEqual(
      expect.arrayContaining(["rect(10,10,40,30)", "moveTo(200,200)", "lineTo(250,220)"]),
    );
  });

  it("keeps the paper fill outside the page clip, exactly as before", () => {
    const recording = renderThumbnail(pageWithLayers([[]]));
    const fillIndex = recording.ops.findIndex((entry) => entry.op === "fillRect");
    const clipIndex = recording.ops.findIndex((entry) => entry.op === "clip");
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(fillIndex, "op order is unchanged by the extraction").toBeLessThan(clipIndex);
  });

  it("draws no pattern marks for blank paper", () => {
    const recording = renderThumbnail(pageWithLayers([[]], { paper: BLANK_PAPER }));
    expect(recording.ops.filter((entry) => entry.op === "stroke")).toEqual([]);
  });
});
