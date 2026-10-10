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

export function encodeStroke(
  stroke: unknown,
  path: string,
  budget: ProjectResourceBudget,
): SerializedStroke {
  if (!(stroke instanceof Stroke)) {
    fail("INVALID_INK", path, "Ink artwork must contain a finalized Stroke instance.");
  }
  const serialized: SerializedStroke = {
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
  parseStroke(serialized, path, budget);
  return serialized;
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
