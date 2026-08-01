import { createEditableStyle, type EditableStyle } from "./editable-style";
import { freezeJsonObject } from "./internal/json";
import type {
  EllipseGeometry,
  EllipseObjectView,
  LineGeometry,
  LineObjectView,
  ObjectBounds,
  ObjectMetadata,
  RectangleGeometry,
  RectangleObjectView,
  VectorGeometry,
  VectorObjectData,
  VectorObjectType,
  VectorPageObject,
} from "./types";
import { assertValidObject } from "./validation";

function freezePosition(position: Readonly<{ x: number; y: number }>) {
  return Object.freeze({ x: position.x, y: position.y });
}

function freezeGeometry<TType extends VectorObjectType>(
  type: TType,
  geometry: VectorGeometry,
): VectorGeometry {
  switch (type) {
    case "line": {
      const line = geometry as LineGeometry;
      return Object.freeze({ start: freezePosition(line.start), end: freezePosition(line.end) });
    }
    case "rectangle": {
      const rectangle = geometry as RectangleGeometry;
      return Object.freeze({
        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
      });
    }
    case "ellipse": {
      const ellipse = geometry as EllipseGeometry;
      return Object.freeze({
        center: freezePosition(ellipse.center),
        radiusX: ellipse.radiusX,
        radiusY: ellipse.radiusY,
      });
    }
  }
}

export function vectorGeometryBounds(
  type: VectorObjectType,
  geometry: VectorGeometry,
): ObjectBounds {
  switch (type) {
    case "line": {
      const { start, end } = geometry as LineGeometry;
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      return Object.freeze({
        x,
        y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      });
    }
    case "rectangle": {
      const rectangle = geometry as RectangleGeometry;
      return Object.freeze({ ...rectangle });
    }
    case "ellipse": {
      const { center, radiusX, radiusY } = geometry as EllipseGeometry;
      return Object.freeze({
        x: center.x - radiusX,
        y: center.y - radiusY,
        width: radiusX * 2,
        height: radiusY * 2,
      });
    }
  }
}

function inflateBounds(bounds: ObjectBounds, amount: number): ObjectBounds {
  return Object.freeze({
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  });
}

interface VectorObjectFields<TType extends VectorObjectType, TGeometry extends VectorGeometry> {
  readonly type: TType;
  readonly version: 1;
  readonly id: VectorObjectData<TType, TGeometry>["id"];
  readonly createdAt: VectorObjectData<TType, TGeometry>["createdAt"];
  readonly modifiedAt: VectorObjectData<TType, TGeometry>["modifiedAt"];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: ObjectMetadata;
  readonly zIndex: number;
  readonly transform: VectorObjectData<TType, TGeometry>["transform"];
  readonly geometry: TGeometry;
  readonly style: EditableStyle;
  readonly localBounds: ObjectBounds;
  readonly bounds: ObjectBounds;
}

function createFields<TType extends VectorObjectType, TGeometry extends VectorGeometry>(
  data: VectorObjectData<TType, TGeometry>,
): VectorObjectFields<TType, TGeometry> {
  const geometry = freezeGeometry(data.type, data.geometry) as TGeometry;
  const style = createEditableStyle(data.style);
  const localBounds = inflateBounds(
    vectorGeometryBounds(data.type, geometry),
    style.strokeWidth / 2,
  );
  return {
    type: data.type,
    version: 1,
    id: data.id,
    createdAt: data.createdAt,
    modifiedAt: data.modifiedAt,
    visible: data.visible,
    locked: data.locked,
    metadata: freezeJsonObject(data.metadata),
    zIndex: data.zIndex,
    transform: data.transform,
    geometry,
    style,
    localBounds,
    bounds: data.transform.isIdentity ? localBounds : data.transform.transformBounds(localBounds),
  };
}

export class LineObject implements LineObjectView {
  readonly type = "line" as const;
  readonly version = 1 as const;
  readonly id: LineObjectView["id"];
  readonly createdAt: LineObjectView["createdAt"];
  readonly modifiedAt: LineObjectView["modifiedAt"];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: LineObjectView["metadata"];
  readonly zIndex: number;
  readonly transform: LineObjectView["transform"];
  readonly geometry: LineGeometry;
  readonly style: EditableStyle;
  readonly localBounds: ObjectBounds;
  readonly bounds: ObjectBounds;

  constructor(data: Omit<VectorObjectData<"line", LineGeometry>, "type">) {
    const fields = createFields({ ...data, type: "line" });
    this.id = fields.id;
    this.createdAt = fields.createdAt;
    this.modifiedAt = fields.modifiedAt;
    this.visible = fields.visible;
    this.locked = fields.locked;
    this.metadata = fields.metadata;
    this.zIndex = fields.zIndex;
    this.transform = fields.transform;
    this.geometry = fields.geometry;
    this.style = fields.style;
    this.localBounds = fields.localBounds;
    this.bounds = fields.bounds;
    assertValidObject(this);
    Object.freeze(this);
  }
}

export class RectangleObject implements RectangleObjectView {
  readonly type = "rectangle" as const;
  readonly version = 1 as const;
  readonly id: RectangleObjectView["id"];
  readonly createdAt: RectangleObjectView["createdAt"];
  readonly modifiedAt: RectangleObjectView["modifiedAt"];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: RectangleObjectView["metadata"];
  readonly zIndex: number;
  readonly transform: RectangleObjectView["transform"];
  readonly geometry: RectangleGeometry;
  readonly style: EditableStyle;
  readonly localBounds: ObjectBounds;
  readonly bounds: ObjectBounds;

  constructor(data: Omit<VectorObjectData<"rectangle", RectangleGeometry>, "type">) {
    const fields = createFields({ ...data, type: "rectangle" });
    this.id = fields.id;
    this.createdAt = fields.createdAt;
    this.modifiedAt = fields.modifiedAt;
    this.visible = fields.visible;
    this.locked = fields.locked;
    this.metadata = fields.metadata;
    this.zIndex = fields.zIndex;
    this.transform = fields.transform;
    this.geometry = fields.geometry;
    this.style = fields.style;
    this.localBounds = fields.localBounds;
    this.bounds = fields.bounds;
    assertValidObject(this);
    Object.freeze(this);
  }
}

export class EllipseObject implements EllipseObjectView {
  readonly type = "ellipse" as const;
  readonly version = 1 as const;
  readonly id: EllipseObjectView["id"];
  readonly createdAt: EllipseObjectView["createdAt"];
  readonly modifiedAt: EllipseObjectView["modifiedAt"];
  readonly visible: boolean;
  readonly locked: boolean;
  readonly metadata: EllipseObjectView["metadata"];
  readonly zIndex: number;
  readonly transform: EllipseObjectView["transform"];
  readonly geometry: EllipseGeometry;
  readonly style: EditableStyle;
  readonly localBounds: ObjectBounds;
  readonly bounds: ObjectBounds;

  constructor(data: Omit<VectorObjectData<"ellipse", EllipseGeometry>, "type">) {
    const fields = createFields({ ...data, type: "ellipse" });
    this.id = fields.id;
    this.createdAt = fields.createdAt;
    this.modifiedAt = fields.modifiedAt;
    this.visible = fields.visible;
    this.locked = fields.locked;
    this.metadata = fields.metadata;
    this.zIndex = fields.zIndex;
    this.transform = fields.transform;
    this.geometry = fields.geometry;
    this.style = fields.style;
    this.localBounds = fields.localBounds;
    this.bounds = fields.bounds;
    assertValidObject(this);
    Object.freeze(this);
  }
}

export function isVectorObject(object: unknown): object is VectorPageObject {
  return (
    object instanceof LineObject ||
    object instanceof RectangleObject ||
    object instanceof EllipseObject
  );
}
