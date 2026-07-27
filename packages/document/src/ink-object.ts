import type { Stroke, StrokeMetrics, StrokeStatistics, StrokeStyle } from "@folio/ink";
import { freezeJsonObject } from "./internal/json";
import { Transform } from "./transform";
import type {
  InkObjectData,
  InkObjectView,
  ObjectBounds,
  ObjectMetadata,
  RenderingHints,
} from "./types";
import { assertValidObject } from "./validation";

export class InkObject implements InkObjectView {
  readonly type = "ink" as const;
  readonly version = 1 as const;
  readonly id: InkObjectData["id"];
  readonly createdAt: InkObjectData["createdAt"];
  readonly modifiedAt: InkObjectData["modifiedAt"];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: Transform;
  readonly stroke: Stroke;
  readonly renderingHints: RenderingHints;
  private readonly boundsValue: ObjectBounds;

  constructor(data: InkObjectData) {
    this.id = data.id;
    this.createdAt = data.createdAt;
    this.modifiedAt = data.modifiedAt;
    this.visible = data.visible;
    this.locked = data.locked;
    this.metadata = freezeJsonObject(data.metadata);
    this.zIndex = data.zIndex;
    this.transform = data.transform;
    this.stroke = data.stroke;
    this.renderingHints = freezeJsonObject(data.renderingHints, "$.renderingHints");
    this.boundsValue = this.transform.isIdentity
      ? this.stroke.inflatedBounds
      : Object.freeze({
          x: this.stroke.inflatedBounds.x + this.transform.translation.x,
          y: this.stroke.inflatedBounds.y + this.transform.translation.y,
          width: this.stroke.inflatedBounds.width,
          height: this.stroke.inflatedBounds.height,
        });
    assertValidObject(this);
    Object.freeze(this);
  }

  get bounds(): ObjectBounds {
    return this.boundsValue;
  }

  get metrics(): StrokeMetrics {
    return this.stroke.metrics;
  }

  get statistics(): StrokeStatistics {
    return this.stroke.statistics;
  }

  get style(): StrokeStyle {
    return this.stroke.style;
  }
}
