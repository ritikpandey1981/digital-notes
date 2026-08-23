import { InkError } from "./errors";
import {
  createLegacyBrushSnapshot,
  createResolvedBrushSnapshot,
  type ResolvedBrushSnapshot,
} from "./brush-model";
import { createStrokeStyle, strokeWidth } from "./internal/style";
import type {
  StrokeBounds,
  StrokeMetrics,
  StrokePoint,
  StrokeStatistics,
  StrokeStyle,
} from "./types";

function freezePoint(point: StrokePoint): StrokePoint {
  return Object.freeze({
    ...point,
    delta: Object.freeze({ ...point.delta }),
  });
}

function freezeBounds(bounds: StrokeBounds): StrokeBounds {
  return Object.freeze({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    center: Object.freeze({ ...bounds.center }),
  });
}

export interface StrokeData {
  readonly id: string;
  readonly timestamp: number;
  readonly points: readonly StrokePoint[];
  readonly sourceSamples?: readonly import("./types").StrokePointInput[];
  readonly style: StrokeStyle;
  readonly brush?: ResolvedBrushSnapshot;
  readonly metrics: StrokeMetrics;
  readonly statistics: StrokeStatistics;
}

export class Stroke {
  readonly id: string;
  readonly timestamp: number;
  readonly points: readonly StrokePoint[];
  readonly sourceSamples: readonly import("./types").StrokePointInput[];
  readonly style: StrokeStyle;
  readonly brush: ResolvedBrushSnapshot;
  readonly metrics: StrokeMetrics;
  readonly statistics: StrokeStatistics;

  constructor(data: StrokeData) {
    if (
      data.id.trim().length === 0 ||
      !Number.isFinite(data.timestamp) ||
      data.points.length === 0
    ) {
      throw new InkError("INVALID_STROKE", "A stroke requires an id, timestamp, and points.");
    }
    this.id = data.id;
    this.timestamp = data.timestamp;
    this.points = Object.freeze(data.points.map(freezePoint));
    const sourceSamples = data.sourceSamples ?? data.points;
    if (sourceSamples.length === 0) {
      throw new InkError("INVALID_STROKE", "A stroke requires source input samples.");
    }
    this.sourceSamples = Object.freeze(sourceSamples.map(freezeSourceSample));
    this.style = createStrokeStyle(data.style);
    this.brush =
      data.brush === undefined
        ? createLegacyBrushSnapshot(this.style)
        : createResolvedBrushSnapshot(data.brush);
    const bounds = freezeBounds(data.metrics.bounds);
    const inflatedBounds = freezeBounds(data.metrics.inflatedBounds);
    this.metrics = Object.freeze({
      ...data.metrics,
      bounds,
      inflatedBounds,
      dirtyRect: Object.freeze({ ...data.metrics.dirtyRect }),
      center: Object.freeze({ ...data.metrics.center }),
    });
    this.statistics = Object.freeze({ ...data.statistics });
    Object.freeze(this);
  }

  get bounds(): StrokeBounds {
    return this.metrics.bounds;
  }

  get inflatedBounds(): StrokeBounds {
    return this.metrics.inflatedBounds;
  }

  get length(): number {
    return this.metrics.length;
  }

  get duration(): number {
    return this.metrics.duration;
  }

  get pointCount(): number {
    return this.statistics.pointCount;
  }

  get sourceSampleCount(): number {
    return this.sourceSamples.length;
  }

  /** Returns the rendered stroke width for a normalized pressure sample. */
  widthAtPressure(pressure: number): number {
    return strokeWidth(this.style, pressure);
  }
}

function freezeSourceSample(
  point: import("./types").StrokePointInput,
): import("./types").StrokePointInput {
  return Object.freeze({
    x: point.x,
    y: point.y,
    timestamp: point.timestamp,
    pressure: point.pressure,
    tiltX: point.tiltX,
    tiltY: point.tiltY,
    twist: point.twist,
    pointerType: point.pointerType,
    button: point.button,
    buttons: point.buttons,
    ...(point.altitudeAngle === undefined ? {} : { altitudeAngle: point.altitudeAngle }),
    ...(point.azimuthAngle === undefined ? {} : { azimuthAngle: point.azimuthAngle }),
  });
}
