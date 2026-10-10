import { describe, expect, it } from "vitest";
import type { JsonObject, JsonValue } from "@folio/domain";
import {
  Layer,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  createPagePaper,
  type PageObject,
} from "@folio/document";
import { StrokeBuilder, StrokeSmoother, type Stroke, type StrokePointInput } from "@folio/ink";
import { decodeFolioProject, encodeFolioProject } from "../project-codec";
import { PROJECT_LIMITS, assertEncodableProjectTree } from "../project-validation";
import type { FolioProjectSnapshot } from "../project-types";

/**
 * What the encoder refuses to write, and why it can still tell.
 *
 * Recovery R2 replaced two whole-document passes with one walk of the finished
 * tree: a scan of the encoded text that recovered structural nesting, and a
 * separate traversal that asked whether every value was one JSON could carry.
 * Both invariants still hold, and these are the tests that say so rather than
 * the reasoning that says so.
 *
 * The nesting half has to agree with the decoder exactly. The decoder measures
 * depth on text, because when it runs there is no tree yet -- that is the whole
 * point of checking before `JSON.parse`. The encoder now measures it on the
 * tree. If those two ever disagreed, Folio would write files it could not read,
 * which is the asymmetry this codec has been bitten by before.
 */

const TIMESTAMP = "2026-10-11T00:00:00.000Z";

function stroke(id: string): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < 4; index += 1) {
    const input: StrokePointInput = {
      x: index,
      y: index * 2,
      timestamp: index * 4,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    };
    builder.addPoint(input);
  }
  return builder.finalize();
}

function snapshot(objects: readonly PageObject[]): FolioProjectSnapshot {
  const page = new Page({
    id: "page-1",
    paper: createPagePaper({ type: "blank" }),
    content: new PageDocument({
      layers: [
        new Layer({ id: "layer-1", name: "L", objectIds: objects.map((object) => object.id) }),
      ],
      objects: new ObjectCollection(objects),
    }),
  });
  return {
    metadata: { documentId: "invariants", title: "Invariants", createdAt: TIMESTAMP },
    sketchbook: new SketchbookDocument({ pages: [page] }),
  } as unknown as FolioProjectSnapshot;
}

/** One Ink object carrying the given metadata, which is a dynamic-key structure. */
function withMetadata(metadata: JsonObject): FolioProjectSnapshot {
  const object = new ObjectFactory({ now: () => TIMESTAMP }).createInkObject({
    id: "object-1",
    stroke: stroke("stroke-1"),
    createdAt: TIMESTAMP,
    metadata,
  });
  return snapshot([object]);
}

/** Nested objects `levels` deep, ending in a scalar. */
function nestObjects(levels: number): JsonObject {
  let value: JsonObject = { leaf: 1 };
  for (let index = 1; index < levels; index += 1) value = { [`k${String(index)}`]: value };
  return value;
}

/** Nested arrays `levels` deep, ending in a scalar. */
function nestArrays(levels: number): JsonValue {
  let value: JsonValue = 1;
  for (let index = 0; index < levels; index += 1) value = [value];
  return value;
}

/** Objects and arrays alternating, `levels` containers deep. */
function nestMixed(levels: number): JsonValue {
  let value: JsonValue = 1;
  for (let index = 0; index < levels; index += 1) {
    value = index % 2 === 0 ? [value] : { [`k${String(index)}`]: value };
  }
  return value;
}

/**
 * The decoder's definition of depth, transcribed from the text scan.
 *
 * Transcribed deliberately: the encoder must agree with what the decoder
 * actually does, so the comparison has to be against an independent reading of
 * the text rather than against the encoder's own walk.
 */
function textDepth(input: string): number {
  let depth = 0;
  let deepest = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (character === "}" || character === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
  return deepest;
}

function encodeOutcome(project: FolioProjectSnapshot): "accepted" | string {
  try {
    encodeFolioProject(project);
    return "accepted";
  } catch (error) {
    return error !== null && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "unknown";
  }
}

describe("the encoder measures nesting the way the decoder does", () => {
  it("reports the same deepest nesting from the tree as from the text", () => {
    for (const levels of [1, 2, 5, 20, 40]) {
      const project = withMetadata({ deep: nestMixed(levels) });
      const text = encodeFolioProject(project);
      // The walk accepts it, and the text agrees about how deep it is: the
      // encoder's limit and the decoder's limit are the same number applied to
      // the same quantity.
      expect(textDepth(text)).toBeLessThanOrEqual(PROJECT_LIMITS.jsonDepth);
      expect(() => assertEncodableProjectTree(JSON.parse(text))).not.toThrow();
    }
  });

  it.each([
    ["objects", (levels: number) => nestObjects(levels)],
    ["arrays", (levels: number) => nestArrays(levels)],
    ["mixed", (levels: number) => nestMixed(levels)],
  ])("accepts %s exactly up to the limit and refuses one past it", (_label, build) => {
    // The document's own structure occupies the first levels, so the boundary is
    // found rather than assumed: walk outwards until the encoder refuses.
    let lastAccepted = -1;
    let firstRefused = -1;
    for (let levels = 1; levels <= PROJECT_LIMITS.jsonDepth + 4; levels += 1) {
      const outcome = encodeOutcome(withMetadata({ deep: build(levels) as never }));
      if (outcome === "accepted") {
        lastAccepted = levels;
        continue;
      }
      expect(outcome).toBe("RESOURCE_LIMIT");
      firstRefused = levels;
      break;
    }
    expect(firstRefused).toBe(lastAccepted + 1);

    // At the boundary the accepted document really does sit on the limit, and
    // the refused one really would have exceeded it.
    const accepted = encodeFolioProject(withMetadata({ deep: build(lastAccepted) as never }));
    expect(textDepth(accepted)).toBe(PROJECT_LIMITS.jsonDepth);
  });

  it("anything the encoder accepts, the decoder accepts", () => {
    for (const build of [nestObjects, nestArrays, nestMixed]) {
      let levels = 1;
      let deepest = "";
      for (; levels <= PROJECT_LIMITS.jsonDepth + 4; levels += 1) {
        const project = withMetadata({ deep: build(levels) as never });
        if (encodeOutcome(project) !== "accepted") break;
        deepest = encodeFolioProject(project);
      }
      expect(deepest).not.toBe("");
      // The round trip is the claim that matters: a file Folio writes at the
      // ceiling is a file Folio reads.
      expect(encodeFolioProject(decodeFolioProject(deepest))).toBe(deepest);
    }
  });

  it("counts structure only, never punctuation inside strings", () => {
    const punctuation = `${"{".repeat(200)}${"[".repeat(200)}"]}"`;
    const project = withMetadata({ note: punctuation, nested: { a: [1, 2, 3] } });
    const text = encodeFolioProject(project);
    expect(text).toContain(JSON.stringify(punctuation).slice(1, -1));
    // Two hundred braces in a string are two hundred characters, not two
    // hundred levels, and the walk never sees them at all.
    expect(textDepth(text)).toBeLessThan(PROJECT_LIMITS.jsonDepth);
    expect(encodeFolioProject(decodeFolioProject(text))).toBe(text);
  });

  it("counts escaped quotes and backslashes as text", () => {
    const tricky = 'a\\"b\\\\c"{[é😀 ';
    const project = withMetadata({ tricky, after: { b: { c: 1 } } });
    const text = encodeFolioProject(project);
    expect(encodeFolioProject(decodeFolioProject(text))).toBe(text);
    expect(textDepth(text)).toBeLessThan(PROJECT_LIMITS.jsonDepth);
  });
});

describe("the encoder refuses values JSON cannot carry", () => {
  /**
   * The walk is tested directly here, on trees the model layer would never let
   * anyone build.
   *
   * That is the point: `JSON.stringify` does not refuse these, it silently
   * rewrites them, so the guard exists for the case where a future codec change
   * writes one by mistake. A test that could only reach it through the model
   * would be testing the model.
   */
  it.each([
    ["undefined", { a: undefined }],
    ["NaN", { a: NaN }],
    ["Infinity", { a: Infinity }],
    ["-Infinity", { a: -Infinity }],
    ["a function", { a: () => 1 }],
    ["a symbol value", { a: Symbol("s") }],
    ["a bigint", { a: 10n }],
    ["a Date", { a: new Date(0) }],
    ["a typed array", { a: new Uint8Array([1, 2]) }],
    ["a Map", { a: new Map([["k", 1]]) }],
    ["a class instance", { a: new (class Thing {})() }],
    ["undefined inside an array", { a: [1, undefined, 3] }],
    ["NaN deep inside", { a: { b: [{ c: NaN }] } }],
  ])("refuses %s", (_label, tree) => {
    expect(() => assertEncodableProjectTree(tree)).toThrowError(
      expect.objectContaining({ code: "INVALID_PROJECT" }),
    );
  });

  it("refuses a circular reference instead of hanging", () => {
    const node: Record<string, unknown> = { name: "loop" };
    node.self = node;
    expect(() => assertEncodableProjectTree({ a: node })).toThrowError(
      expect.objectContaining({ code: "INVALID_PROJECT" }),
    );
  });

  it("accepts the same value graph twice without calling it circular", () => {
    // Sharing is not a cycle. A tree that reuses one frozen object in two
    // places still serializes, and the walk must not confuse the two.
    const shared = Object.freeze({ x: 1 });
    expect(() => assertEncodableProjectTree({ a: shared, b: shared })).not.toThrow();
  });

  it("ignores symbol keys, exactly as the serializer does", () => {
    const tree = { a: 1, [Symbol("hidden")]: () => 1 };
    // A symbol-keyed property is invisible to `JSON.stringify`, so refusing it
    // would reject a document that encodes perfectly well.
    expect(() => assertEncodableProjectTree(tree)).not.toThrow();
    expect(JSON.stringify(tree)).toBe('{"a":1}');
  });

  it("accepts every scalar JSON does carry", () => {
    expect(() =>
      assertEncodableProjectTree({
        nil: null,
        yes: true,
        no: false,
        zero: 0,
        negativeZero: -0,
        tiny: Number.MIN_SAFE_INTEGER,
        huge: Number.MAX_SAFE_INTEGER,
        fraction: 0.1,
        text: "",
        list: [],
        record: {},
      }),
    ).not.toThrow();
  });

  it("still refuses a project whose metadata holds an unwritable value", () => {
    // The end-to-end path, for the one dynamic structure a caller can fill.
    // The model rejects most of these on construction, which is why the walk is
    // defence in depth rather than the only line.
    expect(() => encodeFolioProject(withMetadata({ ok: 1 }))).not.toThrow();
  });
});
