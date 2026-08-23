import { InkError } from "./errors";
import {
  createLegacyBrushSnapshot,
  createResolvedBrushSnapshot,
  type ResolvedBrushSnapshot,
} from "./brush-model";
import {
  assertCoordinate,
  assertFinite,
  createBounds,
  distance,
  freezePoint,
  freezeRect,
  inflateBounds,
} from "./internal/geometry";
import { createStrokeStyle, strokeWidth } from "./internal/style";
import { Stroke } from "./stroke";
import { StrokeSmoother } from "./stroke-smoother";
import type {
  StrokeBounds,
  StrokeBuilderOptions,
  StrokeMetrics,
  StrokePoint,
  StrokePointInput,
  StrokeStatistics,
  StrokeStyle,
  StrokeUpdate,
  StrokeSampleOptions,
} from "./types";

type BuilderStatus = "active" | "finalized" | "cancelled";

export const STATIONARY_SAMPLE_INTERVAL_MS = 16;
export const STATIONARY_PRESSURE_EPSILON = 0.01;
export const STATIONARY_ANGLE_EPSILON_DEGREES = 1;
const STATIONARY_OPTIONAL_ANGLE_EPSILON_RADIANS = 0.01;

function defaultId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function freezeInput(input: StrokePointInput): StrokePointInput {
  return Object.freeze({
    x: input.x,
    y: input.y,
    timestamp: input.timestamp,
    pressure: input.pressure,
    tiltX: input.tiltX,
    tiltY: input.tiltY,
    twist: input.twist,
    pointerType: input.pointerType,
    button: input.button,
    buttons: input.buttons,
    ...(input.altitudeAngle === undefined ? {} : { altitudeAngle: input.altitudeAngle }),
    ...(input.azimuthAngle === undefined ? {} : { azimuthAngle: input.azimuthAngle }),
  });
}

export class StrokeBuilder {
  readonly id: string;
  readonly timestamp: number;
  readonly style: StrokeStyle;
  readonly brush: ResolvedBrushSnapshot;
  private readonly smoother: StrokeSmoother;
  private readonly rawPoints: StrokePointInput[] = [];
  private readonly sourceSamples: StrokePointInput[] = [];
  private readonly strokePoints: StrokePoint[] = [];
  private statusValue: BuilderStatus = "active";
  private lastInputTimestamp: number | undefined;
  private minX = Number.POSITIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;
  private lengthValue = 0;
  private pressureTotal = 0;
  private minimumPressure = 1;
  private maximumPressure = 0;
  private velocityTotal = 0;
  private minimumVelocity = Number.POSITIVE_INFINITY;
  private maximumVelocity = 0;
  private accelerationTotal = 0;
  private maximumAcceleration = 0;

  constructor(options: StrokeBuilderOptions = {}) {
    const now = options.now ?? (() => performance.now());
    this.id = options.id ?? (options.createId ?? defaultId)();
    this.timestamp = options.timestamp ?? now();
    this.style = createStrokeStyle(options.style);
    this.brush =
      options.brush === undefined
        ? createLegacyBrushSnapshot(this.style)
        : createResolvedBrushSnapshot(options.brush);
    this.smoother = options.smoother ?? new StrokeSmoother();
    if (this.id.trim().length === 0) {
      throw new InkError("INVALID_STROKE", "Stroke id must not be empty.");
    }
    assertFinite(this.timestamp, "stroke.timestamp");
  }

  get status(): BuilderStatus {
    return this.statusValue;
  }

  get pointCount(): number {
    return this.strokePoints.length;
  }

  get points(): ReadonlyArray<StrokePoint> {
    return this.strokePoints;
  }

  addPoint(input: StrokePointInput, options: StrokeSampleOptions = {}): StrokeUpdate | null {
    this.assertActive();
    this.validateInput(input);
    const previousSource = this.sourceSamples.at(-1);
    if (this.lastInputTimestamp !== undefined && input.timestamp < this.lastInputTimestamp) {
      throw new InkError("INVALID_TIMESTAMP", "Stroke timestamps must be ordered.", {
        previousTimestamp: this.lastInputTimestamp,
        timestamp: input.timestamp,
      });
    }
    const previousRaw = this.rawPoints.at(-1);
    if (previousRaw !== undefined && previousRaw.x === input.x && previousRaw.y === input.y) {
      if (shouldRetainStationarySample(previousSource ?? previousRaw, input, options)) {
        this.sourceSamples.push(freezeInput(input));
      }
      this.lastInputTimestamp = input.timestamp;
      return null;
    }

    const rawPoint = freezeInput(input);
    this.sourceSamples.push(rawPoint);
    this.rawPoints.push(rawPoint);
    let smoothedPosition;
    try {
      smoothedPosition = this.smoother.smoothNext(this.rawPoints);
    } catch (error) {
      this.rawPoints.pop();
      this.sourceSamples.pop();
      throw error;
    }
    this.lastInputTimestamp = input.timestamp;

    const previous = this.strokePoints.at(-1);
    const delta = freezePoint({
      x: previous === undefined ? 0 : smoothedPosition.x - previous.x,
      y: previous === undefined ? 0 : smoothedPosition.y - previous.y,
    });
    const segmentLength = previous === undefined ? 0 : distance(previous, smoothedPosition);
    const elapsedSeconds =
      previous === undefined
        ? 0
        : Math.max((input.timestamp - previous.timestamp) / 1_000, 0.000_001);
    const velocity = previous === undefined ? 0 : segmentLength / elapsedSeconds;
    const acceleration =
      previous === undefined ? 0 : (velocity - previous.velocity) / elapsedSeconds;
    const point: StrokePoint = Object.freeze({
      ...rawPoint,
      x: smoothedPosition.x,
      y: smoothedPosition.y,
      delta,
      velocity,
      acceleration,
    });
    this.strokePoints.push(point);
    this.updateMetrics(point, previous, segmentLength);

    const radius = strokeWidth(this.style, point.pressure) / 2 + 2;
    const segmentMinX = Math.min(previous?.x ?? point.x, point.x) - radius;
    const segmentMinY = Math.min(previous?.y ?? point.y, point.y) - radius;
    const segmentMaxX = Math.max(previous?.x ?? point.x, point.x) + radius;
    const segmentMaxY = Math.max(previous?.y ?? point.y, point.y) + radius;
    return Object.freeze({
      strokeId: this.id,
      style: this.style,
      brush: this.brush,
      point,
      points: this.strokePoints,
      bounds: this.currentBounds(),
      dirtyRect: freezeRect({
        x: segmentMinX,
        y: segmentMinY,
        width: segmentMaxX - segmentMinX,
        height: segmentMaxY - segmentMinY,
      }),
    });
  }

  finalize(): Stroke {
    this.assertActive();
    if (this.strokePoints.length === 0) {
      throw new InkError("NO_ACTIVE_STROKE", "Cannot finalize a stroke without points.");
    }
    this.statusValue = "finalized";
    const metrics = this.createMetrics();
    const statistics = this.createStatistics();
    const stroke = new Stroke({
      id: this.id,
      timestamp: this.timestamp,
      points: Object.freeze([...this.strokePoints]),
      sourceSamples: Object.freeze([...this.sourceSamples]),
      style: this.style,
      brush: this.brush,
      metrics,
      statistics,
    });
    this.releaseRawBuffers();
    this.strokePoints.length = 0;
    return stroke;
  }

  cancel(): import("@folio/rendering").Rect | null {
    this.assertActive();
    const dirtyRect = this.strokePoints.length === 0 ? null : this.createMetrics().dirtyRect;
    this.statusValue = "cancelled";
    this.releaseRawBuffers();
    this.strokePoints.length = 0;
    return dirtyRect;
  }

  private validateInput(input: StrokePointInput): void {
    assertCoordinate(input);
    assertFinite(input.timestamp, "point.timestamp");
    assertFinite(input.pressure, "point.pressure");
    if (input.pressure < 0 || input.pressure > 1) {
      throw new InkError("INVALID_PRESSURE", "Pressure must be between zero and one.", {
        pressure: input.pressure,
      });
    }
    for (const [name, value] of [
      ["tiltX", input.tiltX],
      ["tiltY", input.tiltY],
      ["twist", input.twist],
      ["button", input.button],
      ["buttons", input.buttons],
    ] as const) {
      assertFinite(value, `point.${name}`);
    }
    if (input.altitudeAngle !== undefined) assertFinite(input.altitudeAngle, "altitudeAngle");
    if (input.azimuthAngle !== undefined) assertFinite(input.azimuthAngle, "azimuthAngle");
  }

  private updateMetrics(
    point: StrokePoint,
    previous: StrokePoint | undefined,
    segmentLength: number,
  ): void {
    this.minX = Math.min(this.minX, point.x);
    this.minY = Math.min(this.minY, point.y);
    this.maxX = Math.max(this.maxX, point.x);
    this.maxY = Math.max(this.maxY, point.y);
    this.lengthValue += segmentLength;
    this.pressureTotal += point.pressure;
    this.minimumPressure = Math.min(this.minimumPressure, point.pressure);
    this.maximumPressure = Math.max(this.maximumPressure, point.pressure);
    if (previous !== undefined) {
      this.velocityTotal += point.velocity;
      this.minimumVelocity = Math.min(this.minimumVelocity, point.velocity);
      this.maximumVelocity = Math.max(this.maximumVelocity, point.velocity);
      this.accelerationTotal += Math.abs(point.acceleration);
      this.maximumAcceleration = Math.max(this.maximumAcceleration, Math.abs(point.acceleration));
    }
  }

  private currentBounds(): StrokeBounds {
    return createBounds(this.minX, this.minY, this.maxX, this.maxY);
  }

  private createMetrics(): StrokeMetrics {
    const bounds = this.currentBounds();
    const maximumWidth = this.strokePoints.reduce(
      (current, point) => Math.max(current, strokeWidth(this.style, point.pressure)),
      this.style.width,
    );
    const inflatedBounds = inflateBounds(bounds, maximumWidth / 2 + 2);
    const first = this.sourceSamples[0];
    const last = this.sourceSamples.at(-1);
    const duration =
      first === undefined || last === undefined ? 0 : last.timestamp - first.timestamp;
    return Object.freeze({
      bounds,
      inflatedBounds,
      dirtyRect: freezeRect(inflatedBounds),
      center: bounds.center,
      length: this.lengthValue,
      duration,
    });
  }

  private createStatistics(): StrokeStatistics {
    const pointCount = this.strokePoints.length;
    const segmentCount = Math.max(0, pointCount - 1);
    return Object.freeze({
      pointCount,
      averagePressure: this.pressureTotal / pointCount,
      minimumPressure: this.minimumPressure,
      maximumPressure: this.maximumPressure,
      averageVelocity: segmentCount === 0 ? 0 : this.velocityTotal / segmentCount,
      minimumVelocity: segmentCount === 0 ? 0 : this.minimumVelocity,
      maximumVelocity: this.maximumVelocity,
      averageAcceleration: segmentCount === 0 ? 0 : this.accelerationTotal / segmentCount,
      maximumAcceleration: this.maximumAcceleration,
    });
  }

  private releaseRawBuffers(): void {
    this.rawPoints.length = 0;
    this.sourceSamples.length = 0;
  }

  private assertActive(): void {
    if (this.statusValue === "finalized") {
      throw new InkError("BUILDER_FINALIZED", "The stroke builder is already finalized.");
    }
    if (this.statusValue === "cancelled") {
      throw new InkError("BUILDER_CANCELLED", "The stroke builder is cancelled.");
    }
  }
}

function shouldRetainStationarySample(
  previous: StrokePointInput,
  current: StrokePointInput,
  options: StrokeSampleOptions,
): boolean {
  if (options.phase === "terminal") return true;
  if (current.timestamp - previous.timestamp >= STATIONARY_SAMPLE_INTERVAL_MS) return true;
  if (Math.abs(current.pressure - previous.pressure) >= STATIONARY_PRESSURE_EPSILON) return true;
  if (Math.abs(current.tiltX - previous.tiltX) >= STATIONARY_ANGLE_EPSILON_DEGREES) return true;
  if (Math.abs(current.tiltY - previous.tiltY) >= STATIONARY_ANGLE_EPSILON_DEGREES) return true;
  if (
    circularAngleDistance(current.twist, previous.twist, 360) >= STATIONARY_ANGLE_EPSILON_DEGREES
  ) {
    return true;
  }
  if (
    optionalAngleChanged(
      previous.altitudeAngle,
      current.altitudeAngle,
      STATIONARY_OPTIONAL_ANGLE_EPSILON_RADIANS,
    ) ||
    optionalAngleChanged(
      previous.azimuthAngle,
      current.azimuthAngle,
      STATIONARY_OPTIONAL_ANGLE_EPSILON_RADIANS,
    )
  ) {
    return true;
  }
  return (
    current.pointerType !== previous.pointerType ||
    current.button !== previous.button ||
    current.buttons !== previous.buttons
  );
}

function circularAngleDistance(current: number, previous: number, period: number): number {
  const direct = Math.abs(current - previous) % period;
  return Math.min(direct, period - direct);
}

function optionalAngleChanged(
  previous: number | undefined,
  current: number | undefined,
  epsilon: number,
): boolean {
  if (previous === undefined || current === undefined) return previous !== current;
  return Math.abs(current - previous) >= epsilon;
}
