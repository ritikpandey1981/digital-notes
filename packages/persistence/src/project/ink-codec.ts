import {
  Stroke,
  createResolvedBrushSnapshot,
  isSupportedBrushStrategy,
  supportedBrushStrategies,
  type BrushPressureResponse,
  type BrushStrategyId,
  type ResolvedBrushSnapshot,
  type StrokeBounds,
  type StrokeData,
  type StrokeMetrics,
  type StrokePoint,
  type StrokePointInput,
  type StrokeStatistics,
  type StrokeStyle,
} from "@folio/ink";
import {
  PROJECT_LIMITS,
  addInkSampleCount,
  assertExactKeys,
  assertMaximumCount,
  constructOrFail,
  expectArray,
  expectBoolean,
  expectFiniteNumber,
  expectId,
  expectRecord,
  expectSafeInteger,
  expectString,
  fail,
  type ProjectResourceBudget,
} from "./project-validation";

interface SerializedStrokePointInput {
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly pointerType: "mouse" | "pen" | "touch";
  readonly button: number;
  readonly buttons: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
}

interface SerializedStrokePoint extends SerializedStrokePointInput {
  readonly delta: Readonly<{ x: number; y: number }>;
  readonly velocity: number;
  readonly acceleration: number;
}

export interface SerializedStroke {
  readonly id: string;
  readonly timestamp: number;
  readonly points: readonly SerializedStrokePoint[];
  readonly sourceSamples: readonly SerializedStrokePointInput[];
  readonly style: StrokeStyle;
  readonly brush: ResolvedBrushSnapshot;
  readonly metrics: StrokeMetrics;
  readonly statistics: StrokeStatistics;
}

/**
 * Encodes one finalized Stroke, after proving the Stroke itself is encodable.
 *
 * This used to encode first and then run the whole decode-side `parseStroke`
 * over its own output. That answered the right question the most expensive way
 * available: at thirty-five thousand samples it spent four `Set` allocations
 * and one rebuilt object per sample re-establishing the *shape* of an object
 * this function had just written field by field from typed model fields, and
 * only then looked at the values. Measured, it was the largest stage of a
 * recovery capture -- larger than `JSON.stringify`.
 *
 * So the shape is no longer re-derived and the values still are. Which fields
 * exist is this function's own doing and is asserted by the format's byte
 * corpus; what is in them is a property of the Stroke, and is checked on the
 * Stroke, where no intermediate object has to exist to be checked.
 *
 * {@link assertEncodableStroke} is what the encoder owes the decoder, not a
 * duplicate of it. The decoder keeps every rule it had, because the decoder is
 * where a file nobody in this process wrote arrives.
 */
export function encodeStroke(
  stroke: unknown,
  path: string,
  budget: ProjectResourceBudget,
): SerializedStroke {
  if (!(stroke instanceof Stroke)) {
    fail("INVALID_INK", path, "Ink artwork must contain a finalized Stroke instance.");
  }
  assertEncodableStroke(stroke, path, budget);
  return {
    brush: serializeBrush(stroke.brush),
    id: stroke.id,
    metrics: serializeMetrics(stroke.metrics),
    points: stroke.points.map(serializeProcessedPoint),
    sourceSamples: stroke.sourceSamples.map(serializeSourceSample),
    statistics: serializeStatistics(stroke.statistics),
    style: {
      ...(stroke.style.brushTextureId === undefined
        ? {}
        : { brushTextureId: stroke.style.brushTextureId }),
      color: stroke.style.color,
      lineCap: stroke.style.lineCap,
      lineJoin: stroke.style.lineJoin,
      opacity: stroke.style.opacity,
      pressureEnabled: stroke.style.pressureEnabled,
      width: stroke.style.width,
    },
    timestamp: stroke.timestamp,
  };
}

/**
 * Proves one in-memory Stroke is a stroke this format can write and read back.
 *
 * Every rule here is a rule {@link parseStroke} enforces on the way in, checked
 * against the model rather than against a transcription of it, so the two sides
 * cannot drift into disagreeing about what a `.folio` file may contain. A
 * project Folio writes and then refuses to open is the failure this prevents,
 * and it is worse than one it declines to write.
 *
 * It is not the first line of defence and does not pretend to be. Almost every
 * value below is already owned by a narrower boundary: `StrokeBuilder` validates
 * every sample as it arrives and refuses an out-of-order timestamp at the
 * source, `createStrokeStyle` and `createResolvedBrushSnapshot` run on every
 * Stroke the constructor builds, and the constructor itself now rejects
 * statistics that disagree with their own points. What is genuinely only knowable
 * here is the *format's* ceilings -- how many samples one stroke may carry, how
 * many a project may, how long an id or a colour may be -- because those are
 * properties of the file rather than of the drawing.
 *
 * The containers can be read without shape guards, and that is a property of
 * `Stroke` rather than an assumption: its constructor rebuilds `points`,
 * `sourceSamples`, `delta`, `metrics`, every bounds, `center`, `dirtyRect`,
 * `statistics`, `style` and `brush` through its own spreads and factories, so by
 * the time an instance exists each one is a plain object whose fields may be
 * wrong but whose absence cannot throw. The adversarial tests construct exactly
 * that: instances whose fields are wrong.
 */
function assertEncodableStroke(stroke: Stroke, path: string, budget: ProjectResourceBudget): void {
  expectId(stroke.id, `${path}.id`, "INVALID_INK");
  expectFiniteNumber(stroke.timestamp, `${path}.timestamp`, "INVALID_INK");
  // Asked the way the decoder asks it, including for the array itself: a
  // forged instance is the only way a Stroke can hold something that is not
  // one, and it should be refused rather than thrown over.
  const points: readonly StrokePoint[] = stroke.points;
  if (!Array.isArray(points)) fail("INVALID_INK", `${path}.points`, "Expected an array.");
  if (points.length === 0) {
    fail("INVALID_INK", `${path}.points`, "A finalized Stroke requires processed points.");
  }
  assertMaximumCount(
    points.length,
    PROJECT_LIMITS.pointsPerStroke,
    `${path}.points`,
    "Processed point count",
  );
  const sourceSamples: readonly StrokePointInput[] = stroke.sourceSamples;
  if (!Array.isArray(sourceSamples)) {
    fail("INVALID_INK", `${path}.sourceSamples`, "Expected an array.");
  }
  if (sourceSamples.length === 0) {
    fail("INVALID_INK", `${path}.sourceSamples`, "A finalized Stroke requires source samples.");
  }
  assertMaximumCount(
    sourceSamples.length,
    PROJECT_LIMITS.sourceSamplesPerStroke,
    `${path}.sourceSamples`,
    "Source sample count",
  );
  addInkSampleCount(budget, points.length + sourceSamples.length, path);

  // The two loops that used to allocate. Nothing in either of them builds an
  // object or a string unless it is about to throw.
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    assertEncodableSample(point, path, "points", index);
    const delta: Readonly<{ x?: unknown; y?: unknown }> = point.delta;
    if (!isFiniteNumber(delta.x)) failSample(path, "points", index, "delta.x", FINITE);
    if (!isFiniteNumber(delta.y)) failSample(path, "points", index, "delta.y", FINITE);
    const velocity = point.velocity;
    if (!isFiniteNumber(velocity)) failSample(path, "points", index, "velocity", FINITE);
    if (velocity < 0) {
      failSample(path, "points", index, "velocity", "Ink velocity cannot be negative.");
    }
    if (!isFiniteNumber(point.acceleration)) {
      failSample(path, "points", index, "acceleration", FINITE);
    }
  }
  for (let index = 0; index < sourceSamples.length; index += 1) {
    assertEncodableSample(sourceSamples[index]!, path, "sourceSamples", index);
  }
  // Separately, and after both loops, because that is the order the decoder
  // reports these in: a bad value anywhere is a bad value before an ordering
  // fault anywhere.
  assertOrderedTimestamps(points, `${path}.points`);
  assertOrderedTimestamps(sourceSamples, `${path}.sourceSamples`);

  assertEncodableStyle(stroke.style, `${path}.style`);
  assertEncodableBrush(stroke.brush, `${path}.brush`);
  assertEncodableMetrics(stroke.metrics, `${path}.metrics`);
  assertEncodableStatistics(stroke.statistics, `${path}.statistics`, points.length);
}

const FINITE = "Expected a finite number.";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Builds the path only when something is already going to be thrown. */
function failSample(
  path: string,
  collection: "points" | "sourceSamples",
  index: number,
  field: string,
  message: string,
): never {
  fail("INVALID_INK", `${path}.${collection}[${String(index)}].${field}`, message);
}

function assertEncodableSample(
  sample: StrokePointInput,
  path: string,
  collection: "points" | "sourceSamples",
  index: number,
): void {
  const pressure = sample.pressure;
  if (!isFiniteNumber(pressure)) failSample(path, collection, index, "pressure", FINITE);
  if (pressure < 0 || pressure > 1) {
    failSample(path, collection, index, "pressure", "Ink pressure must be between zero and one.");
  }
  const pointerType: unknown = sample.pointerType;
  if (pointerType !== "mouse" && pointerType !== "pen" && pointerType !== "touch") {
    failSample(path, collection, index, "pointerType", "Ink pointer type is not supported.");
  }
  if (!isFiniteNumber(sample.x)) failSample(path, collection, index, "x", FINITE);
  if (!isFiniteNumber(sample.y)) failSample(path, collection, index, "y", FINITE);
  if (!isFiniteNumber(sample.timestamp)) failSample(path, collection, index, "timestamp", FINITE);
  if (!isFiniteNumber(sample.tiltX)) failSample(path, collection, index, "tiltX", FINITE);
  if (!isFiniteNumber(sample.tiltY)) failSample(path, collection, index, "tiltY", FINITE);
  if (!isFiniteNumber(sample.twist)) failSample(path, collection, index, "twist", FINITE);
  if (!isFiniteNumber(sample.button)) failSample(path, collection, index, "button", FINITE);
  if (!isFiniteNumber(sample.buttons)) failSample(path, collection, index, "buttons", FINITE);
  // Undefined is the one value the encoder answers by omitting the key, which
  // is exactly what the decoder's `hasOwnProperty` test accepts. Anything else
  // reaches the file and has to be a finite number.
  if (sample.altitudeAngle !== undefined && !isFiniteNumber(sample.altitudeAngle)) {
    failSample(path, collection, index, "altitudeAngle", FINITE);
  }
  if (sample.azimuthAngle !== undefined && !isFiniteNumber(sample.azimuthAngle)) {
    failSample(path, collection, index, "azimuthAngle", FINITE);
  }
}

function assertEncodableStyle(style: StrokeStyle, path: string): void {
  expectString(style.color, `${path}.color`, "INVALID_INK", { nonBlank: true });
  const width = expectFiniteNumber(style.width, `${path}.width`, "INVALID_INK");
  if (width <= 0) fail("INVALID_INK", `${path}.width`, "Stroke width must be positive.");
  const opacity = expectFiniteNumber(style.opacity, `${path}.opacity`, "INVALID_INK");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_INK", `${path}.opacity`, "Stroke opacity must be between zero and one.");
  }
  expectBoolean(style.pressureEnabled, `${path}.pressureEnabled`, "INVALID_INK");
  if (style.lineCap !== "round" || style.lineJoin !== "round") {
    fail("INVALID_INK", path, "Stroke cap and join must use the current round contract.");
  }
  if (style.brushTextureId !== undefined) {
    expectString(style.brushTextureId, `${path}.brushTextureId`, "INVALID_INK");
  }
}

function assertEncodableBrush(brush: ResolvedBrushSnapshot, path: string): void {
  if (brush.schemaVersion !== 1) {
    fail("INVALID_INK", `${path}.schemaVersion`, "Resolved brush schema version must be 1.");
  }
  expectId(brush.presetId, `${path}.presetId`, "INVALID_INK");
  const presetVersion = expectSafeInteger(
    brush.presetVersion,
    `${path}.presetVersion`,
    "INVALID_INK",
  );
  if (presetVersion <= 0) {
    fail("INVALID_INK", `${path}.presetVersion`, "Brush preset version must be positive.");
  }
  const family: unknown = brush.family;
  if (family !== "pencil" && family !== "pen" && family !== "marker" && family !== "highlighter") {
    fail("INVALID_INK", `${path}.family`, "Resolved brush family is not supported.");
  }
  expectString(brush.color, `${path}.color`, "INVALID_INK", { nonBlank: true });
  const size = expectFiniteNumber(brush.size, `${path}.size`, "INVALID_INK");
  if (size <= 0) fail("INVALID_INK", `${path}.size`, "Resolved brush size must be positive.");
  const opacity = expectFiniteNumber(brush.opacity, `${path}.opacity`, "INVALID_INK");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_INK", `${path}.opacity`, "Resolved brush opacity must be between zero and one.");
  }
  const smoothingMode: unknown = brush.smoothing.mode;
  if (
    smoothingMode !== "none" &&
    smoothingMode !== "average" &&
    smoothingMode !== "catmull-rom" &&
    smoothingMode !== "bezier"
  ) {
    fail("INVALID_INK", `${path}.smoothing.mode`, "Brush smoothing mode is not supported.");
  }
  const smoothingAmount = expectFiniteNumber(
    brush.smoothing.amount,
    `${path}.smoothing.amount`,
    "INVALID_INK",
  );
  if (smoothingAmount < 0 || smoothingAmount > 1) {
    fail("INVALID_INK", `${path}.smoothing.amount`, "Brush smoothing amount is invalid.");
  }
  assertEncodablePressureResponse(brush.dynamics.pressureSize, `${path}.dynamics.pressureSize`);
  assertEncodablePressureResponse(
    brush.dynamics.pressureOpacity,
    `${path}.dynamics.pressureOpacity`,
  );
  // The same vocabulary the decoder refuses by name, asked the same way, so a
  // strategy this build cannot draw cannot be written either.
  if (!isSupportedBrushStrategy(brush.renderer.kind, brush.renderer.version)) {
    fail("INVALID_INK", `${path}.renderer`, "Resolved brush render strategy is not supported.", {
      kind: brush.renderer.kind,
      version: brush.renderer.version,
      supported: supportedBrushStrategies(),
    });
  }
}

function assertEncodablePressureResponse(response: BrushPressureResponse, path: string): void {
  const minimumFactor = expectFiniteNumber(
    response.minimumFactor,
    `${path}.minimumFactor`,
    "INVALID_INK",
  );
  const maximumFactor = expectFiniteNumber(
    response.maximumFactor,
    `${path}.maximumFactor`,
    "INVALID_INK",
  );
  if (minimumFactor < 0 || maximumFactor < minimumFactor) {
    fail("INVALID_INK", path, "Pressure factors must be non-negative and ordered.");
  }
  const curveKind: unknown = response.curve.kind;
  if (curveKind !== "linear" && curveKind !== "power") {
    fail("INVALID_INK", `${path}.curve.kind`, "Pressure curve kind is not supported.");
  }
  const exponent = expectFiniteNumber(
    response.curve.exponent,
    `${path}.curve.exponent`,
    "INVALID_INK",
  );
  if (exponent <= 0) {
    fail("INVALID_INK", `${path}.curve.exponent`, "Pressure exponent must be positive.");
  }
  expectBoolean(response.enabled, `${path}.enabled`, "INVALID_INK");
}

function assertEncodableMetrics(metrics: StrokeMetrics, path: string): void {
  const length = expectFiniteNumber(metrics.length, `${path}.length`, "INVALID_INK");
  const duration = expectFiniteNumber(metrics.duration, `${path}.duration`, "INVALID_INK");
  if (length < 0 || duration < 0) {
    fail("INVALID_INK", path, "Stroke length and duration must be non-negative.");
  }
  assertEncodableBounds(metrics.bounds, `${path}.bounds`);
  assertEncodableBounds(metrics.inflatedBounds, `${path}.inflatedBounds`);
  assertEncodableRect(metrics.dirtyRect, `${path}.dirtyRect`);
  assertEncodablePosition(metrics.center, `${path}.center`);
}

function assertEncodableBounds(bounds: StrokeBounds, path: string): void {
  assertEncodableRect(bounds, path);
  assertEncodablePosition(bounds.center, `${path}.center`);
}

function assertEncodableRect(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  path: string,
): void {
  const width = expectFiniteNumber(rect.width, `${path}.width`, "INVALID_INK");
  const height = expectFiniteNumber(rect.height, `${path}.height`, "INVALID_INK");
  if (width < 0 || height < 0) {
    fail("INVALID_INK", path, "Rectangle dimensions must be non-negative.");
  }
  expectFiniteNumber(rect.x, `${path}.x`, "INVALID_INK");
  expectFiniteNumber(rect.y, `${path}.y`, "INVALID_INK");
}

function assertEncodablePosition(position: Readonly<{ x: number; y: number }>, path: string): void {
  expectFiniteNumber(position.x, `${path}.x`, "INVALID_INK");
  expectFiniteNumber(position.y, `${path}.y`, "INVALID_INK");
}

function assertEncodableStatistics(
  statistics: StrokeStatistics,
  path: string,
  pointCount: number,
): void {
  const declared = expectSafeInteger(statistics.pointCount, `${path}.pointCount`, "INVALID_INK");
  if (declared !== pointCount) {
    fail(
      "INVALID_INK",
      `${path}.pointCount`,
      "Stroke point count does not match processed points.",
    );
  }
  const averagePressure = expectUnitInterval(statistics.averagePressure, `${path}.averagePressure`);
  const minimumPressure = expectUnitInterval(statistics.minimumPressure, `${path}.minimumPressure`);
  const maximumPressure = expectUnitInterval(statistics.maximumPressure, `${path}.maximumPressure`);
  if (minimumPressure > averagePressure || averagePressure > maximumPressure) {
    fail("INVALID_INK", path, "Stroke pressure statistics are inconsistent.");
  }
  const averageVelocity = expectNonNegative(statistics.averageVelocity, `${path}.averageVelocity`);
  const minimumVelocity = expectNonNegative(statistics.minimumVelocity, `${path}.minimumVelocity`);
  const maximumVelocity = expectNonNegative(statistics.maximumVelocity, `${path}.maximumVelocity`);
  if (minimumVelocity > averageVelocity || averageVelocity > maximumVelocity) {
    fail("INVALID_INK", path, "Stroke velocity statistics are inconsistent.");
  }
  expectNonNegative(statistics.averageAcceleration, `${path}.averageAcceleration`);
  expectNonNegative(statistics.maximumAcceleration, `${path}.maximumAcceleration`);
}

export function decodeStroke(value: unknown, path: string, budget: ProjectResourceBudget): Stroke {
  const data = parseStroke(value, path, budget);
  return constructOrFail(
    "INVALID_INK",
    path,
    "Stroke data failed Ink validation.",
    () => new Stroke(data),
  );
}

function parseStroke(value: unknown, path: string, budget: ProjectResourceBudget): StrokeData {
  const record = expectRecord(value, path, "INVALID_INK", "Stroke must be an object.");
  assertExactKeys(
    record,
    ["id", "timestamp", "points", "sourceSamples", "style", "brush", "metrics", "statistics"],
    [],
    path,
    "INVALID_INK",
  );
  const id = expectId(record.id, `${path}.id`, "INVALID_INK");
  const timestamp = expectFiniteNumber(record.timestamp, `${path}.timestamp`, "INVALID_INK");
  const pointValues = expectArray(record.points, `${path}.points`, "INVALID_INK");
  if (pointValues.length === 0) {
    fail("INVALID_INK", `${path}.points`, "A finalized Stroke requires processed points.");
  }
  assertMaximumCount(
    pointValues.length,
    PROJECT_LIMITS.pointsPerStroke,
    `${path}.points`,
    "Processed point count",
  );
  const sourceValues = expectArray(record.sourceSamples, `${path}.sourceSamples`, "INVALID_INK");
  if (sourceValues.length === 0) {
    fail("INVALID_INK", `${path}.sourceSamples`, "A finalized Stroke requires source samples.");
  }
  assertMaximumCount(
    sourceValues.length,
    PROJECT_LIMITS.sourceSamplesPerStroke,
    `${path}.sourceSamples`,
    "Source sample count",
  );
  addInkSampleCount(budget, pointValues.length + sourceValues.length, path);

  const points = pointValues.map((point, index) =>
    parseProcessedPoint(point, `${path}.points[${index}]`),
  );
  const sourceSamples = sourceValues.map((sample, index) =>
    parseSourceSample(sample, `${path}.sourceSamples[${index}]`),
  );
  assertOrderedTimestamps(points, `${path}.points`);
  assertOrderedTimestamps(sourceSamples, `${path}.sourceSamples`);
  const style = parseStrokeStyle(record.style, `${path}.style`);
  const brush = parseBrush(record.brush, `${path}.brush`);
  const metrics = parseMetrics(record.metrics, `${path}.metrics`);
  const statistics = parseStatistics(record.statistics, `${path}.statistics`, points.length);
  return { id, timestamp, points, sourceSamples, style, brush, metrics, statistics };
}

function serializeSourceSample(sample: StrokePointInput): SerializedStrokePointInput {
  return {
    ...(sample.altitudeAngle === undefined ? {} : { altitudeAngle: sample.altitudeAngle }),
    ...(sample.azimuthAngle === undefined ? {} : { azimuthAngle: sample.azimuthAngle }),
    button: sample.button,
    buttons: sample.buttons,
    pointerType: sample.pointerType,
    pressure: sample.pressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
    timestamp: sample.timestamp,
    twist: sample.twist,
    x: sample.x,
    y: sample.y,
  };
}

function serializeProcessedPoint(point: StrokePoint): SerializedStrokePoint {
  return {
    acceleration: point.acceleration,
    ...(point.altitudeAngle === undefined ? {} : { altitudeAngle: point.altitudeAngle }),
    ...(point.azimuthAngle === undefined ? {} : { azimuthAngle: point.azimuthAngle }),
    button: point.button,
    buttons: point.buttons,
    delta: { x: point.delta.x, y: point.delta.y },
    pointerType: point.pointerType,
    pressure: point.pressure,
    tiltX: point.tiltX,
    tiltY: point.tiltY,
    timestamp: point.timestamp,
    twist: point.twist,
    velocity: point.velocity,
    x: point.x,
    y: point.y,
  };
}

function parseSourceSample(value: unknown, path: string): StrokePointInput {
  const record = expectRecord(value, path, "INVALID_INK", "Ink sample must be an object.");
  assertExactKeys(
    record,
    [
      "x",
      "y",
      "timestamp",
      "pressure",
      "tiltX",
      "tiltY",
      "twist",
      "pointerType",
      "button",
      "buttons",
    ],
    ["altitudeAngle", "azimuthAngle"],
    path,
    "INVALID_INK",
  );
  const pressure = expectFiniteNumber(record.pressure, `${path}.pressure`, "INVALID_INK");
  if (pressure < 0 || pressure > 1) {
    fail("INVALID_INK", `${path}.pressure`, "Ink pressure must be between zero and one.");
  }
  const pointerType = record.pointerType;
  if (pointerType !== "mouse" && pointerType !== "pen" && pointerType !== "touch") {
    fail("INVALID_INK", `${path}.pointerType`, "Ink pointer type is not supported.");
  }
  return {
    x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_INK"),
    y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_INK"),
    timestamp: expectFiniteNumber(record.timestamp, `${path}.timestamp`, "INVALID_INK"),
    pressure,
    tiltX: expectFiniteNumber(record.tiltX, `${path}.tiltX`, "INVALID_INK"),
    tiltY: expectFiniteNumber(record.tiltY, `${path}.tiltY`, "INVALID_INK"),
    twist: expectFiniteNumber(record.twist, `${path}.twist`, "INVALID_INK"),
    pointerType,
    button: expectFiniteNumber(record.button, `${path}.button`, "INVALID_INK"),
    buttons: expectFiniteNumber(record.buttons, `${path}.buttons`, "INVALID_INK"),
    ...(Object.prototype.hasOwnProperty.call(record, "altitudeAngle")
      ? {
          altitudeAngle: expectFiniteNumber(
            record.altitudeAngle,
            `${path}.altitudeAngle`,
            "INVALID_INK",
          ),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(record, "azimuthAngle")
      ? {
          azimuthAngle: expectFiniteNumber(
            record.azimuthAngle,
            `${path}.azimuthAngle`,
            "INVALID_INK",
          ),
        }
      : {}),
  };
}

function parseProcessedPoint(value: unknown, path: string): StrokePoint {
  const record = expectRecord(value, path, "INVALID_INK", "Processed Ink point must be an object.");
  assertExactKeys(
    record,
    [
      "x",
      "y",
      "timestamp",
      "pressure",
      "tiltX",
      "tiltY",
      "twist",
      "pointerType",
      "button",
      "buttons",
      "delta",
      "velocity",
      "acceleration",
    ],
    ["altitudeAngle", "azimuthAngle"],
    path,
    "INVALID_INK",
  );
  const sample = parseSourceSample(
    Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => key !== "delta" && key !== "velocity" && key !== "acceleration",
      ),
    ),
    path,
  );
  const delta = parsePosition(record.delta, `${path}.delta`);
  const velocity = expectFiniteNumber(record.velocity, `${path}.velocity`, "INVALID_INK");
  if (velocity < 0) fail("INVALID_INK", `${path}.velocity`, "Ink velocity cannot be negative.");
  return {
    ...sample,
    delta,
    velocity,
    acceleration: expectFiniteNumber(record.acceleration, `${path}.acceleration`, "INVALID_INK"),
  };
}

function parseStrokeStyle(value: unknown, path: string): StrokeStyle {
  const record = expectRecord(value, path, "INVALID_INK", "Stroke style must be an object.");
  assertExactKeys(
    record,
    ["color", "width", "opacity", "pressureEnabled", "lineCap", "lineJoin"],
    ["brushTextureId"],
    path,
    "INVALID_INK",
  );
  const color = expectString(record.color, `${path}.color`, "INVALID_INK", { nonBlank: true });
  const width = expectFiniteNumber(record.width, `${path}.width`, "INVALID_INK");
  if (width <= 0) fail("INVALID_INK", `${path}.width`, "Stroke width must be positive.");
  const opacity = expectFiniteNumber(record.opacity, `${path}.opacity`, "INVALID_INK");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_INK", `${path}.opacity`, "Stroke opacity must be between zero and one.");
  }
  if (record.lineCap !== "round" || record.lineJoin !== "round") {
    fail("INVALID_INK", path, "Stroke cap and join must use the current round contract.");
  }
  return {
    color,
    width,
    opacity,
    pressureEnabled: expectBoolean(
      record.pressureEnabled,
      `${path}.pressureEnabled`,
      "INVALID_INK",
    ),
    lineCap: "round",
    lineJoin: "round",
    ...(Object.prototype.hasOwnProperty.call(record, "brushTextureId")
      ? {
          brushTextureId: expectString(
            record.brushTextureId,
            `${path}.brushTextureId`,
            "INVALID_INK",
          ),
        }
      : {}),
  };
}

function serializeBrush(brush: ResolvedBrushSnapshot): ResolvedBrushSnapshot {
  return {
    color: brush.color,
    dynamics: {
      pressureOpacity: serializePressureResponse(brush.dynamics.pressureOpacity),
      pressureSize: serializePressureResponse(brush.dynamics.pressureSize),
    },
    family: brush.family,
    opacity: brush.opacity,
    presetId: brush.presetId,
    presetVersion: brush.presetVersion,
    renderer: { kind: brush.renderer.kind, version: brush.renderer.version },
    schemaVersion: brush.schemaVersion,
    size: brush.size,
    smoothing: { amount: brush.smoothing.amount, mode: brush.smoothing.mode },
  };
}

function serializePressureResponse(response: BrushPressureResponse): BrushPressureResponse {
  return {
    curve: { exponent: response.curve.exponent, kind: response.curve.kind },
    enabled: response.enabled,
    maximumFactor: response.maximumFactor,
    minimumFactor: response.minimumFactor,
  };
}

function parseBrush(value: unknown, path: string): ResolvedBrushSnapshot {
  const record = expectRecord(value, path, "INVALID_INK", "Resolved brush must be an object.");
  assertExactKeys(
    record,
    [
      "schemaVersion",
      "presetId",
      "presetVersion",
      "family",
      "color",
      "size",
      "opacity",
      "smoothing",
      "dynamics",
      "renderer",
    ],
    [],
    path,
    "INVALID_INK",
  );
  if (record.schemaVersion !== 1) {
    fail("INVALID_INK", `${path}.schemaVersion`, "Resolved brush schema version must be 1.");
  }
  const presetVersion = expectSafeInteger(
    record.presetVersion,
    `${path}.presetVersion`,
    "INVALID_INK",
  );
  if (presetVersion <= 0) {
    fail("INVALID_INK", `${path}.presetVersion`, "Brush preset version must be positive.");
  }
  const family = record.family;
  if (family !== "pencil" && family !== "pen" && family !== "marker" && family !== "highlighter") {
    fail("INVALID_INK", `${path}.family`, "Resolved brush family is not supported.");
  }
  const size = expectFiniteNumber(record.size, `${path}.size`, "INVALID_INK");
  if (size <= 0) fail("INVALID_INK", `${path}.size`, "Resolved brush size must be positive.");
  const opacity = expectFiniteNumber(record.opacity, `${path}.opacity`, "INVALID_INK");
  if (opacity < 0 || opacity > 1) {
    fail("INVALID_INK", `${path}.opacity`, "Resolved brush opacity must be between zero and one.");
  }
  const smoothingRecord = expectRecord(record.smoothing, `${path}.smoothing`, "INVALID_INK");
  assertExactKeys(smoothingRecord, ["mode", "amount"], [], `${path}.smoothing`, "INVALID_INK");
  const smoothingMode = smoothingRecord.mode;
  if (
    smoothingMode !== "none" &&
    smoothingMode !== "average" &&
    smoothingMode !== "catmull-rom" &&
    smoothingMode !== "bezier"
  ) {
    fail("INVALID_INK", `${path}.smoothing.mode`, "Brush smoothing mode is not supported.");
  }
  const smoothingAmount = expectFiniteNumber(
    smoothingRecord.amount,
    `${path}.smoothing.amount`,
    "INVALID_INK",
  );
  if (smoothingAmount < 0 || smoothingAmount > 1) {
    fail("INVALID_INK", `${path}.smoothing.amount`, "Brush smoothing amount is invalid.");
  }
  const dynamicsRecord = expectRecord(record.dynamics, `${path}.dynamics`, "INVALID_INK");
  assertExactKeys(
    dynamicsRecord,
    ["pressureSize", "pressureOpacity"],
    [],
    `${path}.dynamics`,
    "INVALID_INK",
  );
  const rendererRecord = expectRecord(record.renderer, `${path}.renderer`, "INVALID_INK");
  assertExactKeys(rendererRecord, ["version", "kind"], [], `${path}.renderer`, "INVALID_INK");
  // Validated against the engine's own vocabulary rather than against literals
  // repeated here, so the codec and the renderer cannot drift. A strategy this
  // build cannot draw is refused by name: falling back to a nearby strategy
  // would silently change what saved artwork looks like.
  if (!isSupportedBrushStrategy(rendererRecord.kind, rendererRecord.version)) {
    fail("INVALID_INK", `${path}.renderer`, "Resolved brush render strategy is not supported.", {
      kind: rendererRecord.kind,
      version: rendererRecord.version,
      supported: supportedBrushStrategies(),
    });
  }
  const decoded: ResolvedBrushSnapshot = {
    schemaVersion: 1,
    presetId: expectId(record.presetId, `${path}.presetId`, "INVALID_INK"),
    presetVersion,
    family,
    color: expectString(record.color, `${path}.color`, "INVALID_INK", { nonBlank: true }),
    size,
    opacity,
    smoothing: { mode: smoothingMode, amount: smoothingAmount },
    dynamics: {
      pressureSize: parsePressureResponse(
        dynamicsRecord.pressureSize,
        `${path}.dynamics.pressureSize`,
      ),
      pressureOpacity: parsePressureResponse(
        dynamicsRecord.pressureOpacity,
        `${path}.dynamics.pressureOpacity`,
      ),
    },
    renderer: {
      version: rendererRecord.version as number,
      kind: rendererRecord.kind as BrushStrategyId,
    },
  };
  return constructOrFail("INVALID_INK", path, "Resolved brush data failed Ink validation.", () =>
    createResolvedBrushSnapshot(decoded),
  );
}

function parsePressureResponse(value: unknown, path: string): BrushPressureResponse {
  const record = expectRecord(value, path, "INVALID_INK", "Pressure response must be an object.");
  assertExactKeys(
    record,
    ["enabled", "minimumFactor", "maximumFactor", "curve"],
    [],
    path,
    "INVALID_INK",
  );
  const minimumFactor = expectFiniteNumber(
    record.minimumFactor,
    `${path}.minimumFactor`,
    "INVALID_INK",
  );
  const maximumFactor = expectFiniteNumber(
    record.maximumFactor,
    `${path}.maximumFactor`,
    "INVALID_INK",
  );
  if (minimumFactor < 0 || maximumFactor < minimumFactor) {
    fail("INVALID_INK", path, "Pressure factors must be non-negative and ordered.");
  }
  const curveRecord = expectRecord(record.curve, `${path}.curve`, "INVALID_INK");
  assertExactKeys(curveRecord, ["kind", "exponent"], [], `${path}.curve`, "INVALID_INK");
  if (curveRecord.kind !== "linear" && curveRecord.kind !== "power") {
    fail("INVALID_INK", `${path}.curve.kind`, "Pressure curve kind is not supported.");
  }
  const exponent = expectFiniteNumber(
    curveRecord.exponent,
    `${path}.curve.exponent`,
    "INVALID_INK",
  );
  if (exponent <= 0) {
    fail("INVALID_INK", `${path}.curve.exponent`, "Pressure exponent must be positive.");
  }
  return {
    enabled: expectBoolean(record.enabled, `${path}.enabled`, "INVALID_INK"),
    minimumFactor,
    maximumFactor,
    curve: { kind: curveRecord.kind, exponent },
  };
}

function serializeMetrics(metrics: StrokeMetrics): StrokeMetrics {
  return {
    bounds: serializeBounds(metrics.bounds),
    center: { x: metrics.center.x, y: metrics.center.y },
    dirtyRect: {
      height: metrics.dirtyRect.height,
      width: metrics.dirtyRect.width,
      x: metrics.dirtyRect.x,
      y: metrics.dirtyRect.y,
    },
    duration: metrics.duration,
    inflatedBounds: serializeBounds(metrics.inflatedBounds),
    length: metrics.length,
  };
}

function serializeBounds(bounds: StrokeBounds): StrokeBounds {
  return {
    center: { x: bounds.center.x, y: bounds.center.y },
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
}

function serializeStatistics(statistics: StrokeStatistics): StrokeStatistics {
  return {
    averageAcceleration: statistics.averageAcceleration,
    averagePressure: statistics.averagePressure,
    averageVelocity: statistics.averageVelocity,
    maximumAcceleration: statistics.maximumAcceleration,
    maximumPressure: statistics.maximumPressure,
    maximumVelocity: statistics.maximumVelocity,
    minimumPressure: statistics.minimumPressure,
    minimumVelocity: statistics.minimumVelocity,
    pointCount: statistics.pointCount,
  };
}

function parseMetrics(value: unknown, path: string): StrokeMetrics {
  const record = expectRecord(value, path, "INVALID_INK", "Stroke metrics must be an object.");
  assertExactKeys(
    record,
    ["bounds", "inflatedBounds", "dirtyRect", "center", "length", "duration"],
    [],
    path,
    "INVALID_INK",
  );
  const length = expectFiniteNumber(record.length, `${path}.length`, "INVALID_INK");
  const duration = expectFiniteNumber(record.duration, `${path}.duration`, "INVALID_INK");
  if (length < 0 || duration < 0) {
    fail("INVALID_INK", path, "Stroke length and duration must be non-negative.");
  }
  return {
    bounds: parseBounds(record.bounds, `${path}.bounds`),
    inflatedBounds: parseBounds(record.inflatedBounds, `${path}.inflatedBounds`),
    dirtyRect: parseRect(record.dirtyRect, `${path}.dirtyRect`),
    center: parsePosition(record.center, `${path}.center`),
    length,
    duration,
  };
}

function parseStatistics(value: unknown, path: string, pointCount: number): StrokeStatistics {
  const record = expectRecord(value, path, "INVALID_INK", "Stroke statistics must be an object.");
  assertExactKeys(
    record,
    [
      "pointCount",
      "averagePressure",
      "minimumPressure",
      "maximumPressure",
      "averageVelocity",
      "minimumVelocity",
      "maximumVelocity",
      "averageAcceleration",
      "maximumAcceleration",
    ],
    [],
    path,
    "INVALID_INK",
  );
  const decodedPointCount = expectSafeInteger(
    record.pointCount,
    `${path}.pointCount`,
    "INVALID_INK",
  );
  if (decodedPointCount !== pointCount) {
    fail(
      "INVALID_INK",
      `${path}.pointCount`,
      "Stroke point count does not match processed points.",
    );
  }
  const averagePressure = expectUnitInterval(record.averagePressure, `${path}.averagePressure`);
  const minimumPressure = expectUnitInterval(record.minimumPressure, `${path}.minimumPressure`);
  const maximumPressure = expectUnitInterval(record.maximumPressure, `${path}.maximumPressure`);
  if (minimumPressure > averagePressure || averagePressure > maximumPressure) {
    fail("INVALID_INK", path, "Stroke pressure statistics are inconsistent.");
  }
  const averageVelocity = expectNonNegative(record.averageVelocity, `${path}.averageVelocity`);
  const minimumVelocity = expectNonNegative(record.minimumVelocity, `${path}.minimumVelocity`);
  const maximumVelocity = expectNonNegative(record.maximumVelocity, `${path}.maximumVelocity`);
  if (minimumVelocity > averageVelocity || averageVelocity > maximumVelocity) {
    fail("INVALID_INK", path, "Stroke velocity statistics are inconsistent.");
  }
  return {
    pointCount: decodedPointCount,
    averagePressure,
    minimumPressure,
    maximumPressure,
    averageVelocity,
    minimumVelocity,
    maximumVelocity,
    averageAcceleration: expectNonNegative(
      record.averageAcceleration,
      `${path}.averageAcceleration`,
    ),
    maximumAcceleration: expectNonNegative(
      record.maximumAcceleration,
      `${path}.maximumAcceleration`,
    ),
  };
}

function parseBounds(value: unknown, path: string): StrokeBounds {
  const record = expectRecord(value, path, "INVALID_INK", "Stroke bounds must be an object.");
  assertExactKeys(record, ["x", "y", "width", "height", "center"], [], path, "INVALID_INK");
  const width = expectFiniteNumber(record.width, `${path}.width`, "INVALID_INK");
  const height = expectFiniteNumber(record.height, `${path}.height`, "INVALID_INK");
  if (width < 0 || height < 0) {
    fail("INVALID_INK", path, "Stroke bounds dimensions must be non-negative.");
  }
  return {
    x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_INK"),
    y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_INK"),
    width,
    height,
    center: parsePosition(record.center, `${path}.center`),
  };
}

function parseRect(
  value: unknown,
  path: string,
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const record = expectRecord(value, path, "INVALID_INK", "Rectangle must be an object.");
  assertExactKeys(record, ["x", "y", "width", "height"], [], path, "INVALID_INK");
  const width = expectFiniteNumber(record.width, `${path}.width`, "INVALID_INK");
  const height = expectFiniteNumber(record.height, `${path}.height`, "INVALID_INK");
  if (width < 0 || height < 0) {
    fail("INVALID_INK", path, "Rectangle dimensions must be non-negative.");
  }
  return {
    x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_INK"),
    y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_INK"),
    width,
    height,
  };
}

function parsePosition(value: unknown, path: string): Readonly<{ x: number; y: number }> {
  const record = expectRecord(value, path, "INVALID_INK", "Position must be an object.");
  assertExactKeys(record, ["x", "y"], [], path, "INVALID_INK");
  return {
    x: expectFiniteNumber(record.x, `${path}.x`, "INVALID_INK"),
    y: expectFiniteNumber(record.y, `${path}.y`, "INVALID_INK"),
  };
}

function expectUnitInterval(value: unknown, path: string): number {
  const result = expectFiniteNumber(value, path, "INVALID_INK");
  if (result < 0 || result > 1) {
    fail("INVALID_INK", path, "Expected a number between zero and one.");
  }
  return result;
}

function expectNonNegative(value: unknown, path: string): number {
  const result = expectFiniteNumber(value, path, "INVALID_INK");
  if (result < 0) fail("INVALID_INK", path, "Expected a non-negative number.");
  return result;
}

function assertOrderedTimestamps(
  values: readonly Readonly<{ timestamp: number }>[],
  path: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]!.timestamp < values[index - 1]!.timestamp) {
      fail("INVALID_INK", `${path}[${index}].timestamp`, "Ink timestamps must be ordered.");
    }
  }
}
