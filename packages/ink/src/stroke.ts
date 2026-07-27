import { InkError } from "./errors";
import { createStrokeStyle } from "./internal/style";
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
  readonly style: StrokeStyle;
  readonly metrics: StrokeMetrics;
  readonly statistics: StrokeStatistics;
}

export class Stroke {
  readonly id: string;
  readonly timestamp: number;
  readonly points: readonly StrokePoint[];
  readonly style: StrokeStyle;
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
    this.style = createStrokeStyle(data.style);
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
}
