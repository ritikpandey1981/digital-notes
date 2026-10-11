import { describe, expect, it } from "vitest";
import {
  InkError,
  Stroke,
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  type BrushFamily,
  type BrushStrategyId,
  type ResolvedBrushSnapshot,
  type StrokePointInput,
} from "@folio/ink";
import { decodeStroke, encodeStroke, type SerializedStroke } from "../ink-codec";
import { FolioProjectCodecError } from "../project-errors";
import { createResourceBudget, type ProjectResourceBudget } from "../project-validation";

/**
 * Who owns each rule a saved Stroke obeys.
 *
 * Recovery R3 stopped the encoder running the whole decode-side parse over the
 * object it had just built. That is only safe if every rule that parse enforces
 * is still enforced somewhere appropriate, so this suite names the boundary for
 * each one and then proves all three sides of it:
 *
 * - the **model** refuses, or cannot express, what a drawing is not allowed to
 *   be -- which is most of it, and is why the encoder does not have to rebuild
 *   anything to find out;
 * - the **encoder** refuses a Stroke it could not read back, which includes the
 *   things only the file format knows about, such as how many samples one
 *   stroke may carry and how long an id may be;
 * - the **decoder** refuses all of it, unchanged, because the decoder is where
 *   a document nobody in this process wrote arrives.
 *
 * The encoder's cases are built by forging an object onto `Stroke.prototype`,
 * which is the only way to hold a Stroke whose fields are wrong. Reaching them
 * through a real constructor is impossible on purpose, and a test that tried
 * would be testing the constructor.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function budget(): ProjectResourceBudget {
  return createResourceBudget();
}

function brushOf(
  kind: BrushStrategyId = "pencil",
  family: BrushFamily = "pencil",
): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `authority-${kind}`,
    presetVersion: 1,
    family,
    color: "#343434",
    size: 14,
    opacity: 0.8,
    smoothing: { mode: "average", amount: 0.3 },
    dynamics: {
      pressureSize: { enabled: true, minimumFactor: 0.5, maximumFactor: 1.5, curve: LINEAR },
      pressureOpacity: { enabled: false, minimumFactor: 1, maximumFactor: 1, curve: LINEAR },
    },
    renderer: { version: 1, kind },
  });
}

function sample(index: number, overrides: Partial<StrokePointInput> = {}): StrokePointInput {
  return {
    x: 40 + index * 7,
    y: 90 + Math.sin(index / 4) * 18,
    timestamp: index * 6,
    pressure: 0.25 + (index % 5) / 10,
    tiltX: 2,
    tiltY: -3,
    twist: index % 360,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    altitudeAngle: 0.9,
    azimuthAngle: 1.4,
    ...overrides,
  };
}

/** The same sample as a mouse reports it: neither optional angle present. */
function mouseSample(index: number): StrokePointInput {
  const { x, y, timestamp, pressure, tiltX, tiltY, twist, button, buttons } = sample(index);
  return { x, y, timestamp, pressure, tiltX, tiltY, twist, button, buttons, pointerType: "mouse" };
}

function strokeOf(samples = 6, brush: ResolvedBrushSnapshot = brushOf()): Stroke {
  const builder = new StrokeBuilder({
    id: "authority-stroke",
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "average" }),
  });
  for (let index = 0; index < samples; index += 1) builder.addPoint(sample(index));
  return builder.finalize();
}

/** One Stroke instance whose fields are whatever the caller says they are. */
function forge(overrides: Readonly<Record<string, unknown>>, base = strokeOf()): Stroke {
  const forged = Object.create(Stroke.prototype) as Record<string, unknown>;
  for (const key of [
    "id",
    "timestamp",
    "points",
    "sourceSamples",
    "style",
    "brush",
    "metrics",
    "statistics",
  ]) {
    forged[key] = (base as unknown as Record<string, unknown>)[key];
  }
  Object.assign(forged, overrides);
  return forged as unknown as Stroke;
}

/** The same Stroke with one sample field replaced, by index and collection. */
function forgeSample(
  collection: "points" | "sourceSamples",
  index: number,
  overrides: Readonly<Record<string, unknown>>,
): Stroke {
  const base = strokeOf();
  const source = base[collection];
  const replaced = source.map((value, position) =>
    position === index ? { ...value, ...overrides } : value,
  );
  return forge({ [collection]: replaced }, base);
}

function forgeNested(field: "style" | "brush" | "metrics" | "statistics", patch: unknown): Stroke {
  const base = strokeOf();
  return forge({ [field]: { ...(base[field] as unknown as object), ...(patch as object) } }, base);
}

interface Refusal {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function refusal(run: () => unknown): Refusal {
  try {
    run();
  } catch (error) {
    if (error instanceof FolioProjectCodecError) {
      return { code: error.code, path: error.path, message: error.message };
    }
    throw error;
  }
  throw new Error("Expected the codec to refuse this input.");
}

function encodeRefusal(stroke: Stroke, resources = budget()): Refusal {
  return refusal(() => encodeStroke(stroke, "$.stroke", resources));
}

function encoded(stroke = strokeOf()): SerializedStroke {
  return encodeStroke(stroke, "$.stroke", budget());
}

/** A JSON-safe clone of a valid encoded stroke, with one thing wrong with it. */
function damaged(mutate: (value: Record<string, unknown>) => void): unknown {
  const clone = JSON.parse(JSON.stringify(encoded())) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

function decodeRefusal(value: unknown, resources = budget()): Refusal {
  return refusal(() => decodeStroke(value, "$.stroke", resources));
}

describe("the model owns what a drawing is not allowed to be", () => {
  it("refuses a sample the pointer could not have produced", () => {
    const builder = new StrokeBuilder({ id: "s", timestamp: 0, brush: brushOf() });
    expect(() => builder.addPoint(sample(0, { pressure: 1.5 }))).toThrow(InkError);
    expect(() => builder.addPoint(sample(0, { pressure: -0.1 }))).toThrow(InkError);
    expect(() => builder.addPoint(sample(0, { x: Number.NaN }))).toThrow(InkError);
    expect(() => builder.addPoint(sample(0, { timestamp: Number.POSITIVE_INFINITY }))).toThrow(
      InkError,
    );
    expect(() => builder.addPoint(sample(0, { twist: Number.NaN }))).toThrow(InkError);
    expect(() => builder.addPoint(sample(0, { altitudeAngle: Number.NaN }))).toThrow(InkError);
  });

  it("refuses a timestamp that goes backwards, at the sample that does it", () => {
    const builder = new StrokeBuilder({ id: "s", timestamp: 0, brush: brushOf() });
    builder.addPoint(sample(0, { timestamp: 100 }));
    builder.addPoint(sample(1, { timestamp: 120 }));
    expect(() => builder.addPoint(sample(2, { timestamp: 110 }))).toThrow(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }) as Error,
    );
  });

  it("refuses statistics that do not count the stroke's own points", () => {
    const valid = strokeOf(5);
    expect(
      () =>
        new Stroke({
          id: valid.id,
          timestamp: valid.timestamp,
          points: valid.points,
          sourceSamples: valid.sourceSamples,
          style: valid.style,
          brush: valid.brush,
          metrics: valid.metrics,
          statistics: { ...valid.statistics, pointCount: valid.points.length + 1 },
        }),
    ).toThrow(InkError);
  });

  it("keeps a smoothed position finite even when the interpolation hook is not", () => {
    // The sample is validated on the way in, but `points[].x` is the smoother's
    // output rather than the sample's. A hostile hook is the only way to reach
    // that value, and the smoother refuses it.
    const builder = new StrokeBuilder({
      id: "s",
      timestamp: 0,
      brush: brushOf(),
      smoother: new StrokeSmoother({
        mode: "catmull-rom",
        catmullRomHook: { name: "hostile", smooth: () => ({ x: Number.NaN, y: 0 }) },
      }),
    });
    expect(() => builder.addPoint(sample(0))).toThrow(InkError);
  });

  it("cannot express a cap or join other than round", () => {
    const stroke = strokeOf(3);
    const restyled = new Stroke({
      id: stroke.id,
      timestamp: stroke.timestamp,
      points: stroke.points,
      sourceSamples: stroke.sourceSamples,
      style: { ...stroke.style, lineCap: "butt" as "round", lineJoin: "miter" as "round" },
      brush: stroke.brush,
      metrics: stroke.metrics,
      statistics: stroke.statistics,
    });
    expect(restyled.style.lineCap).toBe("round");
    expect(restyled.style.lineJoin).toBe("round");
  });

  it("refuses a brush naming a strategy this build cannot draw", () => {
    expect(() =>
      createResolvedBrushSnapshot({
        ...brushOf(),
        renderer: { version: 2, kind: "pencil" },
      }),
    ).toThrow(TypeError);
    expect(() =>
      createResolvedBrushSnapshot({
        ...brushOf(),
        renderer: { version: 1, kind: "marker" as BrushStrategyId },
      }),
    ).toThrow(TypeError);
  });

  it("rebuilds every container, so a missing one cannot throw later", () => {
    // This is what lets the encoder read `point.delta.x` without a shape guard:
    // the constructor's own spreads leave a plain object behind whatever it was
    // given. The value is then wrong, and the encoder is what says so.
    const valid = strokeOf(2);
    const withoutDelta = valid.points.map((point) => {
      const copy: Record<string, unknown> = { ...point };
      delete copy.delta;
      return copy as unknown as (typeof valid.points)[number];
    });
    const stroke = new Stroke({
      id: valid.id,
      timestamp: valid.timestamp,
      points: withoutDelta,
      sourceSamples: valid.sourceSamples,
      style: valid.style,
      brush: valid.brush,
      metrics: valid.metrics,
      statistics: valid.statistics,
    });
    expect(typeof stroke.points[0]!.delta).toBe("object");
    expect(encodeRefusal(stroke)).toMatchObject({
      code: "INVALID_INK",
      path: "$.stroke.points[0].delta.x",
    });
  });

  it("accepts an id the format will not, which is why the encoder still checks", () => {
    // A 513-character id is a perfectly good id as far as a drawing is
    // concerned. It is the *file* that has a ceiling, so this is the class of
    // rule the codec owns outright and could not have delegated to the model.
    const valid = strokeOf(2);
    const long = "s".repeat(513);
    const stroke = new Stroke({
      id: long,
      timestamp: valid.timestamp,
      points: valid.points,
      sourceSamples: valid.sourceSamples,
      style: valid.style,
      brush: valid.brush,
      metrics: valid.metrics,
      statistics: valid.statistics,
    });
    expect(stroke.id).toBe(long);
    expect(encodeRefusal(stroke)).toMatchObject({
      code: "RESOURCE_LIMIT",
      path: "$.stroke.id",
    });
    expect(decodeRefusal(damaged((value) => void (value.id = long)))).toMatchObject({
      code: "RESOURCE_LIMIT",
      path: "$.stroke.id",
    });
  });
});

describe("the encoder refuses a Stroke it could not read back", () => {
  it.each([
    ["a blank id", forge({ id: "   " }), "INVALID_INK", "$.stroke.id"],
    [
      "a non-finite timestamp",
      forge({ timestamp: Number.POSITIVE_INFINITY }),
      "INVALID_INK",
      "$.stroke.timestamp",
    ],
    ["no processed points", forge({ points: [] }), "INVALID_INK", "$.stroke.points"],
    ["no source samples", forge({ sourceSamples: [] }), "INVALID_INK", "$.stroke.sourceSamples"],
    [
      "more points than one stroke may carry",
      forge({ points: new Array<unknown>(1_000_001) }),
      "RESOURCE_LIMIT",
      "$.stroke.points",
    ],
    [
      "more source samples than one stroke may carry",
      forge({ sourceSamples: new Array<unknown>(1_000_001) }),
      "RESOURCE_LIMIT",
      "$.stroke.sourceSamples",
    ],
    [
      "a not-a-number coordinate",
      forgeSample("points", 0, { x: Number.NaN }),
      "INVALID_INK",
      "$.stroke.points[0].x",
    ],
    [
      "an infinite coordinate",
      forgeSample("points", 2, { y: Number.POSITIVE_INFINITY }),
      "INVALID_INK",
      "$.stroke.points[2].y",
    ],
    [
      "a coordinate that is not a number at all",
      forgeSample("sourceSamples", 1, { x: "40" }),
      "INVALID_INK",
      "$.stroke.sourceSamples[1].x",
    ],
    [
      "pressure above one",
      forgeSample("points", 1, { pressure: 1.000_001 }),
      "INVALID_INK",
      "$.stroke.points[1].pressure",
    ],
    [
      "pressure below zero",
      forgeSample("sourceSamples", 3, { pressure: -0.000_001 }),
      "INVALID_INK",
      "$.stroke.sourceSamples[3].pressure",
    ],
    [
      "an unsupported pointer type",
      forgeSample("points", 0, { pointerType: "stylus" }),
      "INVALID_INK",
      "$.stroke.points[0].pointerType",
    ],
    [
      "a non-finite optional angle",
      forgeSample("points", 4, { altitudeAngle: Number.NaN }),
      "INVALID_INK",
      "$.stroke.points[4].altitudeAngle",
    ],
    [
      "an optional angle that is not a number",
      forgeSample("sourceSamples", 0, { azimuthAngle: "up" }),
      "INVALID_INK",
      "$.stroke.sourceSamples[0].azimuthAngle",
    ],
    [
      "a non-finite delta",
      forgeSample("points", 1, { delta: { x: 0, y: Number.NaN } }),
      "INVALID_INK",
      "$.stroke.points[1].delta.y",
    ],
    [
      "a delta that is not a position",
      forgeSample("points", 0, { delta: 5 }),
      "INVALID_INK",
      "$.stroke.points[0].delta.x",
    ],
    [
      "a negative velocity",
      forgeSample("points", 2, { velocity: -1 }),
      "INVALID_INK",
      "$.stroke.points[2].velocity",
    ],
    [
      "a non-finite acceleration",
      forgeSample("points", 3, { acceleration: Number.NEGATIVE_INFINITY }),
      "INVALID_INK",
      "$.stroke.points[3].acceleration",
    ],
    ["a blank colour", forgeNested("style", { color: " " }), "INVALID_INK", "$.stroke.style.color"],
    ["a zero width", forgeNested("style", { width: 0 }), "INVALID_INK", "$.stroke.style.width"],
    [
      "an opacity above one",
      forgeNested("style", { opacity: 1.5 }),
      "INVALID_INK",
      "$.stroke.style.opacity",
    ],
    [
      "a pressure flag that is not a boolean",
      forgeNested("style", { pressureEnabled: "yes" }),
      "INVALID_INK",
      "$.stroke.style.pressureEnabled",
    ],
    [
      "a cap that is not round",
      forgeNested("style", { lineCap: "butt" }),
      "INVALID_INK",
      "$.stroke.style",
    ],
    [
      "a brush texture id that is not a string",
      forgeNested("style", { brushTextureId: 7 }),
      "INVALID_INK",
      "$.stroke.style.brushTextureId",
    ],
    [
      "a brush schema version this build does not write",
      forgeNested("brush", { schemaVersion: 2 }),
      "INVALID_INK",
      "$.stroke.brush.schemaVersion",
    ],
    [
      "a preset id longer than the format allows",
      forgeNested("brush", { presetId: "p".repeat(513) }),
      "RESOURCE_LIMIT",
      "$.stroke.brush.presetId",
    ],
    [
      "a preset version of zero",
      forgeNested("brush", { presetVersion: 0 }),
      "INVALID_INK",
      "$.stroke.brush.presetVersion",
    ],
    [
      "an unsupported family",
      forgeNested("brush", { family: "airbrush" }),
      "INVALID_INK",
      "$.stroke.brush.family",
    ],
    ["a zero brush size", forgeNested("brush", { size: 0 }), "INVALID_INK", "$.stroke.brush.size"],
    [
      "an unsupported smoothing mode",
      forgeNested("brush", { smoothing: { mode: "spline", amount: 0.3 } }),
      "INVALID_INK",
      "$.stroke.brush.smoothing.mode",
    ],
    [
      "a smoothing amount outside the unit interval",
      forgeNested("brush", { smoothing: { mode: "average", amount: 2 } }),
      "INVALID_INK",
      "$.stroke.brush.smoothing.amount",
    ],
    [
      "pressure factors that are not ordered",
      forgeNested("brush", {
        dynamics: {
          pressureSize: { enabled: true, minimumFactor: 2, maximumFactor: 1, curve: LINEAR },
          pressureOpacity: { enabled: false, minimumFactor: 1, maximumFactor: 1, curve: LINEAR },
        },
      }),
      "INVALID_INK",
      "$.stroke.brush.dynamics.pressureSize",
    ],
    [
      "an unsupported pressure curve",
      forgeNested("brush", {
        dynamics: {
          pressureSize: {
            enabled: true,
            minimumFactor: 1,
            maximumFactor: 1,
            curve: { kind: "sine", exponent: 1 },
          },
          pressureOpacity: { enabled: false, minimumFactor: 1, maximumFactor: 1, curve: LINEAR },
        },
      }),
      "INVALID_INK",
      "$.stroke.brush.dynamics.pressureSize.curve.kind",
    ],
    [
      "a non-positive curve exponent",
      forgeNested("brush", {
        dynamics: {
          pressureSize: {
            enabled: true,
            minimumFactor: 1,
            maximumFactor: 1,
            curve: { kind: "power", exponent: 0 },
          },
          pressureOpacity: { enabled: false, minimumFactor: 1, maximumFactor: 1, curve: LINEAR },
        },
      }),
      "INVALID_INK",
      "$.stroke.brush.dynamics.pressureSize.curve.exponent",
    ],
    [
      "a strategy version this build cannot draw",
      forgeNested("brush", { renderer: { version: 2, kind: "pencil" } }),
      "INVALID_INK",
      "$.stroke.brush.renderer",
    ],
    [
      "a strategy name this build cannot draw",
      forgeNested("brush", { renderer: { version: 1, kind: "marker" } }),
      "INVALID_INK",
      "$.stroke.brush.renderer",
    ],
    [
      "a negative length",
      forgeNested("metrics", { length: -1 }),
      "INVALID_INK",
      "$.stroke.metrics",
    ],
    [
      "a negative duration",
      forgeNested("metrics", { duration: -1 }),
      "INVALID_INK",
      "$.stroke.metrics",
    ],
    [
      "bounds with a negative width",
      forgeNested("metrics", {
        bounds: { x: 0, y: 0, width: -1, height: 1, center: { x: 0, y: 0 } },
      }),
      "INVALID_INK",
      "$.stroke.metrics.bounds",
    ],
    [
      "a dirty rectangle with a non-finite origin",
      forgeNested("metrics", {
        dirtyRect: { x: Number.NaN, y: 0, width: 1, height: 1 },
      }),
      "INVALID_INK",
      "$.stroke.metrics.dirtyRect.x",
    ],
    [
      "a centre that is not a position",
      forgeNested("metrics", { center: { x: 0, y: "0" } }),
      "INVALID_INK",
      "$.stroke.metrics.center.y",
    ],
    [
      "statistics that count the wrong number of points",
      forgeNested("statistics", { pointCount: 99 }),
      "INVALID_INK",
      "$.stroke.statistics.pointCount",
    ],
    [
      "a point count that is not an integer",
      forgeNested("statistics", { pointCount: 6.5 }),
      "INVALID_INK",
      "$.stroke.statistics.pointCount",
    ],
    [
      "pressure statistics that disagree with each other",
      forgeNested("statistics", {
        minimumPressure: 0.9,
        averagePressure: 0.5,
        maximumPressure: 1,
      }),
      "INVALID_INK",
      "$.stroke.statistics",
    ],
    [
      "velocity statistics that disagree with each other",
      forgeNested("statistics", {
        minimumVelocity: 0,
        averageVelocity: 10,
        maximumVelocity: 1,
      }),
      "INVALID_INK",
      "$.stroke.statistics",
    ],
    [
      "a negative acceleration statistic",
      forgeNested("statistics", { maximumAcceleration: -1 }),
      "INVALID_INK",
      "$.stroke.statistics.maximumAcceleration",
    ],
    [
      "a pressure statistic outside the unit interval",
      forgeNested("statistics", {
        minimumPressure: 0,
        averagePressure: 0.5,
        maximumPressure: 1.2,
      }),
      "INVALID_INK",
      "$.stroke.statistics.maximumPressure",
    ],
  ])("refuses %s", (_label, stroke, code, path) => {
    expect(encodeRefusal(stroke as Stroke)).toMatchObject({ code, path });
  });

  it("refuses points whose timestamps go backwards, naming the sample that does", () => {
    const base = strokeOf(6);
    const points = base.points.map((point, index) =>
      index === 3 ? { ...point, timestamp: point.timestamp - 1000 } : point,
    );
    expect(encodeRefusal(forge({ points }, base))).toMatchObject({
      code: "INVALID_INK",
      path: "$.stroke.points[3].timestamp",
    });
  });

  it("refuses source samples whose timestamps go backwards", () => {
    const base = strokeOf(6);
    const sourceSamples = base.sourceSamples.map((value, index) =>
      index === 2 ? { ...value, timestamp: value.timestamp - 1000 } : value,
    );
    expect(encodeRefusal(forge({ sourceSamples }, base))).toMatchObject({
      code: "INVALID_INK",
      path: "$.stroke.sourceSamples[2].timestamp",
    });
  });

  it("reports a bad value before an ordering fault, the way the decoder does", () => {
    const base = strokeOf(6);
    const points = base.points.map((point, index) => {
      if (index === 2) return { ...point, timestamp: point.timestamp - 1000 };
      if (index === 4) return { ...point, pressure: 4 };
      return point;
    });
    expect(encodeRefusal(forge({ points }, base))).toMatchObject({
      path: "$.stroke.points[4].pressure",
    });
  });

  it("refuses a colour longer than the format's string ceiling", () => {
    const stroke = forgeNested("style", { color: `#${"a".repeat(1024 * 1024)}` });
    expect(encodeRefusal(stroke)).toMatchObject({
      code: "RESOURCE_LIMIT",
      path: "$.stroke.style.color",
    });
  });

  it("still counts a stroke's samples against the project's budget", () => {
    const resources = budget();
    const stroke = strokeOf(6);
    encodeStroke(stroke, "$.stroke", resources);
    expect(resources.inkSampleCount).toBe(stroke.points.length + stroke.sourceSamples.length);
  });

  it("refuses a stroke that would take the project past its sample ceiling", () => {
    const resources = budget();
    resources.inkSampleCount = 10_000_000;
    expect(encodeRefusal(strokeOf(6), resources)).toMatchObject({
      code: "RESOURCE_LIMIT",
      path: "$.stroke",
    });
  });

  it("refuses anything that is not a finalized Stroke at all", () => {
    for (const value of [null, undefined, {}, [], "stroke", 7, encoded()]) {
      expect(refusal(() => encodeStroke(value, "$.stroke", budget()))).toMatchObject({
        code: "INVALID_INK",
        path: "$.stroke",
      });
    }
  });
});

describe("the decoder refuses a malformed encoded Stroke, unchanged", () => {
  it.each([
    [
      "a missing field",
      (value: Record<string, unknown>) => void delete value.points,
      "INVALID_INK",
      "$.stroke.points",
    ],
    [
      "a field this format does not have",
      (value: Record<string, unknown>) => void (value.extra = 1),
      "INVALID_INK",
      "$.stroke.extra",
    ],
    [
      "a blank id",
      (value: Record<string, unknown>) => void (value.id = "  "),
      "INVALID_INK",
      "$.stroke.id",
    ],
    [
      "a timestamp that is not a number",
      (value: Record<string, unknown>) => void (value.timestamp = "0"),
      "INVALID_INK",
      "$.stroke.timestamp",
    ],
    [
      "a timestamp that parsed to infinity",
      // `1e999` is a legal JSON number and a legal thing for a file to contain.
      (value: Record<string, unknown>) =>
        void (value.timestamp = (JSON.parse('{"v":1e999}') as { v: number }).v),
      "INVALID_INK",
      "$.stroke.timestamp",
    ],
    [
      "an empty point array",
      (value: Record<string, unknown>) => void (value.points = []),
      "INVALID_INK",
      "$.stroke.points",
    ],
    [
      "an empty source sample array",
      (value: Record<string, unknown>) => void (value.sourceSamples = []),
      "INVALID_INK",
      "$.stroke.sourceSamples",
    ],
    [
      "points that are not an array",
      (value: Record<string, unknown>) => void (value.points = {}),
      "INVALID_INK",
      "$.stroke.points",
    ],
    [
      "more points than one stroke may carry",
      (value: Record<string, unknown>) => void (value.points = new Array<unknown>(1_000_001)),
      "RESOURCE_LIMIT",
      "$.stroke.points",
    ],
    [
      "a sample that is not an object",
      (value: Record<string, unknown>) => void ((value.sourceSamples as unknown[])[0] = 7),
      "INVALID_INK",
      "$.stroke.sourceSamples[0]",
    ],
    [
      "a sample missing a field",
      (value: Record<string, unknown>) =>
        void delete (value.points as Record<string, unknown>[])[0]!.twist,
      "INVALID_INK",
      "$.stroke.points[0].twist",
    ],
    [
      "a sample carrying a field this format does not have",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[0]!.jitter = 1),
      "INVALID_INK",
      "$.stroke.points[0].jitter",
    ],
    [
      "an infinite coordinate",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[1]!.x = (
          JSON.parse('{"v":1e999}') as { v: number }
        ).v),
      "INVALID_INK",
      "$.stroke.points[1].x",
    ],
    [
      "pressure above one",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[1]!.pressure = 1.5),
      "INVALID_INK",
      "$.stroke.points[1].pressure",
    ],
    [
      "an unsupported pointer type",
      (value: Record<string, unknown>) =>
        void ((value.sourceSamples as Record<string, unknown>[])[0]!.pointerType = "stylus"),
      "INVALID_INK",
      "$.stroke.sourceSamples[0].pointerType",
    ],
    [
      "a negative velocity",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[2]!.velocity = -1),
      "INVALID_INK",
      "$.stroke.points[2].velocity",
    ],
    [
      "a delta that is not a position",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[0]!.delta = 5),
      "INVALID_INK",
      "$.stroke.points[0].delta",
    ],
    [
      "an optional angle that is not a number",
      (value: Record<string, unknown>) =>
        void ((value.points as Record<string, unknown>[])[0]!.altitudeAngle = "up"),
      "INVALID_INK",
      "$.stroke.points[0].altitudeAngle",
    ],
    [
      "timestamps that go backwards",
      (value: Record<string, unknown>) => {
        const points = value.points as { timestamp: number }[];
        const first = points[0];
        const fourth = points[3];
        if (first === undefined || fourth === undefined) throw new Error("fixture");
        fourth.timestamp = first.timestamp - 1000;
      },
      "INVALID_INK",
      "$.stroke.points[3].timestamp",
    ],
    [
      "statistics that count the wrong number of points",
      (value: Record<string, unknown>) =>
        void ((value.statistics as Record<string, unknown>).pointCount = 99),
      "INVALID_INK",
      "$.stroke.statistics.pointCount",
    ],
    [
      "pressure statistics that disagree with each other",
      (value: Record<string, unknown>) => {
        const statistics = value.statistics as Record<string, number>;
        statistics.minimumPressure = 0.9;
        statistics.averagePressure = 0.5;
        statistics.maximumPressure = 1;
      },
      "INVALID_INK",
      "$.stroke.statistics",
    ],
    [
      "a cap that is not round",
      (value: Record<string, unknown>) =>
        void ((value.style as Record<string, unknown>).lineCap = "butt"),
      "INVALID_INK",
      "$.stroke.style",
    ],
    [
      "a zero width",
      (value: Record<string, unknown>) => void ((value.style as Record<string, unknown>).width = 0),
      "INVALID_INK",
      "$.stroke.style.width",
    ],
    [
      "a brush schema version this build does not read",
      (value: Record<string, unknown>) =>
        void ((value.brush as Record<string, unknown>).schemaVersion = 2),
      "INVALID_INK",
      "$.stroke.brush.schemaVersion",
    ],
    [
      "an unsupported family",
      (value: Record<string, unknown>) =>
        void ((value.brush as Record<string, unknown>).family = "airbrush"),
      "INVALID_INK",
      "$.stroke.brush.family",
    ],
    [
      "an unsupported smoothing mode",
      (value: Record<string, unknown>) =>
        void (((value.brush as Record<string, unknown>).smoothing as Record<string, unknown>).mode =
          "spline"),
      "INVALID_INK",
      "$.stroke.brush.smoothing.mode",
    ],
    [
      "a strategy version this build cannot draw",
      (value: Record<string, unknown>) =>
        void ((
          (value.brush as Record<string, unknown>).renderer as Record<string, unknown>
        ).version = 2),
      "INVALID_INK",
      "$.stroke.brush.renderer",
    ],
    [
      "a strategy name this build cannot draw",
      (value: Record<string, unknown>) =>
        void (((value.brush as Record<string, unknown>).renderer as Record<string, unknown>).kind =
          "marker"),
      "INVALID_INK",
      "$.stroke.brush.renderer",
    ],
    [
      "a negative length",
      (value: Record<string, unknown>) =>
        void ((value.metrics as Record<string, unknown>).length = -1),
      "INVALID_INK",
      "$.stroke.metrics",
    ],
    [
      "bounds with a negative width",
      (value: Record<string, unknown>) =>
        void (((value.metrics as Record<string, unknown>).bounds as Record<string, unknown>).width =
          -1),
      "INVALID_INK",
      "$.stroke.metrics.bounds",
    ],
    ["a stroke that is not an object", () => undefined, "INVALID_INK", "$.stroke"],
  ])("refuses %s", (label, mutate, code, path) => {
    const value =
      label === "a stroke that is not an object" ? "not a stroke" : damaged(mutate as never);
    expect(decodeRefusal(value)).toMatchObject({ code, path });
  });

  it("refuses a document that would take the project past its sample ceiling", () => {
    const resources = budget();
    resources.inkSampleCount = 10_000_000;
    expect(decodeRefusal(encoded(), resources)).toMatchObject({ code: "RESOURCE_LIMIT" });
  });
});

describe("what the encoder writes, the decoder accepts", () => {
  const STRATEGIES: readonly Readonly<{ kind: BrushStrategyId; family: BrushFamily }>[] = [
    { kind: "centerline", family: "pen" },
    { kind: "outline", family: "pen" },
    { kind: "technical-pen", family: "pen" },
    { kind: "pressure-pen", family: "pen" },
    { kind: "pencil", family: "pencil" },
  ];

  it.each(STRATEGIES.map((strategy) => [`${strategy.kind}@1`, strategy] as const))(
    "round-trips %s to the same stroke and the same bytes",
    (_label, strategy) => {
      const original = strokeOf(9, brushOf(strategy.kind, strategy.family));
      const once = encodeStroke(original, "$.stroke", budget());
      const reopened = decodeStroke(once, "$.stroke", budget());
      const twice = encodeStroke(reopened, "$.stroke", budget());
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      expect(reopened.brush.renderer).toEqual({ version: 1, kind: strategy.kind });
      expect(reopened.points).toEqual(original.points);
      expect(reopened.sourceSamples).toEqual(original.sourceSamples);
      expect(reopened.statistics).toEqual(original.statistics);
      expect(reopened.metrics).toEqual(original.metrics);
      expect(reopened.style).toEqual(original.style);
    },
  );

  it("round-trips a one-sample tap", () => {
    const original = strokeOf(1);
    const once = encodeStroke(original, "$.stroke", budget());
    const twice = encodeStroke(decodeStroke(once, "$.stroke", budget()), "$.stroke", budget());
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("round-trips the brush a Stroke built without one falls back to", () => {
    const builder = new StrokeBuilder({ id: "legacy", timestamp: 0 });
    for (let index = 0; index < 5; index += 1) builder.addPoint(sample(index));
    const original = builder.finalize();
    expect(original.brush.presetId).toBe("legacy-stroke-style");
    const once = encodeStroke(original, "$.stroke", budget());
    const twice = encodeStroke(decodeStroke(once, "$.stroke", budget()), "$.stroke", budget());
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("keeps an absent optional angle absent, and a present one present", () => {
    const builder = new StrokeBuilder({ id: "mouse", timestamp: 0, brush: brushOf() });
    for (let index = 0; index < 4; index += 1) builder.addPoint(mouseSample(index));
    const once = encodeStroke(builder.finalize(), "$.stroke", budget());
    expect(Object.prototype.hasOwnProperty.call(once.points[0]!, "altitudeAngle")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(encoded().points[0]!, "altitudeAngle")).toBe(true);
    const reopened = decodeStroke(once, "$.stroke", budget());
    expect(Object.prototype.hasOwnProperty.call(reopened.points[0]!, "altitudeAngle")).toBe(false);
  });

  it("writes a brush texture id when the style carries one", () => {
    const valid = strokeOf(3);
    const stroke = new Stroke({
      id: valid.id,
      timestamp: valid.timestamp,
      points: valid.points,
      sourceSamples: valid.sourceSamples,
      style: { ...valid.style, brushTextureId: "texture-graphite-v1" },
      brush: valid.brush,
      metrics: valid.metrics,
      statistics: valid.statistics,
    });
    const once = encodeStroke(stroke, "$.stroke", budget());
    expect(once.style.brushTextureId).toBe("texture-graphite-v1");
    const reopened = decodeStroke(once, "$.stroke", budget());
    expect(reopened.style.brushTextureId).toBe("texture-graphite-v1");
  });
});
