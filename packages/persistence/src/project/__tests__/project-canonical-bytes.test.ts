import { describe, expect, it } from "vitest";
import type { JsonObject } from "@folio/domain";
import {
  Layer,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  Transform,
  createPageGeometry,
  createPagePaper,
  type PageObject,
} from "@folio/document";
import {
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  type BrushFamily,
  type BrushStrategyId,
  type InkPointerType,
  type ResolvedBrushSnapshot,
  type Stroke,
  type StrokePointInput,
} from "@folio/ink";
import { decodeFolioProject, encodeFolioProject } from "../project-codec";
import type { FolioProjectSnapshot } from "../project-types";

/**
 * What a `.folio` project encodes to, pinned byte for byte.
 *
 * The recovery codec is on the drawing thread, so it gets optimized. Every
 * optimization is allowed to change how the bytes are produced and nothing
 * about what they are: a project this version writes must be the same file the
 * previous version wrote, down to key order, spacing and the trailing newline.
 * Decoded equivalence is not the property under test here -- two files that
 * decode alike are still two different files on disk.
 *
 * The digests below were captured from the implementation that existed before
 * the phase that pinned them -- the first nine from before Recovery R2, the
 * Stroke-shaped eight from before Recovery R3 -- so they are evidence about
 * those implementations rather than a description of the current one. They must
 * never be re-blessed to accommodate a change in output. A deliberate format
 * change is a `formatVersion` change, and would arrive with its own goldens.
 *
 * The second gate is the one that generalises. Every object in the output is
 * asserted to carry its keys in the codec's canonical order, so a new fixture
 * nobody pinned a digest for still cannot be emitted out of order.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

/** FNV-1a over the encoded text. Local, so no helper can drift underneath it. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function brush(): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "corpus-pencil",
    presetVersion: 1,
    family: "pencil",
    color: "#343434",
    size: 26,
    opacity: 0.78,
    smoothing: { mode: "average", amount: 0.2 },
    dynamics: {
      pressureSize: { enabled: true, minimumFactor: 0.65, maximumFactor: 1.25, curve: LINEAR },
      pressureOpacity: {
        enabled: true,
        minimumFactor: 0.45,
        maximumFactor: 1,
        curve: { kind: "power", exponent: 0.75 },
      },
    },
    renderer: { version: 1, kind: "pencil" },
  });
}

function stroke(id: string, samples: number): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush: brush(),
    smoother: new StrokeSmoother({ mode: "average" }),
  });
  for (let index = 0; index < samples; index += 1) {
    const t = index / samples;
    const input: StrokePointInput = {
      x: 100 + Math.sin(t * 11) * 160 + t * 520,
      y: 200 + Math.cos(t * 7) * 110,
      timestamp: index * 4,
      // Pressure and tilt vary so the optional sample fields and the pressure
      // response are both exercised rather than written as constants.
      pressure: 0.3 + 0.5 * Math.abs(Math.sin(t * 5)),
      tiltX: Math.round(Math.sin(t * 3) * 40),
      tiltY: Math.round(Math.cos(t * 3) * 40),
      twist: index % 360,
      pointerType: "pen",
      button: 0,
      buttons: 1,
      altitudeAngle: 0.8,
      azimuthAngle: 1.2,
    };
    builder.addPoint(input);
  }
  return builder.finalize();
}

/**
 * One stroke per durable render strategy, and every other Stroke shape the
 * encoder has to keep producing the same bytes for.
 *
 * Recovery R3 moved the encoder's Stroke validation off the encoded object and
 * onto the model it was built from, so the corpus exercises the fields that
 * choice touches: every strategy identity a saved project may name, both sample
 * arrays at scale, the optional pointer angles present and absent, each pointer
 * type, and the brush a Stroke built without one falls back to.
 */
const STRATEGIES: readonly Readonly<{ kind: BrushStrategyId; family: BrushFamily }>[] =
  Object.freeze([
    { kind: "centerline", family: "pen" },
    { kind: "outline", family: "pen" },
    { kind: "technical-pen", family: "pen" },
    { kind: "pressure-pen", family: "pen" },
    { kind: "pencil", family: "pencil" },
  ]);

function strategyBrush(kind: BrushStrategyId, family: BrushFamily): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `corpus-${kind}`,
    presetVersion: 2,
    family,
    color: "#1b2a3c",
    size: 11.5,
    opacity: 0.93,
    smoothing: { mode: "catmull-rom", amount: 0.55 },
    dynamics: {
      pressureSize: { enabled: true, minimumFactor: 0, maximumFactor: 2, curve: LINEAR },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "power", exponent: 2.5 },
      },
    },
    renderer: { version: 1, kind },
  });
}

interface StrokeShape {
  readonly id: string;
  readonly samples: number;
  readonly brush?: ResolvedBrushSnapshot;
  readonly pointerType?: InkPointerType;
  /** False means each sample omits both optional angles, as a mouse's would. */
  readonly angles?: boolean;
  readonly pressure?: (progress: number) => number;
}

function shapedStroke(shape: StrokeShape): Stroke {
  const builder = new StrokeBuilder({
    id: shape.id,
    timestamp: 0,
    ...(shape.brush === undefined ? {} : { brush: shape.brush }),
    smoother: new StrokeSmoother({ mode: "average" }),
  });
  const pressureOf = shape.pressure ?? ((progress) => 0.3 + 0.5 * Math.abs(Math.sin(progress * 5)));
  for (let index = 0; index < shape.samples; index += 1) {
    const t = shape.samples === 1 ? 0 : index / shape.samples;
    builder.addPoint({
      x: 100 + Math.sin(t * 11) * 160 + t * 520,
      y: 200 + Math.cos(t * 7) * 110,
      timestamp: index * 4,
      pressure: pressureOf(t),
      tiltX: Math.round(Math.sin(t * 3) * 40),
      tiltY: Math.round(Math.cos(t * 3) * 40),
      twist: index % 360,
      pointerType: shape.pointerType ?? "pen",
      button: 0,
      buttons: 1,
      ...(shape.angles === false ? {} : { altitudeAngle: 0.8, azimuthAngle: 1.2 }),
    });
  }
  return builder.finalize();
}

const TIMESTAMP = "2026-10-11T00:00:00.000Z";

function factory(): ObjectFactory {
  return new ObjectFactory({ now: () => TIMESTAMP });
}

function page(
  id: string,
  objects: readonly PageObject[],
  options: Readonly<{
    name?: string;
    layers?: readonly Layer[];
    paper?: Parameters<typeof createPagePaper>[0];
    geometry?: Parameters<typeof createPageGeometry>[0];
  }> = {},
): Page {
  const layers =
    options.layers ??
    ([
      new Layer({ id: `${id}-layer-1`, name: "Layer 1", objectIds: objects.map((o) => o.id) }),
    ] as readonly Layer[]);
  return new Page({
    id,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.geometry === undefined ? {} : { geometry: createPageGeometry(options.geometry) }),
    paper: createPagePaper(options.paper ?? { type: "blank" }),
    content: new PageDocument({ layers, objects: new ObjectCollection(objects) }),
  });
}

function snapshot(
  pages: readonly Page[],
  metadata: Readonly<{ documentId?: string; title?: string }> = {},
): FolioProjectSnapshot {
  return {
    metadata: {
      documentId: metadata.documentId ?? "corpus",
      title: metadata.title ?? "Corpus",
      createdAt: TIMESTAMP,
    },
    sketchbook: new SketchbookDocument({ pages }),
  } as unknown as FolioProjectSnapshot;
}

/** A nesting chain of a given depth, for the dynamic-key metadata structures. */
function nest(levels: number): JsonObject {
  let value: JsonObject = { leaf: 1 };
  for (let index = 0; index < levels; index += 1) value = { [`level${String(index)}`]: value };
  return value;
}

interface CorpusEntry {
  readonly label: string;
  readonly build: () => FolioProjectSnapshot;
}

const CORPUS: readonly CorpusEntry[] = Object.freeze([
  {
    label: "minimal",
    build: () => snapshot([page("page-1", [])]),
  },
  {
    label: "one-ink-stroke",
    build: () => {
      const object = factory().createInkObject({
        id: "object-1",
        stroke: stroke("stroke-1", 24),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "vectors",
    build: () => {
      const make = factory();
      const line = make.createLineObject({
        id: "line-1",
        geometry: { start: { x: 10, y: 20 }, end: { x: 90, y: 120 } },
        style: { strokeColor: { hex: "#112233", opacity: 0.5 }, strokeWidth: 3 },
        zIndex: 0,
      });
      const rectangle = make.createRectangleObject({
        id: "rect-1",
        geometry: { x: 5, y: 6, width: 70, height: 80 },
        style: { fillColor: "#aabbcc", lineStyle: "dashed" },
        zIndex: 1,
      });
      const ellipse = make.createEllipseObject({
        id: "ellipse-1",
        geometry: { center: { x: 50, y: 60 }, radiusX: 25, radiusY: 15 },
        zIndex: 2,
      });
      return snapshot([page("page-1", [line, rectangle, ellipse])]);
    },
  },
  {
    label: "mixed-multi-page",
    build: () => {
      const make = factory();
      const ink = make.createInkObject({
        id: "object-1",
        stroke: stroke("stroke-1", 16),
        createdAt: TIMESTAMP,
      });
      const rectangle = make.createRectangleObject({
        id: "rect-1",
        geometry: { x: 1, y: 2, width: 30, height: 40 },
        zIndex: 1,
      });
      return snapshot([
        page("page-1", [ink, rectangle], {
          name: "First",
          paper: { type: "ruled", color: "#fffdf8", spacing: 24 },
          geometry: { width: 816, height: 1056 },
          layers: [
            new Layer({ id: "page-1-layer-1", name: "Ink", objectIds: ["object-1"] }),
            new Layer({
              id: "page-1-layer-2",
              name: "Shapes",
              objectIds: ["rect-1"],
              visible: false,
              locked: true,
              opacity: 0.4,
            }),
          ],
        }),
        page("page-2", [], {
          name: "Second",
          paper: { type: "grid", color: "#ffffff", spacing: 8 },
        }),
        page("page-3", [], {
          name: "Third",
          paper: { type: "isometric", color: "#f4f4f2", spacing: 12 },
        }),
      ]);
    },
  },
  {
    label: "many-layers",
    build: () => {
      const layers = Array.from(
        { length: 24 },
        (_unused, index) =>
          new Layer({
            id: `layer-${String(index).padStart(2, "0")}`,
            name: `Layer ${String(index)}`,
            objectIds: [],
            visible: index % 3 !== 0,
            locked: index % 4 === 0,
            opacity: Number((index / 24).toFixed(4)),
          }),
      );
      return snapshot([page("page-1", [], { layers })]);
    },
  },
  {
    label: "unicode-names",
    build: () => {
      const object = factory().createInkObject({
        id: "object-ünïcode",
        stroke: stroke("stroke-ü", 8),
        createdAt: TIMESTAMP,
      });
      return snapshot(
        [
          page("page-1", [object], {
            name: 'Ébauche — « étude » 日本語 🖌️\t"quoted"\\backslash',
            layers: [
              new Layer({
                id: "page-1-layer-1",
                name: "Çalışma \u0000\u001f control",
                objectIds: ["object-ünïcode"],
              }),
            ],
          }),
        ],
        { documentId: "corpus-ünïcode", title: "Título — 🎨  line separator" },
      );
    },
  },
  {
    label: "dynamic-keys",
    build: () => {
      // The structures whose keys the codec does not know statically: object
      // metadata, Ink rendering hints, and the vector payloads. Integer-like
      // keys are included deliberately, because JavaScript enumerates those
      // before string keys and in numeric order, which is not the order the
      // codec's canonical comparison produces.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: stroke("stroke-1", 8),
        createdAt: TIMESTAMP,
        metadata: {
          zebra: 1,
          Apple: 2,
          apple: 3,
          "10": 4,
          "2": 5,
          "1": 6,
          "01": 7,
          "-1": 8,
          "layer-1": 9,
          "a b": 10,
          "": 11,
          ümlaut: 12,
          nested: { b: [1, 2, { d: true, c: null }], a: "x" },
        },
        renderingHints: { beta: false, alpha: [3, 2, 1], gamma: { inner: nest(4) } },
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "boundary-nesting",
    build: () => {
      // Metadata nested as deeply as the limit allows once the document that
      // carries it is accounted for. The codec rejects anything past the
      // ceiling, so this fixture sits just inside it.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: stroke("stroke-1", 4),
        createdAt: TIMESTAMP,
        metadata: { deep: nest(50) },
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "punctuation-in-strings",
    build: () => {
      // A name full of JSON punctuation. Structural depth must be a property of
      // the document, never of what its text happens to contain.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: stroke("stroke-1", 4),
        createdAt: TIMESTAMP,
        metadata: {
          note: '{"[[[":"]]]}"}' + "{".repeat(80) + "[".repeat(80),
          escapes: 'a\\"b\\\\cé😀',
        },
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "tap",
    build: () => {
      // One sample. Every count agreement and every "at least one" rule meets
      // its smallest legal case here.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: shapedStroke({ id: "stroke-tap", samples: 1 }),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "long-stroke",
    build: () => {
      const object = factory().createInkObject({
        id: "object-1",
        stroke: shapedStroke({ id: "stroke-long", samples: 600 }),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "five-thousand-samples",
    build: () => {
      // The size class the recovery capture is measured at, pinned byte for
      // byte rather than only timed.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: shapedStroke({ id: "stroke-5000", samples: 5000 }),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "pressure-sweep",
    build: () => {
      // Pressure walks the whole unit interval, so both ends of the domain and
      // the statistics derived from them are in the bytes.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: shapedStroke({
          id: "stroke-pressure",
          samples: 120,
          brush: strategyBrush("pressure-pen", "pen"),
          pressure: (progress) => progress,
        }),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "every-strategy",
    build: () => {
      const make = factory();
      const objects = STRATEGIES.map((strategy, index) =>
        make.createInkObject({
          id: `object-${strategy.kind}`,
          stroke: shapedStroke({
            id: `stroke-${strategy.kind}`,
            samples: 12,
            brush: strategyBrush(strategy.kind, strategy.family),
          }),
          createdAt: TIMESTAMP,
          zIndex: index,
        }),
      );
      return snapshot([page("page-1", objects)]);
    },
  },
  {
    label: "legacy-style-brush",
    build: () => {
      // A Stroke built without a resolved brush, which is the pre-17A shape the
      // model still projects onto `legacy-stroke-style` / `centerline@1`.
      const object = factory().createInkObject({
        id: "object-1",
        stroke: shapedStroke({ id: "stroke-legacy", samples: 10 }),
        createdAt: TIMESTAMP,
      });
      return snapshot([page("page-1", [object])]);
    },
  },
  {
    label: "pointer-types",
    build: () => {
      // A mouse never reports the optional angles; a pen usually does. Both
      // shapes have to encode, and the absent fields have to stay absent.
      const make = factory();
      const mouse = make.createInkObject({
        id: "object-mouse",
        stroke: shapedStroke({
          id: "stroke-mouse",
          samples: 9,
          pointerType: "mouse",
          angles: false,
        }),
        createdAt: TIMESTAMP,
        zIndex: 0,
      });
      const touch = make.createInkObject({
        id: "object-touch",
        stroke: shapedStroke({ id: "stroke-touch", samples: 9, pointerType: "touch" }),
        createdAt: TIMESTAMP,
        zIndex: 1,
      });
      return snapshot([page("page-1", [mouse, touch])]);
    },
  },
  {
    label: "transformed-and-restyled",
    build: () => {
      // The two things that happen to a committed stroke: a page transform,
      // which lives on the object, and a restyle, which rebuilds the brush and
      // the style around the same process data.
      const make = factory();
      const transformed = make.createInkObject({
        id: "object-transformed",
        stroke: shapedStroke({ id: "stroke-source", samples: 20 }),
        createdAt: TIMESTAMP,
        transform: new Transform({ translation: { x: 12.5, y: -8 }, rotation: 0.35, scale: 1.75 }),
        zIndex: 0,
      });
      const restyled = make.createInkObject({
        id: "object-restyled",
        stroke: shapedStroke({
          id: "stroke-restyled",
          samples: 20,
          brush: strategyBrush("outline", "highlighter"),
        }),
        createdAt: TIMESTAMP,
        zIndex: 1,
      });
      return snapshot([page("page-1", [transformed, restyled])]);
    },
  },
]);

/**
 * Byte length and FNV-1a digest of each fixture, from before R2.
 *
 * Captured with `FOLIO_PIN_CANONICAL_BYTES=1`, which prints a replacement for
 * this table. Printing it is not blessing it: a change here has to be a
 * deliberate format decision, with a `formatVersion` to go with it.
 */
const GOLDEN: Readonly<Record<string, string>> = Object.freeze({
  minimal: "751:1w5x6tm",
  "one-ink-stroke": "37122:hj2sj1",
  vectors: "4627:1irczpu",
  "mixed-multi-page": "28915:61ekj8",
  "many-layers": "5787:iflpll",
  "unicode-names": "15794:1i4i0z3",
  "dynamic-keys": "16855:n1hnkg",
  "boundary-nesting": "17956:84wtq2",
  "punctuation-in-strings": "10594:9041zx",
  tap: "5930:fu1bua",
  "long-stroke": "812299:xvkeej",
  "five-thousand-samples": "6751593:1rz5jfl",
  "pressure-sweep": "165005:1ce2yql",
  "every-strategy": "102268:1cj7gy5",
  "legacy-style-brush": "18367:kjqd85",
  "pointer-types": "31793:c2bqly",
  "transformed-and-restyled": "62794:1350hsx",
});

/**
 * Whether a key is an array index as far as the JavaScript engine is concerned.
 *
 * This matters because such keys are not stored in insertion order. An object
 * always enumerates them first and ascending, however it was built -- so for
 * them the codec's emission order is not a choice it gets to make, and
 * inserting them "in sorted order" changes nothing about the resulting bytes.
 */
function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

/**
 * The order this format emits one object's keys in.
 *
 * Array-index-like keys first and ascending, because the engine insists; then
 * every other key by `localeCompare(_, "en")`, which is the comparison the
 * codec's canonical order is defined by. The locale is load-bearing: it puts
 * "apple" before "Apple" and sorts "ümlaut" among the letters, neither of which
 * a code-unit comparison does.
 */
function canonicalKeyOrder(keys: readonly string[]): string[] {
  const indices = keys.filter(isArrayIndexKey).sort((left, right) => Number(left) - Number(right));
  const names = keys
    .filter((key) => !isArrayIndexKey(key))
    .sort((left, right) => left.localeCompare(right, "en"));
  return [...indices, ...names];
}

/** Every object in the parsed output whose keys are not in canonical order. */
function outOfOrderKeyPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => outOfOrderKeyPaths(item, `${path}[${String(index)}]`));
  }
  if (value === null || typeof value !== "object") return [];
  const keys = Object.keys(value as Record<string, unknown>);
  const sorted = canonicalKeyOrder(keys);
  const own = keys.join("\u0000") === sorted.join("\u0000") ? [] : [path];
  return [
    ...own,
    ...keys.flatMap((key) =>
      outOfOrderKeyPaths((value as Record<string, unknown>)[key], `${path}.${key}`),
    ),
  ];
}

describe("the bytes a project encodes to", () => {
  const encoded = new Map<string, string>();
  for (const entry of CORPUS) {
    encoded.set(entry.label, encodeFolioProject(entry.build()));
  }

  if (process.env.FOLIO_PIN_CANONICAL_BYTES === "1") {
    it("prints a replacement golden table", () => {
      const lines = [...encoded].map(
        ([label, text]) => `  ${JSON.stringify(label)}: "${String(text.length)}:${digest(text)}",`,
      );
      console.log(`const GOLDEN = Object.freeze({\n${lines.join("\n")}\n});`);
      expect(lines).toHaveLength(CORPUS.length);
    });
  }

  it.each(CORPUS.map((entry) => entry.label))("is unchanged for %s", (label) => {
    const text = encoded.get(label)!;
    expect(`${String(text.length)}:${digest(text)}`).toBe(GOLDEN[label]);
  });

  it.each(CORPUS.map((entry) => entry.label))("carries canonical key order for %s", (label) => {
    const text = encoded.get(label)!;
    // `JSON.parse` preserves the emitted order of non-integer-like keys, so the
    // parsed object reports what the text actually says.
    expect(outOfOrderKeyPaths(JSON.parse(text))).toEqual([]);
  });

  it.each(CORPUS.map((entry) => entry.label))("still ends in one newline for %s", (label) => {
    const text = encoded.get(label)!;
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    // Pretty printing at two spaces, which is part of the format.
    expect(text.startsWith('{\n  "format": "folio-project",\n')).toBe(true);
  });

  it.each(CORPUS.map((entry) => entry.label))("round-trips %s back to the same bytes", (label) => {
    const text = encoded.get(label)!;
    expect(encodeFolioProject(decodeFolioProject(text))).toBe(text);
  });
});
